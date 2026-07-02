const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-severity-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('B2: severity threaded through createRule/evaluateRules + event + push', () => {
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

  test('a critical rule writes severity to the event and passes it to push', async () => {
    alerts.createRule('cpu', 'cpu_percent', '>', 90, 0, 'critical');
    alerts.evaluateRules(
      { cpuPercent: 99, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } },
      { stopped: 0 },
    );

    // Allow the fire-and-forget pushNotify promise to settle.
    await new Promise((resolve) => setImmediate(resolve));

    const ev = db.prepare('SELECT * FROM alert_events ORDER BY id DESC').get();
    expect(ev.severity).toBe('critical');

    expect(pushSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ type: 'alert_rule', ruleId: expect.any(Number), eventId: expect.any(Number), severity: 'critical' }),
      expect.objectContaining({ severity: 'critical' }),
    );
  });

  test('createRule without severity defaults to warn', () => {
    const rule = alerts.createRule('mem', 'memory_percent', '>', 80, 0);
    expect(rule.severity).toBe('warn');

    const row = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(rule.id);
    expect(row.severity).toBe('warn');
  });

  test('resolving a previously-notified alert fires exactly one info recovery push', async () => {
    alerts.createRule('cpu', 'cpu_percent', '>', 90, 0, 'warn');
    alerts.evaluateRules(
      { cpuPercent: 99, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } },
      { stopped: 0 },
    ); // fire

    await new Promise((resolve) => setImmediate(resolve));
    pushSpy.mockClear();

    alerts.evaluateRules(
      { cpuPercent: 10, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } },
      { stopped: 0 },
    ); // resolve

    await new Promise((resolve) => setImmediate(resolve));

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(
      expect.stringMatching(/resolved/i),
      expect.any(String),
      expect.objectContaining({ type: 'resolve' }),
      expect.objectContaining({ severity: 'info' }),
    );

    const ev = db.prepare('SELECT * FROM alert_events ORDER BY id DESC').get();
    expect(ev.severity).toBe('info');
  });

  test('a rule that trips but never notifies (long duration) resolving fires no push and no resolve event', async () => {
    alerts.createRule('cpu-slow', 'cpu_percent', '>', 90, 3600, 'warn');
    alerts.evaluateRules(
      { cpuPercent: 99, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } },
      { stopped: 0 },
    ); // trips, but duration_seconds gate never met — never notifies

    await new Promise((resolve) => setImmediate(resolve));
    pushSpy.mockClear();

    const eventCountBefore = db.prepare('SELECT COUNT(*) as c FROM alert_events').get().c;

    alerts.evaluateRules(
      { cpuPercent: 10, memory: { percent: 0 }, disk: { percent: 0 }, load: { load1: 0 } },
      { stopped: 0 },
    ); // resolve

    await new Promise((resolve) => setImmediate(resolve));

    expect(pushSpy).not.toHaveBeenCalled();
    const eventCountAfter = db.prepare('SELECT COUNT(*) as c FROM alert_events').get().c;
    expect(eventCountAfter).toBe(eventCountBefore);
  });
});
