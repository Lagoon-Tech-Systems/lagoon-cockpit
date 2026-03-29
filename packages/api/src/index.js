require("dotenv").config();
const express = require("express");
const { init: initDb, auditLog } = require("./db/sqlite");
const db = initDb();

// Initialize JWT with SQLite (must happen before routes that use auth)
const { initJwt } = require("./auth/jwt");
initJwt(db);

const { init: initUsers, createUser } = require("./auth/users");
const containers = require("./docker/containers");
const { getSystemMetrics } = require("./system/metrics");
const metricsHistory = require("./system/history");
const alertEngine = require("./system/alerts");
const webhooks = require("./system/webhooks");
const scheduler = require("./system/scheduler");
const { broadcast, getClientCount, closeAllClients } = require("./stream/sse");
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

// ── SSE broadcast loop ─────────────────────────────────────
const previousContainerStates = {};
async function broadcastLoop() {
  try {
    if (getClientCount() === 0) return;

    const [allContainers, metrics] = await Promise.all([
      containers.listContainers(true),
      Promise.resolve(getSystemMetrics()),
    ]);

    const running = allContainers.filter((c) => c.state === "running").length;
    const containerStats = { total: allContainers.length, running, stopped: allContainers.length - running };
    metricsHistory.recordMetrics(metrics, containerStats);
    if (!app.locals.maintenanceMode) alertEngine.evaluateRules(metrics, containerStats);
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
    for (const c of allContainers) {
      const prev = previousContainerStates[c.id];
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

        if (c.state !== "running" && prev === "running" && !app.locals.maintenanceMode) {
          sendPushNotification(`Container Down: ${c.name}`, `${c.name} changed from ${prev} to ${c.state}`, {
            type: "container",
            containerId: c.id,
          }).catch(() => {});
          webhooks.fireWebhooks("container.down", alert).catch(() => {});
        }
        webhooks.fireWebhooks("container.state_change", alert).catch(() => {});
      }
      previousContainerStates[c.id] = c.state;
    }

    const currentIds = new Set(allContainers.map((c) => c.id));
    for (const id of Object.keys(previousContainerStates)) if (!currentIds.has(id)) delete previousContainerStates[id];
  } catch (err) {
    console.error("[SSE] Broadcast error:", err.message);
  }
}

const broadcastInterval = setInterval(broadcastLoop, 15000);

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
  clearInterval(walCheckpointInterval);
  clearInterval(auditPruneInterval);
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
