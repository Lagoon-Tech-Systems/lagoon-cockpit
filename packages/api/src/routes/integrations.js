const express = require("express");
const router = express.Router();
const { requireAuth, requireRole } = require("../auth/middleware");
const { checkLimit } = require("../edition/middleware");
const { validateBody } = require("../security/request-validator");
const { generateId } = require("../security/crypto");
const {
  createIntegration,
  getIntegration,
  listIntegrations,
  updateIntegration,
  deleteIntegration,
  countIntegrations,
  queryData,
} = require("../integrations/store");
const { listAdapterTypes, createAdapterInstance, hasAdapter } = require("../integrations/registry");
const { forcePoll } = require("../integrations/scheduler");

// ── List available adapter types ───────────────────────────
router.get("/api/integrations/adapters", requireAuth, (_req, res) => {
  res.json({ adapters: listAdapterTypes() });
});

// ── List configured integrations ───────────────────────────
router.get("/api/integrations", requireAuth, (_req, res) => {
  try {
    const integrations = listIntegrations().map((i) => ({
      ...i,
      // Redact sensitive config values
      config: redactConfig(i.config),
    }));
    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: "Failed to list integrations" });
  }
});

// ── Get single integration ─────────────────────────────────
router.get("/api/integrations/:id", requireAuth, (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });
    integration.config = redactConfig(integration.config);
    res.json(integration);
  } catch (err) {
    res.status(500).json({ error: "Failed to get integration" });
  }
});

// ── Create integration ─────────────────────────────────────
router.post("/api/integrations", requireAuth, requireRole("admin"), validateBody("integration"), (req, res) => {
  try {
    // Check edition limit
    const count = countIntegrations();
    const limit = checkLimit(req, "integrations", count);
    if (!limit.allowed) {
      return res.status(402).json({
        error: `Integration limit reached (${limit.max})`,
        current: limit.current,
        max: limit.max,
        currentEdition: req.app.locals.edition?.name || "ce",
        upgradeUrl: "https://lagoontechsystems.com/upgrade",
      });
    }

    const { adapter, name, config, poll_interval } = req.body;

    // Validate adapter exists
    if (!hasAdapter(adapter)) {
      return res.status(400).json({ error: `Unknown adapter: ${adapter}` });
    }

    const id = generateId();
    createIntegration(id, adapter, name, config, poll_interval);

    res.status(201).json({ id, adapter, name, poll_interval: poll_interval || 30 });
  } catch (err) {
    res.status(500).json({ error: "Failed to create integration" });
  }
});

// ── Update integration ─────────────────────────────────────
router.put("/api/integrations/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });

    updateIntegration(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update integration" });
  }
});

// ── Delete integration ─────────────────────────────────────
router.delete("/api/integrations/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });

    deleteIntegration(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete integration" });
  }
});

// ── Test integration connection ────────────────────────────
router.post("/api/integrations/:id/test", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });

    const adapter = createAdapterInstance(integration.adapter, integration.config);
    if (!adapter) return res.status(400).json({ error: `Unknown adapter: ${integration.adapter}` });

    const result = await adapter.testConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Connection test failed", message: err.message });
  }
});

// ── Force poll integration ─────────────────────────────────
router.post("/api/integrations/:id/poll", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });

    await forcePoll(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Poll failed", message: err.message });
  }
});

// ── Query integration data ─────────────────────────────────
router.get("/api/integrations/:id/data", requireAuth, (req, res) => {
  try {
    const integration = getIntegration(req.params.id);
    if (!integration) return res.status(404).json({ error: "Integration not found" });

    const data = queryData(req.params.id, {
      type: req.query.type,
      since: req.query.since,
      until: req.query.until,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
    });

    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: "Failed to query data" });
  }
});

/**
 * Redact sensitive fields from integration config before sending to clients.
 */
function redactConfig(config) {
  if (!config || typeof config !== "object") return config;
  const redacted = { ...config };
  const sensitiveKeys = ["apiKey", "bearerToken", "password", "serviceAccountToken", "secret", "token"];
  for (const key of sensitiveKeys) {
    if (redacted[key]) redacted[key] = "***REDACTED***";
    if (redacted.basicAuth?.password) {
      redacted.basicAuth = { ...redacted.basicAuth, password: "***REDACTED***" };
    }
  }
  return redacted;
}

module.exports = router;
