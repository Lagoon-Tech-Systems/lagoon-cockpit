const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-hysteresis-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('B6: hysteresis — clear band + clear-duration (+ debounce fallback)', () => {
  let db, dir, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    require('../src/db/sqlite').runMigrations(db);
    jest.resetModules();
    alerts = require('../src/system/alerts');
    pushSpy = jest.fn(async () => {});
    alerts.init(db, (...args) => pushSpy(...args));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.resetModules();
  });

  test('a value oscillating just under the threshold does not re-fire (hysteresis)', () => {
    alerts.createRule('cpu', 'cpu_percent', '>', 90, 0, 'warn'); // band → clears below 85.5
    const m = (cpu) => ({ cpuPercent: cpu, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } });
    alerts.evaluateRules(m(95), { stopped: 0 }); // fire (1 event)
    alerts.evaluateRules(m(88), { stopped: 0 }); // dips below 90 but inside the band → still active, NO new event
    alerts.evaluateRules(m(95), { stopped: 0 }); // back up — must NOT be a fresh fire (cooldown still applies)

    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(1);
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  test('full clear past the band resolves (one recovery push + one info event); a later breach re-fires fresh', async () => {
    alerts.createRule('cpu', 'cpu_percent', '>', 90, 0, 'warn'); // clear_duration 0, band clears below 85.5
    const m = (cpu) => ({ cpuPercent: cpu, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } });

    alerts.evaluateRules(m(95), { stopped: 0 }); // fire
    await new Promise((resolve) => setImmediate(resolve));

    alerts.evaluateRules(m(10), { stopped: 0 }); // past the 85.5 band → resolve
    await new Promise((resolve) => setImmediate(resolve));

    const resolveEvent = db.prepare("SELECT * FROM alert_events WHERE severity = 'info' ORDER BY id DESC").get();
    expect(resolveEvent).toBeTruthy();
    expect(db.prepare('SELECT COUNT(*) AS n FROM alert_events').get().n).toBe(2); // fire + resolve
    expect(pushSpy).toHaveBeenCalledTimes(2); // fire push + recovery push

    // Re-breach after delete creates a fresh entry with notifiedAt 0 → fires immediately.
    alerts.evaluateRules(m(95), { stopped: 0 });
    await new Promise((resolve) => setImmediate(resolve));

    const fireEvents = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE severity != 'info'").get().n;
    expect(fireEvents).toBe(2);
  });

  test('clear_duration_seconds is honored — no resolve until the duration elapses', () => {
    const rule = alerts.createRule('cpu', 'cpu_percent', '>', 90, 0, 'warn');
    db.prepare('UPDATE alert_rules SET clear_duration_seconds = 3600 WHERE id = ?').run(rule.id);

    const m = (cpu) => ({ cpuPercent: cpu, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } });

    alerts.evaluateRules(m(95), { stopped: 0 }); // fire
    alerts.evaluateRules(m(10), { stopped: 0 }); // past the band, but clear_duration not elapsed → no resolve yet

    let resolveEvent = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE severity = 'info'").get().n;
    expect(resolveEvent).toBe(0);

    alerts.evaluateRules(m(10), { stopped: 0 }); // still within the hour → still no resolve

    resolveEvent = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE severity = 'info'").get().n;
    expect(resolveEvent).toBe(0);
  });

  test('container_stopped debounces on K=2 consecutive clear ticks', async () => {
    alerts.createRule('container-down', 'container_stopped', '>', 0, 0, 'warn');
    const m = () => ({ cpuPercent: 0, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } });

    alerts.evaluateRules(m(), { stopped: 1 }); // fire
    await new Promise((resolve) => setImmediate(resolve));

    alerts.evaluateRules(m(), { stopped: 0 }); // clear tick 1 — NOT resolved yet
    await new Promise((resolve) => setImmediate(resolve));

    let resolveEvent = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE severity = 'info'").get().n;
    expect(resolveEvent).toBe(0);
    expect(pushSpy).toHaveBeenCalledTimes(1); // only the fire push so far

    alerts.evaluateRules(m(), { stopped: 0 }); // clear tick 2 — resolved
    await new Promise((resolve) => setImmediate(resolve));

    resolveEvent = db.prepare("SELECT COUNT(*) AS n FROM alert_events WHERE severity = 'info'").get().n;
    expect(resolveEvent).toBe(1);
    expect(pushSpy).toHaveBeenCalledTimes(2); // fire push + recovery push
  });
});
