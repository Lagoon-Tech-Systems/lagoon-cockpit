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

describe("boot sequence ordering (mirrors index.js)", () => {
  test("init -> runBackfill -> rollupTick produces rollups and a set backfill flag on a real tmpdir DB", () => {
    // Simulate the exact index.js boot ordering.
    insertRaw(db, daysAgo(2), { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    insertRaw(db, daysAgo(2), { cpu: 30, mem: 60, disk: 50, load: 0.3, ctotal: 4, crunning: 4 });

    // 1. init already ran in beforeEach (metrics_history exists).
    // 2. one-time backfill
    const bf = metricsHistory.runBackfill(db);
    expect(bf.done).toBe(true);
    // 3. boot catch-up tick (idempotent over already-backfilled window)
    expect(() => metricsHistory.rollupTick(db)).not.toThrow();

    expect(metricsHistory.getState("backfill_v1_done")).toBe("1");
    expect(db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_hourly").get().n).toBeGreaterThanOrEqual(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM metrics_rollup_daily").get().n).toBeGreaterThanOrEqual(1);
  });

  test("rollupTick after backfill is idempotent (catch-up does not duplicate)", () => {
    insertRaw(db, daysAgo(2), { cpu: 12, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    metricsHistory.runBackfill(db);
    const before = db.prepare("SELECT * FROM metrics_rollup_hourly ORDER BY bucket_start").all();
    metricsHistory.rollupTick(db);
    const after = db.prepare("SELECT * FROM metrics_rollup_hourly ORDER BY bucket_start").all();
    expect(after).toEqual(before);
  });
});

describe("guarded raw prune", () => {
  test("RAW_RETENTION_HOURS is 48", () => {
    expect(metricsHistory.RAW_RETENTION_HOURS).toBe(48);
  });

  test("never deletes un-rolled raw, even when older than retention", () => {
    // Old raw (5 days) but NOT rolled into hourly → must survive prune.
    insertRaw(db, daysAgo(5), { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    metricsHistory.setState("backfill_v1_done", "1"); // 48h retention active
    const deleted = metricsHistory.pruneRaw(db);
    expect(deleted).toBe(0);
    const remaining = db.prepare("SELECT COUNT(*) AS n FROM metrics_history").get().n;
    expect(remaining).toBe(1);
  });

  test("deletes old raw once its hour bucket is in metrics_rollup_hourly", () => {
    insertRaw(db, daysAgo(5), { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    metricsHistory.runBackfill(db); // rolls it into hourly + sets backfill flag
    const deleted = metricsHistory.pruneRaw(db);
    expect(deleted).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM metrics_history").get().n).toBe(0);
  });

  test("keeps raw within the retention window even if rolled", () => {
    // Recent raw (1h ago) rolled, but inside 48h → must NOT be pruned (sparkline still uses it).
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 13).replace("T", " ") + ":05:00";
    insertRaw(db, oneHourAgo, { cpu: 22, mem: 50, disk: 50, load: 0.3, ctotal: 5, crunning: 5 });
    metricsHistory.runBackfill(db);
    const deleted = metricsHistory.pruneRaw(db);
    expect(deleted).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM metrics_history").get().n).toBe(1);
  });

  test("before backfill, retention is 168h (legacy window preserved)", () => {
    // 5-day-old raw, rolled into hourly, but backfill flag NOT set → 168h window keeps it.
    insertRaw(db, daysAgo(5), { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 4, crunning: 4 });
    metricsHistory.rollupTick(db); // rolls into hourly, does NOT set backfill_v1_done
    expect(metricsHistory.getState("backfill_v1_done")).toBeNull();
    const deleted = metricsHistory.pruneRaw(db);
    expect(deleted).toBe(0); // 5d < 168h(=7d) → retained
    expect(db.prepare("SELECT COUNT(*) AS n FROM metrics_history").get().n).toBe(1);
  });
});
