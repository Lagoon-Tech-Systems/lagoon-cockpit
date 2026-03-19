require("dotenv").config();
const express = require("express");
const os = require("os");

// ── Database ──────────────────────────────────────────────
const { init: initDb, getDb, auditLog } = require("./db/sqlite");
const db = initDb();

// ── Auth ──────────────────────────────────────────────────
const { authenticateWithKey } = require("./auth/keys");
const { init: initUsers, authenticateWithCredentials, createUser, listUsers, deleteUser, updateUserRole } = require("./auth/users");
const { signAccessToken, generateRefreshToken, validateRefreshToken } = require("./auth/jwt");
const { requireAuth, requireRole, rateLimitAuth, recordFailedAttempt, clearFailedAttempts } = require("./auth/middleware");

// ── Docker ────────────────────────────────────────────────
const containers = require("./docker/containers");
const compose = require("./docker/compose");
const dockerSystem = require("./docker/system");

// ── System ────────────────────────────────────────────────
const { getSystemMetrics } = require("./system/metrics");
const { checkAllSSL } = require("./system/ssl");
const { probeAllEndpoints } = require("./system/endpoints");

// ── Stream ────────────────────────────────────────────────
const { addClient, broadcast, getClientCount } = require("./stream/sse");

// ── Push ──────────────────────────────────────────────────
const { init: initPush, registerToken, sendPushNotification } = require("./push/expo");

// ── Init ──────────────────────────────────────────────────
const AUTH_MODE = process.env.AUTH_MODE || "key";
const PORT = parseInt(process.env.PORT || "3000", 10);
const SERVER_NAME = process.env.SERVER_NAME || "Cockpit Server";
const SELF_HOSTNAME = os.hostname();
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").filter(Boolean);

if (AUTH_MODE === "users") {
  initUsers(db);

  // Create initial admin if no users exist
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
  if (userCount === 0 && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    createUser(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, "admin");
    console.log(`[COCKPIT] Initial admin created: ${process.env.ADMIN_EMAIL}`);
  }
}

initPush(db);

// ── Input Validation ─────────────────────────────────────
const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const STACK_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;

function validateContainerId(req, res, next) {
  if (!CONTAINER_ID_RE.test(req.params.id)) {
    return res.status(400).json({ error: "Invalid container ID" });
  }
  next();
}

function validateStackName(req, res, next) {
  if (!STACK_NAME_RE.test(req.params.name)) {
    return res.status(400).json({ error: "Invalid stack name" });
  }
  next();
}

function blockSelfAction(req, res, next) {
  if (req.params.id === SELF_HOSTNAME) {
    return res.status(403).json({ error: "Cannot perform this action on the Cockpit API container" });
  }
  next();
}

function safeError(err, defaultMsg = "Internal server error") {
  console.error(`[API] ${defaultMsg}:`, err.message);
  return err.statusCode === 404 ? "Not found" : defaultMsg;
}

// ── Express ───────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "16kb" }));

// Security headers
app.use((_req, res, next) => {
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  next();
});

// CORS — restrict to configured origins; mobile (non-browser) requests have no Origin header
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.length > 0 && origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  } else if (ALLOWED_ORIGINS.length === 0) {
    // No CORS_ORIGINS configured — allow all (for mobile-only deployments)
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Health ────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Detailed status (authenticated)
app.get("/api/health", requireAuth, (_req, res) => {
  res.json({
    status: "ok",
    service: "lagoon-cockpit-api",
    serverName: SERVER_NAME,
    authMode: AUTH_MODE,
    uptime: process.uptime(),
    sseClients: getClientCount(),
    timestamp: new Date().toISOString(),
  });
});

// ── Auth Routes ───────────────────────────────────────────

// API key auth (single-admin mode)
app.post("/auth/token", rateLimitAuth, (req, res) => {
  if (AUTH_MODE !== "key") {
    return res.status(400).json({ error: "Use /auth/login for user-based auth" });
  }

  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "apiKey required" });

  const result = authenticateWithKey(apiKey);
  if (!result) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid API key" });
  }

  clearFailedAttempts(req._authIp);
  auditLog(result.userId, "auth.token", null, "API key authentication");
  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    role: result.role,
    serverName: SERVER_NAME,
  });
});

