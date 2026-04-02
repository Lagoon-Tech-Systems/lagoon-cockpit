/**
 * IP Allowlisting Module — Enterprise
 *
 * Restrict API access to specific IP addresses or CIDR ranges.
 * Supports per-user overrides and temporary bypass tokens.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/ip-allowlist):
 *   GET    /rules               — List allowlist rules
 *   GET    /rules/:id           — Get rule details
 *   POST   /rules               — Add IP/CIDR rule
 *   PUT    /rules/:id           — Update rule
 *   DELETE /rules/:id           — Delete rule
 *   PUT    /rules/:id/toggle    — Enable/disable rule
 *   GET    /check               — Check if current IP is allowed
 *   GET    /config              — Get enforcement config
 *   PUT    /config              — Update enforcement config
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── CIDR utilities ─────────────────────────────────────────────

function ipToLong(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function isValidIPv4(ip) {
  return ipToLong(ip) !== null;
}

function parseCIDR(cidr) {
  const slash = cidr.indexOf("/");
  if (slash === -1) {
    // Plain IP — treat as /32
    const long = ipToLong(cidr);
    if (long === null) return null;
    return { network: long, mask: 0xffffffff };
  }
  const ip = cidr.slice(0, slash);
  const bits = parseInt(cidr.slice(slash + 1), 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return null;
  const long = ipToLong(ip);
  if (long === null) return null;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { network: (long & mask) >>> 0, mask };
}

function normalizeIp(ip) {
  // Strip IPv4-mapped IPv6 prefix (::ffff:10.0.0.1 -> 10.0.0.1)
  if (ip && ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function ipMatchesCIDR(ip, cidr) {
  const normalized = normalizeIp(ip);
  const ipLong = ipToLong(normalized);
  if (ipLong === null) return false;
  const parsed = parseCIDR(cidr);
  if (!parsed) return false;
  return ((ipLong & parsed.mask) >>> 0) === parsed.network;
}

function validateRule(body) {
  const { cidr, label } = body;
  if (!cidr || typeof cidr !== "string") {
    return "cidr is required (IP or CIDR notation)";
  }
  if (!parseCIDR(cidr)) {
    return "Invalid CIDR format. Use IP (1.2.3.4) or CIDR (1.2.3.0/24)";
  }
  // Reject overly broad CIDR ranges (prefix < /8) that could disable the allowlist
  const slash = cidr.indexOf("/");
  if (slash !== -1) {
    const prefix = parseInt(cidr.slice(slash + 1), 10);
    if (prefix < 8) {
      return `CIDR prefix /${prefix} is too broad (minimum is /8). This would match too many addresses.`;
    }
  }
  if (label && (typeof label !== "string" || label.length > 200)) {
    return "label must be a string (max 200 chars)";
  }
  return null;
}

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
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_ip_allowlist (
      id TEXT PRIMARY KEY,
      cidr TEXT NOT NULL,
      label TEXT,
      scope TEXT NOT NULL DEFAULT 'global',
      scope_id TEXT,
      enabled INTEGER DEFAULT 1,
      expires_at DATETIME,
      created_by TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_ip_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_ip_allowlist_enabled
      ON ext_cockpit_enterprise_ip_allowlist(enabled, scope);

    -- Default config: enforcement off until explicitly enabled
    INSERT OR IGNORE INTO ext_cockpit_enterprise_ip_config (key, value)
      VALUES ('enforcement_enabled', 'false');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_ip_config (key, value)
      VALUES ('deny_action', 'block');
    INSERT OR IGNORE INTO ext_cockpit_enterprise_ip_config (key, value)
      VALUES ('log_denials', 'true');
  `);
}

// ── Routes ─────────────────────────────────────────────────────

// List rules
router.get("/rules", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const scope = req.query.scope;

    let sql = "SELECT * FROM ext_cockpit_enterprise_ip_allowlist";
    const params = [];

    if (scope) {
      sql += " WHERE scope = ?";
      params.push(scope);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const rules = db.prepare(sql).all(...params);
    res.json({ rules });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get rule
router.get("/rules/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid rule ID" });
    }
    const rule = db
      .prepare("SELECT * FROM ext_cockpit_enterprise_ip_allowlist WHERE id = ?")
      .get(req.params.id);
    if (!rule) return res.status(404).json({ error: "Rule not found" });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create rule
router.post("/rules", requireRole("admin"), (req, res) => {
  try {
    const err = validateRule(req.body);
    if (err) return res.status(400).json({ error: err });

    const id = crypto.randomUUID();
    const { cidr, label, scope, scope_id, expires_at } = req.body;

    // Normalize CIDR
    const parsed = parseCIDR(cidr);
    const normalizedCidr = cidr.includes("/") ? cidr : `${cidr}/32`;

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_ip_allowlist
        (id, cidr, label, scope, scope_id, expires_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      normalizedCidr,
      label || null,
      scope || "global",
      scope_id || null,
      expires_at || null,
      req.user?.id || "system"
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "ip_allowlist.create", id, normalizedCidr);
    }

    res.status(201).json({ id, cidr: normalizedCidr, label, enabled: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update rule
router.put("/rules/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid rule ID" });
    }

    const existing = db
      .prepare("SELECT id FROM ext_cockpit_enterprise_ip_allowlist WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Rule not found" });

    const err = validateRule(req.body);
    if (err) return res.status(400).json({ error: err });

    const { cidr, label, scope, scope_id, expires_at } = req.body;
    const normalizedCidr = cidr.includes("/") ? cidr : `${cidr}/32`;

    db.prepare(
      `UPDATE ext_cockpit_enterprise_ip_allowlist SET
        cidr = ?, label = ?, scope = ?, scope_id = ?, expires_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      normalizedCidr,
      label || null,
      scope || "global",
      scope_id || null,
      expires_at || null,
      req.params.id
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "ip_allowlist.update", req.params.id, normalizedCidr);
    }

    res.json({ id: req.params.id, updated: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete rule
router.delete("/rules/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid rule ID" });
    }

    const existing = db
      .prepare("SELECT id, cidr FROM ext_cockpit_enterprise_ip_allowlist WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Rule not found" });

    db.prepare("DELETE FROM ext_cockpit_enterprise_ip_allowlist WHERE id = ?").run(req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "ip_allowlist.delete", req.params.id, existing.cidr);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle rule
router.put("/rules/:id/toggle", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid rule ID" });
    }

    const rule = db
      .prepare("SELECT id, cidr, enabled FROM ext_cockpit_enterprise_ip_allowlist WHERE id = ?")
      .get(req.params.id);
    if (!rule) return res.status(404).json({ error: "Rule not found" });

    const newState = rule.enabled ? 0 : 1;
    db.prepare(
      "UPDATE ext_cockpit_enterprise_ip_allowlist SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newState, req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(
        userId,
        newState ? "ip_allowlist.enable" : "ip_allowlist.disable",
        req.params.id,
        rule.cidr
      );
    }

    res.json({ id: req.params.id, enabled: !!newState });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Check current IP
router.get("/check", (req, res) => {
  try {
    const rawIp = req.ip || req.connection?.remoteAddress || "unknown";
    const clientIp = normalizeIp(rawIp);

    // Get enforcement config
    const enforcement = db
      .prepare("SELECT value FROM ext_cockpit_enterprise_ip_config WHERE key = 'enforcement_enabled'")
      .get();

    if (!enforcement || enforcement.value !== "true") {
      return res.json({ ip: clientIp, allowed: true, reason: "Enforcement disabled" });
    }

    // Get active rules (not expired)
    const rules = db
      .prepare(
        `SELECT cidr, scope, scope_id FROM ext_cockpit_enterprise_ip_allowlist
         WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY scope`
      )
      .all();

    if (rules.length === 0) {
      return res.json({ ip: clientIp, allowed: true, reason: "No rules configured" });
    }

    const matched = rules.some((r) => ipMatchesCIDR(clientIp, r.cidr));
    res.json({
      ip: clientIp,
      allowed: matched,
      reason: matched ? "IP matches allowlist" : "IP not in allowlist",
      rules_evaluated: rules.length,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get enforcement config
router.get("/config", (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM ext_cockpit_enterprise_ip_config").all();
    const config = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update enforcement config
router.put("/config", requireRole("admin"), (req, res) => {
  try {
    const allowed = ["enforcement_enabled", "deny_action", "log_denials"];
    const updates = {};

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] = String(req.body[key]);
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: `No valid config keys. Allowed: ${allowed.join(", ")}` });
    }

    db.transaction(() => {
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO ext_cockpit_enterprise_ip_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
      );
      for (const [key, value] of Object.entries(updates)) {
        stmt.run(key, value);
      }
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "ip_allowlist.config_update", null, JSON.stringify(updates));
    }

    res.json({ updated: true, config: updates });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create, ipMatchesCIDR, normalizeIp };
