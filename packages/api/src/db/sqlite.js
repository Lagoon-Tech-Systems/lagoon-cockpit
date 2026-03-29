const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");

let db = null;

/** Initialize SQLite database */
function init() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(path.join(DATA_DIR, "cockpit.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Run migrations
  migrate(db);

  return db;
}

/** Run database migrations */
function migrate(db) {
  db.exec(`
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
  `);
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
