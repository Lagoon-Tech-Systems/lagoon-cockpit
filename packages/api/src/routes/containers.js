const express = require("express");
const router = express.Router();

const containers = require("../docker/containers");
const { execInContainer, isCommandAllowed, getContainerTop } = require("../docker/exec");
const { requireAuth, requireRole } = require("../auth/middleware");
const { auditLog } = require("../db/sqlite");
const { validateContainerId, blockSelfAction, safeError, SELF_HOSTNAME } = require("../middleware");

// ── List Containers ──────────────────────────────────────
router.get("/api/containers", requireAuth, async (_req, res) => {
  try {
    const list = await containers.listContainers(true, true);
    res.json({ containers: list });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Container Detail ─────────────────────────────────────
router.get("/api/containers/:id", requireAuth, validateContainerId, async (req, res) => {
  try {
    const [info, stats] = await Promise.all([
      containers.inspectContainer(req.params.id),
      containers.getContainerStats(req.params.id).catch(() => null),
    ]);
    res.json({ container: info, stats });
  } catch (err) {
    res.status(err.statusCode === 404 ? 404 : 500).json({ error: safeError(err, "Container not found") });
  }
});

// ── Container Logs ───────────────────────────────────────
router.get("/api/containers/:id/logs", requireAuth, validateContainerId, async (req, res) => {
  try {
    const { tail, since, stdout, stderr } = req.query;
    const lines = await containers.getContainerLogs(req.params.id, {
      tail: Math.min(Math.max(parseInt(tail || "100", 10), 1), 1000),
      since: since || undefined,
      stdout: stdout !== "false",
      stderr: stderr !== "false",
    });
    res.json({ lines });
  } catch (err) {
    res.status(err.statusCode === 404 ? 404 : 500).json({ error: safeError(err, "Container not found") });
  }
});

// ── Container Log Search ─────────────────────────────────
router.get("/api/containers/:id/logs/search", requireAuth, validateContainerId, async (req, res) => {
  try {
    const { q, regex, context = "2" } = req.query;
    if (!q) return res.status(400).json({ error: "q (search query) required" });

    const lines = await containers.getContainerLogs(req.params.id, { tail: 1000 });
    const contextLines = Math.min(parseInt(context, 10) || 2, 5);
    let pattern = null;
    if (regex === "true") {
      if (q.length > 200) return res.status(400).json({ error: "Regex pattern too long (max 200 chars)" });
      if (/(\(.+[+*]\)[+*]|\(.+\|.+\)[+*]|\(.+\)\{\d+,?\d*\}[+*]?|\(.+[+*]\)\{\d+,?\d*\}|\\1)/.test(q))
        return res.status(400).json({ error: "Potentially unsafe regex pattern" });
      try {
        pattern = new RegExp(q, "i");
      } catch {
        return res.status(400).json({ error: "Invalid regex pattern" });
      }
    }

    const matches = [];
    for (let i = 0; i < lines.length; i++) {
      const match = pattern ? pattern.test(lines[i]) : lines[i].toLowerCase().includes(q.toLowerCase());
      if (match) {
        const start = Math.max(0, i - contextLines);
        const end = Math.min(lines.length, i + contextLines + 1);
        matches.push({
          lineNumber: i,
          line: lines[i],
          context: lines.slice(start, end),
        });
      }
    }
    res.json({ query: q, totalLines: lines.length, matches });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Container Actions ────────────────────────────────────
router.post(
  "/api/containers/:id/start",
  requireAuth,
  requireRole("admin", "operator"),
  validateContainerId,
  async (req, res) => {
    try {
      await containers.startContainer(req.params.id);
      auditLog(req.user.id, "container.start", req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.statusCode === 304 ? 304 : 500).json({ error: safeError(err) });
    }
  },
);

router.post(
  "/api/containers/:id/stop",
  requireAuth,
  requireRole("admin", "operator"),
  validateContainerId,
  blockSelfAction,
  async (req, res) => {
    try {
      const timeout = parseInt(req.query.t || "10", 10);
      await containers.stopContainer(req.params.id, timeout);
      auditLog(req.user.id, "container.stop", req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(err.statusCode === 304 ? 304 : 500).json({ error: safeError(err) });
    }
  },
);

router.post(
  "/api/containers/:id/restart",
  requireAuth,
  requireRole("admin", "operator"),
  validateContainerId,
  blockSelfAction,
  async (req, res) => {
    try {
      const timeout = parseInt(req.query.t || "10", 10);
      await containers.restartContainer(req.params.id, timeout);
      auditLog(req.user.id, "container.restart", req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  },
);

// ── Container Exec ───────────────────────────────────────
router.post("/api/containers/:id/exec", requireAuth, requireRole("admin"), validateContainerId, async (req, res) => {
  try {
    const { command } = req.body;
    if (!command || typeof command !== "string") return res.status(400).json({ error: "command required" });
    if (command.length > 500) return res.status(400).json({ error: "Command too long (max 500 chars)" });
    if (!isCommandAllowed(command)) return res.status(403).json({ error: "Command not in allowed list" });

    const result = await execInContainer(req.params.id, command);
    auditLog(req.user.id, "container.exec", req.params.id, command);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode === 404 ? 404 : 500).json({ error: safeError(err, "Exec failed") });
  }
});

// ── Container Top ────────────────────────────────────────
router.get("/api/containers/:id/top", requireAuth, validateContainerId, async (req, res) => {
  try {
    const result = await getContainerTop(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode === 404 ? 404 : 500).json({ error: safeError(err) });
  }
});

// ── Bulk Operations ──────────────────────────────────────
router.post("/api/containers/bulk", requireAuth, requireRole("admin", "operator"), async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    if (!["start", "stop", "restart"].includes(action))
      return res.status(400).json({ error: "action must be start, stop, or restart" });
    if (ids.length > 20) return res.status(400).json({ error: "Max 20 containers per bulk operation" });

    // Validate all IDs
    const CONTAINER_ID_RE_LOCAL = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
    for (const id of ids) {
      if (!CONTAINER_ID_RE_LOCAL.test(id)) return res.status(400).json({ error: `Invalid container ID: ${id}` });
      if (id === SELF_HOSTNAME)
        return res.status(403).json({ error: "Cannot perform this action on the Cockpit API container" });
    }

    const results = await Promise.allSettled(ids.map((id) => containers[`${action}Container`](id)));

    const summary = ids.map((id, i) => ({
      id,
      success: results[i].status === "fulfilled",
      error: results[i].status === "rejected" ? results[i].reason.message : null,
    }));

    auditLog(req.user.id, `container.bulk.${action}`, ids.join(","), `${ids.length} containers`);
    res.json({ action, results: summary });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Nuke & Rebuild ───────────────────────────────────────
router.post(
  "/api/containers/:id/rebuild",
  requireAuth,
  requireRole("admin"),
  validateContainerId,
  blockSelfAction,
  async (req, res) => {
    try {
      const info = await containers.inspectContainer(req.params.id);
      const imageName = info.Config.Image;
      const name = info.Name.replace(/^\//, "");

      // Stop container
      await containers.stopContainer(req.params.id, 10).catch(() => {});

      // Remove container
      const { dockerAPI } = require("../docker/client");
      await dockerAPI("DELETE", `/containers/${req.params.id}`, null, { query: { force: "true" } });

      // Pull latest image
      await dockerAPI("POST", "/images/create", null, {
        query: { fromImage: imageName.split(":")[0], tag: imageName.split(":")[1] || "latest" },
        timeout: 120000,
      });

      auditLog(req.user.id, "container.rebuild", req.params.id, `Image: ${imageName}`);
      res.json({
        ok: true,
        message: `Container ${name} removed and image ${imageName} pulled. Recreate via docker-compose up -d.`,
      });
    } catch (err) {
      res.status(500).json({ error: safeError(err, "Rebuild failed") });
    }
  },
);

module.exports = router;
