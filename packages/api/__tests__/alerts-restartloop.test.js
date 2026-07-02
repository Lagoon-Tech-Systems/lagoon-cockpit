const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-restartloop-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('B7: restart-loop dedup via gated RestartCount inspect (G-Gk1)', () => {
  let db, dir, indexMod, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    require('../src/db/sqlite').runMigrations(db);
    jest.resetModules();
    pushSpy = jest.fn(async () => {});
    // No SSE clients connected — matches the 2am oncall scenario this whole detection path serves.
    jest.doMock('../src/stream/sse', () => ({
      getClientCount: jest.fn(() => 0),
      broadcast: jest.fn(),
      closeAllClients: jest.fn(),
    }));
    // Non-breaching metrics so alertEngine.evaluateRules never contributes a push —
    // isolates the assertions to the crash-loop path.
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({ cpuPercent: 5, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
    }));
    // evaluateAndDetect lazy-requires './push/expo' directly for the crash-loop push —
    // mock it so pushSpy captures those calls (title is call[0]).
    jest.doMock('../src/push/expo', () => ({
      init: jest.fn(),
      sendPushNotification: (...args) => pushSpy(...args),
    }));

    alerts = require('../src/system/alerts');
    alerts.init(db, pushSpy);
    indexMod = require('../src/index');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.dontMock('../src/stream/sse');
    jest.dontMock('../src/docker/containers');
    jest.dontMock('../src/system/metrics');
    jest.dontMock('../src/push/expo');
    jest.resetModules();
  });

  function armTick() {
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});
  }

  test('a crash-looping container collapses to ONE crash-loop push across 4 ticks, and does not re-fire on a 5th', async () => {
    let restartCount = 0;
    const inspectContainer = jest.fn(async () => {
      restartCount += 1;
      return { State: { RestartCount: restartCount } };
    });
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [
        { id: 'c1', name: 'web', state: 'restarting', status: 'Restarting (1) 3 seconds ago' },
      ]),
      inspectContainer,
    }));
    // Re-require index after docker/containers mock is in place (lazy requires inside
    // evaluateAndDetect/sampleTick pick up jest.doMock regardless of require order, but
    // keep the same indexMod instance so module-level _restartHistory persists across ticks).

    // Tick 1: baseline — RestartCount 1, no rise counted on first sight.
    armTick();
    await indexMod.sampleTick();
    // Tick 2: RestartCount 2 — rises=1.
    armTick();
    await indexMod.sampleTick();
    // Tick 3: RestartCount 3 — rises=2.
    armTick();
    await indexMod.sampleTick();
    // Tick 4: RestartCount 4 — rises=3 → fires exactly once.
    armTick();
    await indexMod.sampleTick();

    let crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    expect(crashPushes.length).toBe(1);

    // Tick 5: RestartCount 5 — already alerted, must not fire again.
    armTick();
    await indexMod.sampleTick();
    crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    expect(crashPushes.length).toBe(1);
  });

  test('a healthy, never-transitioning container is never inspected (gated inspect)', async () => {
    const inspectContainer = jest.fn(async () => ({ State: { RestartCount: 0 } }));
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [{ id: 'c1', name: 'web', state: 'running', status: 'Up 2 hours' }]),
      inspectContainer,
    }));

    armTick();
    await indexMod.sampleTick();
    armTick();
    await indexMod.sampleTick();
    armTick();
    await indexMod.sampleTick();

    expect(inspectContainer.mock.calls.length).toBe(0);
  });
});
