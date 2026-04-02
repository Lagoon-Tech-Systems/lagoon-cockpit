/**
 * Encryption at Rest Module — Enterprise
 *
 * SQLCipher key management and encryption status reporting.
 * Provides config layer — actual SQLCipher integration is at the DB driver level.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/encryption):
 *   GET    /status              — Encryption status and health check
 *   GET    /config              — Get encryption configuration
 *   PUT    /config              — Update encryption configuration
 *   POST   /rotate-key          — Initiate key rotation
 *   GET    /rotations           — Key rotation history
 *   GET    /audit               — Encryption audit log
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Factory ─────────────────────────────────────────────────────
function create() {
  const router = express.Router();
  let db = null;
  let services = null;

// ── Init ───────────────────────────────────────────────────────
function init(svc) {
  services = svc;
  db = svc.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_encryption_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_encryption_rotations (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      algorithm TEXT NOT NULL DEFAULT 'aes-256-cbc',
      kdf_iterations INTEGER DEFAULT 256000,
      initiated_by TEXT,
      started_at DATETIME DEFAULT (datetime('now')),
      completed_at DATETIME,
      error_message TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_encryption_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      detail TEXT,
      actor TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_enc_audit_type
      ON ext_cockpit_enterprise_encryption_audit(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_enc_rotations_status
      ON ext_cockpit_enterprise_encryption_rotations(status);

    -- Default config
    INSERT OR IGNORE INTO ext_cockpit_enterprise_encryption_config (key, value)
      VALUES ('enabled', 'false');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_encryption_config (key, value)
      VALUES ('algorithm', 'aes-256-cbc');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_encryption_config (key, value)
      VALUES ('kdf_iterations', '256000');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_encryption_config (key, value)
      VALUES ('page_size', '4096');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_encryption_config (key, value)
      VALUES ('last_rotation', '');
  `);
}

// ── Helper ─────────────────────────────────────────────────────

function checkSqlCipherActive() {
  try {
    const pragma = db.prepare("PRAGMA cipher_version").get();
    return !!(pragma?.cipher_version);
  } catch {
    return false;
  }
}

function getConfig() {
  const rows = db.prepare("SELECT * FROM ext_cockpit_enterprise_encryption_config").all();
  const config = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

function logEncEvent(type, detail, actor, ip) {
  db.prepare(
    `INSERT INTO ext_cockpit_enterprise_encryption_audit
      (event_type, detail, actor, ip_address) VALUES (?, ?, ?, ?)`
  ).run(type, detail || null, actor || "system", ip || null);
}

// ── Routes ─────────────────────────────────────────────────────

// Encryption status
router.get("/status", (req, res) => {
  try {
    const config = getConfig();

    // Check SQLCipher availability
    let sqlcipherAvailable = false;
    try {
      const pragma = db.prepare("PRAGMA cipher_version").get();
      if (pragma?.cipher_version) sqlcipherAvailable = true;
    } catch {
      // SQLCipher not available — standard SQLite
    }

    const lastRotation = db
      .prepare(
        "SELECT * FROM ext_cockpit_enterprise_encryption_rotations ORDER BY started_at DESC LIMIT 1"
      )
      .get();

    const pendingRotations = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_encryption_rotations WHERE status IN ('pending', 'in_progress')"
      )
      .get().cnt;

    res.json({
      enabled: config.enabled === "true",
      sqlcipher_available: sqlcipherAvailable,
      algorithm: config.algorithm,
      kdf_iterations: parseInt(config.kdf_iterations) || 256000,
      page_size: parseInt(config.page_size) || 4096,
      last_rotation: lastRotation || null,
      pending_rotations: pendingRotations,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get config — cross-checks enabled flag against actual SQLCipher state
router.get("/config", (req, res) => {
  try {
    const config = getConfig();
    const sqlcipherActive = checkSqlCipherActive();
    const configSaysEnabled = config.enabled === "true";

    const warnings = [];
    if (configSaysEnabled && !sqlcipherActive) {
      warnings.push(
        "Config shows encryption enabled but SQLCipher is NOT active on the database. " +
        "Data is NOT encrypted at rest. Re-initialize the database with SQLCipher to fix."
      );
    }
    if (!configSaysEnabled && sqlcipherActive) {
      warnings.push(
        "SQLCipher is active on the database but config shows encryption disabled. " +
        "Config is out of sync — encryption IS active regardless of this flag."
      );
    }

    const result = { config, sqlcipher_active: sqlcipherActive };
    if (warnings.length > 0) result.warnings = warnings;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update config
router.put("/config", requireRole("admin"), (req, res) => {
  try {
    const allowed = ["enabled", "algorithm", "kdf_iterations", "page_size"];
    const validAlgorithms = ["aes-256-cbc", "aes-256-gcm"];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const val = String(req.body[key]);

        // Validate specific keys
        if (key === "algorithm" && !validAlgorithms.includes(val)) {
          return res.status(400).json({ error: `Invalid algorithm. Allowed: ${validAlgorithms.join(", ")}` });
        }
        if (key === "kdf_iterations") {
          const n = parseInt(val);
          if (isNaN(n) || n < 10000 || n > 10000000) {
            return res.status(400).json({ error: "kdf_iterations must be between 10,000 and 10,000,000" });
          }
        }
        if (key === "page_size") {
          const n = parseInt(val);
          if (![1024, 2048, 4096, 8192, 16384].includes(n)) {
            return res.status(400).json({ error: "page_size must be 1024, 2048, 4096, 8192, or 16384" });
          }
        }

        updates[key] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `No valid config keys. Allowed: ${allowed.join(", ")}` });
    }

    // When toggling encryption on, verify SQLCipher is actually available
    if (updates.enabled === "true") {
      const sqlcipherActive = checkSqlCipherActive();
      if (!sqlcipherActive) {
        return res.status(409).json({
          error: "Cannot enable encryption: SQLCipher is not active on the database. " +
                 "The database must be initialized with SQLCipher before enabling this flag.",
          sqlcipher_active: false,
        });
      }
    }

    const userId = req.user?.id || "system";

    db.transaction(() => {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO ext_cockpit_enterprise_encryption_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      );
      for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, value);
      }
    })();

    logEncEvent("config_update", JSON.stringify(updates), userId, req.ip);

    if (services?.auditLog) {
      services.auditLog(userId, "encryption.config_update", null, JSON.stringify(updates));
    }

    res.json({ updated: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Initiate key rotation
router.post("/rotate-key", requireRole("admin"), (req, res) => {
  try {
    const config = getConfig();

    // Check for in-progress rotations
    const inProgress = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_encryption_rotations WHERE status IN ('pending', 'in_progress')"
      )
      .get().cnt;

    if (inProgress > 0) {
      return res.status(409).json({ error: "A key rotation is already in progress" });
    }

    const id = crypto.randomUUID();
    const userId = req.user?.id || "system";
    const notes = req.body.notes || null;

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_encryption_rotations
        (id, status, algorithm, kdf_iterations, initiated_by, notes)
       VALUES (?, 'pending', ?, ?, ?, ?)`
    ).run(
      id,
      config.algorithm || "aes-256-cbc",
      parseInt(config.kdf_iterations) || 256000,
      userId,
      notes
    );

    logEncEvent("key_rotation_initiated", `rotation_id=${id}`, userId, req.ip);

    if (services?.auditLog) {
      services.auditLog(userId, "encryption.rotate_key", id, "Key rotation initiated");
    }

    // NOTE: Actual key rotation requires restart with new PRAGMA key.
    // This creates the rotation record; the ops team or automated process
    // picks up pending rotations and executes them during maintenance windows.

    res.status(202).json({
      id,
      status: "pending",
      message: "Key rotation queued. Will be executed during next maintenance window.",
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Rotation history
router.get("/rotations", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const rotations = db
      .prepare(
        "SELECT * FROM ext_cockpit_enterprise_encryption_rotations ORDER BY started_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);

    res.json({ rotations });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Encryption audit log
router.get("/audit", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const eventType = req.query.event_type;

    let sql = "SELECT * FROM ext_cockpit_enterprise_encryption_audit";
    const params = [];

    if (eventType) {
      sql += " WHERE event_type = ?";
      params.push(eventType);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const entries = db.prepare(sql).all(...params);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Audit retention cleanup
router.delete("/audit/retention", requireRole("admin"), (req, res) => {
  try {
    const retentionDays = parseInt(req.query.days) || 365;
    if (retentionDays < 30 || retentionDays > 3650) {
      return res.status(400).json({ error: "days must be between 30 and 3650" });
    }

    const result = db
      .prepare(
        `DELETE FROM ext_cockpit_enterprise_encryption_audit
         WHERE created_at < datetime('now', '-' || ? || ' days')`
      )
      .run(retentionDays);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "encryption.audit_retention", null, `Deleted ${result.changes} entries`);
    }

    res.json({ deleted: result.changes, retention_days: retentionDays });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
