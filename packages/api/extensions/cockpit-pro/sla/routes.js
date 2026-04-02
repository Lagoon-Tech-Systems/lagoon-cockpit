const express = require("express");
const crypto = require("crypto");

const router = express.Router();
const { requireRole } = require("../helpers/auth");

let db = null;
let services = null;

// ── Init ──────────────────────────────────────────────────────
function init(svc) {
  services = svc;
  db = services.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_sla_definitions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_uptime REAL NOT NULL,
      period_type TEXT NOT NULL DEFAULT 'monthly' CHECK(period_type IN ('monthly', 'quarterly', 'yearly')),
      monitor_ids TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_sla_periods (
      id TEXT PRIMARY KEY,
      sla_id TEXT NOT NULL REFERENCES ext_cockpit_pro_sla_definitions(id) ON DELETE CASCADE,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      total_minutes INTEGER,
      downtime_minutes REAL DEFAULT 0,
      uptime_percentage REAL DEFAULT 100,
      error_budget_minutes REAL,
      error_budget_remaining REAL,
      breached INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_sla_breaches (
      id TEXT PRIMARY KEY,
      sla_id TEXT NOT NULL REFERENCES ext_cockpit_pro_sla_definitions(id) ON DELETE CASCADE,
      period_id TEXT NOT NULL REFERENCES ext_cockpit_pro_sla_periods(id) ON DELETE CASCADE,
      breached_at DATETIME DEFAULT (datetime('now')),
      downtime_minutes REAL,
      target_uptime REAL,
      actual_uptime REAL,
      notified INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_cp_sla_periods_sla
      ON ext_cockpit_pro_sla_periods(sla_id, period_start);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_sla_breaches_sla
      ON ext_cockpit_pro_sla_breaches(sla_id);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_sla_breaches_period
      ON ext_cockpit_pro_sla_breaches(period_id);
  `);
}

// ── Helpers ───────────────────────────────────────────────────

function getSlaOrFail(id, res) {
  const sla = db.prepare("SELECT * FROM ext_cockpit_pro_sla_definitions WHERE id = ?").get(id);
  if (!sla) {
    res.status(404).json({ error: "SLA definition not found" });
    return null;
  }
  return sla;
}

function parseMonitorIds(sla) {
  try {
    return JSON.parse(sla.monitor_ids || "[]");
  } catch (_) {
    return [];
  }
}

/**
 * Compute the current period boundaries based on period_type and a reference date.
 */
function getPeriodBounds(periodType, refDate) {
  const d = refDate || new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed

  let start, end;

  if (periodType === "monthly") {
    start = new Date(Date.UTC(year, month, 1));
    end = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59));
  } else if (periodType === "quarterly") {
    const qStart = Math.floor(month / 3) * 3;
    start = new Date(Date.UTC(year, qStart, 1));
    end = new Date(Date.UTC(year, qStart + 3, 0, 23, 59, 59));
  } else {
    // yearly
    start = new Date(Date.UTC(year, 0, 1));
    end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
  }

  return {
    start: start.toISOString().replace("T", " ").slice(0, 19),
    end: end.toISOString().replace("T", " ").slice(0, 19),
    totalMinutes: Math.round((end.getTime() - start.getTime()) / 60000),
  };
}

/**
 * Get or create the current period for an SLA.
 */
function getCurrentPeriod(sla) {
  const bounds = getPeriodBounds(sla.period_type);
  const errorBudgetMinutes = bounds.totalMinutes * (1 - sla.target_uptime / 100);

  // Check if period already exists
  let period = db.prepare(`
    SELECT * FROM ext_cockpit_pro_sla_periods
    WHERE sla_id = ? AND period_start = ? AND period_end = ?
  `).get(sla.id, bounds.start, bounds.end);

  if (!period) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO ext_cockpit_pro_sla_periods
        (id, sla_id, period_start, period_end, total_minutes, downtime_minutes,
         uptime_percentage, error_budget_minutes, error_budget_remaining, breached)
      VALUES (?, ?, ?, ?, ?, 0, 100, ?, ?, 0)
    `).run(id, sla.id, bounds.start, bounds.end, bounds.totalMinutes, errorBudgetMinutes, errorBudgetMinutes);

    period = db.prepare("SELECT * FROM ext_cockpit_pro_sla_periods WHERE id = ?").get(id);
  }

  return period;
}

/**
 * Recalculate a period by querying uptime check data from the uptime module.
 */
