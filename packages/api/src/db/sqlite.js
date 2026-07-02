const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");

let db = null;

/**
 * Versioned migration system.
 * Each migration runs exactly once, tracked by the schema_migrations table.
 * Add new migrations to the end of the array — never edit existing ones.
 */
const migrations = [
  {
    version: 1,
    description: "Initial schema — users, push_tokens, audit_log",
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'operator', 'viewer')),
        created_at DATETIME DEFAULT (datetime('now')),
        last_login DATETIME
      );

      CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        user_id TEXT,
        server_name TEXT,
        created_at DATETIME DEFAULT (datetime('now')),
        updated_at DATETIME DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    `,
  },
  {
    version: 2,
    description: "Refresh tokens table",
    sql: `
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        fingerprint TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
    `,
  },
  {
    version: 3,
    description:
      "Trend rollups — metrics_rollup_hourly/daily, app_state, idempotent metrics_history",
    sql: `
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

      CREATE TABLE IF NOT EXISTS app_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 4,
    description: 'alert severity + hysteresis (clear band/duration)',
    sql: `
      CREATE TABLE IF NOT EXISTS alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, metric TEXT NOT NULL,
        operator TEXT NOT NULL CHECK(operator IN ('>', '<', '>=', '<=', '==')),
        threshold REAL NOT NULL, duration_seconds INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS alert_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, rule_id INTEGER, rule_name TEXT, metric TEXT,
        value REAL, threshold REAL, message TEXT, created_at DATETIME DEFAULT (datetime('now')),
        FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL
      );
      ALTER TABLE alert_rules ADD COLUMN severity TEXT NOT NULL DEFAULT 'warn' CHECK(severity IN ('info','warn','critical'));
      ALTER TABLE alert_rules ADD COLUMN clear_threshold REAL;
      ALTER TABLE alert_rules ADD COLUMN clear_duration_seconds INTEGER DEFAULT 0;
      ALTER TABLE alert_events ADD COLUMN severity TEXT;
    `,
  },
];

/** Initialize SQLite database */
function init() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(path.join(DATA_DIR, "cockpit.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run versioned migrations
  runMigrations(db);

  return db;
}

/** Run pending migrations inside a transaction */
function runMigrations(db) {
  // Create migration tracking table (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      description TEXT,
      applied_at DATETIME DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db
      .prepare("SELECT version FROM schema_migrations")
      .all()
      .map((r) => r.version),
  );

  const pending = migrations.filter((m) => !applied.has(m.version));
  if (pending.length === 0) return;

  const applyMigration = db.transaction((m) => {
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_migrations (version, description) VALUES (?, ?)").run(m.version, m.description);
  });

  for (const m of pending) {
    applyMigration(m);
    console.log(`[DB] Migration ${m.version}: ${m.description}`);
  }
}

/** Get the database instance */
function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

/** Log an action to the audit log */
function auditLog(userId, action, target, detail) {
  if (!db) return;
  db.prepare("INSERT INTO audit_log (user_id, action, target, detail) VALUES (?, ?, ?, ?)").run(
    userId,
    action,
    target,
    detail || null,
  );
}

/** Prune audit log entries older than the retention period (default: 90 days) */
function pruneAuditLog(retentionDays) {
  if (!db) return 0;
  const days = retentionDays || parseInt(process.env.AUDIT_RETENTION_DAYS || "90", 10);
  const result = db.prepare("DELETE FROM audit_log WHERE created_at < datetime('now', '-' || ? || ' days')").run(days);
  if (result.changes > 0) {
    console.log(`[DB] Pruned ${result.changes} audit log entries older than ${days} days`);
  }
  return result.changes;
}

module.exports = { init, getDb, auditLog, pruneAuditLog, runMigrations };
