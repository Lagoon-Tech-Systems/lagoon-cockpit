const express = require("express");
const router = express.Router();

const alertEngine = require("../system/alerts");
const webhooks = require("../system/webhooks");
const scheduler = require("../system/scheduler");
const { requireAuth, requireRole } = require("../auth/middleware");
const { checkLimit } = require("../edition/middleware");
const { auditLog, getDb } = require("../db/sqlite");

// ── Alert Rules ──────────────────────────────────────────
router.get("/api/alerts/rules", requireAuth, (_req, res) => {
  res.json({ rules: alertEngine.listRules() });
});

router.post("/api/alerts/rules", requireAuth, requireRole("admin"), (req, res) => {
  try {
    // Edition limit check
    const ruleCount = alertEngine.listRules().length;
    const limit = checkLimit(req, "alertRules", ruleCount);
    if (!limit.allowed) {
      return res.status(402).json({
        error: `Alert rule limit reached (${limit.max})`,
        current: limit.current,
        max: limit.max,
        upgradeUrl: "https://lagoontechsystems.com/upgrade",
      });
    }

    const { name, metric, operator, threshold, durationSeconds } = req.body;
    if (!name || !metric || !operator || threshold === undefined) {
      return res.status(400).json({ error: "name, metric, operator, threshold required" });
    }
    const rule = alertEngine.createRule(name, metric, operator, threshold, durationSeconds || 0);
    auditLog(req.user.id, "alert.rule.create", name);
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/alerts/rules/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid rule ID" });
    alertEngine.deleteRule(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/alerts/rules/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/alerts/rules/:id/toggle", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid rule ID" });
    alertEngine.toggleRule(id, req.body.enabled !== false);
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/alerts/rules/:id/toggle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/alerts/events", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  res.json({ events: alertEngine.getAlertEvents(limit) });
});

// ── Webhooks ─────────────────────────────────────────────
router.get("/api/webhooks", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ webhooks: webhooks.listWebhooks() });
});

router.post("/api/webhooks", requireAuth, requireRole("admin"), (req, res) => {
  try {
    // Edition limit check
    const hookCount = webhooks.listWebhooks().length;
    const limit = checkLimit(req, "webhooks", hookCount);
    if (!limit.allowed) {
      return res.status(402).json({
        error: `Webhook limit reached (${limit.max})`,
        current: limit.current,
        max: limit.max,
        upgradeUrl: "https://lagoontechsystems.com/upgrade",
      });
    }

    const { name, url, events, headers } = req.body;
    if (!name || !url) return res.status(400).json({ error: "name and url required" });
    const hook = webhooks.createWebhook(name, url, events || "container.down", headers || {});
    auditLog(req.user.id, "webhook.create", name);
    res.status(201).json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/webhooks/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid webhook ID" });
    webhooks.deleteWebhook(id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/webhooks/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Scheduled Actions ────────────────────────────────────
router.get("/api/schedules", requireAuth, (_req, res) => {
  res.json({ schedules: scheduler.listSchedules() });
});

router.post("/api/schedules", requireAuth, requireRole("admin"), (req, res) => {
  try {
    // Edition limit check
    const schedCount = scheduler.listSchedules().length;
    const limit = checkLimit(req, "schedules", schedCount);
    if (!limit.allowed) {
      return res.status(402).json({
        error: `Schedule limit reached (${limit.max})`,
        current: limit.current,
        max: limit.max,
        upgradeUrl: "https://lagoontechsystems.com/upgrade",
      });
    }

    const { name, containerId, containerName, action, cronExpression } = req.body;
    if (!name || !containerId || !containerName || !action || !cronExpression) {
      return res.status(400).json({ error: "name, containerId, containerName, action, cronExpression required" });
    }
    const schedule = scheduler.createSchedule(name, containerId, containerName, action, cronExpression);
    auditLog(req.user.id, "schedule.create", name, `${action} ${containerName} @ ${cronExpression}`);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/schedules/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid schedule ID" });
    scheduler.deleteSchedule(id);
    auditLog(req.user.id, "schedule.delete", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/schedules/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/api/schedules/:id/toggle", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid schedule ID" });
    const schedule = scheduler.toggleSchedule(id, req.body.enabled !== false);
    if (!schedule) return res.status(404).json({ error: "Schedule not found" });
    auditLog(req.user.id, "schedule.toggle", req.params.id, req.body.enabled !== false ? "enabled" : "disabled");
    res.json(schedule);
  } catch (err) {
    console.error("PUT /api/schedules/:id/toggle error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/api/schedules/history", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
  res.json({ history: scheduler.getScheduleHistory(limit) });
});

// ── Maintenance Mode ─────────────────────────────────────
// maintenanceMode state is managed in index.js and passed via app.locals
router.get("/api/maintenance", requireAuth, (req, res) => {
  res.json({ enabled: req.app.locals.maintenanceMode });
});

router.post("/api/maintenance", requireAuth, requireRole("admin"), (req, res) => {
  req.app.locals.maintenanceMode = req.body.enabled === true;
  auditLog(req.user.id, "maintenance.toggle", null, req.app.locals.maintenanceMode ? "enabled" : "disabled");
  res.json({ enabled: req.app.locals.maintenanceMode });
});

// ── Audit Log ────────────────────────────────────────────
router.get("/api/audit", requireAuth, requireRole("admin"), (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
  const { action, user } = req.query;

  const conditions = [];
  const params = [];
  if (action) {
    conditions.push("action = ?");
    params.push(action);
  }
  if (user) {
    conditions.push("user_id = ?");
    params.push(user);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { total } = db.prepare(`SELECT COUNT(*) as total FROM audit_log ${where}`).get(...params);
  const logs = db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  res.json({ logs, total, limit, offset });
});

module.exports = router;
