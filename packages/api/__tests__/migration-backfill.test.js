/**
 * Phase 2 — backfill + guarded prune, exercised through the REAL metricsHistory.init()
 * on a tmpdir DB. Locks init ordering: rollup tables must exist before backfill runs.
 */
const os = require("os");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let metricsHistory;
let db;
let tmpDir;

function freshDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-backfill-"));
  const database = new Database(path.join(tmpDir, "cockpit.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS metrics_rollup_hourly (
      bucket_start INTEGER PRIMARY KEY,
      cpu_min REAL, cpu_max REAL, cpu_avg REAL,
      memory_min REAL, memory_max REAL, memory_avg REAL,
      disk_min REAL, disk_max REAL, disk_avg REAL,
      load_min REAL, load_max REAL, load_avg REAL,
      container_total_min INTEGER, container_total_max INTEGER, container_total_avg REAL,
      container_running_min INTEGER, container_running_max INTEGER, container_running_avg REAL,
      sample_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metrics_rollup_daily (
      bucket_start INTEGER PRIMARY KEY,
      cpu_min REAL, cpu_max REAL, cpu_avg REAL,
      memory_min REAL, memory_max REAL, memory_avg REAL,
      disk_min REAL, disk_max REAL, disk_avg REAL,
      load_min REAL, load_max REAL, load_avg REAL,
      container_total_min INTEGER, container_total_max INTEGER, container_total_avg REAL,
      container_running_min INTEGER, container_running_max INTEGER, container_running_avg REAL,
      sample_count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return database;
}

function insertRaw(database, createdAt, m) {
  database
    .prepare(
      `INSERT INTO metrics_history
       (cpu_percent, memory_percent, disk_percent, load_1, container_total, container_running, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(m.cpu ?? null, m.mem ?? null, m.disk ?? null, m.load ?? null, m.ctotal ?? null, m.crunning ?? null, createdAt);
}

/** A created_at N days before now, at HH:05, UTC-naive. */
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400 * 1000);
  return d.toISOString().slice(0, 13).replace("T", " ") + ":05:00";
}

beforeEach(() => {
  jest.resetModules();
  metricsHistory = require("../src/system/history");
  db = freshDb();
  metricsHistory.init(db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("runBackfill", () => {
  test("rolls all existing raw into hourly + daily and sets backfill_v1_done", () => {
    insertRaw(db, daysAgo(5), { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    insertRaw(db, daysAgo(5), { cpu: 30, mem: 60, disk: 50, load: 0.3, ctotal: 4, crunning: 4 });
    insertRaw(db, daysAgo(3), { cpu: 20, mem: 50, disk: 55, load: 0.2, ctotal: 5, crunning: 5 });

    const res = metricsHistory.runBackfill(db);
    expect(res.done).toBe(true);
    expect(res.rolled).toBe(true);
    expect(metricsHistory.getState("backfill_v1_done")).toBe("1");

    const hourly = db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_hourly").get();
    const daily = db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_daily").get();
    expect(hourly.n).toBeGreaterThanOrEqual(2); // two distinct source hours
    expect(daily.n).toBeGreaterThanOrEqual(2); // two distinct source days
  });

  test("idempotent — second call is a no-op (rolled:false) and does not duplicate", () => {
    insertRaw(db, daysAgo(4), { cpu: 15, mem: 45, disk: 50, load: 0.2, ctotal: 3, crunning: 3 });
    metricsHistory.runBackfill(db);
    const hourlyAfterFirst = db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_hourly").get().n;

    // A late raw row would NOT be folded by a guarded second backfill (flag set).
    insertRaw(db, daysAgo(4), { cpu: 99, mem: 99, disk: 99, load: 9, ctotal: 9, crunning: 9 });
    const res = metricsHistory.runBackfill(db);
    expect(res.done).toBe(true);
    expect(res.rolled).toBe(false);
    const hourlyAfterSecond = db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_hourly").get().n;
    expect(hourlyAfterSecond).toBe(hourlyAfterFirst);
  });
});
