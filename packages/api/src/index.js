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
const networks = require("./docker/networks");
const volumes = require("./docker/volumes");
const images = require("./docker/images");
const { execInContainer, isCommandAllowed, getContainerTop } = require("./docker/exec");
const { systemPrune } = require("./docker/prune");

// ── System ────────────────────────────────────────────────
const { getSystemMetrics } = require("./system/metrics");
const { checkAllSSL } = require("./system/ssl");
const { probeAllEndpoints } = require("./system/endpoints");
const metricsHistory = require("./system/history");
const alertEngine = require("./system/alerts");
const webhooks = require("./system/webhooks");
const scheduler = require("./system/scheduler");

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
metricsHistory.init(db);
alertEngine.init(db, sendPushNotification);
webhooks.init(db);
scheduler.init(db, auditLog);

let maintenanceMode = false;

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

// Request logging (debug)
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// Root route
app.get("/", (_req, res) => {
  res.json({ service: "lagoon-cockpit-api", status: "ok", docs: "/health" });
});

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

// ── Container Exec ───────────────────────────────────────
app.post("/api/containers/:id/exec", requireAuth, requireRole("admin"), validateContainerId, async (req, res) => {
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

app.get("/api/containers/:id/top", requireAuth, validateContainerId, async (req, res) => {
  try {
    const result = await getContainerTop(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode === 404 ? 404 : 500).json({ error: safeError(err) });
  }
});

// ── Container Log Search ─────────────────────────────────
app.get("/api/containers/:id/logs/search", requireAuth, validateContainerId, async (req, res) => {
  try {
    const { q, regex, context = "2" } = req.query;
    if (!q) return res.status(400).json({ error: "q (search query) required" });

    const lines = await containers.getContainerLogs(req.params.id, { tail: 1000 });
    const contextLines = Math.min(parseInt(context, 10) || 2, 5);
    const pattern = regex === "true" ? new RegExp(q, "i") : null;

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

// ── Bulk Operations ──────────────────────────────────────
app.post("/api/containers/bulk", requireAuth, requireRole("admin", "operator"), async (req, res) => {
  try {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
    if (!["start", "stop", "restart"].includes(action)) return res.status(400).json({ error: "action must be start, stop, or restart" });
    if (ids.length > 20) return res.status(400).json({ error: "Max 20 containers per bulk operation" });

    // Validate all IDs
    for (const id of ids) {
      if (!CONTAINER_ID_RE.test(id)) return res.status(400).json({ error: `Invalid container ID: ${id}` });
      if (id === SELF_HOSTNAME) return res.status(403).json({ error: "Cannot perform this action on the Cockpit API container" });
    }

    const results = await Promise.allSettled(
      ids.map((id) => containers[`${action}Container`](id))
    );

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
app.post("/api/containers/:id/rebuild", requireAuth, requireRole("admin"), validateContainerId, blockSelfAction, async (req, res) => {
  try {
    const info = await containers.inspectContainer(req.params.id);
    const imageName = info.Config.Image;
    const name = info.Name.replace(/^\//, "");

    // Stop container
    await containers.stopContainer(req.params.id, 10).catch(() => {});

    // Remove container
    const { dockerAPI } = require("./docker/client");
    await dockerAPI("DELETE", `/containers/${req.params.id}`, null, { query: { force: "true" } });

    // Pull latest image
    await dockerAPI("POST", "/images/create", null, {
      query: { fromImage: imageName.split(":")[0], tag: imageName.split(":")[1] || "latest" },
      timeout: 120000,
    });

    auditLog(req.user.id, "container.rebuild", req.params.id, `Image: ${imageName}`);
    res.json({ ok: true, message: `Container ${name} removed and image ${imageName} pulled. Recreate via docker-compose up -d.` });
  } catch (err) {
    res.status(500).json({ error: safeError(err, "Rebuild failed") });
  }
});

// ── Docker Networks ──────────────────────────────────────
app.get("/api/networks", requireAuth, async (_req, res) => {
  try {
    const list = await networks.listNetworks();
    res.json({ networks: list });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Docker Volumes ───────────────────────────────────────
app.get("/api/volumes", requireAuth, async (_req, res) => {
  try {
    const list = await volumes.listVolumes();
    res.json({ volumes: list });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.delete("/api/volumes/:name", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await volumes.removeVolume(req.params.name);
    auditLog(req.user.id, "volume.remove", req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Docker Images ────────────────────────────────────────
app.get("/api/images", requireAuth, async (_req, res) => {
  try {
    const list = await images.listImages();
    res.json({ images: list });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.delete("/api/images/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await images.removeImage(req.params.id);
    auditLog(req.user.id, "image.remove", req.params.id);
    res.json({ ok: true, deleted: result });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

app.post("/api/images/prune", requireAuth, requireRole("admin"), async (_req, res) => {
  try {
    const result = await images.pruneImages();
    auditLog(_req.user.id, "image.prune", null, `Reclaimed: ${result.SpaceReclaimed || 0} bytes`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── System Prune ─────────────────────────────────────────
app.post("/api/system/prune", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await systemPrune();
    auditLog(req.user.id, "system.prune", null, `Reclaimed: ${result.totalReclaimed} bytes`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Disk Usage Breakdown ─────────────────────────────────
app.get("/api/system/disk", requireAuth, async (_req, res) => {
  try {
    const df = await dockerSystem.getDockerDiskUsage();
    const containerSize = (df.Containers || []).reduce((sum, c) => sum + (c.SizeRw || 0), 0);
    const imageSize = (df.Images || []).reduce((sum, img) => sum + (img.Size || 0), 0);
    const volumeSize = (df.Volumes || []).reduce((sum, v) => sum + (v.UsageData?.Size || 0), 0);
    const buildCacheSize = (df.BuildCache || []).reduce((sum, bc) => sum + (bc.Size || 0), 0);

    res.json({
      containers: { count: (df.Containers || []).length, size: containerSize },
      images: { count: (df.Images || []).length, size: imageSize },
      volumes: { count: (df.Volumes || []).length, size: volumeSize },
      buildCache: { count: (df.BuildCache || []).length, size: buildCacheSize },
      totalSize: containerSize + imageSize + volumeSize + buildCacheSize,
    });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Metrics History ──────────────────────────────────────
app.get("/api/metrics/history", requireAuth, (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10), 1), 168); // Max 7 days
  res.json({ history: metricsHistory.getHistory(hours), summary: metricsHistory.getHistorySummary(hours) });
});

// ── Alert Rules ──────────────────────────────────────────
app.get("/api/alerts/rules", requireAuth, (_req, res) => {
  res.json({ rules: alertEngine.listRules() });
});

app.post("/api/alerts/rules", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { name, metric, operator, threshold, durationSeconds } = req.body;
    if (!name || !metric || !operator || threshold === undefined) {
      return res.status(400).json({ error: "name, metric, operator, threshold required" });
    }
    const rule = alertEngine.createRule(name, metric, operator, threshold, durationSeconds || 0);
    auditLog(req.user.id, "alert.rule.create", name);
    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/alerts/rules/:id", requireAuth, requireRole("admin"), (req, res) => {
  alertEngine.deleteRule(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.put("/api/alerts/rules/:id/toggle", requireAuth, requireRole("admin"), (req, res) => {
  alertEngine.toggleRule(parseInt(req.params.id, 10), req.body.enabled !== false);
  res.json({ ok: true });
});

app.get("/api/alerts/events", requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  res.json({ events: alertEngine.getAlertEvents(limit) });
});

// ── Webhooks ─────────────────────────────────────────────
app.get("/api/webhooks", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ webhooks: webhooks.listWebhooks() });
});

app.post("/api/webhooks", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { name, url, events, headers } = req.body;
    if (!name || !url) return res.status(400).json({ error: "name and url required" });
    const hook = webhooks.createWebhook(name, url, events || "container.down", headers || {});
    auditLog(req.user.id, "webhook.create", name);
    res.status(201).json(hook);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/webhooks/:id", requireAuth, requireRole("admin"), (req, res) => {
  webhooks.deleteWebhook(parseInt(req.params.id, 10));
  res.json({ ok: true });
});

// ── Scheduled Actions ────────────────────────────────────
app.get("/api/schedules", requireAuth, (_req, res) => {
  res.json({ schedules: scheduler.listSchedules() });
});

app.post("/api/schedules", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const { name, containerId, containerName, action, cronExpression } = req.body;
    if (!name || !containerId || !containerName || !action || !cronExpression) {
      return res.status(400).json({ error: "name, containerId, containerName, action, cronExpression required" });
    }
    const schedule = scheduler.createSchedule(name, containerId, containerName, action, cronExpression);
    auditLog(req.user.id, "schedule.create", name, `${action} ${containerName} @ ${cronExpression}`);
    res.status(201).json(schedule);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/schedules/:id", requireAuth, requireRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid schedule ID" });
  scheduler.deleteSchedule(id);
  auditLog(req.user.id, "schedule.delete", req.params.id);
  res.json({ ok: true });
});

app.put("/api/schedules/:id/toggle", requireAuth, requireRole("admin"), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid schedule ID" });
  const schedule = scheduler.toggleSchedule(id, req.body.enabled !== false);
  if (!schedule) return res.status(404).json({ error: "Schedule not found" });
  auditLog(req.user.id, "schedule.toggle", req.params.id, req.body.enabled !== false ? "enabled" : "disabled");
  res.json(schedule);
});

app.get("/api/schedules/history", requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 500);
  res.json({ history: scheduler.getScheduleHistory(limit) });
});

// ── Maintenance Mode ─────────────────────────────────────
app.get("/api/maintenance", requireAuth, (_req, res) => {
  res.json({ enabled: maintenanceMode });
});

app.post("/api/maintenance", requireAuth, requireRole("admin"), (req, res) => {
  maintenanceMode = req.body.enabled === true;
  auditLog(req.user.id, "maintenance.toggle", null, maintenanceMode ? "enabled" : "disabled");
  res.json({ enabled: maintenanceMode });
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

    // Record historical metrics
    const containerStats = {
      total: allContainers.length,
      running: allContainers.filter((c) => c.state === "running").length,
      stopped: allContainers.filter((c) => c.state !== "running").length,
    };
    metricsHistory.recordMetrics(metrics, containerStats);

    // Evaluate alert rules (skip in maintenance mode)
    if (!maintenanceMode) {
      alertEngine.evaluateRules(metrics, containerStats);
    }

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

        // Push notification + webhooks for containers going down (skip in maintenance mode)
        if (c.state !== "running" && prev === "running" && !maintenanceMode) {
          sendPushNotification(
            `Container Down: ${c.name}`,
            `${c.name} changed from ${prev} to ${c.state}`,
            { type: "container", containerId: c.id }
          ).catch(() => {});
          webhooks.fireWebhooks("container.down", alert).catch(() => {});
        }
        webhooks.fireWebhooks("container.state_change", alert).catch(() => {});
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