// User login (multi-user mode)
app.post("/auth/login", rateLimitAuth, (req, res) => {
  if (AUTH_MODE !== "users") {
    return res.status(400).json({ error: "Use /auth/token for API key auth" });
  }

  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "email and password required" });

  const result = authenticateWithCredentials(email, password);
  if (!result) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  clearFailedAttempts(req._authIp);
  auditLog(result.userId, "auth.login", null, `User login: ${email}`);
  res.json({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    role: result.role,
    email: result.email,
    serverName: SERVER_NAME,
  });
});

// Refresh token (rate-limited)
app.post("/auth/refresh", rateLimitAuth, (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });

  const payload = validateRefreshToken(refreshToken);
  if (!payload) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  clearFailedAttempts(req._authIp);
  const accessToken = signAccessToken({ sub: payload.userId, role: payload.role });
  const newRefreshToken = generateRefreshToken(payload.userId, payload.role);

  res.json({ accessToken, refreshToken: newRefreshToken });
});

// User management (multi-user mode, admin only)
app.get("/auth/users", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ users: listUsers() });
});

app.post("/auth/users", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: "email and password required" });
    const user = createUser(email, password, role);
    auditLog(req.user.id, "user.create", email, `Role: ${role || "viewer"}`);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/auth/users/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid user ID" });
  if (id === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
  deleteUser(id);
  auditLog(req.user.id, "user.delete", req.params.id);
  res.json({ ok: true });
});

