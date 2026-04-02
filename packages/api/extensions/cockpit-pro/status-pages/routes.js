const express = require("express");
const crypto = require("crypto");
const dns = require("dns");
const { URL } = require("url");

const router = express.Router();
const { requireRole } = require("../helpers/auth");

let db = null;
let services = null;

// ── Helpers ───────────────────────────────────────────────

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function userId(req) {
  return req.user?.id || "system";
}

function audit(req, action, entityId, detail) {
  if (services?.auditLog) {
    services.auditLog(userId(req), action, entityId, detail);
  }
}

function now() {
  return new Date().toISOString();
}

/**
 * SSRF protection: validate that a URL does not point to private/internal networks.
 * Resolves hostname and checks against RFC 1918, loopback, link-local, and metadata ranges.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
async function isUrlSafe(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { safe: false, reason: "Only http and https protocols are allowed" };
  }

  const hostname = parsed.hostname;

  // Block obvious localhost/metadata hostnames
  const blockedHostnames = ["localhost", "metadata.google.internal", "instance-data"];
  if (blockedHostnames.includes(hostname.toLowerCase())) {
    return { safe: false, reason: "Hostname is blocked" };
  }

  let addresses;
  try {
    // Try resolving as IPv4 first
    addresses = await dns.promises.resolve4(hostname);
  } catch {
    try {
      addresses = await dns.promises.resolve6(hostname);
    } catch {
      // If hostname is already an IP literal, use it directly
      addresses = [hostname];
    }
  }

  const privateRanges = [
    /^127\./,                        // loopback
    /^10\./,                         // RFC 1918 Class A
    /^172\.(1[6-9]|2\d|3[01])\./,   // RFC 1918 Class B
    /^192\.168\./,                   // RFC 1918 Class C
    /^169\.254\./,                   // link-local
    /^0\./,                          // current network
    /^::1$/,                         // IPv6 loopback
    /^f[cd][0-9a-f]{2}:/i,          // IPv6 unique local (fc00::/7)
    /^fe80:/i,                       // IPv6 link-local
  ];

  for (const addr of addresses) {
    for (const range of privateRanges) {
      if (range.test(addr)) {
        return { safe: false, reason: `Resolved IP ${addr} is in a private range` };
      }
    }
  }

  return { safe: true };
}

// ── Init ──────────────────────────────────────────────────

function init(svc) {
  services = svc;
  db = svc.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_status_pages (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      is_public INTEGER NOT NULL DEFAULT 1,
      custom_domain TEXT,
      theme TEXT NOT NULL DEFAULT 'default',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_status_components (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES ext_cockpit_pro_status_pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'operational'
        CHECK(status IN ('operational', 'degraded', 'partial_outage', 'major_outage', 'maintenance')),
      display_order INTEGER NOT NULL DEFAULT 0,
      group_name TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_status_incidents (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES ext_cockpit_pro_status_pages(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT,
      severity TEXT NOT NULL CHECK(severity IN ('minor', 'major', 'critical')),
      status TEXT NOT NULL DEFAULT 'investigating'
        CHECK(status IN ('investigating', 'identified', 'monitoring', 'resolved')),
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now')),
      resolved_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_status_subscribers (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL REFERENCES ext_cockpit_pro_status_pages(id) ON DELETE CASCADE,
      email TEXT,
      webhook_url TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      verify_token TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sp_pages_slug
      ON ext_cockpit_pro_status_pages(slug);
    CREATE INDEX IF NOT EXISTS idx_sp_components_page
      ON ext_cockpit_pro_status_components(page_id);
    CREATE INDEX IF NOT EXISTS idx_sp_incidents_page
      ON ext_cockpit_pro_status_incidents(page_id);
    CREATE INDEX IF NOT EXISTS idx_sp_incidents_status
      ON ext_cockpit_pro_status_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_sp_subscribers_page
      ON ext_cockpit_pro_status_subscribers(page_id);
    CREATE INDEX IF NOT EXISTS idx_sp_subscribers_token
      ON ext_cockpit_pro_status_subscribers(verify_token);
  `);
}

// ═══════════════════════════════════════════════════════════
//  PAGES CRUD
// ═══════════════════════════════════════════════════════════

// ── List all status pages ─────────────────────────────────
router.get("/", (req, res) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 500));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const pages = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset);

    const total = db
      .prepare("SELECT COUNT(*) AS count FROM ext_cockpit_pro_status_pages")
      .get().count;

    res.json({ pages, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Failed to list status pages" });
  }
});

// ── Create status page ────────────────────────────────────
router.post("/", requireRole("admin", "operator"), (req, res) => {
  try {
    const { name, description, is_public, custom_domain, theme } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const id = crypto.randomUUID();
    let slug = slugify(name);

    // Ensure slug uniqueness
    const existing = db
      .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE slug = ?")
      .get(slug);
    if (existing) {
      slug = `${slug}-${id.slice(0, 8)}`;
    }

    const ts = now();
    db.prepare(`
      INSERT INTO ext_cockpit_pro_status_pages
        (id, name, slug, description, is_public, custom_domain, theme, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      slug,
      description || null,
      is_public !== undefined ? (is_public ? 1 : 0) : 1,
      custom_domain || null,
      theme || "default",
      ts,
      ts
    );

    audit(req, "status_page.create", id, `Created status page: ${name} (${id})`);

    if (services?.broadcast) {
      services.broadcast({ type: "status_page_update", action: "page_created", pageId: id, name, slug });
    }

    res.status(201).json({ id, name: name.trim(), slug, description, is_public: is_public !== undefined ? (is_public ? 1 : 0) : 1, theme: theme || "default" });
  } catch (err) {
    res.status(500).json({ error: "Failed to create status page" });
  }
});

// ── Get single page with components + active incidents ────
router.get("/:pageId", (req, res) => {
  try {
    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const components = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_components WHERE page_id = ? ORDER BY display_order ASC")
      .all(req.params.pageId);

    const incidents = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_incidents WHERE page_id = ? AND status != 'resolved' ORDER BY created_at DESC")
      .all(req.params.pageId);

    res.json({ ...page, components, active_incidents: incidents });
  } catch (err) {
    res.status(500).json({ error: "Failed to get status page" });
  }
});

// ── Update status page ────────────────────────────────────
router.put("/:pageId", requireRole("admin", "operator"), (req, res) => {
  try {
    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const { name, description, is_public, custom_domain, theme } = req.body;

    let slug = page.slug;
    if (name && name.trim() !== page.name) {
      slug = slugify(name);
      const existing = db
        .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE slug = ? AND id != ?")
        .get(slug, req.params.pageId);
      if (existing) {
        slug = `${slug}-${req.params.pageId.slice(0, 8)}`;
      }
    }

    const ts = now();
    db.prepare(`
      UPDATE ext_cockpit_pro_status_pages
      SET name = ?, slug = ?, description = ?, is_public = ?, custom_domain = ?, theme = ?, updated_at = ?
      WHERE id = ?
    `).run(
      name ? name.trim() : page.name,
      slug,
      description !== undefined ? description : page.description,
      is_public !== undefined ? (is_public ? 1 : 0) : page.is_public,
      custom_domain !== undefined ? custom_domain : page.custom_domain,
      theme || page.theme,
      ts,
      req.params.pageId
    );

    audit(req, "status_page.update", req.params.pageId, `Updated status page: ${page.name} (${req.params.pageId})`);

    res.json({ ok: true, id: req.params.pageId, slug });
  } catch (err) {
    res.status(500).json({ error: "Failed to update status page" });
  }
});

// ── Delete status page (cascade) ──────────────────────────
router.delete("/:pageId", requireRole("admin", "operator"), (req, res) => {
  try {
    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    // Cascade delete related records in a single transaction
    const cascadeDelete = db.transaction((pageId) => {
      db.prepare("DELETE FROM ext_cockpit_pro_status_subscribers WHERE page_id = ?").run(pageId);
      db.prepare("DELETE FROM ext_cockpit_pro_status_incidents WHERE page_id = ?").run(pageId);
      db.prepare("DELETE FROM ext_cockpit_pro_status_components WHERE page_id = ?").run(pageId);
      db.prepare("DELETE FROM ext_cockpit_pro_status_pages WHERE id = ?").run(pageId);
    });
    cascadeDelete(req.params.pageId);

    audit(req, "status_page.delete", req.params.pageId, `Deleted status page: ${page.name} (${req.params.pageId})`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete status page" });
  }
});

// ═══════════════════════════════════════════════════════════
//  COMPONENTS
// ═══════════════════════════════════════════════════════════

const VALID_COMPONENT_STATUSES = ["operational", "degraded", "partial_outage", "major_outage", "maintenance"];

// ── List components for a page ────────────────────────────
router.get("/:pageId/components", (req, res) => {
  try {
    const page = db
      .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const components = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_components WHERE page_id = ? ORDER BY display_order ASC")
      .all(req.params.pageId);

    res.json({ components });
  } catch (err) {
    res.status(500).json({ error: "Failed to list components" });
  }
});

// ── Add component ─────────────────────────────────────────
router.post("/:pageId/components", requireRole("admin", "operator"), (req, res) => {
  try {
    const page = db
      .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const { name, description, status, display_order, group_name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const compStatus = status || "operational";
    if (!VALID_COMPONENT_STATUSES.includes(compStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_COMPONENT_STATUSES.join(", ")}` });
    }

    const id = crypto.randomUUID();
    const ts = now();

    db.prepare(`
      INSERT INTO ext_cockpit_pro_status_components
        (id, page_id, name, description, status, display_order, group_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      req.params.pageId,
      name.trim(),
      description || null,
      compStatus,
      display_order !== undefined ? display_order : 0,
      group_name || null,
      ts,
      ts
    );

    audit(req, "status_component.create", id, `Added component "${name}" to page ${req.params.pageId}`);

    res.status(201).json({ id, name: name.trim(), status: compStatus, page_id: req.params.pageId });
  } catch (err) {
    res.status(500).json({ error: "Failed to add component" });
  }
});

// ── Update component ──────────────────────────────────────
router.put("/:pageId/components/:compId", requireRole("admin", "operator"), (req, res) => {
  try {
    const comp = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_components WHERE id = ? AND page_id = ?")
      .get(req.params.compId, req.params.pageId);
    if (!comp) return res.status(404).json({ error: "Component not found" });

    const { name, description, status, display_order, group_name } = req.body;

    if (status && !VALID_COMPONENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_COMPONENT_STATUSES.join(", ")}` });
    }

    const previousStatus = comp.status;
    const newStatus = status || comp.status;
    const ts = now();

    db.prepare(`
      UPDATE ext_cockpit_pro_status_components
      SET name = ?, description = ?, status = ?, display_order = ?, group_name = ?, updated_at = ?
      WHERE id = ? AND page_id = ?
    `).run(
      name ? name.trim() : comp.name,
      description !== undefined ? description : comp.description,
      newStatus,
      display_order !== undefined ? display_order : comp.display_order,
      group_name !== undefined ? group_name : comp.group_name,
      ts,
      req.params.compId,
      req.params.pageId
    );

    audit(req, "status_component.update", req.params.compId, `Updated component "${comp.name}" on page ${req.params.pageId}`);

    // Broadcast on status change
    if (status && status !== previousStatus && services?.broadcast) {
      services.broadcast({
        type: "status_page_update",
        action: "component_status_changed",
        pageId: req.params.pageId,
        componentId: req.params.compId,
        previousStatus,
        newStatus,
      });
    }

    res.json({ ok: true, id: req.params.compId, status: newStatus });
  } catch (err) {
    res.status(500).json({ error: "Failed to update component" });
  }
});

// ── Delete component ──────────────────────────────────────
router.delete("/:pageId/components/:compId", requireRole("admin", "operator"), (req, res) => {
  try {
    const comp = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_components WHERE id = ? AND page_id = ?")
      .get(req.params.compId, req.params.pageId);
    if (!comp) return res.status(404).json({ error: "Component not found" });

    db.prepare("DELETE FROM ext_cockpit_pro_status_components WHERE id = ? AND page_id = ?")
      .run(req.params.compId, req.params.pageId);

    audit(req, "status_component.delete", req.params.compId, `Deleted component "${comp.name}" from page ${req.params.pageId}`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete component" });
  }
});

// ═══════════════════════════════════════════════════════════
//  INCIDENTS
// ═══════════════════════════════════════════════════════════

const VALID_INCIDENT_SEVERITIES = ["minor", "major", "critical"];
const VALID_INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"];

// ── List incidents for a page ─────────────────────────────
router.get("/:pageId/incidents", (req, res) => {
  try {
    const page = db
      .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 500));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    let sql = "SELECT * FROM ext_cockpit_pro_status_incidents WHERE page_id = ?";
    let countSql = "SELECT COUNT(*) AS count FROM ext_cockpit_pro_status_incidents WHERE page_id = ?";
    const params = [req.params.pageId];
    const countParams = [req.params.pageId];

    if (req.query.status) {
      if (!VALID_INCIDENT_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: `Invalid status filter. Must be one of: ${VALID_INCIDENT_STATUSES.join(", ")}` });
      }
      sql += " AND status = ?";
      countSql += " AND status = ?";
      params.push(req.query.status);
      countParams.push(req.query.status);
    }

    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const incidents = db.prepare(sql).all(...params);
    const total = db.prepare(countSql).get(...countParams).count;
    res.json({ incidents, total, limit, offset });
  } catch (err) {
    res.status(500).json({ error: "Failed to list incidents" });
  }
});

// ── Create incident ───────────────────────────────────────
router.post("/:pageId/incidents", requireRole("admin", "operator"), (req, res) => {
  try {
    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const { title, message, severity, status } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: "title is required" });
    }
    if (!severity || !VALID_INCIDENT_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `severity is required and must be one of: ${VALID_INCIDENT_SEVERITIES.join(", ")}` });
    }

    const incStatus = status || "investigating";
    if (!VALID_INCIDENT_STATUSES.includes(incStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_INCIDENT_STATUSES.join(", ")}` });
    }

    const id = crypto.randomUUID();
    const ts = now();

    db.prepare(`
      INSERT INTO ext_cockpit_pro_status_incidents
        (id, page_id, title, message, severity, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.pageId, title.trim(), message || null, severity, incStatus, ts, ts);

    audit(req, "status_incident.create", id, `Created incident "${title}" (${severity}) on page ${req.params.pageId}`);

    // Broadcast via SSE
    if (services?.broadcast) {
      services.broadcast({
        type: "status_page_update",
        action: "incident_created",
        pageId: req.params.pageId,
        incidentId: id,
        title: title.trim(),
        severity,
        status: incStatus,
      });
    }

    // Fire webhooks
    services?.webhooks?.fireWebhooks?.("status_page.update", {
      event: "incident_created",
      page_id: req.params.pageId,
      page_name: page.name,
      incident: { id, title: title.trim(), message, severity, status: incStatus },
    });

    // Notify subscribers
    notifySubscribers(req.params.pageId, {
      event: "incident_created",
      title: title.trim(),
      severity,
      message: message || "",
    });

    res.status(201).json({ id, title: title.trim(), severity, status: incStatus, page_id: req.params.pageId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create incident" });
  }
});

// ── Update incident ───────────────────────────────────────
router.put("/:pageId/incidents/:incId", requireRole("admin", "operator"), (req, res) => {
  try {
    const incident = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_incidents WHERE id = ? AND page_id = ?")
      .get(req.params.incId, req.params.pageId);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    const { title, message, severity, status } = req.body;

    if (severity && !VALID_INCIDENT_SEVERITIES.includes(severity)) {
      return res.status(400).json({ error: `Invalid severity. Must be one of: ${VALID_INCIDENT_SEVERITIES.join(", ")}` });
    }
    if (status && !VALID_INCIDENT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_INCIDENT_STATUSES.join(", ")}` });
    }

    const newStatus = status || incident.status;
    const ts = now();
    const resolvedAt = newStatus === "resolved" && incident.status !== "resolved" ? ts : incident.resolved_at;

    db.prepare(`
      UPDATE ext_cockpit_pro_status_incidents
      SET title = ?, message = ?, severity = ?, status = ?, updated_at = ?, resolved_at = ?
      WHERE id = ? AND page_id = ?
    `).run(
      title ? title.trim() : incident.title,
      message !== undefined ? message : incident.message,
      severity || incident.severity,
      newStatus,
      ts,
      resolvedAt,
      req.params.incId,
      req.params.pageId
    );

    audit(req, "status_incident.update", req.params.incId, `Updated incident "${incident.title}" on page ${req.params.pageId} — status: ${newStatus}`);

    // Broadcast on status change
    if (status && status !== incident.status && services?.broadcast) {
      services.broadcast({
        type: "status_page_update",
        action: "incident_updated",
        pageId: req.params.pageId,
        incidentId: req.params.incId,
        previousStatus: incident.status,
        newStatus,
      });
    }

    // Fire webhooks on update
    services?.webhooks?.fireWebhooks?.("status_page.update", {
      event: "incident_updated",
      page_id: req.params.pageId,
      incident: {
        id: req.params.incId,
        title: title ? title.trim() : incident.title,
        status: newStatus,
        severity: severity || incident.severity,
      },
    });

    res.json({ ok: true, id: req.params.incId, status: newStatus, resolved_at: resolvedAt });
  } catch (err) {
    res.status(500).json({ error: "Failed to update incident" });
  }
});

// ── Delete incident ───────────────────────────────────────
router.delete("/:pageId/incidents/:incId", requireRole("admin", "operator"), (req, res) => {
  try {
    const incident = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_incidents WHERE id = ? AND page_id = ?")
      .get(req.params.incId, req.params.pageId);
    if (!incident) return res.status(404).json({ error: "Incident not found" });

    db.prepare("DELETE FROM ext_cockpit_pro_status_incidents WHERE id = ? AND page_id = ?")
      .run(req.params.incId, req.params.pageId);

    audit(req, "status_incident.delete", req.params.incId, `Deleted incident "${incident.title}" from page ${req.params.pageId}`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete incident" });
  }
});

// ═══════════════════════════════════════════════════════════
//  SUBSCRIBERS
// ═══════════════════════════════════════════════════════════

// ── Subscribe ─────────────────────────────────────────────
router.post("/:pageId/subscribers", requireRole("admin", "operator"), async (req, res) => {
  try {
    const page = db
      .prepare("SELECT id FROM ext_cockpit_pro_status_pages WHERE id = ?")
      .get(req.params.pageId);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const { email, webhook_url } = req.body;
    if (!email && !webhook_url) {
      return res.status(400).json({ error: "email or webhook_url is required" });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // SSRF protection: validate webhook URL before storing
    if (webhook_url) {
      const urlCheck = await isUrlSafe(webhook_url);
      if (!urlCheck.safe) {
        return res.status(400).json({ error: `Webhook URL rejected: ${urlCheck.reason}` });
      }
    }

    // Check for duplicate email subscription on this page
    if (email) {
      const existing = db
        .prepare("SELECT id FROM ext_cockpit_pro_status_subscribers WHERE page_id = ? AND email = ?")
        .get(req.params.pageId, email);
      if (existing) {
        return res.status(409).json({ error: "This email is already subscribed to this status page" });
      }
    }

    const id = crypto.randomUUID();
    const verify_token = crypto.randomUUID();
    const ts = now();

    db.prepare(`
      INSERT INTO ext_cockpit_pro_status_subscribers
        (id, page_id, email, webhook_url, verified, verify_token, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(id, req.params.pageId, email || null, webhook_url || null, verify_token, ts);

    audit(req, "status_subscriber.create", id, `New subscriber on page ${req.params.pageId}: ${email || webhook_url}`);

    res.status(201).json({ id, verify_token, message: "Subscription created. Please verify." });
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

// ── Verify subscription ───────────────────────────────────
router.get("/:pageId/subscribers/verify/:token", (req, res) => {
  try {
    const sub = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_subscribers WHERE page_id = ? AND verify_token = ?")
      .get(req.params.pageId, req.params.token);
    if (!sub) return res.status(404).json({ error: "Invalid or expired verification token" });

    if (sub.verified) {
      return res.json({ ok: true, message: "Already verified" });
    }

    db.prepare("UPDATE ext_cockpit_pro_status_subscribers SET verified = 1 WHERE id = ?")
      .run(sub.id);

    res.json({ ok: true, message: "Subscription verified" });
  } catch (err) {
    res.status(500).json({ error: "Failed to verify subscription" });
  }
});

// ── Unsubscribe ───────────────────────────────────────────
router.delete("/:pageId/subscribers/:subId", requireRole("admin", "operator"), (req, res) => {
  try {
    const sub = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_subscribers WHERE id = ? AND page_id = ?")
      .get(req.params.subId, req.params.pageId);
    if (!sub) return res.status(404).json({ error: "Subscriber not found" });

    db.prepare("DELETE FROM ext_cockpit_pro_status_subscribers WHERE id = ? AND page_id = ?")
      .run(req.params.subId, req.params.pageId);

    audit(req, "status_subscriber.delete", req.params.subId, `Removed subscriber ${sub.email || sub.webhook_url} from page ${req.params.pageId}`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

// ═══════════════════════════════════════════════════════════
//  PUBLIC ENDPOINT
// ═══════════════════════════════════════════════════════════

// NOTE: This route is behind the extension router which may enforce auth.
// For true public access, the parent app should mount this path without auth middleware.
router.get("/public/:slug", (req, res) => {
  try {
    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE slug = ? AND is_public = 1")
      .get(req.params.slug);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const components = db
      .prepare("SELECT id, name, description, status, display_order, group_name FROM ext_cockpit_pro_status_components WHERE page_id = ? ORDER BY display_order ASC")
      .all(page.id);

    const active_incidents = db
      .prepare("SELECT id, title, message, severity, status, created_at, updated_at FROM ext_cockpit_pro_status_incidents WHERE page_id = ? AND status != 'resolved' ORDER BY created_at DESC")
      .all(page.id);

    const recent_incidents = db
      .prepare("SELECT id, title, message, severity, status, created_at, resolved_at FROM ext_cockpit_pro_status_incidents WHERE page_id = ? AND status = 'resolved' ORDER BY resolved_at DESC LIMIT 10")
      .all(page.id);

    // Compute overall status from components
    let overall_status = "operational";
    for (const comp of components) {
      if (comp.status === "major_outage") { overall_status = "major_outage"; break; }
      if (comp.status === "partial_outage" && overall_status !== "major_outage") overall_status = "partial_outage";
      if (comp.status === "degraded" && overall_status === "operational") overall_status = "degraded";
      if (comp.status === "maintenance" && overall_status === "operational") overall_status = "maintenance";
    }

    res.json({
      name: page.name,
      slug: page.slug,
      description: page.description,
      theme: page.theme,
      overall_status,
      components,
      active_incidents,
      recent_incidents,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load status page" });
  }
});

// ═══════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Notify verified subscribers of a status page about an event.
 * Fires webhook URLs for verified webhook subscribers.
 */
