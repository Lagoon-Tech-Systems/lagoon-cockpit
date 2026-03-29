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

module.exports = { init, getDb, auditLog };