function recalculatePeriod(sla, period) {
  const monitorIds = parseMonitorIds(sla);
  if (monitorIds.length === 0) {
    return period; // Nothing to calculate
  }

  // Build placeholders for IN clause
  const placeholders = monitorIds.map(() => "?").join(", ");

  // Query uptime checks within the period timeframe for the SLA's monitor IDs
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_checks,
      SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) AS down_checks
    FROM ext_cockpit_pro_uptime_checks
    WHERE monitor_id IN (${placeholders})
      AND checked_at >= ?
      AND checked_at <= ?
  `).get(...monitorIds, period.period_start, period.period_end);

  const totalChecks = row.total_checks || 0;
  const downChecks = row.down_checks || 0;

  let downtimeMinutes = 0;
  let uptimePercentage = 100;

  if (totalChecks > 0) {
    downtimeMinutes = (downChecks / totalChecks) * period.total_minutes;
    uptimePercentage = 100 - (downtimeMinutes / period.total_minutes * 100);
  }

  // Round to reasonable precision
  downtimeMinutes = Math.round(downtimeMinutes * 100) / 100;
  uptimePercentage = Math.round(uptimePercentage * 10000) / 10000;

  const errorBudgetMinutes = period.total_minutes * (1 - sla.target_uptime / 100);
  const errorBudgetRemaining = Math.round((errorBudgetMinutes - downtimeMinutes) * 100) / 100;
  const breached = uptimePercentage < sla.target_uptime ? 1 : 0;

  db.prepare(`
    UPDATE ext_cockpit_pro_sla_periods SET
      downtime_minutes = ?,
      uptime_percentage = ?,
      error_budget_minutes = ?,
      error_budget_remaining = ?,
      breached = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(downtimeMinutes, uptimePercentage, errorBudgetMinutes, errorBudgetRemaining, breached, period.id);

  // If breached, create breach record and notify
  if (breached) {
    handleBreach(sla, period, downtimeMinutes, uptimePercentage);
  }

  return db.prepare("SELECT * FROM ext_cockpit_pro_sla_periods WHERE id = ?").get(period.id);
}

/**
 * Handle an SLA breach: create breach record, send notifications.
 */
function handleBreach(sla, period, downtimeMinutes, actualUptime) {
  // Check if we already have a breach for this period
  const existing = db.prepare(`
    SELECT id FROM ext_cockpit_pro_sla_breaches
    WHERE sla_id = ? AND period_id = ?
  `).get(sla.id, period.id);

  if (existing) return; // Already recorded

  const breachId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO ext_cockpit_pro_sla_breaches
      (id, sla_id, period_id, breached_at, downtime_minutes, target_uptime, actual_uptime, notified)
    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, 1)
  `).run(breachId, sla.id, period.id, downtimeMinutes, sla.target_uptime, actualUptime);

  const message = `SLA "${sla.name}" breached: ${actualUptime.toFixed(2)}% uptime (target: ${sla.target_uptime}%)`;

  if (services?.sendPushNotification) {
    services.sendPushNotification("SLA Breach", message, {
      type: "sla_breach",
      slaId: sla.id,
      breachId,
      actualUptime,
      targetUptime: sla.target_uptime,
    }).catch(() => {});
  }

  if (services?.webhooks?.fireWebhooks) {
    services.webhooks.fireWebhooks("sla.breached", {
      slaId: sla.id,
      slaName: sla.name,
      breachId,
      periodId: period.id,
      downtimeMinutes,
      targetUptime: sla.target_uptime,
      actualUptime,
      periodStart: period.period_start,
      periodEnd: period.period_end,
      breachedAt: new Date().toISOString(),
    }).catch(() => {});
  }

  if (services?.auditLog) {
    services.auditLog("system", "sla.breached", sla.id, message);
  }
}

/**
 * Calculate burn rate: error_budget_used / days_elapsed_in_period.
 */
function calculateBurnRate(period) {
  const periodStart = new Date(period.period_start + "Z");
  const now = new Date();
  const elapsedMs = now.getTime() - periodStart.getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);

  if (elapsedDays <= 0) return 0;

  const budgetUsed = (period.error_budget_minutes || 0) - (period.error_budget_remaining || 0);
  return Math.round((budgetUsed / elapsedDays) * 100) / 100;
}

// ── Routes: SLA Definitions CRUD ──────────────────────────────

// List all SLA definitions
router.get("/definitions", (req, res) => {
  try {
    const definitions = db.prepare(`
      SELECT * FROM ext_cockpit_pro_sla_definitions ORDER BY created_at DESC
    `).all();

    // Parse monitor_ids for each
    const result = definitions.map((d) => ({
      ...d,
      monitor_ids: parseMonitorIds(d),
    }));

    res.json({ definitions: result });
  } catch (err) {
    console.error("[SLA] List definitions error:", err.message);
    res.status(500).json({ error: "Failed to list SLA definitions" });
  }
});

// Create SLA definition
router.post("/definitions", requireRole("admin", "operator"), (req, res) => {
  try {
    const { name, description, target_uptime, period_type, monitor_ids } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    if (target_uptime == null || typeof target_uptime !== "number") {
      return res.status(400).json({ error: "target_uptime is required and must be a number" });
    }
    if (target_uptime < 0 || target_uptime >= 100) {
      return res.status(400).json({ error: "target_uptime must be between 0 and 99.9999 (exclusive of 100 to avoid zero error budget)" });
    }

    const validPeriodTypes = ["monthly", "quarterly", "yearly"];
    const pType = period_type || "monthly";
    if (!validPeriodTypes.includes(pType)) {
      return res.status(400).json({ error: `period_type must be one of: ${validPeriodTypes.join(", ")}` });
    }

    if (monitor_ids !== undefined && !Array.isArray(monitor_ids)) {
      return res.status(400).json({ error: "monitor_ids must be an array" });
    }

    const id = crypto.randomUUID();
    const monitorIdsJson = JSON.stringify(monitor_ids || []);

    db.prepare(`
      INSERT INTO ext_cockpit_pro_sla_definitions
        (id, name, description, target_uptime, period_type, monitor_ids)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), description || null, target_uptime, pType, monitorIdsJson);

    const sla = db.prepare("SELECT * FROM ext_cockpit_pro_sla_definitions WHERE id = ?").get(id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "sla.definition_created", id, `Created SLA "${name}" (target: ${target_uptime}%, period: ${pType})`);
    }

    res.status(201).json({ definition: { ...sla, monitor_ids: parseMonitorIds(sla) } });
  } catch (err) {
    console.error("[SLA] Create definition error:", err.message);
    res.status(500).json({ error: "Failed to create SLA definition" });
  }
});

