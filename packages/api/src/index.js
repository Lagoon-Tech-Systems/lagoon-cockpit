// ── Adaptive sampler cadence (pure, testable) ──────────────
const SAMPLE_INTERVAL_MS = 15000;
function shouldSample({ now, lastSampleMs, clientCount }) {
  const minGap = clientCount > 0 ? 15000 : 60000;
  return now - lastSampleMs >= minGap - 500; // 500ms tolerance for timer drift
}

// ── Always-on adaptive sampler (decoupled from SSE broadcast) ──
let _lastSampleMs = 0;
let _latest = null; // { metrics, containerStats }
let _recordMetrics = null; // set lazily; DI seam for tests
let _maintenanceMode = false; // gate read by evaluateAndDetect; setter added in a later task

function cacheLatest(metrics, containerStats) {
  _latest = { metrics, containerStats };
}
function getLatest() {
  return _latest;
}

const _previousContainerStates = {};

// Single alert-evaluation + container-state-detection site (was inside broadcastLoop).
// Called from sampleTick so it runs even with zero SSE clients.
async function evaluateAndDetect(metrics, containerStats, allContainers) {
  // Require lazily so mocks applied before require() take effect in tests
  const alertEngine = require("./system/alerts");
  const webhooks = require("./system/webhooks");
  const { sendPushNotification } = require("./push/expo");
  const { broadcast } = require("./stream/sse");
  if (!_maintenanceMode) alertEngine.evaluateRules(metrics, containerStats);
  for (const c of allContainers) {
    const prev = _previousContainerStates[c.id];
    if (prev && prev !== c.state) {
      const alert = {
        type: "container_state_change",
        containerId: c.id,
        containerName: c.name,
        previousState: prev,
        currentState: c.state,
        timestamp: new Date().toISOString(),
      };
      broadcast("alert", alert);
      if (!_maintenanceMode && c.state !== "running" && prev === "running") {
        sendPushNotification(
          `Container Down: ${c.name}`,
          `${c.name} changed from ${prev} to ${c.state}`,
          { type: "container", containerId: c.id },
          { severity: "critical" },
        ).catch(() => {});
        webhooks.fireWebhooks("container.down", alert).catch(() => {});
      }
      webhooks.fireWebhooks("container.state_change", alert).catch(() => {});
    }
    _previousContainerStates[c.id] = c.state;
  }
  const currentIds = new Set(allContainers.map((c) => c.id));
  for (const id of Object.keys(_previousContainerStates)) if (!currentIds.has(id)) delete _previousContainerStates[id];
}

async function sampleTick() {
  // Require lazily so mocks applied before require() take effect in tests
  const { getSystemMetrics } = require("./system/metrics");
  const containers = require("./docker/containers");
  const { getClientCount } = require("./stream/sse");
  const metricsHistory = require("./system/history");
  const recorder = _recordMetrics !== null ? _recordMetrics : metricsHistory.recordMetrics;
  try {
    const now = Date.now();
    if (!shouldSample({ now, lastSampleMs: _lastSampleMs, clientCount: getClientCount() })) return;
    const metrics = getSystemMetrics();
    const allContainers = await containers.listContainers(true);
    const running = allContainers.filter((c) => c.state === "running").length;
    const containerStats = { total: allContainers.length, running, stopped: allContainers.length - running };
    recorder(metrics, containerStats);
    cacheLatest(metrics, containerStats);
    await evaluateAndDetect(metrics, containerStats, allContainers);
    _lastSampleMs = now;
  } catch (err) {
    console.error("[SAMPLER] sampleTick error:", err.message);
  }
}

// Test-only DI hooks
function _resetSamplerState() {
  // Tests: after _resetSamplerState(), call _setRecorder(...) before invoking sampleTick — otherwise
  // sampleTick falls back to the lazy-required history.js (the jest-mocked module in tests).
  _lastSampleMs = 0;
  _latest = null;
  _recordMetrics = null;
}
function _setRecorder(fn) {
  _recordMetrics = fn;
}

// ── SSE broadcast loop — retains only the broadcast(...) calls; alert-eval and
// container-state-detection moved to evaluateAndDetect (called from sampleTick). ──
async function broadcastLoop() {
  // Require lazily so mocks applied before require() take effect in tests
  const { getClientCount, broadcast } = require("./stream/sse");
  const containers = require("./docker/containers");
  const { getSystemMetrics } = require("./system/metrics");
  try {
    if (getClientCount() === 0) return;

    const allContainers = await containers.listContainers(true);
    const cached = getLatest();
    const metrics = cached ? cached.metrics : getSystemMetrics();

    broadcast("metrics", metrics);
    broadcast(
      "containers",
      allContainers.map((c) => ({
        id: c.id,
        name: c.name,
        state: c.state,
        health: c.health,
        image: c.image,
        composeProject: c.composeProject,
      })),
    );
  } catch (err) {
    console.error("[SSE] Broadcast error:", err.message);
  }
}

