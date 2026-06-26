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

/** Insert a raw metrics_history row with an explicit UTC-naive created_at. */
function insertRaw(database, createdAt, m) {
  database
    .prepare(
      `INSERT INTO metrics_history
       (cpu_percent, memory_percent, disk_percent, load_1, container_total, container_running, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.cpu ?? null,
      m.mem ?? null,
      m.disk ?? null,
      m.load ?? null,
      m.ctotal ?? null,
      m.crunning ?? null,
      createdAt,
    );
}

describe("rollupTick raw -> hourly", () => {
  test("MIN/MAX/AVG match known input; sample_count = COUNT(cpu_percent); bucket_start epoch is correct", () => {
    // Three samples inside the 2026-06-01 10:00 UTC hour (epoch 1748772000).
    insertRaw(db, "2026-06-01 10:05:00", { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 8, crunning: 6 });
    insertRaw(db, "2026-06-01 10:25:00", { cpu: 20, mem: 50, disk: 50, load: 0.3, ctotal: 8, crunning: 7 });
    insertRaw(db, "2026-06-01 10:55:00", { cpu: 30, mem: 60, disk: 51, load: 0.2, ctotal: 9, crunning: 8 });

    metricsHistory.rollupTick(db);

    const expectedBucket = Math.floor(Date.parse("2026-06-01T10:00:00Z") / 1000); // 1748772000
    const row = db.prepare("SELECT * FROM metrics_rollup_hourly WHERE bucket_start = ?").get(expectedBucket);
    expect(row).toBeTruthy();
    expect(row.bucket_start).toBe(expectedBucket);
    expect(row.cpu_min).toBe(10);
    expect(row.cpu_max).toBe(30);
    expect(row.cpu_avg).toBe(20); // ROUND(AVG(10,20,30),2)
    expect(row.memory_min).toBe(40);
    expect(row.memory_max).toBe(60);
    expect(row.memory_avg).toBe(50);
    expect(row.disk_min).toBe(50);
    expect(row.disk_max).toBe(51);
    expect(row.container_total_min).toBe(8);
    expect(row.container_total_max).toBe(9);
    expect(row.container_running_max).toBe(8);
    expect(row.sample_count).toBe(3);
  });

  test("sample_count counts only non-null cpu_percent (NaN-coerced-null rows excluded)", () => {
    insertRaw(db, "2026-06-01 11:05:00", { cpu: 12, mem: 40, disk: 50, load: 0.1, ctotal: 5, crunning: 5 });
    insertRaw(db, "2026-06-01 11:35:00", { cpu: null, mem: 41, disk: 50, load: null, ctotal: 5, crunning: 5 });
    metricsHistory.rollupTick(db);
    const bucket = Math.floor(Date.parse("2026-06-01T11:00:00Z") / 1000);
    const row = db.prepare("SELECT * FROM metrics_rollup_hourly WHERE bucket_start = ?").get(bucket);
    expect(row.sample_count).toBe(1); // COUNT(cpu_percent), not COUNT(*)=2
    expect(row.cpu_avg).toBe(12);
  });

  test("all-NULL cpu bucket is skipped (HAVING COUNT(cpu_percent) > 0)", () => {
    insertRaw(db, "2026-06-01 12:05:00", { cpu: null, mem: null, disk: null, load: null, ctotal: null, crunning: null });
    insertRaw(db, "2026-06-01 12:35:00", { cpu: null, mem: 30, disk: 40, load: 0.5, ctotal: 3, crunning: 3 });
    metricsHistory.rollupTick(db);
    const bucket = Math.floor(Date.parse("2026-06-01T12:00:00Z") / 1000);
    const row = db.prepare("SELECT * FROM metrics_rollup_hourly WHERE bucket_start = ?").get(bucket);
    expect(row).toBeUndefined();
  });

  test("idempotent — running rollupTick twice yields identical hourly rows", () => {
    insertRaw(db, "2026-06-01 13:10:00", { cpu: 5, mem: 20, disk: 30, load: 0.1, ctotal: 2, crunning: 2 });
    insertRaw(db, "2026-06-01 13:50:00", { cpu: 15, mem: 22, disk: 30, load: 0.2, ctotal: 2, crunning: 2 });
    metricsHistory.rollupTick(db);
    const first = db.prepare("SELECT * FROM metrics_rollup_hourly ORDER BY bucket_start").all();
    const wmAfterFirst = metricsHistory.getState("rollup_hourly_watermark");
    metricsHistory.rollupTick(db);
    const second = db.prepare("SELECT * FROM metrics_rollup_hourly ORDER BY bucket_start").all();
    const wmAfterSecond = metricsHistory.getState("rollup_hourly_watermark");
    expect(second).toEqual(first);
    expect(wmAfterSecond).toBe(wmAfterFirst); // watermark is stable across idempotent re-runs
  });

  test("the current incomplete hour is NOT finalized", () => {
    const now = new Date();
    const isoThisHour = now.toISOString().slice(0, 13).replace("T", " ") + ":30:00"; // YYYY-MM-DD HH:30:00 UTC
    insertRaw(db, isoThisHour, { cpu: 99, mem: 99, disk: 99, load: 9, ctotal: 1, crunning: 1 });
    metricsHistory.rollupTick(db);
    const curBucket = Math.floor(Date.now() / 1000 / 3600) * 3600;
    const row = db.prepare("SELECT * FROM metrics_rollup_hourly WHERE bucket_start = ?").get(curBucket);
    expect(row).toBeUndefined();
  });
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
