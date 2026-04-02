const express = require("express");
const crypto = require("crypto");
const net = require("net");
const dns = require("dns");
const { URL } = require("url");

const router = express.Router();
const { requireRole } = require("../helpers/auth");

let db = null;
let services = null;
let schedulerInterval = null;
let cleanupCounter = 0;

// ── Init ──────────────────────────────────────────────────────
function init(svc) {
  services = svc;
  db = services.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_uptime_monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'http' CHECK(type IN ('http', 'tcp', 'dns')),
      method TEXT NOT NULL DEFAULT 'GET',
      expected_status INTEGER NOT NULL DEFAULT 200,
      timeout_ms INTEGER NOT NULL DEFAULT 10000,
      interval_seconds INTEGER NOT NULL DEFAULT 60,
      headers TEXT,
      body TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_uptime_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL REFERENCES ext_cockpit_pro_uptime_monitors(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('up', 'down', 'degraded')),
      response_time_ms INTEGER,
      status_code INTEGER,
      error_message TEXT,
      checked_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_uptime_incidents (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES ext_cockpit_pro_uptime_monitors(id) ON DELETE CASCADE,
      started_at DATETIME NOT NULL DEFAULT (datetime('now')),
      resolved_at DATETIME,
      duration_seconds INTEGER,
      cause TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ext_cp_uptime_checks_monitor
      ON ext_cockpit_pro_uptime_checks(monitor_id, checked_at);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_uptime_incidents_monitor
      ON ext_cockpit_pro_uptime_incidents(monitor_id);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_uptime_monitors_enabled
      ON ext_cockpit_pro_uptime_monitors(enabled);
  `);

  startScheduler();
}

// ── Probe Execution ───────────────────────────────────────────

async function performCheck(monitor) {
  const start = Date.now();

  try {
    if (monitor.type === "http") {
      return await probeHTTP(monitor, start);
    } else if (monitor.type === "tcp") {
      return await probeTCP(monitor, start);
    } else if (monitor.type === "dns") {
      return await probeDNS(monitor);
    }
    return { status: "down", responseTime: 0, statusCode: null, error: `Unknown monitor type: ${monitor.type}` };
  } catch (err) {
    const elapsed = Date.now() - start;
    return { status: "down", responseTime: elapsed, statusCode: null, error: err.message };
  }
}

async function probeHTTP(monitor, start) {
  try {
    await validateTargetUrl(monitor.url);
  } catch (err) {
    return { status: "down", responseTime: 0, statusCode: null, error: err.message };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout_ms);

  try {
    const opts = {
      method: monitor.method || "GET",
      signal: controller.signal,
      headers: {},
    };

    if (monitor.headers) {
      try {
        opts.headers = JSON.parse(monitor.headers);
      } catch (_) { /* ignore bad JSON */ }
    }

    if (monitor.body && ["POST", "PUT", "PATCH"].includes(opts.method)) {
      opts.body = monitor.body;
    }

    const resp = await fetch(monitor.url, opts);
    const responseTime = Date.now() - start;

    clearTimeout(timer);

    const expectedStatus = monitor.expected_status || 200;
    if (resp.status !== expectedStatus) {
      return {
        status: "down",
        responseTime,
        statusCode: resp.status,
        error: `Expected status ${expectedStatus}, got ${resp.status}`,
      };
    }

    return {
      status: responseTime > 5000 ? "degraded" : "up",
      responseTime,
      statusCode: resp.status,
      error: null,
    };
  } catch (err) {
    clearTimeout(timer);
    const responseTime = Date.now() - start;
    const errorMsg = err.name === "AbortError"
      ? `Timeout after ${monitor.timeout_ms}ms`
      : err.message;
    return { status: "down", responseTime, statusCode: null, error: errorMsg };
  }
}

async function probeTCP(monitor, start) {
  try {
    await validateTargetUrl(monitor.url);
  } catch (err) {
    return { status: "down", responseTime: 0, statusCode: null, error: err.message };
  }

  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(monitor.url);
    } catch (_) {
      // Try as host:port
      const parts = monitor.url.split(":");
      parsed = { hostname: parts[0], port: parseInt(parts[1] || "80", 10) };
    }

    const host = parsed.hostname;
    const port = parseInt(parsed.port || "80", 10);
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      const responseTime = Date.now() - start;
      resolve({ status: "down", responseTime, statusCode: null, error: `TCP timeout after ${monitor.timeout_ms}ms` });
    }, monitor.timeout_ms);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      const responseTime = Date.now() - start;
      socket.destroy();
      resolve({
        status: responseTime > 5000 ? "degraded" : "up",
        responseTime,
        statusCode: null,
        error: null,
      });
    });

    socket.on("error", (err) => {
      clearTimeout(timer);
      const responseTime = Date.now() - start;
      socket.destroy();
      resolve({ status: "down", responseTime, statusCode: null, error: err.message });
    });
  });
}

async function probeDNS(monitor) {
  const start = Date.now();
  let hostname;
  try {
    const parsed = new URL(monitor.url);
    hostname = parsed.hostname;
  } catch (_) {
    hostname = monitor.url;
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`DNS timeout after ${monitor.timeout_ms}ms`)), monitor.timeout_ms)
  );

  try {
    await Promise.race([dns.promises.resolve(hostname), timeoutPromise]);
    const elapsed = Date.now() - start;
    return { status: elapsed > 5000 ? "degraded" : "up", responseTime: elapsed, statusCode: null, error: null };
  } catch (err) {
    return { status: "down", responseTime: Date.now() - start, statusCode: null, error: err.message };
  }
}

// ── Scheduler ─────────────────────────────────────────────────

function startScheduler() {
  if (schedulerInterval) clearInterval(schedulerInterval);

  schedulerInterval = setInterval(async () => {
    try {
      await runScheduledChecks();
    } catch (err) {
      console.error("[UPTIME] Scheduler error:", err.message);
    }
  }, 30_000);

  // Run once on startup after a short delay
  setTimeout(() => runScheduledChecks().catch((e) => console.error("[UPTIME] Initial check error:", e.message)), 5000);
}

async function runScheduledChecks() {
  // Retention cleanup: purge checks older than 90 days (~every hour at 30s intervals)
  cleanupCounter++;
  if (cleanupCounter >= 120) {
    cleanupCounter = 0;
    try {
      db.prepare("DELETE FROM ext_cockpit_pro_uptime_checks WHERE checked_at < datetime('now', '-90 days')").run();
    } catch (err) {
      console.error("[UPTIME] Retention cleanup error:", err.message);
    }
  }

  // H5: Single query with LEFT JOIN instead of N+1 per-monitor queries
  const monitors = db.prepare(`
    SELECT m.*, lc.checked_at AS last_checked_at
    FROM ext_cockpit_pro_uptime_monitors m
    LEFT JOIN (
      SELECT monitor_id, MAX(checked_at) AS checked_at
      FROM ext_cockpit_pro_uptime_checks
      GROUP BY monitor_id
    ) lc ON lc.monitor_id = m.id
    WHERE m.enabled = 1
  `).all();

  // Filter to monitors that are due for a check
  const nowMs = Date.now();
  const dueMonitors = monitors.filter((monitor) => {
    if (!monitor.last_checked_at) return true;
    const lastTime = new Date(monitor.last_checked_at + "Z").getTime();
    const elapsed = (nowMs - lastTime) / 1000;
    return elapsed >= monitor.interval_seconds;
  });

  // Run checks concurrently with a concurrency limit of 10
  const CONCURRENCY = 10;
  for (let i = 0; i < dueMonitors.length; i += CONCURRENCY) {
    const chunk = dueMonitors.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      chunk.map(async (monitor) => {
        const result = await performCheck(monitor);
        storeCheckResult(monitor, result);
      })
    );

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === "rejected") {
        const monitor = chunk[j];
        console.error(`[UPTIME] Error checking monitor ${monitor.id} (${monitor.name}):`, results[j].reason?.message || results[j].reason);
      }
    }
  }
}

function storeCheckResult(monitor, result) {
  const txn = db.transaction(() => {
    // Insert the check
    db.prepare(`
      INSERT INTO ext_cockpit_pro_uptime_checks (monitor_id, status, response_time_ms, status_code, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(monitor.id, result.status, result.responseTime, result.statusCode || null, result.error || null);

    // Get previous check to detect status transitions
    const prevCheck = db.prepare(`
      SELECT status FROM ext_cockpit_pro_uptime_checks
      WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1 OFFSET 1
    `).get(monitor.id);

    const prevStatus = prevCheck?.status || "up";

    // Transition: up/degraded → down — open incident
    if (result.status === "down" && prevStatus !== "down") {
      const incidentId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO ext_cockpit_pro_uptime_incidents (id, monitor_id, started_at, cause)
        VALUES (?, ?, datetime('now'), ?)
      `).run(incidentId, monitor.id, result.error || "Monitor went down");

      if (services?.broadcast) {
        services.broadcast("uptime_check", { monitorId: monitor.id, monitorName: monitor.name, status: "down", incidentId });
      }

      if (services?.sendPushNotification) {
        services.sendPushNotification(
          `🔴 ${monitor.name} is DOWN`,
          result.error || `${monitor.url} is not responding`,
          { type: "uptime_down", monitorId: monitor.id, incidentId }
        ).catch(() => {});
      }

      if (services?.webhooks?.fireWebhooks) {
        services.webhooks.fireWebhooks("uptime.down", {
          monitorId: monitor.id,
          monitorName: monitor.name,
          url: monitor.url,
          incidentId,
          error: result.error,
          checkedAt: new Date().toISOString(),
        }).catch(() => {});
      }

      if (services?.auditLog) {
        services.auditLog("system", "uptime.incident_opened", monitor.id, `Monitor ${monitor.name} went down: ${result.error}`);
      }
    }

    // Transition: down → up/degraded — resolve incident
    if (prevStatus === "down" && result.status !== "down") {
      const openIncident = db.prepare(`
        SELECT * FROM ext_cockpit_pro_uptime_incidents
        WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1
      `).get(monitor.id);

      if (openIncident) {
        const startedAt = new Date(openIncident.started_at + "Z").getTime();
        const duration = Math.round((Date.now() - startedAt) / 1000);

        db.prepare(`
          UPDATE ext_cockpit_pro_uptime_incidents
          SET resolved_at = datetime('now'), duration_seconds = ?
          WHERE id = ?
        `).run(duration, openIncident.id);

        if (services?.broadcast) {
          services.broadcast("uptime_check", { monitorId: monitor.id, monitorName: monitor.name, status: "up", incidentId: openIncident.id, durationSeconds: duration });
        }

        if (services?.auditLog) {
          services.auditLog("system", "uptime.incident_resolved", monitor.id, `Monitor ${monitor.name} recovered after ${duration}s`);
        }
      }
    }
  });

  txn();
}

function stop() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────

function validateURL(url) {
  if (!url || typeof url !== "string") return false;
  try {
    new URL(url);
    return true;
  } catch (_) {
    // Allow host:port for TCP
    return /^[\w.-]+:\d+$/.test(url);
  }
}

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fd") || ip.startsWith("fc")) return true;
  return false;
}

async function validateTargetUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch (_) {
    // Handle host:port format for TCP
    const parts = urlStr.split(":");
    parsed = { hostname: parts[0] };
  }
  const hostname = parsed.hostname;

  // Direct IP check
  if (net.isIP(hostname)) {
    if (isPrivateIP(hostname)) throw new Error("Target resolves to private IP");
    return;
  }

  // DNS resolution check
  const addresses = await dns.promises.resolve(hostname);
  for (const addr of addresses) {
    if (isPrivateIP(addr)) throw new Error("Target resolves to private IP");
  }
}

function getMonitorOrFail(id, res) {
  const monitor = db.prepare("SELECT * FROM ext_cockpit_pro_uptime_monitors WHERE id = ?").get(id);
  if (!monitor) {
    res.status(404).json({ error: "Monitor not found" });
    return null;
  }
  return monitor;
}

// ── Routes: Monitors CRUD ─────────────────────────────────────

// List all monitors with latest check status
router.get("/monitors", (req, res) => {
  try {
    const monitors = db.prepare(`
      SELECT m.*,
        c.status AS last_status,
        c.response_time_ms AS last_response_time,
        c.checked_at AS last_checked_at
      FROM ext_cockpit_pro_uptime_monitors m
      LEFT JOIN (
        SELECT monitor_id, status, response_time_ms, checked_at,
          ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY checked_at DESC) AS rn
        FROM ext_cockpit_pro_uptime_checks
      ) c ON c.monitor_id = m.id AND c.rn = 1
      ORDER BY m.created_at DESC
    `).all();

    res.json({ monitors });
  } catch (err) {
    console.error("[UPTIME] List monitors error:", err.message);
    res.status(500).json({ error: "Failed to list monitors" });
  }
});

// Create monitor
router.post("/monitors", requireRole("admin", "operator"), async (req, res) => {
  try {
    const { name, url, type, method, expected_status, timeout_ms, interval_seconds, headers, body } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!url || !validateURL(url)) {
      return res.status(400).json({ error: "A valid url is required" });
    }

    const monitorType = type || "http";
    if (!["http", "tcp", "dns"].includes(monitorType)) {
      return res.status(400).json({ error: "type must be http, tcp, or dns" });
    }

    const monitorMethod = method || "GET";
    if (!["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(monitorMethod)) {
      return res.status(400).json({ error: "Invalid HTTP method" });
    }

    // Validate headers JSON if provided
    if (headers) {
      try {
        if (typeof headers === "string") JSON.parse(headers);
      } catch (_) {
        return res.status(400).json({ error: "headers must be valid JSON" });
      }
    }

    // SSRF protection: validate target does not resolve to private IP
    try {
      await validateTargetUrl(url);
    } catch (ssrfErr) {
      return res.status(400).json({ error: ssrfErr.message });
    }

    const id = crypto.randomUUID();
    const headersStr = headers ? (typeof headers === "object" ? JSON.stringify(headers) : headers) : null;
    const expectedStatus = parseInt(expected_status || "200", 10);
    const timeoutMs = Math.max(1000, Math.min(parseInt(timeout_ms || "10000", 10), 60000));
    const intervalSec = Math.max(10, Math.min(parseInt(interval_seconds || "60", 10), 86400));

    db.prepare(`
      INSERT INTO ext_cockpit_pro_uptime_monitors
        (id, name, url, type, method, expected_status, timeout_ms, interval_seconds, headers, body)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), url.trim(), monitorType, monitorMethod, expectedStatus, timeoutMs, intervalSec, headersStr, body || null);

    const monitor = db.prepare("SELECT * FROM ext_cockpit_pro_uptime_monitors WHERE id = ?").get(id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.monitor_created", id, `Created monitor "${name}" for ${url}`);
    }

    res.status(201).json({ monitor });
  } catch (err) {
    console.error("[UPTIME] Create monitor error:", err.message);
    res.status(500).json({ error: "Failed to create monitor" });
  }
});

