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
});