app.put("/auth/users/:id/role", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid user ID" });
    updateUserRole(id, req.body.role);
    auditLog(req.user.id, "user.role", req.params.id, `New role: ${req.body.role}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Overview ──────────────────────────────────────────────
app.get("/api/overview", requireAuth, async (_req, res) => {
  try {
    const [allContainers, metrics] = await Promise.all([
      containers.listContainers(true),
      Promise.resolve(getSystemMetrics()),
    ]);

    const running = allContainers.filter((c) => c.state === "running").length;
    const stopped = allContainers.filter((c) => c.state !== "running").length;
    const unhealthy = allContainers.filter((c) => c.health === "unhealthy").length;

    // Stack summary
    const stacks = {};
    for (const c of allContainers) {
      if (c.composeProject) {
        if (!stacks[c.composeProject]) stacks[c.composeProject] = { total: 0, running: 0 };
        stacks[c.composeProject].total++;
        if (c.state === "running") stacks[c.composeProject].running++;
      }
    }

    res.json({
      serverName: SERVER_NAME,
      system: metrics,
      containers: { total: allContainers.length, running, stopped, unhealthy },
      stacks: {
        total: Object.keys(stacks).length,
        allHealthy: Object.values(stacks).every((s) => s.running === s.total),
      },
      sseClients: getClientCount(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Container Routes ──────────────────────────────────────
app.get("/api/containers", requireAuth, async (_req, res) => {
  try {
    const list = await containers.listContainers(true);
    res.json({ containers: list });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.get("/api/containers/:id", requireAuth, validateContainerId, async (req, res) => {
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

app.get("/api/containers/:id/logs", requireAuth, validateContainerId, async (req, res) => {
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

app.post("/api/containers/:id/start", requireAuth, requireRole("admin", "operator"), validateContainerId, async (req, res) => {
  try {
    await containers.startContainer(req.params.id);
    auditLog(req.user.id, "container.start", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode === 304 ? 304 : 500).json({ error: safeError(err) });
  }
});

app.post("/api/containers/:id/stop", requireAuth, requireRole("admin", "operator"), validateContainerId, blockSelfAction, async (req, res) => {
  try {
    const timeout = parseInt(req.query.t || "10", 10);
    await containers.stopContainer(req.params.id, timeout);
    auditLog(req.user.id, "container.stop", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode === 304 ? 304 : 500).json({ error: safeError(err) });
  }
});

app.post("/api/containers/:id/restart", requireAuth, requireRole("admin", "operator"), validateContainerId, blockSelfAction, async (req, res) => {
  try {
    const timeout = parseInt(req.query.t || "10", 10);
    await containers.restartContainer(req.params.id, timeout);
    auditLog(req.user.id, "container.restart", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Stack Routes ──────────────────────────────────────────
app.get("/api/stacks", requireAuth, async (_req, res) => {
  try {
    const stacks = await compose.listStacks();
    res.json({ stacks });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.get("/api/stacks/:name", requireAuth, validateStackName, async (req, res) => {
  try {
    const stack = await compose.getStack(req.params.name);
    if (!stack) return res.status(404).json({ error: "Stack not found" });
    res.json(stack);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.post("/api/stacks/:name/start", requireAuth, requireRole("admin"), validateStackName, async (req, res) => {
  try {
    const results = await compose.startStack(req.params.name);
    auditLog(req.user.id, "stack.start", req.params.name);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.post("/api/stacks/:name/stop", requireAuth, requireRole("admin"), validateStackName, async (req, res) => {
  try {
    const results = await compose.stopStack(req.params.name);
    auditLog(req.user.id, "stack.stop", req.params.name);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.post("/api/stacks/:name/restart", requireAuth, requireRole("admin"), validateStackName, async (req, res) => {
  try {
    const results = await compose.restartStack(req.params.name);
    auditLog(req.user.id, "stack.restart", req.params.name);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── System Routes ─────────────────────────────────────────
app.get("/api/system/metrics", requireAuth, (_req, res) => {
  res.json(getSystemMetrics());
});

app.get("/api/system/docker", requireAuth, async (_req, res) => {
  try {
    const [info, df] = await Promise.all([
      dockerSystem.getDockerInfo(),
      dockerSystem.getDockerDiskUsage(),
    ]);
    res.json({ info, diskUsage: df });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Monitoring Routes ─────────────────────────────────────
app.get("/api/endpoints", requireAuth, async (_req, res) => {
  try {
    const results = await probeAllEndpoints(process.env.ENDPOINTS);
    res.json({ endpoints: results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.get("/api/ssl", requireAuth, async (_req, res) => {
  try {
    const domains = (process.env.SSL_DOMAINS || "").split(",").filter(Boolean);
    const results = await checkAllSSL(domains);
    res.json({ certificates: results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── SSE Stream ────────────────────────────────────────────
app.get("/api/stream", requireAuth, (req, res) => {
  addClient(res);
});

// ── Push Registration ─────────────────────────────────────
app.post("/api/push/register", requireAuth, (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token required" });
    registerToken(token, req.user.id, SERVER_NAME);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Audit Log ─────────────────────────────────────────────
app.get("/api/audit", requireAuth, requireRole("admin"), (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
  const logs = db
    .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset);
  res.json({ logs });
});

// ── SSE Broadcast Loop ───────────────────────────────────
// Every 15 seconds, broadcast system + container status to SSE clients
let previousContainerStates = {};

async function broadcastLoop() {
  try {
    if (getClientCount() === 0) return;

    const [allContainers, metrics] = await Promise.all([
      containers.listContainers(true),
      Promise.resolve(getSystemMetrics()),
    ]);

    // Broadcast metrics
    broadcast("metrics", metrics);

    // Broadcast container summary
    const containerSummary = allContainers.map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
      health: c.health,
      image: c.image,
      composeProject: c.composeProject,
    }));
    broadcast("containers", containerSummary);

    // Detect state changes for alerts
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

        // Push notification for containers going down
        if (c.state !== "running" && prev === "running") {
          sendPushNotification(
            `Container Down: ${c.name}`,
            `${c.name} changed from ${prev} to ${c.state}`,
            { type: "container", containerId: c.id }
          ).catch(() => {});
        }
      }
      previousContainerStates[c.id] = c.state;
    }
  } catch (err) {
    console.error("[SSE] Broadcast error:", err.message);
  }
}

setInterval(broadcastLoop, 15000);

// ── Start Server ──────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[COCKPIT] Lagoon Cockpit API running on port ${PORT}`);
  console.log(`[COCKPIT] Server name: ${SERVER_NAME}`);
  console.log(`[COCKPIT] Auth mode: ${AUTH_MODE}`);
  console.log(`[COCKPIT] Self-protection: ${SELF_HOSTNAME}`);
  console.log(`[COCKPIT] SSE broadcast interval: 15s`);
});
