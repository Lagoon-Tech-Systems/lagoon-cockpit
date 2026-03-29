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

/** Record a metrics snapshot */
function recordMetrics(metrics, containerStats) {
  if (!db) return;
  db.prepare(
    `
    INSERT INTO metrics_history (cpu_percent, memory_percent, disk_percent, load_1, container_total, container_running)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
    metrics.cpuPercent,
    metrics.memory.percent,
    metrics.disk.percent,
    metrics.load.load1,
    containerStats.total,
    containerStats.running,
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

module.exports = { init, recordMetrics, getHistory, getHistorySummary };
