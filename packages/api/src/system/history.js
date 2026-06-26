/**
 * Historical metrics storage.
 * Stores CPU/RAM/disk snapshots in SQLite for trend visualization.
 */

let db = null;

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cpu_percent REAL,
      memory_percent REAL,
      disk_percent REAL,
      load_1 REAL,
      container_total INTEGER,
      container_running INTEGER,
      created_at DATETIME DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_created ON metrics_history(created_at);
  `);

  // Cleanup old entries (keep 7 days)
  setInterval(
    () => {
      if (db) db.prepare("DELETE FROM metrics_history WHERE created_at < datetime('now', '-7 days')").run();
    },
    60 * 60 * 1000,
  ); // Every hour
}

/** Coerce a value to a finite number or null (NaN/Infinity → null so SQLite binds clean NULL) */
function finiteOrNull(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Record a metrics snapshot */
function recordMetrics(metrics, containerStats) {
  if (!db) return;
  db.prepare(
    `
    INSERT INTO metrics_history (cpu_percent, memory_percent, disk_percent, load_1, container_total, container_running)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    finiteOrNull(metrics.cpuPercent),
    finiteOrNull(metrics.memory.percent),
    finiteOrNull(metrics.disk.percent),
    finiteOrNull(metrics.load.load1),
    finiteOrNull(containerStats.total),
    finiteOrNull(containerStats.running),
  );
}

/** Get historical metrics for the last N hours */
function getHistory(hours = 24) {
  if (!db) return [];
  return db
    .prepare(
      `
    SELECT cpu_percent, memory_percent, disk_percent, load_1,
           container_total, container_running, created_at
    FROM metrics_history
    WHERE created_at > datetime('now', '-' || ? || ' hours')
    ORDER BY created_at ASC
  `,
    )
    .all(hours);
}

/** Get a summary with min/max/avg for each metric */
function getHistorySummary(hours = 24) {
  if (!db) return null;
  return db
    .prepare(
      `
    SELECT
      COUNT(*) as data_points,
      ROUND(AVG(cpu_percent), 2) as cpu_avg,
      ROUND(MAX(cpu_percent), 2) as cpu_max,
      ROUND(MIN(cpu_percent), 2) as cpu_min,
      ROUND(AVG(memory_percent), 2) as memory_avg,
      ROUND(MAX(memory_percent), 2) as memory_max,
      ROUND(AVG(disk_percent), 2) as disk_avg,
      ROUND(MAX(disk_percent), 2) as disk_max,
      ROUND(AVG(load_1), 2) as load_avg,
      ROUND(MAX(load_1), 2) as load_max
    FROM metrics_history
    WHERE created_at > datetime('now', '-' || ? || ' hours')
  `,
    )
    .get(hours);
}

/** Read a value from the generic app_state key/value table; null if absent. */
function getState(key) {
  if (!db) return null;
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(key);
  return row ? row.value : null;
}

/** Upsert a value into the generic app_state key/value table. */
function setState(key, value) {
  if (!db) return;
  db.prepare(
    `
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, value);
}

// SQL fragment shared by tick + backfill. Folds raw rows whose hour bucket is
// in [lowBound, upperExclusive) into metrics_rollup_hourly. bucket_start is the
// canonical UTC-epoch-seconds conversion — NEVER bare unixepoch().
const HOURLY_UPSERT_SQL = `
  INSERT INTO metrics_rollup_hourly
    (bucket_start, cpu_min, cpu_max, cpu_avg, memory_min, memory_max, memory_avg,
     disk_min, disk_max, disk_avg, load_min, load_max, load_avg,
     container_total_min, container_total_max, container_total_avg,
     container_running_min, container_running_max, container_running_avg, sample_count)
  SELECT CAST(strftime('%s', created_at) AS INTEGER) / 3600 * 3600 AS bucket_start,
         MIN(cpu_percent), MAX(cpu_percent), ROUND(AVG(cpu_percent), 2),
         MIN(memory_percent), MAX(memory_percent), ROUND(AVG(memory_percent), 2),
         MIN(disk_percent), MAX(disk_percent), ROUND(AVG(disk_percent), 2),
         MIN(load_1), MAX(load_1), ROUND(AVG(load_1), 2),
         MIN(container_total), MAX(container_total), ROUND(AVG(container_total), 2),
         MIN(container_running), MAX(container_running), ROUND(AVG(container_running), 2),
         COUNT(cpu_percent)
  FROM metrics_history
  WHERE created_at >= ? AND created_at < ?
  GROUP BY bucket_start
  HAVING COUNT(cpu_percent) > 0
  ON CONFLICT(bucket_start) DO UPDATE SET
    cpu_min=excluded.cpu_min, cpu_max=excluded.cpu_max, cpu_avg=excluded.cpu_avg,
    memory_min=excluded.memory_min, memory_max=excluded.memory_max, memory_avg=excluded.memory_avg,
    disk_min=excluded.disk_min, disk_max=excluded.disk_max, disk_avg=excluded.disk_avg,
    load_min=excluded.load_min, load_max=excluded.load_max, load_avg=excluded.load_avg,
    container_total_min=excluded.container_total_min, container_total_max=excluded.container_total_max,
    container_total_avg=excluded.container_total_avg,
    container_running_min=excluded.container_running_min, container_running_max=excluded.container_running_max,
    container_running_avg=excluded.container_running_avg,
    sample_count=excluded.sample_count;
`;

/** Format a UTC epoch-seconds value as a UTC-naive 'YYYY-MM-DD HH:MM:SS' string for created_at comparisons. */
function epochToCreatedAt(epochSec) {
  return new Date(epochSec * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Fold COMPLETED raw buckets into hourly (and, in Task 2.3, hourly into daily).
 * Idempotent UPSERT. Re-rolls from (watermark - 1 hour) to absorb late raw,
 * recomputing the boundary bucket. The current incomplete hour is never finalized.
 */
function rollupTick(database) {
  if (!database) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const lastCompleteHour = Math.floor(nowSec / 3600) * 3600; // exclusive upper bound (current hour excluded)

  const wmRaw = getState("rollup_hourly_watermark");
  const wm = wmRaw !== null ? parseInt(wmRaw, 10) : 0;
  const hourlyLow = wm > 0 ? wm - 3600 : 0; // slack: re-roll the boundary bucket

  const run = database.transaction(() => {
    database
      .prepare(HOURLY_UPSERT_SQL)
      .run(hourlyLow > 0 ? epochToCreatedAt(hourlyLow) : "0000-00-00 00:00:00", epochToCreatedAt(lastCompleteHour));

    const maxHourly = database
      .prepare("SELECT MAX(bucket_start) AS m FROM metrics_rollup_hourly WHERE bucket_start < ?")
      .get(lastCompleteHour);
    if (maxHourly && maxHourly.m !== null) setState("rollup_hourly_watermark", String(maxHourly.m));
  });
  run();
}

module.exports = { init, recordMetrics, getHistory, getHistorySummary, getState, setState, rollupTick };