// Get single monitor with recent checks and uptime stats
router.get("/monitors/:id", (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    const recentChecks = db.prepare(`
      SELECT * FROM ext_cockpit_pro_uptime_checks
      WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 100
    `).all(monitor.id);

    // Uptime stats
    const stats = computeUptimeStats(monitor.id);

    res.json({ monitor, recentChecks, stats });
  } catch (err) {
    console.error("[UPTIME] Get monitor error:", err.message);
    res.status(500).json({ error: "Failed to get monitor" });
  }
});

// Update monitor
router.put("/monitors/:id", requireRole("admin", "operator"), async (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    const { name, url, type, method, expected_status, timeout_ms, interval_seconds, headers, body, enabled } = req.body;

    if (url && !validateURL(url)) {
      return res.status(400).json({ error: "Invalid url" });
    }

    // H3: SSRF protection on URL update (mirrors POST validation)
    if (url) {
      try {
        await validateTargetUrl(url);
      } catch (ssrfErr) {
        return res.status(400).json({ error: ssrfErr.message });
      }
    }
    if (type && !["http", "tcp", "dns"].includes(type)) {
      return res.status(400).json({ error: "type must be http, tcp, or dns" });
    }
    if (method && !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(method)) {
      return res.status(400).json({ error: "Invalid HTTP method" });
    }
    if (headers) {
      try {
        if (typeof headers === "string") JSON.parse(headers);
      } catch (_) {
        return res.status(400).json({ error: "headers must be valid JSON" });
      }
    }

    const updatedName = name?.trim() || monitor.name;
    const updatedUrl = url?.trim() || monitor.url;
    const updatedType = type || monitor.type;
    const updatedMethod = method || monitor.method;
    const updatedExpectedStatus = expected_status != null ? parseInt(expected_status, 10) : monitor.expected_status;
    const updatedTimeout = timeout_ms != null ? Math.max(1000, Math.min(parseInt(timeout_ms, 10), 60000)) : monitor.timeout_ms;
    const updatedInterval = interval_seconds != null ? Math.max(10, Math.min(parseInt(interval_seconds, 10), 86400)) : monitor.interval_seconds;
    const updatedHeaders = headers !== undefined ? (typeof headers === "object" ? JSON.stringify(headers) : headers) : monitor.headers;
    const updatedBody = body !== undefined ? body : monitor.body;
    const updatedEnabled = enabled != null ? (enabled ? 1 : 0) : monitor.enabled;

    db.prepare(`
      UPDATE ext_cockpit_pro_uptime_monitors SET
        name = ?, url = ?, type = ?, method = ?, expected_status = ?,
        timeout_ms = ?, interval_seconds = ?, headers = ?, body = ?,
        enabled = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      updatedName, updatedUrl, updatedType, updatedMethod, updatedExpectedStatus,
      updatedTimeout, updatedInterval, updatedHeaders, updatedBody,
      updatedEnabled, monitor.id
    );

    const updated = db.prepare("SELECT * FROM ext_cockpit_pro_uptime_monitors WHERE id = ?").get(monitor.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.monitor_updated", monitor.id, `Updated monitor "${updatedName}"`);
    }

    res.json({ monitor: updated });
  } catch (err) {
    console.error("[UPTIME] Update monitor error:", err.message);
    res.status(500).json({ error: "Failed to update monitor" });
  }
});

// Delete monitor (cascades checks + incidents)
router.delete("/monitors/:id", requireRole("admin", "operator"), (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    db.prepare("DELETE FROM ext_cockpit_pro_uptime_checks WHERE monitor_id = ?").run(monitor.id);
    db.prepare("DELETE FROM ext_cockpit_pro_uptime_incidents WHERE monitor_id = ?").run(monitor.id);
    db.prepare("DELETE FROM ext_cockpit_pro_uptime_monitors WHERE id = ?").run(monitor.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.monitor_deleted", monitor.id, `Deleted monitor "${monitor.name}" (${monitor.url})`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[UPTIME] Delete monitor error:", err.message);
    res.status(500).json({ error: "Failed to delete monitor" });
  }
});

// Pause monitor
router.post("/monitors/:id/pause", requireRole("admin", "operator"), (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    db.prepare("UPDATE ext_cockpit_pro_uptime_monitors SET enabled = 0, updated_at = datetime('now') WHERE id = ?").run(monitor.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.monitor_paused", monitor.id, `Paused monitor "${monitor.name}"`);
    }

    res.json({ ok: true, enabled: false });
  } catch (err) {
    console.error("[UPTIME] Pause error:", err.message);
    res.status(500).json({ error: "Failed to pause monitor" });
  }
});

// Resume monitor
router.post("/monitors/:id/resume", requireRole("admin", "operator"), (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    db.prepare("UPDATE ext_cockpit_pro_uptime_monitors SET enabled = 1, updated_at = datetime('now') WHERE id = ?").run(monitor.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.monitor_resumed", monitor.id, `Resumed monitor "${monitor.name}"`);
    }

    res.json({ ok: true, enabled: true });
  } catch (err) {
    console.error("[UPTIME] Resume error:", err.message);
    res.status(500).json({ error: "Failed to resume monitor" });
  }
});

// ── Routes: Checks & Stats ───────────────────────────────────

// Paginated check history
router.get("/monitors/:id/checks", (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 500));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));

    const checks = db.prepare(`
      SELECT * FROM ext_cockpit_pro_uptime_checks
      WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ? OFFSET ?
    `).all(monitor.id, limit, offset);

    const total = db.prepare(
      "SELECT COUNT(*) AS count FROM ext_cockpit_pro_uptime_checks WHERE monitor_id = ?"
    ).get(monitor.id).count;

    res.json({ checks, total, limit, offset });
  } catch (err) {
    console.error("[UPTIME] List checks error:", err.message);
    res.status(500).json({ error: "Failed to list checks" });
  }
});

// Uptime stats (24h, 7d, 30d)
router.get("/monitors/:id/stats", (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    const stats = computeUptimeStats(monitor.id);
    res.json({ stats });
  } catch (err) {
    console.error("[UPTIME] Stats error:", err.message);
    res.status(500).json({ error: "Failed to compute stats" });
  }
});

function computeUptimeStats(monitorId) {
  const periods = [
    { label: "24h", sql: "datetime('now', '-1 day')" },
    { label: "7d", sql: "datetime('now', '-7 days')" },
    { label: "30d", sql: "datetime('now', '-30 days')" },
  ];

  const stats = {};

  for (const period of periods) {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'up' THEN 1 WHEN status = 'degraded' THEN 1 ELSE 0 END) AS up_count,
        AVG(response_time_ms) AS avg_response_time
      FROM ext_cockpit_pro_uptime_checks
      WHERE monitor_id = ? AND checked_at >= ${period.sql}
    `).get(monitorId);

    const downtime = db.prepare(`
      SELECT COALESCE(SUM(
        CASE
          WHEN resolved_at IS NOT NULL THEN duration_seconds
          ELSE CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER)
        END
      ), 0) AS total_downtime
      FROM ext_cockpit_pro_uptime_incidents
      WHERE monitor_id = ? AND started_at >= ${period.sql}
    `).get(monitorId);

    stats[period.label] = {
      uptime_percent: row.total > 0 ? Math.round((row.up_count / row.total) * 10000) / 100 : 100,
      avg_response_time_ms: row.avg_response_time ? Math.round(row.avg_response_time) : null,
      total_checks: row.total,
      total_downtime_seconds: downtime.total_downtime,
    };
  }

  return stats;
}

