/**
 * Phase 2 — rollup engine, app_state helpers, guarded prune.
 * Real DB on a tmpdir DATA_DIR. No network. '?' placeholders only.
 */
const os = require("os");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

let metricsHistory;
let db;
let tmpDir;

/** Build a real DB with the metrics_history + rollup + app_state schema via metricsHistory.init(). */
function freshDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-rollup-"));
  const database = new Database(path.join(tmpDir, "cockpit.db"));
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  // Phase 1's v3 migration normally creates these; create defensively so this
  // suite is runnable standalone. IF NOT EXISTS => no-op when migration present.
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

beforeEach(() => {
  jest.resetModules();
  metricsHistory = require("../src/system/history");
  db = freshDb();
  metricsHistory.init(db); // EXISTING init creates metrics_history + index
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

describe("app_state helpers", () => {
  test("getState returns null for an absent key", () => {
    expect(metricsHistory.getState("nope")).toBeNull();
  });

  test("setState then getState round-trips a string", () => {
    metricsHistory.setState("rollup_hourly_watermark", "1750000000");
    expect(metricsHistory.getState("rollup_hourly_watermark")).toBe("1750000000");
  });

  test("setState is an UPSERT (second write overwrites, no UNIQUE error)", () => {
    metricsHistory.setState("backfill_v1_done", "0");
    metricsHistory.setState("backfill_v1_done", "1");
    expect(metricsHistory.getState("backfill_v1_done")).toBe("1");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM app_state WHERE key = ?").get("backfill_v1_done");
    expect(rows.n).toBe(1);
  });
});