// Test-only seam: run one broadcastLoop iteration without waiting on the interval.
async function _runBroadcastOnce() {
  return broadcastLoop();
}

function bootstrap() {
  require("dotenv").config();
  const express = require("express");
  const { init: initDb, auditLog } = require("./db/sqlite");
  const db = initDb();

  // Initialize JWT with SQLite (must happen before routes that use auth)
  const { initJwt } = require("./auth/jwt");
  initJwt(db);

  const { init: initUsers, createUser } = require("./auth/users");
  const metricsHistory = require("./system/history");
  const alertEngine = require("./system/alerts");
  const webhooks = require("./system/webhooks");
  const scheduler = require("./system/scheduler");
  const { broadcast, closeAllClients } = require("./stream/sse");
  const { init: initPush, sendPushNotification } = require("./push/expo");

  // Security module
  const { securityHeaders, globalLimiter, strictCors, enhancedAudit, requestId, forceHttps } = require("./security");

  // Edition system
  const { loadLicense } = require("./edition/license");
  const { loadExtensions } = require("./extensions");

  // Integration system
  const { initIntegrations } = require("./integrations");

  // Routes
  const authRoutes = require("./routes/auth");
  const containerRoutes = require("./routes/containers");
  const stackRoutes = require("./routes/stacks");
  const systemRoutes = require("./routes/system");
  const manageRoutes = require("./routes/manage");
  const dockerRoutes = require("./routes/docker");
  const integrationRoutes = require("./routes/integrations");

  const AUTH_MODE = process.env.AUTH_MODE || "key";
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const SERVER_NAME = process.env.SERVER_NAME || "Cockpit Server";
  const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);

  if (AUTH_MODE === "users") {
    initUsers(db);
    const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
    if (userCount === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      createUser(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, "admin");
      console.log(`[COCKPIT] Initial admin created: ${process.env.ADMIN_EMAIL}`);
    }
  }

  initPush(db);
  metricsHistory.init(db);
  // One-time backfill of pre-existing raw into rollups (guarded by app_state),
  // then a boot catch-up rollup over the full raw window before the interval arms.
  try {
    metricsHistory.runBackfill(db);
    metricsHistory.rollupTick(db);
  } catch (err) {
    console.error("[COCKPIT] rollup boot catch-up error:", err.message);
  }
  alertEngine.init(db, sendPushNotification);
  webhooks.init(db);
  scheduler.init(db, auditLog);

  // Load edition from license key (defaults to CE)
  const edition = loadLicense();

  // Initialize integration system (adapters, store, scheduler)
  initIntegrations(db, broadcast);
  console.log(`[COCKPIT] Edition: ${edition.name} | Features: ${edition.features?.length || "CE defaults"}`);

  const app = express();

  // ── Security middleware chain (order matters) ──────────────
  app.set("trust proxy", 1); // Trust first proxy (nginx/traefik)
  app.use(forceHttps());
  app.use(requestId());
  app.use(securityHeaders());
  app.use(strictCors(ALLOWED_ORIGINS));
  app.use(globalLimiter);
  app.use(express.json({ limit: "16kb" }));
  app.use(enhancedAudit(auditLog));

  // Store edition in app.locals for middleware access
  app.locals.edition = edition;
  app.locals.maintenanceMode = false;

  // ── Request logging ────────────────────────────────────────
  app.use((req, _res, next) => {
    if (req.path !== "/health" && req.path !== "/") {
      console.log(`[REQ] ${req.method} ${req.path} from ${req.ip} [${req.requestId}]`);
    }
    next();
  });

  // ── Health & info ──────────────────────────────────────────
  app.get("/", (_req, res) => {
    res.json({ service: "lagoon-cockpit-api", status: "ok", edition: edition.name, docs: "/health" });
  });
  app.get("/health", async (_req, res) => {
    const checks = { api: "ok", db: "ok", docker: "ok" };
    let status = 200;

    // Verify SQLite is responsive
    try {
      db.prepare("SELECT 1").get();
    } catch {
      checks.db = "error";
      status = 503;
    }

    // Verify Docker socket is reachable
    try {
      await require("./docker/client").dockerAPI("GET", "/_ping", null, { timeout: 3000 });
    } catch {
      checks.docker = "error";
      status = 503;
    }

    res.status(status).json({
      status: status === 200 ? "ok" : "degraded",
      checks,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Edition info endpoint ──────────────────────────────────
  const { requireAuth } = require("./auth/middleware");
  app.get("/api/edition", requireAuth, (_req, res) => {
    res.json({
      edition: edition.name,
      features: edition.features || [],
      limits: edition.limits || {},
      org: edition.org || null,
      expiresAt: edition.exp ? new Date(edition.exp * 1000).toISOString() : null,
      graceMode: edition.graceMode || false,
      extensions: (app.locals.extensions || []).map((e) => e.name),
    });
  });

  // ── Routes ────────────────────────────────────────────────
  app.use(authRoutes);
  app.use(containerRoutes);
  app.use(stackRoutes);
  app.use(systemRoutes);
  app.use(manageRoutes);
  app.use(dockerRoutes);
  app.use(integrationRoutes);

  // ── Extension loader (Pro/Enterprise modules) ──────────────
  const services = { broadcast, sendPushNotification, auditLog, alertEngine, metricsHistory, webhooks };
  const extensions = loadExtensions(app, db, services);
  app.locals.extensions = extensions;

  // ── SSE broadcast loop (module-scope broadcastLoop — see above; always-on
  //    sampler feeds it via cacheLatest/getLatest, decoupled from client count) ──
  const broadcastInterval = setInterval(broadcastLoop, 15000);

  // Always-on sampler — persists metrics regardless of SSE clients
  const samplerInterval = setInterval(sampleTick, SAMPLE_INTERVAL_MS);

  // Periodic WAL checkpoint every 5 minutes (prevents WAL file from growing unbounded)
  const walCheckpointInterval = setInterval(
    () => {
      try {
        db.pragma("wal_checkpoint(PASSIVE)");
      } catch (err) {
        console.error("[COCKPIT] WAL checkpoint error:", err.message);
      }
    },
    5 * 60 * 1000,
  );

  // Rollup engine — fold completed raw buckets into hourly/daily every 5 minutes
  // (aligned with the WAL checkpoint cadence). Always-on, independent of clients.
  const rollupInterval = setInterval(
    () => {
      try {
        metricsHistory.rollupTick(db);
      } catch (err) {
        console.error("[COCKPIT] rollup tick error:", err.message);
      }
    },
    5 * 60 * 1000,
  );

  // Daily audit log rotation — prune entries older than retention period
  const { pruneAuditLog } = require("./db/sqlite");
  const auditPruneInterval = setInterval(
    () => {
      try {
        pruneAuditLog();
      } catch (err) {
        console.error("[COCKPIT] Audit log prune error:", err.message);
      }
    },
    24 * 60 * 60 * 1000,
  );

  const server = app.listen(PORT, () => {
    console.log(`[COCKPIT] API on :${PORT} | ${SERVER_NAME} | auth=${AUTH_MODE} | edition=${edition.name} | SSE=15s`);
  });

  // Graceful shutdown — stop integrations, close SSE, checkpoint WAL
  const { stopAll: stopIntegrations } = require("./integrations/scheduler");
  const { stopCleanup: stopJwtCleanup } = require("./auth/jwt");
  const { stopLockoutCleanup } = require("./auth/middleware");
  function shutdown(signal) {
    console.log(`[COCKPIT] ${signal} received — shutting down gracefully`);
    clearInterval(broadcastInterval);
    clearInterval(samplerInterval);
    clearInterval(walCheckpointInterval);
    clearInterval(rollupInterval);
    clearInterval(auditPruneInterval);
    metricsHistory.shutdown();
    stopJwtCleanup();
    stopLockoutCleanup();
    stopIntegrations();
    closeAllClients();
    server.close(() => {
      try {
        db.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        /* ignore */
      }
      console.log("[COCKPIT] HTTP server closed");
      process.exit(0);
    });
    setTimeout(() => {
      console.error("[COCKPIT] Forced exit after 5s timeout");
      process.exit(1);
    }, 5000);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  bootstrap();
}

module.exports = {
  shouldSample,
  sampleTick,
  cacheLatest,
  getLatest,
  _resetSamplerState,
  _setRecorder,
  evaluateAndDetect,
  _runBroadcastOnce,
  _previousContainerStates,
};
