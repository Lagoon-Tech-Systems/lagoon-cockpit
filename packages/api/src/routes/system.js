const express = require("express");
const router = express.Router();

const { getSystemMetrics } = require("../system/metrics");
const { checkAllSSL } = require("../system/ssl");
const { probeAllEndpoints } = require("../system/endpoints");
const metricsHistory = require("../system/history");
const containers = require("../docker/containers");
const dockerSystem = require("../docker/system");
const { systemPrune } = require("../docker/prune");
const { requireAuth, requireRole } = require("../auth/middleware");
const { auditLog } = require("../db/sqlite");
const { addClient, getClientCount } = require("../stream/sse");
const { registerToken } = require("../push/expo");
const { safeError } = require("../middleware");

const SERVER_NAME = process.env.SERVER_NAME || "Cockpit Server";
const AUTH_MODE = process.env.AUTH_MODE || "key";

// ── Overview ─────────────────────────────────────────────
router.get("/api/overview", requireAuth, async (_req, res) => {
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

// ── System Metrics ───────────────────────────────────────
router.get("/api/system/metrics", requireAuth, (_req, res) => {
  res.json(getSystemMetrics());
});

// ── Docker Info + Disk Usage ─────────────────────────────
router.get("/api/system/docker", requireAuth, async (_req, res) => {
  try {
    const [info, df] = await Promise.all([dockerSystem.getDockerInfo(), dockerSystem.getDockerDiskUsage()]);
    res.json({ info, diskUsage: df });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── System Prune ─────────────────────────────────────────
router.post("/api/system/prune", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const result = await systemPrune(req.body.includeVolumes === true);
    auditLog(req.user.id, "system.prune", null, `Reclaimed: ${result.totalReclaimed} bytes`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Disk Usage Breakdown ─────────────────────────────────
router.get("/api/system/disk", requireAuth, async (_req, res) => {
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

// ── Endpoints ────────────────────────────────────────────
router.get("/api/endpoints", requireAuth, async (_req, res) => {
  try {
    const results = await probeAllEndpoints(process.env.ENDPOINTS);
    res.json({ endpoints: results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── SSL Certificates ─────────────────────────────────────
router.get("/api/ssl", requireAuth, async (_req, res) => {
  try {
    const domains = (process.env.SSL_DOMAINS || "").split(",").filter(Boolean);
    const results = await checkAllSSL(domains);
    res.json({ certificates: results });
  } catch (err) {
    res.status(500).json({ error: safeError(err) });
  }
});

// ── Metrics History ──────────────────────────────────────
router.get("/api/metrics/history", requireAuth, (req, res) => {
  const hours = Math.min(Math.max(parseInt(req.query.hours || "24", 10), 1), 168); // Max 7 days
  res.json({ history: metricsHistory.getHistory(hours), summary: metricsHistory.getHistorySummary(hours) });
});

// ── SSE Stream ───────────────────────────────────────────
router.get("/api/stream", requireAuth, (req, res) => {
  addClient(res);
});

// ── Push Registration ────────────────────────────────────
router.post("/api/push/register", requireAuth, (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: "token required" });
    registerToken(token, req.user.id, SERVER_NAME);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Detailed Health (authenticated) ──────────────────────
router.get("/api/health", requireAuth, (_req, res) => {
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

// ── Prometheus Metrics Export ─────────────────────────────
// Protected by a static bearer token (METRICS_TOKEN env var).
// If no token is configured, the endpoint is open (local-only setups).
const METRICS_TOKEN = process.env.METRICS_TOKEN || null;

router.get("/metrics", async (req, res) => {
  if (METRICS_TOKEN) {
    const auth = req.headers.authorization || "";
    const prefix = "Bearer ";
    if (!auth.startsWith(prefix)) {
      return res.status(401).set("Content-Type", "text/plain").send("Unauthorized\n");
    }
    const provided = Buffer.from(auth.slice(prefix.length));
    const expected = Buffer.from(METRICS_TOKEN);
    if (provided.length !== expected.length || !require("crypto").timingSafeEqual(provided, expected)) {
      return res.status(401).set("Content-Type", "text/plain").send("Unauthorized\n");
    }
  }
  const sys = getSystemMetrics();
  const containerList = await containers.listContainers(true).catch(() => []);
  const running = containerList.filter((c) => c.state === "running").length;
  const stopped = containerList.length - running;

  const lines = [
    "# HELP cockpit_cpu_percent Current CPU usage percentage",
    "# TYPE cockpit_cpu_percent gauge",
    `cockpit_cpu_percent ${sys.cpuPercent}`,
    "",
    "# HELP cockpit_memory_used_bytes Memory used in bytes",
    "# TYPE cockpit_memory_used_bytes gauge",
    `cockpit_memory_used_bytes ${sys.memory.used}`,
    "",
    "# HELP cockpit_memory_total_bytes Total memory in bytes",
    "# TYPE cockpit_memory_total_bytes gauge",
    `cockpit_memory_total_bytes ${sys.memory.total}`,
    "",
    "# HELP cockpit_memory_percent Memory usage percentage",
    "# TYPE cockpit_memory_percent gauge",
    `cockpit_memory_percent ${sys.memory.percent}`,
    "",
    "# HELP cockpit_disk_used_bytes Disk used in bytes",
    "# TYPE cockpit_disk_used_bytes gauge",
    `cockpit_disk_used_bytes ${sys.disk.used}`,
    "",
    "# HELP cockpit_disk_total_bytes Total disk in bytes",
    "# TYPE cockpit_disk_total_bytes gauge",
    `cockpit_disk_total_bytes ${sys.disk.total}`,
    "",
    "# HELP cockpit_disk_percent Disk usage percentage",
    "# TYPE cockpit_disk_percent gauge",
    `cockpit_disk_percent ${sys.disk.percent}`,
    "",
    "# HELP cockpit_load_1m 1-minute load average",
    "# TYPE cockpit_load_1m gauge",
    `cockpit_load_1m ${sys.load.load1}`,
    "",
    "# HELP cockpit_load_5m 5-minute load average",
    "# TYPE cockpit_load_5m gauge",
    `cockpit_load_5m ${sys.load.load5}`,
    "",
    "# HELP cockpit_load_15m 15-minute load average",
    "# TYPE cockpit_load_15m gauge",
    `cockpit_load_15m ${sys.load.load15}`,
    "",
    "# HELP cockpit_uptime_seconds System uptime in seconds",
    "# TYPE cockpit_uptime_seconds gauge",
    `cockpit_uptime_seconds ${sys.uptimeSeconds}`,
    "",
    "# HELP cockpit_cpu_count Number of CPU cores",
    "# TYPE cockpit_cpu_count gauge",
    `cockpit_cpu_count ${sys.cpuCount}`,
    "",
    "# HELP cockpit_containers_running Number of running containers",
    "# TYPE cockpit_containers_running gauge",
    `cockpit_containers_running ${running}`,
    "",
    "# HELP cockpit_containers_stopped Number of stopped containers",
    "# TYPE cockpit_containers_stopped gauge",
    `cockpit_containers_stopped ${stopped}`,
    "",
    "# HELP cockpit_containers_total Total number of containers",
    "# TYPE cockpit_containers_total gauge",
    `cockpit_containers_total ${containerList.length}`,
  ];

  // Per-container state metrics
  if (containerList.length > 0) {
    lines.push("");
    lines.push("# HELP cockpit_container_running Whether container is running (1) or not (0)");
    lines.push("# TYPE cockpit_container_running gauge");
    for (const c of containerList) {
      const state = c.state === "running" ? 1 : 0;
      const safeName = c.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeImage = c.image.replace(/[^a-zA-Z0-9_./:@-]/g, "_");
      lines.push(`cockpit_container_running{name="${safeName}",image="${safeImage}"} ${state}`);
    }
  }

  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
});

module.exports = router;
