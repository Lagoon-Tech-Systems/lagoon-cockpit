/**
 * Custom Roles / Granular RBAC Module — Enterprise
 *
 * Fine-grained role management beyond CE's basic admin/viewer model.
 * Supports custom roles with per-resource permissions and user-role assignments.
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/roles):
 *   GET    /                      — List all custom roles
 *   GET    /:id                   — Get role with permissions
 *   POST   /                      — Create custom role
 *   PUT    /:id                   — Update role
 *   DELETE /:id                   — Delete role
 *   GET    /:id/users             — List users assigned to role
 *   POST   /:id/users             — Assign user to role
 *   DELETE /:id/users/:userId     — Remove user from role
 *   GET    /users/:userId/check   — Check user's effective permissions
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resources and actions that can be controlled
const VALID_RESOURCES = [
  "containers",
  "stacks",
  "alerts",
  "schedules",
  "webhooks",
  "integrations",
  "users",
  "settings",
  "incidents",
  "remediation",
  "status_pages",
  "uptime",
  "chatops",
  "sla",
  "sso",
  "branding",
  "roles",
  "ip_allowlist",
  "mtls",
  "encryption",
  "compliance",
];

const VALID_ACTIONS = ["read", "create", "update", "delete", "execute"];

function validateRole(body) {
  const { name } = body;
  if (!name || typeof name !== "string" || name.length > 100) {
    return "name is required (max 100 chars)";
  }
  if (/^(admin|viewer|system)$/i.test(name)) {
    return "Cannot use reserved role names (admin, viewer, system)";
  }
  if (body.permissions && !Array.isArray(body.permissions)) {
    return "permissions must be an array";
  }
  if (body.permissions) {
    for (const perm of body.permissions) {
      if (!perm.resource || !VALID_RESOURCES.includes(perm.resource)) {
        return `Invalid resource: ${perm.resource}. Valid: ${VALID_RESOURCES.join(", ")}`;
      }
      if (!perm.actions || !Array.isArray(perm.actions)) {
        return "Each permission must have an actions array";
      }
      for (const action of perm.actions) {
        if (!VALID_ACTIONS.includes(action)) {
          return `Invalid action: ${action}. Valid: ${VALID_ACTIONS.join(", ")}`;
        }
      }
    }
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
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      is_system INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id TEXT NOT NULL REFERENCES ext_cockpit_enterprise_roles(id) ON DELETE CASCADE,
      resource TEXT NOT NULL,
      action TEXT NOT NULL,
      conditions TEXT DEFAULT '{}',
      UNIQUE(role_id, resource, action)
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role_id TEXT NOT NULL REFERENCES ext_cockpit_enterprise_roles(id) ON DELETE CASCADE,
      assigned_by TEXT,
      assigned_at DATETIME DEFAULT (datetime('now')),
      UNIQUE(user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_role_perms_role
      ON ext_cockpit_enterprise_role_permissions(role_id);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_user_roles_user
      ON ext_cockpit_enterprise_user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_user_roles_role
      ON ext_cockpit_enterprise_user_roles(role_id);
  `);
}

// ── Helper: get role with permissions ──────────────────────────
function getRoleWithPermissions(roleId) {
  const role = db
    .prepare("SELECT * FROM ext_cockpit_enterprise_roles WHERE id = ?")
    .get(roleId);
  if (!role) return null;

  const perms = db
    .prepare(
      "SELECT resource, action, conditions FROM ext_cockpit_enterprise_role_permissions WHERE role_id = ?"
    )
    .all(roleId);

  // Group permissions by resource
  const permissions = {};
  for (const p of perms) {
    if (!permissions[p.resource]) permissions[p.resource] = [];
    permissions[p.resource].push(p.action);
  }

  return { ...role, permissions };
}

// ── Routes ─────────────────────────────────────────────────────

// ── Permission check (must be before /:id to avoid param capture) ──

// Check effective permissions for a user (admin or self only)
router.get("/users/:userId/check", (req, res) => {
  try {
    const { userId } = req.params;
    const { resource, action } = req.query;

    // Authorization: only admin or self can check permissions
    const requesterId = req.user?.id;
    const requesterRole = req.user?.role;
    if (requesterId && requesterId !== userId && requesterRole !== "admin") {
      return res.status(403).json({ error: "Can only check your own permissions or require admin role" });
    }

    // Get all roles for user
    const userRoles = db
      .prepare(
        `SELECT r.id, r.name, r.priority
         FROM ext_cockpit_enterprise_user_roles ur
         JOIN ext_cockpit_enterprise_roles r ON ur.role_id = r.id
         WHERE ur.user_id = ?
         ORDER BY r.priority DESC`
      )
      .all(userId);

    if (userRoles.length === 0) {
      return res.json({ user_id: userId, roles: [], permissions: {}, has_permission: false });
    }

    const roleIds = userRoles.map((r) => r.id);
    const placeholders = roleIds.map(() => "?").join(",");

    const allPerms = db
      .prepare(
        `SELECT resource, action FROM ext_cockpit_enterprise_role_permissions
         WHERE role_id IN (${placeholders})`
      )
      .all(...roleIds);

    // Aggregate permissions by resource
    const permissions = {};
    for (const p of allPerms) {
      if (!permissions[p.resource]) permissions[p.resource] = new Set();
      permissions[p.resource].add(p.action);
    }

    // Convert sets to arrays
    const permResult = {};
    for (const [res, actions] of Object.entries(permissions)) {
      permResult[res] = [...actions];
    }

    // Check specific permission if requested
    let hasPermission = null;
    if (resource && action) {
      hasPermission = !!(permissions[resource] && permissions[resource].has(action));
    }

    res.json({
      user_id: userId,
      roles: userRoles.map((r) => ({ id: r.id, name: r.name })),
      permissions: permResult,
      ...(hasPermission !== null ? { has_permission: hasPermission, checked: { resource, action } } : {}),
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// List roles
router.get("/", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const roles = db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM ext_cockpit_enterprise_role_permissions WHERE role_id = r.id) AS permission_count
         FROM ext_cockpit_enterprise_roles r
         ORDER BY r.priority DESC, r.name
         LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    const total = db
      .prepare("SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_roles")
      .get().cnt;

    res.json({ roles, total });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get role with full permissions
router.get("/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }
    const role = getRoleWithPermissions(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const userCount = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_user_roles WHERE role_id = ?"
      )
      .get(req.params.id).cnt;

    res.json({ ...role, user_count: userCount });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create role
router.post("/", requireRole("admin"), (req, res) => {
  try {
    const err = validateRole(req.body);
    if (err) return res.status(400).json({ error: err });

    const id = crypto.randomUUID();
    const { name, description, priority, permissions } = req.body;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO ext_cockpit_enterprise_roles (id, name, description, priority)
         VALUES (?, ?, ?, ?)`
      ).run(id, name, description || null, priority || 0);

      if (permissions && permissions.length > 0) {
        const insert = db.prepare(
          `INSERT OR IGNORE INTO ext_cockpit_enterprise_role_permissions (role_id, resource, action)
           VALUES (?, ?, ?)`
        );
        for (const perm of permissions) {
          for (const action of perm.actions) {
            insert.run(id, perm.resource, action);
          }
        }
      }
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "role.create", id, name);
    }

    res.status(201).json(getRoleWithPermissions(id));
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "A role with this name already exists" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update role
router.put("/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const existing = db
      .prepare("SELECT id, is_system FROM ext_cockpit_enterprise_roles WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Role not found" });
    if (existing.is_system) {
      return res.status(403).json({ error: "System roles cannot be modified" });
    }

    const err = validateRole(req.body);
    if (err) return res.status(400).json({ error: err });

    const { name, description, priority, permissions } = req.body;

    db.transaction(() => {
      db.prepare(
        `UPDATE ext_cockpit_enterprise_roles SET
          name = ?, description = ?, priority = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(name, description || null, priority || 0, req.params.id);

      // Replace permissions
      if (permissions !== undefined) {
        db.prepare(
          "DELETE FROM ext_cockpit_enterprise_role_permissions WHERE role_id = ?"
        ).run(req.params.id);

        if (permissions && permissions.length > 0) {
          const insert = db.prepare(
            `INSERT INTO ext_cockpit_enterprise_role_permissions (role_id, resource, action)
             VALUES (?, ?, ?)`
          );
          for (const perm of permissions) {
            for (const action of perm.actions) {
              insert.run(req.params.id, perm.resource, action);
            }
          }
        }
      }
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "role.update", req.params.id, name);
    }

    res.json(getRoleWithPermissions(req.params.id));
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "A role with this name already exists" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete role
router.delete("/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const existing = db
      .prepare("SELECT id, name, is_system FROM ext_cockpit_enterprise_roles WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Role not found" });
    if (existing.is_system) {
      return res.status(403).json({ error: "System roles cannot be deleted" });
    }

    const userCount = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_user_roles WHERE role_id = ?"
      )
      .get(req.params.id).cnt;
    if (userCount > 0) {
      return res.status(409).json({
        error: `Cannot delete role with ${userCount} assigned user(s). Unassign them first.`,
      });
    }

    db.transaction(() => {
      db.prepare(
        "DELETE FROM ext_cockpit_enterprise_role_permissions WHERE role_id = ?"
      ).run(req.params.id);
      db.prepare("DELETE FROM ext_cockpit_enterprise_roles WHERE id = ?").run(req.params.id);
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "role.delete", req.params.id, existing.name);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── User-role assignments ──────────────────────────────────────

// List users in role
router.get("/:id/users", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const role = db
      .prepare("SELECT id FROM ext_cockpit_enterprise_roles WHERE id = ?")
      .get(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const users = db
      .prepare(
        "SELECT user_id, assigned_by, assigned_at FROM ext_cockpit_enterprise_user_roles WHERE role_id = ? ORDER BY assigned_at DESC LIMIT ? OFFSET ?"
      )
      .all(req.params.id, limit, offset);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Assign user to role
router.post("/:id/users", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const { user_id } = req.body;
    if (!user_id || typeof user_id !== "string") {
      return res.status(400).json({ error: "user_id is required" });
    }

    const role = db
      .prepare("SELECT id, name FROM ext_cockpit_enterprise_roles WHERE id = ?")
      .get(req.params.id);
    if (!role) return res.status(404).json({ error: "Role not found" });

    const assignedBy = req.user?.id || "system";
    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_user_roles (user_id, role_id, assigned_by)
       VALUES (?, ?, ?)`
    ).run(user_id, req.params.id, assignedBy);

    if (services?.auditLog) {
      services.auditLog(assignedBy, "role.assign", req.params.id, `${user_id} -> ${role.name}`);
    }

    res.status(201).json({ user_id, role_id: req.params.id, assigned: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "User is already assigned to this role" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Remove user from role
router.delete("/:id/users/:userId", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid role ID" });
    }

    const result = db
      .prepare(
        "DELETE FROM ext_cockpit_enterprise_user_roles WHERE role_id = ? AND user_id = ?"
      )
      .run(req.params.id, req.params.userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: "User-role assignment not found" });
    }

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "role.unassign", req.params.id, req.params.userId);
    }

    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