async function notifySubscribers(pageId, payload) {
  try {
    const subscribers = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_subscribers WHERE page_id = ? AND verified = 1")
      .all(pageId);

    for (const sub of subscribers) {
      // For webhook subscribers, fire the webhook with SSRF re-validation
      if (sub.webhook_url) {
        try {
          const urlCheck = await isUrlSafe(sub.webhook_url);
          if (!urlCheck.safe) continue; // Skip unsafe URLs silently

          // Non-blocking webhook call
          fetch(sub.webhook_url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, page_id: pageId, subscriber_id: sub.id }),
          }).catch(() => {});
        } catch (_) {
          // Ignore individual webhook failures
        }
      }

      // For email subscribers, use push notification service as a proxy
      if (sub.email && services?.sendPushNotification) {
        services.sendPushNotification(
          `Status Update: ${payload.title}`,
          `${payload.severity.toUpperCase()}: ${payload.message || payload.event}`,
          { type: "status_page", pageId, email: sub.email }
        ).catch(() => {});
      }
    }
  } catch (_) {
    // Subscriber notification is best-effort
  }
}

// Public router — mounted WITHOUT auth for unauthenticated status page access
const publicRouter = express.Router();
publicRouter.get("/public/:slug", (req, res) => {
  try {
    if (!db) return res.status(503).json({ error: "Status pages not initialized" });

    const page = db
      .prepare("SELECT * FROM ext_cockpit_pro_status_pages WHERE slug = ? AND is_public = 1")
      .get(req.params.slug);
    if (!page) return res.status(404).json({ error: "Status page not found" });

    const components = db
      .prepare("SELECT id, name, description, status, display_order, group_name FROM ext_cockpit_pro_status_components WHERE page_id = ? ORDER BY display_order ASC")
      .all(page.id);

    const active_incidents = db
      .prepare("SELECT id, title, message, severity, status, created_at, updated_at FROM ext_cockpit_pro_status_incidents WHERE page_id = ? AND status != 'resolved' ORDER BY created_at DESC")
      .all(page.id);

    const recent_incidents = db
      .prepare("SELECT id, title, message, severity, status, created_at, resolved_at FROM ext_cockpit_pro_status_incidents WHERE page_id = ? AND status = 'resolved' ORDER BY resolved_at DESC LIMIT 10")
      .all(page.id);

    let overall_status = "operational";
    for (const comp of components) {
      if (comp.status === "major_outage") { overall_status = "major_outage"; break; }
      if (comp.status === "partial_outage" && overall_status !== "major_outage") overall_status = "partial_outage";
      if (comp.status === "degraded" && overall_status === "operational") overall_status = "degraded";
      if (comp.status === "maintenance" && overall_status === "operational") overall_status = "maintenance";
    }

    res.json({
      name: page.name, slug: page.slug, description: page.description,
      theme: page.theme, overall_status, components, active_incidents, recent_incidents,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to load status page" });
  }
});

module.exports = { init, router, publicRouter };
