const express = require("express");
const router = express.Router();

const compose = require("../docker/compose");
const { requireAuth, requireRole } = require("../auth/middleware");
const { auditLog } = require("../db/sqlite");
const { validateStackName, safeError } = require("../middleware");
const { strictLimiter } = require("../security");

// ── List Stacks ──────────────────────────────────────────
router.get("/api/stacks", requireAuth, async (_req, res) => {
  try {
    const stacks = await compose.listStacks();
    res.json({ stacks });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Stack Detail ─────────────────────────────────────────
router.get("/api/stacks/:name", requireAuth, validateStackName, async (req, res) => {
  try {
    const stack = await compose.getStack(req.params.name);
    if (!stack) return res.status(404).json({ error: "Stack not found" });
    res.json(stack);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Stack Actions ────────────────────────────────────────
router.post(
  "/api/stacks/:name/start",
  requireAuth,
  requireRole("admin"),
  strictLimiter,
  validateStackName,
  async (req, res) => {
    try {
      const results = await compose.startStack(req.params.name);
      auditLog(req.user.id, "stack.start", req.params.name);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  },
);

router.post(
  "/api/stacks/:name/stop",
  requireAuth,
  requireRole("admin"),
  strictLimiter,
  validateStackName,
  async (req, res) => {
    try {
      const results = await compose.stopStack(req.params.name);
      auditLog(req.user.id, "stack.stop", req.params.name);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  },
);

router.post(
  "/api/stacks/:name/restart",
  requireAuth,
  requireRole("admin"),
  strictLimiter,
  validateStackName,
  async (req, res) => {
    try {
      const results = await compose.restartStack(req.params.name);
      auditLog(req.user.id, "stack.restart", req.params.name);
      res.json({ results });
    } catch (err) {
      res.status(500).json({ error: safeError(err) });
    }
  },
);

module.exports = router;