// ── Routes: Incidents ─────────────────────────────────────────

// List all uptime incidents
router.get("/incidents", (req, res) => {
  try {
    const monitorId = req.query.monitor_id;
    const status = req.query.status;
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 500));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));

    let sql = `
      SELECT i.*, m.name AS monitor_name, m.url AS monitor_url
      FROM ext_cockpit_pro_uptime_incidents i
      JOIN ext_cockpit_pro_uptime_monitors m ON m.id = i.monitor_id
      WHERE 1=1
    `;
    const params = [];

    if (monitorId) {
      sql += " AND i.monitor_id = ?";
      params.push(monitorId);
    }
    if (status === "open") {
      sql += " AND i.resolved_at IS NULL";
    } else if (status === "resolved") {
      sql += " AND i.resolved_at IS NOT NULL";
    }

    sql += " ORDER BY i.started_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const incidents = db.prepare(sql).all(...params);
    res.json({ incidents });
  } catch (err) {
    console.error("[UPTIME] List incidents error:", err.message);
    res.status(500).json({ error: "Failed to list incidents" });
  }
});

// Incidents for specific monitor
router.get("/monitors/:id/incidents", (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    const limit = Math.max(1, Math.min(parseInt(req.query.limit || "50", 10), 500));
    const offset = Math.max(0, parseInt(req.query.offset || "0", 10));

    const incidents = db.prepare(`
      SELECT * FROM ext_cockpit_pro_uptime_incidents
      WHERE monitor_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?
    `).all(monitor.id, limit, offset);

    res.json({ incidents });
  } catch (err) {
    console.error("[UPTIME] Monitor incidents error:", err.message);
    res.status(500).json({ error: "Failed to list incidents" });
  }
});

// ── Manual check ──────────────────────────────────────────────

router.post("/monitors/:id/check", requireRole("admin", "operator"), async (req, res) => {
  try {
    const monitor = getMonitorOrFail(req.params.id, res);
    if (!monitor) return;

    // SSRF protection at manual check time
    try {
      await validateTargetUrl(monitor.url);
    } catch (ssrfErr) {
      return res.status(400).json({ error: ssrfErr.message });
    }

    const result = await performCheck(monitor);
    storeCheckResult(monitor, result);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "uptime.manual_check", monitor.id, `Manual check on "${monitor.name}": ${result.status} (${result.responseTime}ms)`);
    }

    res.json({
      monitor_id: monitor.id,
      status: result.status,
      response_time_ms: result.responseTime,
      status_code: result.statusCode,
      error: result.error,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[UPTIME] Manual check error:", err.message);
    res.status(500).json({ error: "Failed to run check" });
  }
});

// ── Exports ───────────────────────────────────────────────────

module.exports = { init, router, stop };