// Get single SLA definition with current period status
router.get("/definitions/:id", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const currentPeriod = getCurrentPeriod(sla);

    res.json({
      definition: { ...sla, monitor_ids: parseMonitorIds(sla) },
      current_period: currentPeriod,
    });
  } catch (err) {
    console.error("[SLA] Get definition error:", err.message);
    res.status(500).json({ error: "Failed to get SLA definition" });
  }
});

// Update SLA definition
router.put("/definitions/:id", requireRole("admin", "operator"), (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const { name, description, target_uptime, period_type, monitor_ids } = req.body;

    if (target_uptime != null) {
      if (typeof target_uptime !== "number") {
        return res.status(400).json({ error: "target_uptime must be a number" });
      }
      if (target_uptime < 0 || target_uptime >= 100) {
        return res.status(400).json({ error: "target_uptime must be between 0 and 99.9999 (exclusive of 100 to avoid zero error budget)" });
      }
    }

    const validPeriodTypes = ["monthly", "quarterly", "yearly"];
    if (period_type && !validPeriodTypes.includes(period_type)) {
      return res.status(400).json({ error: `period_type must be one of: ${validPeriodTypes.join(", ")}` });
    }

    if (monitor_ids !== undefined && !Array.isArray(monitor_ids)) {
      return res.status(400).json({ error: "monitor_ids must be an array" });
    }

    const updatedName = name?.trim() || sla.name;
    const updatedDescription = description !== undefined ? description : sla.description;
    const updatedTargetUptime = target_uptime != null ? target_uptime : sla.target_uptime;
    const updatedPeriodType = period_type || sla.period_type;
    const updatedMonitorIds = monitor_ids !== undefined ? JSON.stringify(monitor_ids) : sla.monitor_ids;

    db.prepare(`
      UPDATE ext_cockpit_pro_sla_definitions SET
        name = ?, description = ?, target_uptime = ?, period_type = ?,
        monitor_ids = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(updatedName, updatedDescription, updatedTargetUptime, updatedPeriodType, updatedMonitorIds, sla.id);

    const updated = db.prepare("SELECT * FROM ext_cockpit_pro_sla_definitions WHERE id = ?").get(sla.id);

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "sla.definition_updated", sla.id, `Updated SLA "${updatedName}"`);
    }

    res.json({ definition: { ...updated, monitor_ids: parseMonitorIds(updated) } });
  } catch (err) {
    console.error("[SLA] Update definition error:", err.message);
    res.status(500).json({ error: "Failed to update SLA definition" });
  }
});

// Delete SLA definition + cascade periods/breaches
router.delete("/definitions/:id", requireRole("admin", "operator"), (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    db.transaction(() => {
      db.prepare("DELETE FROM ext_cockpit_pro_sla_breaches WHERE sla_id = ?").run(sla.id);
      db.prepare("DELETE FROM ext_cockpit_pro_sla_periods WHERE sla_id = ?").run(sla.id);
      db.prepare("DELETE FROM ext_cockpit_pro_sla_definitions WHERE id = ?").run(sla.id);
    })();

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "sla.definition_deleted", sla.id, `Deleted SLA "${sla.name}"`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("[SLA] Delete definition error:", err.message);
    res.status(500).json({ error: "Failed to delete SLA definition" });
  }
});

// ── Routes: Periods ───────────────────────────────────────────

// List all periods for an SLA (most recent first, paginated)
router.get("/definitions/:id/periods", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const periods = db.prepare(`
      SELECT * FROM ext_cockpit_pro_sla_periods
      WHERE sla_id = ? ORDER BY period_start DESC LIMIT ? OFFSET ?
    `).all(sla.id, limit, offset);

    res.json({ periods, limit, offset });
  } catch (err) {
    console.error("[SLA] List periods error:", err.message);
    res.status(500).json({ error: "Failed to list periods" });
  }
});

// Get or create the current period
router.get("/definitions/:id/current", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const period = getCurrentPeriod(sla);
    const burnRate = calculateBurnRate(period);

    res.json({ period, burn_rate: burnRate });
  } catch (err) {
    console.error("[SLA] Get current period error:", err.message);
    res.status(500).json({ error: "Failed to get current period" });
  }
});

// Recalculate current period by querying uptime check data
router.post("/definitions/:id/recalculate", requireRole("admin", "operator"), (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const period = getCurrentPeriod(sla);
    const updated = recalculatePeriod(sla, period);
    const burnRate = calculateBurnRate(updated);

    if (services?.broadcast) {
      services.broadcast({
        type: "sla_update",
        slaId: sla.id,
        slaName: sla.name,
        uptimePercentage: updated.uptime_percentage,
        breached: updated.breached === 1,
        errorBudgetRemaining: updated.error_budget_remaining,
      });
    }

    if (services?.auditLog) {
      services.auditLog(req.user?.id || "system", "sla.recalculated", sla.id, `Recalculated SLA "${sla.name}": ${updated.uptime_percentage}% uptime`);
    }

    res.json({ period: updated, burn_rate: burnRate });
  } catch (err) {
    console.error("[SLA] Recalculate error:", err.message);
    res.status(500).json({ error: "Failed to recalculate period" });
  }
});

// ── Routes: Error Budget ──────────────────────────────────────

router.get("/definitions/:id/budget", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const period = getCurrentPeriod(sla);
    const totalBudgetMinutes = period.error_budget_minutes || 0;
    const usedMinutes = totalBudgetMinutes - (period.error_budget_remaining || 0);
    const remainingMinutes = period.error_budget_remaining || 0;
    const remainingPercentage = totalBudgetMinutes > 0
      ? Math.round((remainingMinutes / totalBudgetMinutes) * 10000) / 100
      : 100;
    const isBreached = period.breached === 1;
    const burnRate = calculateBurnRate(period);

    res.json({
      total_budget_minutes: Math.round(totalBudgetMinutes * 100) / 100,
      used_minutes: Math.round(usedMinutes * 100) / 100,
      remaining_minutes: Math.round(remainingMinutes * 100) / 100,
      remaining_percentage: remainingPercentage,
      is_breached: isBreached,
      burn_rate: burnRate,
    });
  } catch (err) {
    console.error("[SLA] Budget error:", err.message);
    res.status(500).json({ error: "Failed to get error budget" });
  }
});

// ── Routes: Breaches ──────────────────────────────────────────

// List all breaches (optional ?sla_id= filter, paginated)
router.get("/breaches", (req, res) => {
  try {
    const slaId = req.query.sla_id;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let sql = `
      SELECT b.*, d.name AS sla_name, d.target_uptime AS sla_target_uptime
      FROM ext_cockpit_pro_sla_breaches b
      JOIN ext_cockpit_pro_sla_definitions d ON d.id = b.sla_id
      WHERE 1=1
    `;
    const params = [];

    if (slaId) {
      sql += " AND b.sla_id = ?";
      params.push(slaId);
    }

    sql += " ORDER BY b.breached_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const breaches = db.prepare(sql).all(...params);
    res.json({ breaches, limit, offset });
  } catch (err) {
    console.error("[SLA] List breaches error:", err.message);
    res.status(500).json({ error: "Failed to list breaches" });
  }
});

// Breaches for a specific SLA (paginated)
router.get("/definitions/:id/breaches", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    const breaches = db.prepare(`
      SELECT * FROM ext_cockpit_pro_sla_breaches
      WHERE sla_id = ? ORDER BY breached_at DESC LIMIT ? OFFSET ?
    `).all(sla.id, limit, offset);

    res.json({ breaches, limit, offset });
  } catch (err) {
    console.error("[SLA] SLA breaches error:", err.message);
    res.status(500).json({ error: "Failed to list breaches" });
  }
});

// ── Routes: Report ────────────────────────────────────────────

router.get("/definitions/:id/report", (req, res) => {
  try {
    const sla = getSlaOrFail(req.params.id, res);
    if (!sla) return;

    const currentPeriod = getCurrentPeriod(sla);
    const burnRate = calculateBurnRate(currentPeriod);

    const allPeriods = db.prepare(`
      SELECT * FROM ext_cockpit_pro_sla_periods
      WHERE sla_id = ? ORDER BY period_start DESC
    `).all(sla.id);

    const allBreaches = db.prepare(`
      SELECT * FROM ext_cockpit_pro_sla_breaches
      WHERE sla_id = ? ORDER BY breached_at DESC
    `).all(sla.id);

    // Build burn rate chart data: daily error budget usage over the current period
    const burnRateChart = buildBurnRateChart(sla, currentPeriod);

    res.json({
      definition: { ...sla, monitor_ids: parseMonitorIds(sla) },
      current_status: {
        period: currentPeriod,
        burn_rate: burnRate,
        is_breached: currentPeriod.breached === 1,
      },
      periods: allPeriods,
      breaches: allBreaches,
      burn_rate_chart: burnRateChart,
    });
  } catch (err) {
    console.error("[SLA] Report error:", err.message);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

/**
 * Build daily error budget chart data for the current period.
 * Returns array of { date, budget_remaining_minutes, budget_used_minutes }.
 */
function buildBurnRateChart(sla, period) {
  const monitorIds = parseMonitorIds(sla);
  if (monitorIds.length === 0) return [];

  const placeholders = monitorIds.map(() => "?").join(", ");

  // Single query: group by date, count total and down checks per day
  const rows = db.prepare(`
    SELECT
      date(checked_at) as check_date,
      COUNT(*) as total_checks,
      SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_checks
    FROM ext_cockpit_pro_uptime_checks
    WHERE monitor_id IN (${placeholders})
      AND checked_at >= ? AND checked_at <= ?
    GROUP BY date(checked_at)
    ORDER BY check_date
  `).all(...monitorIds, period.period_start, period.period_end);

  const errorBudgetMinutes = period.total_minutes * (1 - sla.target_uptime / 100);
  let cumulativeDowntime = 0;

  // H4: Guard against division by zero when target_uptime = 100 (zero error budget)
  if (errorBudgetMinutes <= 0) {
    return rows.map(row => ({
      date: row.check_date,
      downtime_minutes: 0,
      cumulative_downtime: 0,
      budget_remaining: 0,
      budget_remaining_pct: 0,
    }));
  }

  return rows.map(row => {
    const dayMinutes = 1440; // minutes in a day
    const dayDowntime = row.total_checks > 0 ? (row.down_checks / row.total_checks) * dayMinutes : 0;
    cumulativeDowntime += dayDowntime;

    return {
      date: row.check_date,
      downtime_minutes: Math.round(dayDowntime * 100) / 100,
      cumulative_downtime: Math.round(cumulativeDowntime * 100) / 100,
      budget_remaining: Math.round((errorBudgetMinutes - cumulativeDowntime) * 100) / 100,
      budget_remaining_pct: Math.round(((errorBudgetMinutes - cumulativeDowntime) / errorBudgetMinutes) * 10000) / 10000 * 100,
    };
  });
}

// ── Exports ───────────────────────────────────────────────────

module.exports = { init, router };
