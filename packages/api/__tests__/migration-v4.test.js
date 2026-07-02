const fs=require('fs'),os=require('os'),path=require('path'),Database=require('better-sqlite3');
test('v4 migration adds severity + hysteresis columns to alert_rules/alert_events', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cockpit-mig4-'));
  const db=new Database(path.join(dir,'test.db')); db.pragma('foreign_keys = ON');
  const { runMigrations } = require('../src/db/sqlite');
  runMigrations(db);
  const ruleCols = db.prepare("PRAGMA table_info(alert_rules)").all().map(c=>c.name);
  const evCols = db.prepare("PRAGMA table_info(alert_events)").all().map(c=>c.name);
  expect(ruleCols).toEqual(expect.arrayContaining(['severity','clear_threshold','clear_duration_seconds']));
  expect(evCols).toEqual(expect.arrayContaining(['severity']));
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v;
  expect(v).toBeGreaterThanOrEqual(4);
  db.close(); fs.rmSync(dir,{recursive:true,force:true});
});
