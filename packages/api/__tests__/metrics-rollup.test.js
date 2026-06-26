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

describe("rollupTick hourly -> daily (sample-weighted avg)", () => {
  test("daily avg is sample-weighted; daily min/max/sample_count fold the hourly rows", () => {
    // Two completed hours on 2026-06-01, weights 1 and 9 → weighted cpu avg = (10*1 + 20*9)/10 = 19.
    insertRaw(db, "2026-06-01 08:05:00", { cpu: 10, mem: 30, disk: 40, load: 0.1, ctotal: 4, crunning: 4 });
    let i;
    for (i = 0; i < 9; i++) {
      insertRaw(db, "2026-06-01 09:0" + i + ":00", { cpu: 20, mem: 50, disk: 45, load: 0.5, ctotal: 6, crunning: 5 });
    }
    metricsHistory.rollupTick(db);

    const dayBucket = Math.floor(Date.parse("2026-06-01T00:00:00Z") / 1000);
    const row = db.prepare("SELECT * FROM metrics_rollup_daily WHERE bucket_start = ?").get(dayBucket);
    expect(row).toBeTruthy();
    expect(row.bucket_start).toBe(dayBucket);
    expect(row.sample_count).toBe(10); // SUM(1, 9)
    expect(row.cpu_min).toBe(10);
    expect(row.cpu_max).toBe(20);
    expect(row.cpu_avg).toBe(19); // weighted, NOT the simple mean 15
    expect(row.memory_min).toBe(30);
    expect(row.memory_max).toBe(50);
    expect(row.container_total_max).toBe(6);
  });

  test("daily rollup is idempotent (twice == identical)", () => {
    insertRaw(db, "2026-06-02 08:05:00", { cpu: 11, mem: 33, disk: 44, load: 0.2, ctotal: 3, crunning: 3 });
    insertRaw(db, "2026-06-02 09:05:00", { cpu: 22, mem: 44, disk: 44, load: 0.4, ctotal: 3, crunning: 3 });
    metricsHistory.rollupTick(db);
    const first = db.prepare("SELECT * FROM metrics_rollup_daily ORDER BY bucket_start").all();
    metricsHistory.rollupTick(db);
    const second = db.prepare("SELECT * FROM metrics_rollup_daily ORDER BY bucket_start").all();
    expect(second).toEqual(first);
  });

  test("today's incomplete day is not finalized", () => {
    const now = new Date();
    const isoToday = now.toISOString().slice(0, 10) + " 00:30:00";
    insertRaw(db, isoToday, { cpu: 50, mem: 50, disk: 50, load: 1, ctotal: 1, crunning: 1 });
    metricsHistory.rollupTick(db);
    const todayBucket = Math.floor(Date.now() / 1000 / 86400) * 86400;
    const row = db.prepare("SELECT * FROM metrics_rollup_daily WHERE bucket_start = ?").get(todayBucket);
    // The current hour is excluded from hourly, and today's day is excluded from daily.
    expect(row).toBeUndefined();
  });
});

describe("getTrendBuckets reads", () => {
  test("hourly tier returns bucket objects with t + full metric key set, ascending", () => {
    insertRaw(db, "2026-06-01 10:05:00", { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 8, crunning: 6 });
    insertRaw(db, "2026-06-01 11:05:00", { cpu: 20, mem: 50, disk: 50, load: 0.2, ctotal: 8, crunning: 7 });
    metricsHistory.rollupTick(db);

    const from = Math.floor(Date.parse("2026-06-01T00:00:00Z") / 1000);
    const to = Math.floor(Date.parse("2026-06-02T00:00:00Z") / 1000);
    const buckets = metricsHistory.getTrendBuckets({ tier: "hourly", fromEpoch: from, toEpoch: to });

    expect(Array.isArray(buckets)).toBe(true);
    expect(buckets.length).toBe(2);
    expect(buckets[0].t).toBeLessThan(buckets[1].t);
    const b = buckets[0];
    for (const k of [
      "t", "cpu_min", "cpu_max", "cpu_avg", "memory_min", "memory_max", "memory_avg",
      "disk_min", "disk_max", "disk_avg", "load_min", "load_max", "load_avg",
      "container_total_min", "container_total_max", "container_total_avg",
      "container_running_min", "container_running_max", "container_running_avg", "sample_count",
    ]) {
      expect(b).toHaveProperty(k);
    }
    expect(b.cpu_avg).toBe(10);
    expect(b.sample_count).toBe(1);
  });

  test("daily tier reads from metrics_rollup_daily", () => {
    insertRaw(db, "2026-06-01 08:05:00", { cpu: 12, mem: 30, disk: 40, load: 0.1, ctotal: 2, crunning: 2 });
    insertRaw(db, "2026-06-01 09:05:00", { cpu: 18, mem: 32, disk: 40, load: 0.2, ctotal: 2, crunning: 2 });
    metricsHistory.rollupTick(db);
    const from = Math.floor(Date.parse("2026-05-30T00:00:00Z") / 1000);
    const to = Math.floor(Date.parse("2026-06-03T00:00:00Z") / 1000);
    const buckets = metricsHistory.getTrendBuckets({ tier: "daily", fromEpoch: from, toEpoch: to });
    expect(buckets.length).toBe(1);
    expect(buckets[0].cpu_min).toBe(12);
    expect(buckets[0].cpu_max).toBe(18);
  });

  test("raw tier maps each row to min=max=avg=value, sample_count:1", () => {
    insertRaw(db, "2026-06-01 10:05:00", { cpu: 17, mem: 41, disk: 52, load: 0.7, ctotal: 9, crunning: 8 });
    const t = Math.floor(Date.parse("2026-06-01T10:05:00Z") / 1000);
    const buckets = metricsHistory.getTrendBuckets({ tier: "raw", fromEpoch: t - 60, toEpoch: t + 60 });
    expect(buckets.length).toBe(1);
    const b = buckets[0];
    expect(b.t).toBe(t);
    expect(b.cpu_min).toBe(17);
    expect(b.cpu_max).toBe(17);
    expect(b.cpu_avg).toBe(17);
    expect(b.memory_min).toBe(41);
    expect(b.memory_avg).toBe(41);
    expect(b.container_running_max).toBe(8);
    expect(b.sample_count).toBe(1);
  });

  test("buckets outside [fromEpoch, toEpoch) are excluded", () => {
    insertRaw(db, "2026-06-01 10:05:00", { cpu: 10, mem: 40, disk: 50, load: 0.1, ctotal: 8, crunning: 6 });
    insertRaw(db, "2026-06-05 10:05:00", { cpu: 99, mem: 99, disk: 99, load: 9, ctotal: 1, crunning: 1 });
    metricsHistory.rollupTick(db);
    const from = Math.floor(Date.parse("2026-06-01T00:00:00Z") / 1000);
    const to = Math.floor(Date.parse("2026-06-02T00:00:00Z") / 1000);
    const buckets = metricsHistory.getTrendBuckets({ tier: "hourly", fromEpoch: from, toEpoch: to });
    expect(buckets.every((x) => x.t >= from && x.t < to)).toBe(true);
    expect(buckets.find((x) => x.cpu_max === 99)).toBeUndefined();
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
