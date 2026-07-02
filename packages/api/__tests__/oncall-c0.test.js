const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-c0-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('C0: alert evaluation fires with zero SSE clients', () => {
  let db, dir, indexMod, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    jest.resetModules();
    // No SSE clients connected — the 2am case.
    jest.doMock('../src/stream/sse', () => ({
      getClientCount: jest.fn(() => 0),
      broadcast: jest.fn(),
      closeAllClients: jest.fn(),
    }));
    // Mock containers so sampleTick has data and no real Docker is touched.
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [{ id: 'c1', name: 'web', state: 'running' }]),
      inspectContainer: jest.fn(async () => ({ State: { RestartCount: 0 } })),
    }));
    // Force a breaching metric.
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({ cpuPercent: 99, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
    }));
    alerts = require('../src/system/alerts');
    alerts.init(db, async (...args) => { pushSpy(...args); });
    pushSpy = jest.fn();
    // A rule that trips immediately (cpu > 90, duration 0).
    alerts.createRule('cpu-high', 'cpu_percent', '>', 90, 0);
    indexMod = require('../src/index');
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.dontMock('../src/stream/sse');
    jest.dontMock('../src/docker/containers');
    jest.dontMock('../src/system/metrics');
    jest.resetModules();
  });

  test('an alert_event is recorded after sampleTick with 0 SSE clients', async () => {
    const before = db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n;
    await indexMod.sampleTick();
    const after = db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n;
    expect(after).toBe(before + 1);
  });
});

test('broadcastLoop still emits the same SSE events when a client is connected (G-B1 zero-delta)', async () => {
  jest.resetModules();
  const broadcast = jest.fn();
  jest.doMock('../src/stream/sse', () => ({ getClientCount: jest.fn(() => 1), broadcast, closeAllClients: jest.fn() }));
  jest.doMock('../src/docker/containers', () => ({
    listContainers: jest.fn(async () => [{ id: 'c1', name: 'web', state: 'running' }]),
    inspectContainer: jest.fn(async () => ({ State: { RestartCount: 0 } })),
  }));
  // Fresh module has no cached _latest (getLatest() is null), so broadcastLoop falls back
  // to getSystemMetrics() — mock it too or the real implementation runs.
  jest.doMock('../src/system/metrics', () => ({
    getSystemMetrics: () => ({ cpuPercent: 99, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
  }));
  const idx = require('../src/index');
  await idx._runBroadcastOnce(); // exported test seam wrapping broadcastLoop body
  const events = broadcast.mock.calls.map((c) => c[0]).sort();
  expect(events).toEqual(['containers', 'metrics']); // exactly the SSE payloads, no alert side-effects added/removed
});

describe('C0 Task A3: cold-start storm guard prevents boot-time alert storm (G-T1)', () => {
  let db, dir, indexMod, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    jest.resetModules();
    // No SSE clients connected — the 2am deploy case.
    jest.doMock('../src/stream/sse', () => ({
      getClientCount: jest.fn(() => 0),
      broadcast: jest.fn(),
      closeAllClients: jest.fn(),
    }));
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [{ id: 'c1', name: 'web', state: 'running' }]),
      inspectContainer: jest.fn(async () => ({ State: { RestartCount: 0 } })),
    }));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.dontMock('../src/stream/sse');
    jest.dontMock('../src/docker/containers');
    jest.dontMock('../src/system/metrics');
    jest.resetModules();
  });

  test('a rule already breaching at boot is suppressed through the cooldown, not just the first tick', async () => {
    // Force a rule that's already breaching at the moment the process comes up.
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({ cpuPercent: 99, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
    }));
    alerts = require('../src/system/alerts');
    pushSpy = jest.fn();
    alerts.init(db, async (...args) => { pushSpy(...args); });
    alerts.createRule('cpu-high', 'cpu_percent', '>', 90, 0);
    indexMod = require('../src/index');
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});

    alerts.seedColdStart(); // called once at boot, mirroring index.js bootstrap
    await indexMod.sampleTick(); // baseline tick: already-breaching rule must not fire
    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(0);

    // Clear the sampler throttle only (not the alert cooldown) and sample again —
    // the storm is prevented outright, not merely delayed one tick.
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});
    await indexMod.sampleTick();
    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(0);
  });

  test('a new breach that starts after the baseline tick fires immediately (guard does not delay genuine incidents)', async () => {
    const metricsState = { cpu: 10 }; // healthy at boot
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({
        cpuPercent: metricsState.cpu,
        memory: { percent: 10 },
        disk: { percent: 10 },
        load: { load1: 0.1 },
      }),
    }));
    alerts = require('../src/system/alerts');
    pushSpy = jest.fn();
    alerts.init(db, async (...args) => { pushSpy(...args); });
    alerts.createRule('cpu-high', 'cpu_percent', '>', 90, 0);
    indexMod = require('../src/index');
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});

    alerts.seedColdStart();
    await indexMod.sampleTick(); // baseline tick: not breaching, nothing to suppress
    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(0);

    metricsState.cpu = 99; // a genuinely new incident after boot
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});
    await indexMod.sampleTick();
    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(1);
  });
});

test('evaluateAndDetect broadcasts an SSE alert on container state change with zero SSE clients (C0 review fix wave 1)', async () => {
  jest.resetModules();
  // Zero SSE clients throughout — the mobile Alerts tab's only data source must still fire.
  const broadcast = jest.fn();
  jest.doMock('../src/stream/sse', () => ({ getClientCount: jest.fn(() => 0), broadcast, closeAllClients: jest.fn() }));
  const listContainers = jest
    .fn()
    .mockResolvedValueOnce([{ id: 'c1', name: 'web', state: 'running' }])
    .mockResolvedValueOnce([{ id: 'c1', name: 'web', state: 'exited' }]);
  jest.doMock('../src/docker/containers', () => ({
    listContainers,
    inspectContainer: jest.fn(async () => ({ State: { RestartCount: 0 } })),
  }));
  jest.doMock('../src/system/metrics', () => ({
    getSystemMetrics: () => ({ cpuPercent: 10, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
  }));
  const idx = require('../src/index');

  // Tick 1: establish 'running' as the previous state. Reset sampler state between ticks
  // (rather than bumping clientCount to 1) to keep the scenario at true zero-client throughout,
  // clearing the 60s zero-client throttle so the second tick isn't a same-instant early-return.
  idx._resetSamplerState();
  idx._setRecorder(() => {});
  await idx.sampleTick();

  // Tick 2: running -> exited state change.
  idx._resetSamplerState();
  idx._setRecorder(() => {});
  await idx.sampleTick();

  expect(broadcast).toHaveBeenCalledWith(
    'alert',
    expect.objectContaining({ type: 'container_state_change', containerId: 'c1', currentState: 'exited' }),
  );
});
