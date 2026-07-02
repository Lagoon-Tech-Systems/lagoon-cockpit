const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-duration-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('B8: 60s duration_seconds quantization at idle cadence (G-Gk1)', () => {
  let db, dir, indexMod, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    require('../src/db/sqlite').runMigrations(db);
    jest.resetModules();
    // No SSE clients connected — the idle case (60s sampler cadence).
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
    // Force a breaching metric (cpu 99% > 90 threshold).
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({ cpuPercent: 99, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
    }));
    alerts = require('../src/system/alerts');
    pushSpy = jest.fn();
    alerts.init(db, async (...args) => { pushSpy(...args); });
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

  test('a rule with duration_seconds < 60 does not fire on the first idle tick', async () => {
    // Rule: cpu_percent > 90, duration_seconds=30. Metric breaches immediately (cpu=99).
    // First sampleTick: triggeredAt is set, but elapsed ≈ 0 < 30s → no alert_event.
    // This documents that sub-cadence durations require at least one full idle tick before firing.
    alerts.createRule('cpu', 'cpu_percent', '>', 90, 30, 'warn');

    await indexMod.sampleTick();

    const count = db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n;
    expect(count).toBe(0);
  });
});
