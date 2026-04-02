const express = require("express");
const router = express.Router();
const { requireRole } = require("../helpers/auth");

const VALID_STATUSES = ["open", "investigating", "identified", "monitoring", "resolved"];

let db = null;
let services = null;

function init(svc) {
  services = svc;
  db = services.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_incidents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'investigating', 'identified', 'monitoring', 'resolved')),
      commander TEXT,
      description TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_incident_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL REFERENCES ext_cockpit_pro_incidents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      author TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_cp_incidents_status ON ext_cockpit_pro_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_timeline_incident ON ext_cockpit_pro_incident_timeline(incident_id);
  `);
}

// ── List incidents ─────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const status = req.query.status;
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    let sql = "SELECT * FROM ext_cockpit_pro_incidents";
    const params = [];

    if (status) {
      sql += " WHERE status = ?";
      params.push(status);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const incidents = db.prepare(sql).all(...params);
    res.json({ incidents });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Get single incident with timeline ──────────────────────
router.get("/:id", (req, res) => {
  try {
    const incident = db.prepare("SELECT * FROM ext_cockpit_pro_incidents WHERE id = ?").get(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const timeline = db.prepare(
      "SELECT * FROM ext_cockpit_pro_incident_timeline WHERE incident_id = ? ORDER BY created_at ASC"
    ).all(req.params.id);

    res.json({ ...incident, timeline });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Declare incident ───────────────────────────────────────
router.post("/", requireRole("admin", "operator"), (req, res) => {
  try {
    const { title, severity, commander, description } = req.body;
    if (!title || !severity) {
      return res.status(400).json({ error: "title and severity required" });
    }
    if (!["critical", "high", "medium", "low"].includes(severity)) {
      return res.status(400).json({ error: "Invalid severity. Must be: critical, high, medium, low" });
    }

    const id = require("crypto").randomUUID();
    const userId = req.user?.id || "system";

    db.transaction(() => {
      db.prepare(
        "INSERT INTO ext_cockpit_pro_incidents (id, title, severity, commander, description, created_by) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(id, title, severity, commander || null, description || null, userId);

      // Add timeline entry
      db.prepare(
        "INSERT INTO ext_cockpit_pro_incident_timeline (incident_id, type, message, author) VALUES (?, ?, ?, ?)"
      ).run(id, "declared", `Incident declared: ${title} (${severity})`, userId);
    })();

    // Send push notification
    if (services?.sendPushNotification) {
      services.sendPushNotification(
        `Incident: ${title}`,
        `Severity: ${severity} | Commander: ${commander || "unassigned"}`,
        { type: "incident", incidentId: id }
      ).catch(() => {});
    }

    // Broadcast via SSE
    if (services?.broadcast) {
      services.broadcast("incident", { id, title, severity, status: "open", commander });
    }

    // Audit log
    if (services?.auditLog) {
      services.auditLog(userId, "incident.declare", id, `${severity}: ${title}`);
    }

    res.status(201).json({ id, title, severity, status: "open" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Update incident status ─────────────────────────────────
router.put("/:id/status", requireRole("admin", "operator"), (req, res) => {
  try {
    const { status, message } = req.body;
    if (!status) return res.status(400).json({ error: "status required" });
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status", allowed: VALID_STATUSES });
    }

    const incident = db.prepare("SELECT * FROM ext_cockpit_pro_incidents WHERE id = ?").get(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const userId = req.user?.id || "system";
    const updates = { status, updated_at: new Date().toISOString() };

    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
    }

    // H7: Wrap status update + timeline insert in a transaction
    db.transaction(() => {
      db.prepare(
        "UPDATE ext_cockpit_pro_incidents SET status = ?, updated_at = ?" +
        (status === "resolved" ? ", resolved_at = ?" : "") +
        " WHERE id = ?"
      ).run(
        ...(status === "resolved"
          ? [status, updates.updated_at, updates.resolved_at, req.params.id]
          : [status, updates.updated_at, req.params.id])
      );

      // Timeline entry
      db.prepare(
        "INSERT INTO ext_cockpit_pro_incident_timeline (incident_id, type, message, author) VALUES (?, ?, ?, ?)"
      ).run(req.params.id, "status_change", message || `Status changed to ${status}`, userId);
    })();

    if (services?.broadcast) {
      services.broadcast("incident", { id: req.params.id, status, previousStatus: incident.status });
    }

    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Add timeline entry ─────────────────────────────────────
router.post("/:id/timeline", requireRole("admin", "operator"), (req, res) => {
  try {
    const { type, message } = req.body;
    if (!message) return res.status(400).json({ error: "message required" });

    const incident = db.prepare("SELECT * FROM ext_cockpit_pro_incidents WHERE id = ?").get(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const userId = req.user?.id || "system";
    db.prepare(
      "INSERT INTO ext_cockpit_pro_incident_timeline (incident_id, type, message, author) VALUES (?, ?, ?, ?)"
    ).run(req.params.id, type || "note", message, userId);

    db.prepare("UPDATE ext_cockpit_pro_incidents SET updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), req.params.id);

    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Delete incident ────────────────────────────────────────
router.delete("/:id", requireRole("admin", "operator"), (req, res) => {
  try {
    const incident = db.prepare("SELECT * FROM ext_cockpit_pro_incidents WHERE id = ?").get(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    db.prepare("DELETE FROM ext_cockpit_pro_incidents WHERE id = ?").run(req.params.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "incident.delete", req.params.id, incident.title);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = { init, router };
