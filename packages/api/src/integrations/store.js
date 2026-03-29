/**
 * Integration data store — persists adapter outputs in SQLite.
 * Handles time-series storage with configurable retention.
 * Config blobs are AES-256-GCM encrypted at rest using JWT_SECRET.
 */

const { encrypt, decrypt } = require("../security/crypto");

let db = null;

function getEncryptionKey() {
  return process.env.JWT_SECRET || "cockpit-fallback-key";
}

function encryptConfig(config) {
  return encrypt(JSON.stringify(config), getEncryptionKey());
}

function decryptConfig(encrypted) {
  try {
    return JSON.parse(decrypt(encrypted, getEncryptionKey()));
  } catch {
    // Fallback: config may be stored as plain JSON (pre-encryption migration)
    return JSON.parse(encrypted);
  }
}

const DEFAULT_RETENTION_DAYS = 7;

/** Initialize the integration store with SQLite tables */
function initStore(database) {
  db = database;

  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      adapter TEXT NOT NULL,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      poll_interval INTEGER DEFAULT 30,
      enabled INTEGER DEFAULT 1,
      last_pull DATETIME,
      last_status TEXT,
      last_error TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS integration_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_intdata_ts ON integration_data(integration_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_intdata_created ON integration_data(created_at);
  `);
}

// ── Integration CRUD ───────────────────────────────────────

function createIntegration(id, adapter, name, config, pollInterval) {
  db.prepare("INSERT INTO integrations (id, adapter, name, config, poll_interval) VALUES (?, ?, ?, ?, ?)").run(
    id,
    adapter,
    name,
    encryptConfig(config),
    pollInterval || 30,
  );
}

function getIntegration(id) {
  const row = db.prepare("SELECT * FROM integrations WHERE id = ?").get(id);
  if (row) row.config = decryptConfig(row.config);
  return row;
}

function listIntegrations() {
  const rows = db.prepare("SELECT * FROM integrations ORDER BY created_at DESC").all();
  return rows.map((r) => ({ ...r, config: decryptConfig(r.config) }));
}

function updateIntegration(id, fields) {
  const allowed = ["name", "config", "poll_interval", "enabled"];
  const sets = [];
  const values = [];

  for (const [key, val] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    sets.push(`${key} = ?`);
    values.push(key === "config" ? encryptConfig(val) : val);
  }

  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE integrations SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

function deleteIntegration(id) {
  db.prepare("DELETE FROM integrations WHERE id = ?").run(id);
}

function updateIntegrationStatus(id, status, error) {
  db.prepare("UPDATE integrations SET last_pull = datetime('now'), last_status = ?, last_error = ? WHERE id = ?").run(
    status,
    error || null,
    id,
  );
}

function countIntegrations() {
  return db.prepare("SELECT COUNT(*) as count FROM integrations").get().count;
}

// ── Integration data ───────────────────────────────────────

function storeDataPoints(integrationId, dataPoints) {
  const stmt = db.prepare("INSERT INTO integration_data (integration_id, type, data, timestamp) VALUES (?, ?, ?, ?)");

  const insertMany = db.transaction((points) => {
    for (const point of points) {
      stmt.run(integrationId, point.type, JSON.stringify(point), point.timestamp);
    }
  });

  insertMany(dataPoints);
}

function queryData(integrationId, opts = {}) {
  const { type, since, until, limit } = opts;
  let sql = "SELECT * FROM integration_data WHERE integration_id = ?";
  const params = [integrationId];

  if (type) {
    sql += " AND type = ?";
    params.push(type);
  }
  if (since) {
    sql += " AND timestamp >= ?";
    params.push(since);
  }
  if (until) {
    sql += " AND timestamp <= ?";
    params.push(until);
  }

  sql += " ORDER BY timestamp DESC";

  if (limit) {
    sql += " LIMIT ?";
    params.push(limit);
  } else {
    sql += " LIMIT 500";
  }

  return db
    .prepare(sql)
    .all(...params)
    .map((r) => ({
      ...r,
      data: JSON.parse(r.data),
    }));
}

/** Clean up data older than retention period */
function cleanupOldData(retentionDays) {
  const days = retentionDays || DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare("DELETE FROM integration_data WHERE created_at < ?").run(cutoff);
  if (result.changes > 0) {
    console.log(`[INTEGRATIONS] Cleaned up ${result.changes} data points older than ${days} days`);
  }
}

module.exports = {
  initStore,
  createIntegration,
  getIntegration,
  listIntegrations,
  updateIntegration,
  deleteIntegration,
  updateIntegrationStatus,
  countIntegrations,
  storeDataPoints,
  queryData,
  cleanupOldData,
};
