/**
 * mTLS Module — Enterprise
 *
 * Mutual TLS for agent-to-server communication.
 * Manages CA certificates, client cert registrations, and agent enrollment.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/mtls):
 *   GET    /ca                   — List CA certificates
 *   POST   /ca                   — Upload CA certificate
 *   DELETE /ca/:id               — Remove CA certificate
 *   GET    /agents               — List enrolled agents
 *   GET    /agents/:id           — Get agent details
 *   POST   /agents               — Enroll agent (register client cert)
 *   PUT    /agents/:id           — Update agent
 *   DELETE /agents/:id           — Revoke agent enrollment
 *   PUT    /agents/:id/toggle    — Enable/disable agent
 *   GET    /config               — Get mTLS config
 *   PUT    /config               — Update mTLS config
 *   POST   /verify               — Verify a client certificate (called by reverse proxy)
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractCertInfo(pem) {
  // Extract basic info from PEM certificate without external deps
  const info = { subject: null, issuer: null, fingerprint: null };

  // Extract DER bytes from PEM and compute fingerprint over DER (standard practice)
  try {
    const b64 = pem
      .replace(/-----BEGIN CERTIFICATE-----/g, "")
      .replace(/-----END CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    const der = Buffer.from(b64, "base64");
    info.fingerprint = crypto.createHash("sha256").update(der).digest("hex");
  } catch {
    // Fallback: hash trimmed PEM
    info.fingerprint = crypto.createHash("sha256").update(pem.trim()).digest("hex");
  }

  // Try Node's X509Certificate (available since Node 15+)
  try {
    const cert = new crypto.X509Certificate(pem);
    info.subject = cert.subject;
  } catch {
    // Fallback: best-effort CN extraction
    const cnMatch = pem.match(/CN\s*=\s*([^\n\/,]+)/);
    if (cnMatch) info.subject = cnMatch[1].trim();
  }

  return info;
}

// ── Factory ────────────────���────────────────────────────────���───
function create() {
  const router = express.Router();
  let db = null;
  let services = null;

// ── Init ───────────────────────────────────────���───────────────
function init(svc) {
  services = svc;
  db = svc.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_mtls_ca (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      certificate TEXT NOT NULL,
      fingerprint TEXT NOT NULL UNIQUE,
      subject TEXT,
      enabled INTEGER DEFAULT 1,
      created_by TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_mtls_agents (
      id TEXT PRIMARY KEY,
      hostname TEXT NOT NULL,
      description TEXT,
      cert_fingerprint TEXT NOT NULL UNIQUE,
      cert_subject TEXT,
      ca_id TEXT REFERENCES ext_cockpit_enterprise_mtls_ca(id) ON DELETE SET NULL,
      enabled INTEGER DEFAULT 1,
      last_seen_at DATETIME,
      last_ip TEXT,
      tags TEXT DEFAULT '[]',
      created_by TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_mtls_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_mtls_agents_fingerprint
      ON ext_cockpit_enterprise_mtls_agents(cert_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_mtls_agents_enabled
      ON ext_cockpit_enterprise_mtls_agents(enabled);

    -- Default config
    INSERT OR IGNORE INTO ext_cockpit_enterprise_mtls_config (key, value)
      VALUES ('enforcement_enabled', 'false');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_mtls_config (key, value)
      VALUES ('reject_unknown_certs', 'true');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_mtls_config (key, value)
      VALUES ('auto_enroll', 'false');
  `);
}

// ── CA Routes ──────────────────────────────────────────────────

// List CAs
router.get("/ca", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const cas = db
      .prepare(
        "SELECT id, name, fingerprint, subject, enabled, created_by, created_at FROM ext_cockpit_enterprise_mtls_ca ORDER BY created_at DESC LIMIT ? OFFSET ?"
      )
      .all(limit, offset);
    res.json({ cas });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Upload CA cert
router.post("/ca", requireRole("admin"), (req, res) => {
  try {
    const { name, certificate } = req.body;
    if (!name || typeof name !== "string" || name.length > 200) {
      return res.status(400).json({ error: "name is required (max 200 chars)" });
    }
    if (!certificate || typeof certificate !== "string") {
      return res.status(400).json({ error: "certificate (PEM) is required" });
    }
    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
      return res.status(400).json({ error: "certificate must be in PEM format" });
    }
    if (certificate.length > 50000) {
      return res.status(400).json({ error: "certificate exceeds max length (50KB)" });
    }

    const info = extractCertInfo(certificate);
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_mtls_ca
        (id, name, certificate, fingerprint, subject, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, certificate, info.fingerprint, info.subject, req.user?.id || "system");

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.ca_upload", id, name);
    }

    res.status(201).json({ id, name, fingerprint: info.fingerprint, subject: info.subject });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "This CA certificate is already registered (duplicate fingerprint)" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete CA
router.delete("/ca/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid CA ID" });
    }

    const ca = db
      .prepare("SELECT id, name FROM ext_cockpit_enterprise_mtls_ca WHERE id = ?")
      .get(req.params.id);
    if (!ca) return res.status(404).json({ error: "CA not found" });

    // Check if agents reference this CA
    const agentCount = db
      .prepare("SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_mtls_agents WHERE ca_id = ?")
      .get(req.params.id).cnt;
    if (agentCount > 0) {
      return res.status(409).json({
        error: `Cannot delete CA with ${agentCount} enrolled agent(s). Revoke agents first.`,
      });
    }

    db.prepare("DELETE FROM ext_cockpit_enterprise_mtls_ca WHERE id = ?").run(req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.ca_delete", req.params.id, ca.name);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Agent Routes ───────────────────────────────────────────────

// List agents
router.get("/agents", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const enabled = req.query.enabled;

    let sql = `SELECT a.*, c.name AS ca_name
               FROM ext_cockpit_enterprise_mtls_agents a
               LEFT JOIN ext_cockpit_enterprise_mtls_ca c ON a.ca_id = c.id`;
    const params = [];

    if (enabled !== undefined) {
      sql += " WHERE a.enabled = ?";
      params.push(enabled === "true" ? 1 : 0);
    }

    sql += " ORDER BY a.last_seen_at IS NULL, a.last_seen_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const agents = db.prepare(sql).all(...params);
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get agent
router.get("/agents/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }

    const agent = db
      .prepare(
        `SELECT a.*, c.name AS ca_name
         FROM ext_cockpit_enterprise_mtls_agents a
         LEFT JOIN ext_cockpit_enterprise_mtls_ca c ON a.ca_id = c.id
         WHERE a.id = ?`
      )
      .get(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Enroll agent
router.post("/agents", requireRole("admin"), (req, res) => {
  try {
    const { hostname, description, certificate, ca_id, tags } = req.body;

    if (!hostname || typeof hostname !== "string" || hostname.length > 255) {
      return res.status(400).json({ error: "hostname is required (max 255 chars)" });
    }
    if (!certificate || typeof certificate !== "string") {
      return res.status(400).json({ error: "certificate (client PEM) is required" });
    }
    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
      return res.status(400).json({ error: "certificate must be in PEM format" });
    }
    if (certificate.length > 50000) {
      return res.status(400).json({ error: "certificate exceeds max length (50KB)" });
    }

    // Validate CA reference if provided
    if (ca_id) {
      if (!UUID_RE.test(ca_id)) {
        return res.status(400).json({ error: "Invalid ca_id" });
      }
      const ca = db
        .prepare("SELECT id FROM ext_cockpit_enterprise_mtls_ca WHERE id = ?")
        .get(ca_id);
      if (!ca) return res.status(404).json({ error: "Referenced CA not found" });
    }

    const info = extractCertInfo(certificate);
    const id = crypto.randomUUID();

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_mtls_agents
        (id, hostname, description, cert_fingerprint, cert_subject, ca_id, tags, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      hostname,
      description || null,
      info.fingerprint,
      info.subject,
      ca_id || null,
      JSON.stringify(tags || []),
      req.user?.id || "system"
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.agent_enroll", id, hostname);
    }

    res.status(201).json({ id, hostname, fingerprint: info.fingerprint, enabled: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "An agent with this certificate fingerprint already exists" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update agent
router.put("/agents/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }

    const existing = db
      .prepare("SELECT id FROM ext_cockpit_enterprise_mtls_agents WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Agent not found" });

    const { hostname, description, tags } = req.body;
    if (!hostname || typeof hostname !== "string" || hostname.length > 255) {
      return res.status(400).json({ error: "hostname is required (max 255 chars)" });
    }

    db.prepare(
      `UPDATE ext_cockpit_enterprise_mtls_agents SET
        hostname = ?, description = ?, tags = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(hostname, description || null, JSON.stringify(tags || []), req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.agent_update", req.params.id, hostname);
    }

    res.json({ id: req.params.id, updated: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke agent
router.delete("/agents/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }

    const agent = db
      .prepare("SELECT id, hostname FROM ext_cockpit_enterprise_mtls_agents WHERE id = ?")
      .get(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    db.prepare("DELETE FROM ext_cockpit_enterprise_mtls_agents WHERE id = ?").run(req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.agent_revoke", req.params.id, agent.hostname);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle agent
router.put("/agents/:id/toggle", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid agent ID" });
    }

    const agent = db
      .prepare("SELECT id, hostname, enabled FROM ext_cockpit_enterprise_mtls_agents WHERE id = ?")
      .get(req.params.id);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const newState = agent.enabled ? 0 : 1;
    db.prepare(
      "UPDATE ext_cockpit_enterprise_mtls_agents SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newState, req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(
        userId,
        newState ? "mtls.agent_enable" : "mtls.agent_disable",
        req.params.id,
        agent.hostname
      );
    }

    res.json({ id: req.params.id, enabled: !!newState });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Config ─────────────────────────────────────────────────────

router.get("/config", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM ext_cockpit_enterprise_mtls_config").all();
    const config = {};
    for (const row of rows) config[row.key] = row.value;
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/config", requireRole("admin"), (req, res) => {
  try {
    const allowed = ["enforcement_enabled", "reject_unknown_certs", "auto_enroll"];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = String(req.body[key]);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `No valid config keys. Allowed: ${allowed.join(", ")}` });
    }

    db.transaction(() => {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO ext_cockpit_enterprise_mtls_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      );
      for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, value);
      }
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "mtls.config_update", null, JSON.stringify(updates));
    }

    res.json({ updated: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Certificate verification (called by reverse proxy) ─────────
// Authenticated via shared secret to prevent spoofing
router.post("/verify", (req, res) => {
  try {
    // Verify caller is authorized (reverse proxy shared secret)
    const verifySecret = process.env.MTLS_VERIFY_SECRET;
    if (verifySecret) {
      const provided = req.get("X-Verify-Secret") || req.body.verify_secret || "";
      const a = Buffer.from(String(provided));
      const b = Buffer.from(verifySecret);
      if (a.length !== b.length || !require("crypto").timingSafeEqual(a, b)) {
        return res.status(403).json({ error: "Unauthorized: invalid verify secret" });
      }
    }

    const { fingerprint, ip } = req.body;
    if (!fingerprint || typeof fingerprint !== "string") {
      return res.status(400).json({ error: "fingerprint is required" });
    }

    // Check enforcement
    const enforcement = db
      .prepare("SELECT value FROM ext_cockpit_enterprise_mtls_config WHERE key = 'enforcement_enabled'")
      .get();
    if (!enforcement || enforcement.value !== "true") {
      return res.json({ verified: true, reason: "mTLS enforcement disabled" });
    }

    // Look up agent by fingerprint
    const agent = db
      .prepare(
        "SELECT id, hostname, enabled FROM ext_cockpit_enterprise_mtls_agents WHERE cert_fingerprint = ?"
      )
      .get(fingerprint);

    if (!agent) {
      // Check auto-enroll config
      const autoEnroll = db
        .prepare("SELECT value FROM ext_cockpit_enterprise_mtls_config WHERE key = 'auto_enroll'")
        .get();
      if (autoEnroll && autoEnroll.value === "true") {
        return res.json({ verified: false, reason: "Unknown certificate — auto_enroll not yet implemented for verify endpoint" });
      }

      if (services?.auditLog) {
        services.auditLog("system", "mtls.verify_reject", fingerprint, "unknown cert");
      }
      return res.status(403).json({ verified: false, reason: "Unknown client certificate" });
    }

    if (!agent.enabled) {
      if (services?.auditLog) {
        services.auditLog("system", "mtls.verify_reject", agent.id, "agent disabled");
      }
      return res.status(403).json({ verified: false, reason: "Agent is disabled" });
    }

    // Update last_seen with 60-second debounce to reduce write pressure
    const lastSeen = db
      .prepare("SELECT last_seen_at FROM ext_cockpit_enterprise_mtls_agents WHERE id = ?")
      .get(agent.id);
    const shouldUpdate =
      !lastSeen?.last_seen_at ||
      (Date.now() - new Date(lastSeen.last_seen_at + "Z").getTime()) > 60_000;

    if (shouldUpdate) {
      db.prepare(
        "UPDATE ext_cockpit_enterprise_mtls_agents SET last_seen_at = datetime('now'), last_ip = ? WHERE id = ?"
      ).run(ip || null, agent.id);
    }

    res.json({ verified: true, agent_id: agent.id, hostname: agent.hostname });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
