/**
 * White-label / Custom Branding Module — Enterprise
 *
 * Per-tenant branding: logo, colors, app name, favicon, custom CSS.
 * Supports multiple brand configs with one active at a time.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/branding):
 *   GET    /                — List brand configs
 *   GET    /active          — Get active brand config (public-facing)
 *   GET    /:id             — Get brand config by ID
 *   POST   /                — Create brand config
 *   PUT    /:id             — Update brand config
 *   DELETE /:id             — Delete brand config
 *   PUT    /:id/activate    — Set as active brand
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_CSS_LENGTH = 50000;
const FONT_FAMILY_RE = /^[a-zA-Z0-9\s,\-'"]+$/;

// Dangerous CSS patterns that could enable XSS or external resource loading
const CSS_BLOCKED_PATTERNS = [
  /expression\s*\(/i,
  /javascript\s*:/i,
  /-moz-binding/i,
  /@import/i,
  /url\s*\(\s*['"]?\s*(?!https?:\/\/)/i, // url() with non-http schemes
  /<\/style/i,
  /<script/i,
];

function validateUrl(url) {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

function validateBrand(body) {
  const { name } = body;
  if (!name || typeof name !== "string" || name.length > 100) {
    return "name is required (max 100 chars)";
  }
  if (body.primary_color && !HEX_COLOR_RE.test(body.primary_color)) {
    return "primary_color must be a hex color (e.g. #1a2b3c)";
  }
  if (body.secondary_color && !HEX_COLOR_RE.test(body.secondary_color)) {
    return "secondary_color must be a hex color";
  }
  if (body.accent_color && !HEX_COLOR_RE.test(body.accent_color)) {
    return "accent_color must be a hex color";
  }
  if (body.custom_css) {
    if (body.custom_css.length > MAX_CSS_LENGTH) {
      return `custom_css exceeds max length (${MAX_CSS_LENGTH} chars)`;
    }
    for (const pattern of CSS_BLOCKED_PATTERNS) {
      if (pattern.test(body.custom_css)) {
        return "custom_css contains blocked pattern (expression, javascript:, @import, etc.)";
      }
    }
  }
  // Validate all URL fields
  const urlFields = ["logo_url", "logo_dark_url", "favicon_url", "email_logo_url"];
  for (const field of urlFields) {
    if (body[field] && !validateUrl(body[field])) {
      return `${field} must be a valid http/https URL`;
    }
  }
  if (body.font_family && !FONT_FAMILY_RE.test(body.font_family)) {
    return "font_family contains invalid characters (alphanumeric, commas, hyphens, quotes, spaces only)";
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
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_branding (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      app_name TEXT DEFAULT 'Cockpit',
      logo_url TEXT,
      logo_dark_url TEXT,
      favicon_url TEXT,
      primary_color TEXT DEFAULT '#2563eb',
      secondary_color TEXT DEFAULT '#1e40af',
      accent_color TEXT DEFAULT '#3b82f6',
      sidebar_bg TEXT DEFAULT '#1e293b',
      sidebar_text TEXT DEFAULT '#e2e8f0',
      font_family TEXT DEFAULT 'Inter, system-ui, sans-serif',
      custom_css TEXT,
      login_title TEXT,
      login_subtitle TEXT,
      footer_text TEXT,
      email_from_name TEXT,
      email_logo_url TEXT,
      is_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_branding_active
      ON ext_cockpit_enterprise_branding(is_active);
  `);
}

// ── Routes ─────────────────────────────────────────────────────

// List brands (excludes custom_css from list for performance)
router.get("/", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const brands = db
      .prepare(
        `SELECT id, name, app_name, logo_url, logo_dark_url, favicon_url,
                primary_color, secondary_color, accent_color, sidebar_bg, sidebar_text,
                font_family, login_title, login_subtitle, footer_text,
                email_from_name, email_logo_url, is_active, created_at, updated_at
         FROM ext_cockpit_enterprise_branding
         ORDER BY is_active DESC, updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);
    res.json({ brands });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get active brand (for client rendering)
router.get("/active", (req, res) => {
  try {
    const brand = db
      .prepare("SELECT * FROM ext_cockpit_enterprise_branding WHERE is_active = 1")
      .get();
    if (!brand) return res.json({ brand: null });
    res.json({ brand });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get brand by ID
router.get("/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid brand ID" });
    }
    const brand = db
      .prepare("SELECT * FROM ext_cockpit_enterprise_branding WHERE id = ?")
      .get(req.params.id);
    if (!brand) return res.status(404).json({ error: "Brand config not found" });
    res.json(brand);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create brand
router.post("/", requireRole("admin"), (req, res) => {
  try {
    const err = validateBrand(req.body);
    if (err) return res.status(400).json({ error: err });

    const id = crypto.randomUUID();
    const b = req.body;

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_branding
        (id, name, app_name, logo_url, logo_dark_url, favicon_url,
         primary_color, secondary_color, accent_color, sidebar_bg, sidebar_text,
         font_family, custom_css, login_title, login_subtitle, footer_text,
         email_from_name, email_logo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      b.name,
      b.app_name || "Cockpit",
      b.logo_url || null,
      b.logo_dark_url || null,
      b.favicon_url || null,
      b.primary_color || "#2563eb",
      b.secondary_color || "#1e40af",
      b.accent_color || "#3b82f6",
      b.sidebar_bg || "#1e293b",
      b.sidebar_text || "#e2e8f0",
      b.font_family || "Inter, system-ui, sans-serif",
      b.custom_css || null,
      b.login_title || null,
      b.login_subtitle || null,
      b.footer_text || null,
      b.email_from_name || null,
      b.email_logo_url || null
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "branding.create", id, b.name);
    }

    res.status(201).json({ id, name: b.name, is_active: false });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update brand
router.put("/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid brand ID" });
    }

    const existing = db
      .prepare("SELECT id FROM ext_cockpit_enterprise_branding WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Brand config not found" });

    const err = validateBrand(req.body);
    if (err) return res.status(400).json({ error: err });

    const b = req.body;
    db.prepare(
      `UPDATE ext_cockpit_enterprise_branding SET
        name = ?, app_name = ?, logo_url = ?, logo_dark_url = ?, favicon_url = ?,
        primary_color = ?, secondary_color = ?, accent_color = ?, sidebar_bg = ?, sidebar_text = ?,
        font_family = ?, custom_css = ?, login_title = ?, login_subtitle = ?, footer_text = ?,
        email_from_name = ?, email_logo_url = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.name,
      b.app_name || "Cockpit",
      b.logo_url || null,
      b.logo_dark_url || null,
      b.favicon_url || null,
      b.primary_color || "#2563eb",
      b.secondary_color || "#1e40af",
      b.accent_color || "#3b82f6",
      b.sidebar_bg || "#1e293b",
      b.sidebar_text || "#e2e8f0",
      b.font_family || "Inter, system-ui, sans-serif",
      b.custom_css || null,
      b.login_title || null,
      b.login_subtitle || null,
      b.footer_text || null,
      b.email_from_name || null,
      b.email_logo_url || null,
      req.params.id
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "branding.update", req.params.id, b.name);
    }

    res.json({ id: req.params.id, updated: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete brand
router.delete("/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid brand ID" });
    }

    const existing = db
      .prepare("SELECT id, name, is_active FROM ext_cockpit_enterprise_branding WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Brand config not found" });

    if (existing.is_active) {
      return res.status(409).json({ error: "Cannot delete the active brand config. Activate another first." });
    }

    db.prepare("DELETE FROM ext_cockpit_enterprise_branding WHERE id = ?").run(req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "branding.delete", req.params.id, existing.name);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Activate brand
router.put("/:id/activate", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid brand ID" });
    }

    const brand = db
      .prepare("SELECT id, name FROM ext_cockpit_enterprise_branding WHERE id = ?")
      .get(req.params.id);
    if (!brand) return res.status(404).json({ error: "Brand config not found" });

    db.transaction(() => {
      db.prepare("UPDATE ext_cockpit_enterprise_branding SET is_active = 0 WHERE is_active = 1").run();
      db.prepare(
        "UPDATE ext_cockpit_enterprise_branding SET is_active = 1, updated_at = datetime('now') WHERE id = ?"
      ).run(req.params.id);
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "branding.activate", req.params.id, brand.name);
    }

    if (services?.broadcast) {
      services.broadcast("branding:changed", { brand_id: req.params.id });
    }

    res.json({ id: req.params.id, activated: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
