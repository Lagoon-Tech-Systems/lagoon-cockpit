/**
 * Compliance Logging Module — Enterprise
 *
 * SOC2-ready structured audit logging with tamper-evident hashing,
 * retention policies, and export capabilities.
 *
 * Hash chain: each entry's hash includes the previous entry's hash,
 * creating a tamper-evident chain. Verification checks both self-consistency
 * and cross-entry linkage.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/compliance):
 *   GET    /logs                — Query compliance logs (filterable)
 *   GET    /logs/:id            — Get single log entry with chain verification
 *   POST   /logs                — Create compliance log entry (internal/API use)
 *   GET    /export              — Export logs as JSON or CSV
 *   GET    /config              — Get compliance config
 *   PUT    /config              — Update compliance config
 *   GET    /stats               — Log statistics and health
 *   POST   /verify-chain        — Verify tamper-evident hash chain integrity
 *   DELETE /retention           — Run retention cleanup (archives, preserves chain anchor)
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const VALID_CATEGORIES = [
  "authentication",
  "authorization",
  "data_access",
  "data_modification",
  "configuration",
  "system",
  "security",
  "compliance",
  "user_management",
  "api_access",
];

const VALID_SEVERITIES = ["info", "warning", "critical"];

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
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_compliance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      timestamp DATETIME NOT NULL DEFAULT (datetime('now')),
      category TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      actor_id TEXT,
      actor_type TEXT DEFAULT 'user',
      actor_ip TEXT,
      actor_user_agent TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      detail TEXT,
      outcome TEXT NOT NULL DEFAULT 'success' CHECK(outcome IN ('success', 'failure', 'error')),
      metadata TEXT DEFAULT '{}',
      previous_hash TEXT,
      entry_hash TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_compliance_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_compliance_anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anchor_hash TEXT NOT NULL,
      anchor_entry_id INTEGER NOT NULL,
      entries_deleted INTEGER NOT NULL,
      retention_days INTEGER NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_compliance_timestamp
      ON ext_cockpit_enterprise_compliance_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_compliance_category
      ON ext_cockpit_enterprise_compliance_logs(category, timestamp);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_compliance_actor
      ON ext_cockpit_enterprise_compliance_logs(actor_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_compliance_action
      ON ext_cockpit_enterprise_compliance_logs(action, timestamp);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_compliance_resource
      ON ext_cockpit_enterprise_compliance_logs(resource_type, resource_id);

    -- Default config
    INSERT OR IGNORE INTO ext_cockpit_enterprise_compliance_config (key, value)
      VALUES ('enabled', 'true');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_compliance_config (key, value)
      VALUES ('retention_days', '365');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_compliance_config (key, value)
      VALUES ('hash_algorithm', 'sha256');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_compliance_config (key, value)
      VALUES ('log_api_reads', 'false');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_compliance_config (key, value)
      VALUES ('export_format', 'json');
  `);
}

// ── Hash chain ─────────────────────────────────────────────────

function computeEntryHash(entry, previousHash) {
  const payload = JSON.stringify({
    event_id: entry.event_id,
    timestamp: entry.timestamp,
    category: entry.category,
    action: entry.action,
    actor_id: entry.actor_id,
    resource_type: entry.resource_type,
    resource_id: entry.resource_id,
    outcome: entry.outcome,
    previous_hash: previousHash || "",
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

// ── Routes ─────────────────────────────────────────────────────

// Query logs
router.get("/logs", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 1000);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let sql = "SELECT * FROM ext_cockpit_enterprise_compliance_logs WHERE 1=1";
    const params = [];

    if (req.query.category) {
      sql += " AND category = ?";
      params.push(req.query.category);
    }
    if (req.query.severity) {
      sql += " AND severity = ?";
      params.push(req.query.severity);
    }
    if (req.query.actor_id) {
      sql += " AND actor_id = ?";
      params.push(req.query.actor_id);
    }
    if (req.query.action) {
      sql += " AND action = ?";
      params.push(req.query.action);
    }
    if (req.query.resource_type) {
      sql += " AND resource_type = ?";
      params.push(req.query.resource_type);
    }
    if (req.query.outcome) {
      sql += " AND outcome = ?";
      params.push(req.query.outcome);
    }
    if (req.query.from) {
      sql += " AND timestamp >= ?";
      params.push(req.query.from);
    }
    if (req.query.to) {
      sql += " AND timestamp <= ?";
      params.push(req.query.to);
    }

    sql += " ORDER BY id DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const logs = db.prepare(sql).all(...params);

    const total = db
      .prepare(
        sql
          .replace("SELECT *", "SELECT COUNT(*) AS cnt")
          .replace(/ ORDER BY.*$/, "")
      )
      .get(...params.slice(0, -2)).cnt;

    res.json({ logs, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get single entry with chain verification
router.get("/logs/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id) || id < 1) {
      return res.status(400).json({ error: "Invalid log ID" });
    }

    const entry = db
      .prepare("SELECT * FROM ext_cockpit_enterprise_compliance_logs WHERE id = ?")
      .get(id);
    if (!entry) return res.status(404).json({ error: "Log entry not found" });

    // Verify self-consistency
    const recomputed = computeEntryHash(entry, entry.previous_hash);
    const selfValid = recomputed === entry.entry_hash;

    // Verify linkage to previous entry
    let linkageValid = true;
    if (entry.previous_hash) {
      const prevEntry = db
        .prepare("SELECT entry_hash FROM ext_cockpit_enterprise_compliance_logs WHERE id = ?")
        .get(id - 1);

      if (prevEntry) {
        linkageValid = prevEntry.entry_hash === entry.previous_hash;
      } else {
        // Previous entry may have been archived — check anchors
        const anchor = db
          .prepare(
            "SELECT anchor_hash FROM ext_cockpit_enterprise_compliance_anchors WHERE anchor_entry_id = ? LIMIT 1"
          )
          .get(id - 1);
        linkageValid = anchor ? anchor.anchor_hash === entry.previous_hash : false;
      }
    }

    res.json({ ...entry, chain_valid: selfValid && linkageValid });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create compliance log entry — serialized via transaction to prevent hash chain forks
router.post("/logs", (req, res) => {
  try {
    const {
      category,
      severity,
      actor_id,
      actor_type,
      action,
      resource_type,
      resource_id,
      detail,
      outcome,
      metadata,
    } = req.body;

    if (!category || !VALID_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `category is required. Valid: ${VALID_CATEGORIES.join(", ")}`,
      });
    }
    if (severity && !VALID_SEVERITIES.includes(severity)) {
      return res.status(400).json({
        error: `Invalid severity. Valid: ${VALID_SEVERITIES.join(", ")}`,
      });
    }
    if (!action || typeof action !== "string") {
      return res.status(400).json({ error: "action is required" });
    }

    const eventId = crypto.randomUUID();
    const timestamp = new Date().toISOString().replace("T", " ").replace("Z", "");

    const entry = {
      event_id: eventId,
      timestamp,
      category,
      action,
      actor_id: actor_id || req.user?.id || "system",
      resource_type: resource_type || null,
      resource_id: resource_id || null,
      outcome: outcome || "success",
    };

    // Serialize getLastHash + INSERT in a transaction to prevent hash chain forks
    const result = db.transaction(() => {
      const last = db
        .prepare(
          "SELECT entry_hash FROM ext_cockpit_enterprise_compliance_logs ORDER BY id DESC LIMIT 1"
        )
        .get();
      const previousHash = last?.entry_hash || null;
      const entryHash = computeEntryHash(entry, previousHash);

      db.prepare(
        `INSERT INTO ext_cockpit_enterprise_compliance_logs
          (event_id, timestamp, category, severity, actor_id, actor_type, actor_ip,
           actor_user_agent, action, resource_type, resource_id, detail, outcome,
           metadata, previous_hash, entry_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        eventId,
        timestamp,
        category,
        severity || "info",
        entry.actor_id,
        actor_type || "user",
        req.ip,
        req.get("user-agent") || "",
        action,
        resource_type || null,
        resource_id || null,
        detail || null,
        entry.outcome,
        JSON.stringify(metadata || {}),
        previousHash,
        entryHash
      );

      return { entryHash };
    })();

    res.status(201).json({ event_id: eventId, entry_hash: result.entryHash });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Export logs — streamed to avoid loading all rows into memory
router.get("/export", (req, res) => {
  try {
    const format = req.query.format || "json";
    const from = req.query.from;
    const to = req.query.to;

    let sql = "SELECT * FROM ext_cockpit_enterprise_compliance_logs WHERE 1=1";
    const params = [];

    if (from) {
      sql += " AND timestamp >= ?";
      params.push(from);
    }
    if (to) {
      sql += " AND timestamp <= ?";
      params.push(to);
    }

    sql += " ORDER BY id ASC";

    const userId = req.user?.id || "system";
    const dateSuffix = new Date().toISOString().slice(0, 10);

    const csvHeaders = [
      "event_id",
      "timestamp",
      "category",
      "severity",
      "actor_id",
      "actor_type",
      "actor_ip",
      "action",
      "resource_type",
      "resource_id",
      "detail",
      "outcome",
      "entry_hash",
    ];

    function escapeCsvField(val) {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }

    if (format === "csv") {
      res.set("Content-Type", "text/csv");
      res.set("Content-Disposition", `attachment; filename=compliance-logs-${dateSuffix}.csv`);
      res.write(csvHeaders.join(",") + "\n");

      let count = 0;
      for (const log of db.prepare(sql).iterate(...params)) {
        const row = csvHeaders.map((h) => escapeCsvField(log[h]));
        res.write(row.join(",") + "\n");
        count++;
      }

      if (services?.auditLog) {
        services.auditLog(userId, "compliance.export", null, `${count} entries, format=csv`);
      }
      return res.end();
    }

    // Default: NDJSON (newline-delimited JSON) — one object per line, streamed
    res.set("Content-Type", "application/x-ndjson");
    res.set("Content-Disposition", `attachment; filename=compliance-logs-${dateSuffix}.ndjson`);

    let count = 0;
    for (const log of db.prepare(sql).iterate(...params)) {
      res.write(JSON.stringify(log) + "\n");
      count++;
    }

    if (services?.auditLog) {
      services.auditLog(userId, "compliance.export", null, `${count} entries, format=ndjson`);
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Config
router.get("/config", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM ext_cockpit_enterprise_compliance_config").all();
    const config = {};
    for (const row of rows) config[row.key] = row.value;
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/config", requireRole("admin"), (req, res) => {
  try {
    const allowed = ["enabled", "retention_days", "hash_algorithm", "log_api_reads", "export_format"];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const val = String(req.body[key]);

        if (key === "retention_days") {
          const n = parseInt(val);
          if (isNaN(n) || n < 30 || n > 3650) {
            return res.status(400).json({ error: "retention_days must be between 30 and 3650" });
          }
        }
        if (key === "hash_algorithm" && !["sha256", "sha512"].includes(val)) {
          return res.status(400).json({ error: "hash_algorithm must be sha256 or sha512" });
        }
        if (key === "export_format" && !["json", "csv"].includes(val)) {
          return res.status(400).json({ error: "export_format must be json or csv" });
        }

        updates[key] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `No valid config keys. Allowed: ${allowed.join(", ")}` });
    }

    db.transaction(() => {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO ext_cockpit_enterprise_compliance_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      );
      for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, value);
      }
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "compliance.config_update", null, JSON.stringify(updates));
    }

    res.json({ updated: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stats
router.get("/stats", (req, res) => {
  try {
    const total = db
      .prepare("SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_compliance_logs")
      .get().cnt;

    const byCategory = db
      .prepare(
        "SELECT category, COUNT(*) AS count FROM ext_cockpit_enterprise_compliance_logs GROUP BY category ORDER BY count DESC"
      )
      .all();

    const bySeverity = db
      .prepare(
        "SELECT severity, COUNT(*) AS count FROM ext_cockpit_enterprise_compliance_logs GROUP BY severity ORDER BY count DESC"
      )
      .all();

    const byOutcome = db
      .prepare(
        "SELECT outcome, COUNT(*) AS count FROM ext_cockpit_enterprise_compliance_logs GROUP BY outcome"
      )
      .all();

    const last24h = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_compliance_logs WHERE timestamp >= datetime('now', '-1 day')"
      )
      .get().cnt;

    const oldestEntry = db
      .prepare(
        "SELECT timestamp FROM ext_cockpit_enterprise_compliance_logs ORDER BY id ASC LIMIT 1"
      )
      .get();

    const newestEntry = db
      .prepare(
        "SELECT timestamp FROM ext_cockpit_enterprise_compliance_logs ORDER BY id DESC LIMIT 1"
      )
      .get();

    res.json({
      total_entries: total,
      last_24h: last24h,
      oldest_entry: oldestEntry?.timestamp || null,
      newest_entry: newestEntry?.timestamp || null,
      by_category: byCategory,
      by_severity: bySeverity,
      by_outcome: byOutcome,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Verify hash chain integrity (checks both self-consistency AND cross-entry linkage)
router.post("/verify-chain", (req, res) => {
  try {
    const from = parseInt(req.body.from || req.query.from) || 1;
    const limit = Math.min(parseInt(req.body.limit || req.query.limit) || 1000, 10000);

    const entries = db
      .prepare(
        "SELECT * FROM ext_cockpit_enterprise_compliance_logs WHERE id >= ? ORDER BY id ASC LIMIT ?"
      )
      .all(from, limit);

    if (entries.length === 0) {
      return res.json({ verified: true, entries_checked: 0, message: "No entries to verify" });
    }

    let brokenAt = null;
    let breakReason = null;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // 1. Verify self-consistency: recompute hash matches stored hash
      const expected = computeEntryHash(entry, entry.previous_hash);
      if (expected !== entry.entry_hash) {
        brokenAt = entry.id;
        breakReason = "Entry hash mismatch (possible data tampering)";
        break;
      }

      // 2. Verify cross-entry linkage: previous_hash matches prior entry's hash
      if (i > 0) {
        const prevEntry = entries[i - 1];
        if (entry.previous_hash !== prevEntry.entry_hash) {
          brokenAt = entry.id;
          breakReason = "Previous hash does not match prior entry (chain linkage broken)";
          break;
        }
      } else if (entry.previous_hash !== null) {
        // First entry in range — verify against preceding entry or anchor
        const preceding = db
          .prepare("SELECT entry_hash FROM ext_cockpit_enterprise_compliance_logs WHERE id = ?")
          .get(entry.id - 1);

        if (preceding) {
          if (entry.previous_hash !== preceding.entry_hash) {
            brokenAt = entry.id;
            breakReason = "Previous hash does not match preceding entry outside verification range";
            break;
          }
        } else {
          // Check if there's a chain anchor from retention
          const anchor = db
            .prepare(
              "SELECT anchor_hash FROM ext_cockpit_enterprise_compliance_anchors WHERE anchor_entry_id = ?"
            )
            .get(entry.id - 1);

          if (anchor && entry.previous_hash !== anchor.anchor_hash) {
            brokenAt = entry.id;
            breakReason = "Previous hash does not match retention anchor";
            break;
          }
          // If no preceding entry and no anchor, this may be the genesis entry — OK
        }
      }
    }

    if (brokenAt !== null) {
      return res.json({
        verified: false,
        entries_checked: entries.length,
        broken_at_id: brokenAt,
        reason: breakReason,
        message: `Hash chain broken at entry ID ${brokenAt}. ${breakReason}`,
      });
    }

    res.json({
      verified: true,
      entries_checked: entries.length,
      range: { from: entries[0].id, to: entries[entries.length - 1].id },
      message: "Hash chain integrity verified",
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Retention cleanup — records chain anchor before deleting
router.delete("/retention", requireRole("admin"), (req, res) => {
  try {
    const config = db
      .prepare("SELECT value FROM ext_cockpit_enterprise_compliance_config WHERE key = 'retention_days'")
      .get();
    const retentionDays = parseInt(config?.value) || 365;

    const result = db.transaction(() => {
      // Find the last entry that will be deleted (to create anchor)
      const lastDeleted = db
        .prepare(
          `SELECT id, entry_hash FROM ext_cockpit_enterprise_compliance_logs
           WHERE timestamp < datetime('now', '-' || ? || ' days')
           ORDER BY id DESC LIMIT 1`
        )
        .get(retentionDays);

      if (!lastDeleted) {
        return { changes: 0 };
      }

      // Record chain anchor so future verification can resume from this point
      db.prepare(
        `INSERT INTO ext_cockpit_enterprise_compliance_anchors
          (anchor_hash, anchor_entry_id, entries_deleted, retention_days)
         VALUES (?, ?, (SELECT COUNT(*) FROM ext_cockpit_enterprise_compliance_logs WHERE timestamp < datetime('now', '-' || ? || ' days')), ?)`
      ).run(lastDeleted.entry_hash, lastDeleted.id, retentionDays, retentionDays);

      // Now delete the old entries
      const deleteResult = db
        .prepare(
          `DELETE FROM ext_cockpit_enterprise_compliance_logs
           WHERE timestamp < datetime('now', '-' || ? || ' days')`
        )
        .run(retentionDays);

      return deleteResult;
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(
        userId,
        "compliance.retention_cleanup",
        null,
        `Deleted ${result.changes} entries older than ${retentionDays} days (chain anchor recorded)`
      );
    }

    res.json({
      deleted: result.changes,
      retention_days: retentionDays,
      chain_anchor_recorded: result.changes > 0,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
