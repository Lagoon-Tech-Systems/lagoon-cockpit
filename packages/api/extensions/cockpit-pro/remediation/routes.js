const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

// H2: Disallowed action types — run_script is too dangerous for automated remediation
const BLOCKED_ACTION_TYPES = ["run_script"];

// H5: SSRF protection for webhook targets
function isPrivateUrl(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(hostname)) return true;
    if (hostname.startsWith("169.254.")) return true; // link-local / cloud metadata
    if (hostname.startsWith("10.")) return true;
    if (hostname.startsWith("192.168.")) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (!["http:", "https:"].includes(parsed.protocol)) return true;
    return false;
  } catch {
    return true;
  }
}

let db = null;
let services = null;

function init(svc) {
  services = svc;
  db = services.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_remediation_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      condition_metric TEXT NOT NULL,
      condition_operator TEXT NOT NULL CHECK(condition_operator IN ('>', '>=', '<', '<=', '==')),
      condition_threshold REAL NOT NULL,
      condition_duration INTEGER DEFAULT 0,
      action_type TEXT NOT NULL CHECK(action_type IN ('restart_container', 'restart_service', 'run_script', 'webhook')),
      action_target TEXT NOT NULL,
      action_config TEXT DEFAULT '{}',
      cooldown_seconds INTEGER DEFAULT 300,
      enabled INTEGER DEFAULT 1,
      last_triggered DATETIME,
      trigger_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_remediation_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL REFERENCES ext_cockpit_pro_remediation_rules(id) ON DELETE CASCADE,
      rule_name TEXT NOT NULL,
      condition_value REAL,
      action_type TEXT NOT NULL,
      action_target TEXT NOT NULL,
      result TEXT NOT NULL CHECK(result IN ('success', 'failed', 'cooldown_skipped')),
      error_message TEXT,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_cp_remed_history_rule ON ext_cockpit_pro_remediation_history(rule_id);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_remed_history_created ON ext_cockpit_pro_remediation_history(created_at);
  `);
}

router.get("/rules", (_req, res) => {
  const rules = db.prepare("SELECT * FROM ext_cockpit_pro_remediation_rules ORDER BY created_at DESC").all();
  res.json({ rules: rules.map((r) => ({ ...r, action_config: JSON.parse(r.action_config) })) });
});

router.post("/rules", requireRole("admin", "operator"), (req, res) => {
  const { name, condition_metric, condition_operator, condition_threshold, condition_duration, action_type, action_target, action_config, cooldown_seconds } = req.body;
  if (!name || !condition_metric || !condition_operator || condition_threshold === undefined || !action_type || !action_target) {
    return res.status(400).json({ error: "name, condition_metric, condition_operator, condition_threshold, action_type, action_target required" });
  }

  // H2: Block run_script action type
  if (BLOCKED_ACTION_TYPES.includes(action_type)) {
    return res.status(400).json({ error: `Action type '${action_type}' is not allowed` });
  }

  // H5: SSRF check on webhook targets
  if (action_type === "webhook" && isPrivateUrl(action_target)) {
    return res.status(400).json({ error: "Webhook target cannot point to private/internal addresses" });
  }

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO ext_cockpit_pro_remediation_rules (id, name, condition_metric, condition_operator, condition_threshold, condition_duration, action_type, action_target, action_config, cooldown_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, condition_metric, condition_operator, condition_threshold, condition_duration || 0, action_type, action_target, JSON.stringify(action_config || {}), cooldown_seconds || 300);

  if (services?.auditLog) services.auditLog(req.user?.id || "system", "remediation.rule.create", id, `${action_type} on ${action_target}`);
  res.status(201).json({ id, name, action_type, action_target });
});

router.put("/rules/:id", requireRole("admin", "operator"), (req, res) => {
  const rule = db.prepare("SELECT * FROM ext_cockpit_pro_remediation_rules WHERE id = ?").get(req.params.id);
  if (!rule) return res.status(404).json({ error: "Rule not found" });

  // H2: Block run_script action type on update
  if (req.body.action_type && BLOCKED_ACTION_TYPES.includes(req.body.action_type)) {
    return res.status(400).json({ error: `Action type '${req.body.action_type}' is not allowed` });
  }

  // H5: SSRF check on webhook target updates
  const effectiveType = req.body.action_type || rule.action_type;
  const effectiveTarget = req.body.action_target || rule.action_target;
  if (effectiveType === "webhook" && isPrivateUrl(effectiveTarget)) {
    return res.status(400).json({ error: "Webhook target cannot point to private/internal addresses" });
  }

  const fields = ["name", "condition_metric", "condition_operator", "condition_threshold", "condition_duration", "action_type", "action_target", "cooldown_seconds", "enabled"];
  const sets = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); values.push(req.body[f]); }
  }
  if (req.body.action_config !== undefined) { sets.push("action_config = ?"); values.push(JSON.stringify(req.body.action_config)); }
  if (sets.length === 0) return res.status(400).json({ error: "No fields to update" });

  values.push(req.params.id);
  db.prepare(`UPDATE ext_cockpit_pro_remediation_rules SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  res.json({ ok: true });
});

router.delete("/rules/:id", requireRole("admin", "operator"), (req, res) => {
  const result = db.prepare("DELETE FROM ext_cockpit_pro_remediation_rules WHERE id = ?").run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "Rule not found" });
  res.json({ ok: true });
});

router.put("/rules/:id/toggle", requireRole("admin", "operator"), (req, res) => {
  const enabled = req.body.enabled !== false ? 1 : 0;
  db.prepare("UPDATE ext_cockpit_pro_remediation_rules SET enabled = ? WHERE id = ?").run(enabled, req.params.id);
  res.json({ ok: true, enabled: !!enabled });
});

router.get("/history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  const history = db.prepare("SELECT * FROM ext_cockpit_pro_remediation_history ORDER BY created_at DESC LIMIT ?").all(limit);
  res.json({ history });
});

module.exports = { init, router };
