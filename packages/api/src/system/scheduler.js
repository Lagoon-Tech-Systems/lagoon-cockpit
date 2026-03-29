/**
 * Scheduled Actions engine.
 * Stores cron-like schedules in SQLite and executes container actions
 * (start / stop / restart) at the configured times using a setInterval-based
 * cron evaluator (no external cron library required).
 */

const containers = require("../docker/containers");

let db = null;
let auditLogFn = null;
const timers = new Map(); // scheduleId -> intervalId

// ── Init ────────────────────────────────────────────────────
function init(database, auditLog) {
  db = database;
  auditLogFn = auditLog;

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      container_id TEXT NOT NULL,
      container_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('start', 'stop', 'restart')),
      cron_expression TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      last_run DATETIME,
      next_run DATETIME,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER,
      schedule_name TEXT,
      container_id TEXT,
      container_name TEXT,
      action TEXT,
      success INTEGER DEFAULT 1,
      error TEXT,
      executed_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (schedule_id) REFERENCES scheduled_actions(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_history_executed ON schedule_history(executed_at);
  `);

  // Load and start all enabled schedules
  const schedules = db.prepare("SELECT * FROM scheduled_actions WHERE enabled = 1").all();
  for (const schedule of schedules) {
    startTimer(schedule);
  }
  console.log(`[SCHEDULER] Loaded ${schedules.length} active schedule(s)`);
}

// ── Cron Parser (supports standard 5-field: min hour dom month dow) ──

/**
 * Parse a cron field against a value.
 * Supports: * , / - and literal numbers.
 */
function fieldMatches(field, value, _max) {
  if (field === "*") return true;

  const parts = field.split(",");
  for (const part of parts) {
    // Step: */n or n/m
    if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const start = range === "*" ? 0 : parseInt(range, 10);
      if ((value - start) % step === 0 && value >= start) return true;
      continue;
    }
    // Range: n-m
    if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (value >= lo && value <= hi) return true;
      continue;
    }
    // Literal
    if (parseInt(part, 10) === value) return true;
  }
  return false;
}

function cronMatches(expression, date) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minF, hourF, domF, monF, dowF] = parts;
  const min = date.getMinutes();
  const hour = date.getHours();
  const dom = date.getDate();
  const mon = date.getMonth() + 1; // 1-12
  const dow = date.getDay(); // 0=Sun

  return (
    fieldMatches(minF, min, 59) &&
    fieldMatches(hourF, hour, 23) &&
    fieldMatches(domF, dom, 31) &&
    fieldMatches(monF, mon, 12) &&
    fieldMatches(dowF, dow, 7)
  );
}

/**
 * Compute the next run time for a cron expression (within the next 48 hours).
 * Returns an ISO string or null if unable to compute.
 */
function computeNextRun(expression) {
  const now = new Date();
  // Start from next minute
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  const maxIterations = 48 * 60; // 48 hours of minutes
  for (let i = 0; i < maxIterations; i++) {
    if (cronMatches(expression, candidate)) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

// ── Timer Management ────────────────────────────────────────

const lastFiredMinute = new Map(); // scheduleId -> "YYYY-MM-DD HH:mm"

function startTimer(schedule) {
  if (timers.has(schedule.id)) {
    clearInterval(timers.get(schedule.id));
  }

  // Check every 30 seconds for cron match
  const intervalId = setInterval(() => {
    const now = new Date();

    if (cronMatches(schedule.cron_expression, now)) {
      // Deduplicate: only fire once per minute window
      const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
      if (lastFiredMinute.get(schedule.id) === minuteKey) return;
      lastFiredMinute.set(schedule.id, minuteKey);

      executeAction(schedule);
    }
  }, 30000);

  timers.set(schedule.id, intervalId);
}

function stopTimer(scheduleId) {
  if (timers.has(scheduleId)) {
    clearInterval(timers.get(scheduleId));
    timers.delete(scheduleId);
  }
}

// ── Execute Action ──────────────────────────────────────────

async function executeAction(schedule) {
  const actionMap = {
    start: () => containers.startContainer(schedule.container_id),
    stop: () => containers.stopContainer(schedule.container_id),
    restart: () => containers.restartContainer(schedule.container_id),
  };

  const fn = actionMap[schedule.action];
  if (!fn) return;

  let success = true;
  let error = null;

  try {
    await fn();
    console.log(`[SCHEDULER] Executed ${schedule.action} on ${schedule.container_name} (schedule: ${schedule.name})`);
  } catch (err) {
    success = false;
    error = err.message || "Unknown error";
    console.error(`[SCHEDULER] Failed ${schedule.action} on ${schedule.container_name}: ${error}`);
  }

  // Update last_run and next_run
  const nextRun = computeNextRun(schedule.cron_expression);
  db.prepare("UPDATE scheduled_actions SET last_run = datetime('now'), next_run = ? WHERE id = ?").run(
    nextRun,
    schedule.id,
  );

  // Log to schedule_history
  db.prepare(
    `INSERT INTO schedule_history (schedule_id, schedule_name, container_id, container_name, action, success, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    schedule.id,
    schedule.name,
    schedule.container_id,
    schedule.container_name,
    schedule.action,
    success ? 1 : 0,
    error,
  );

  // Audit log
  if (auditLogFn) {
    auditLogFn(
      "scheduler",
      `schedule.${schedule.action}`,
      schedule.container_id,
      `${schedule.name}: ${schedule.action} ${schedule.container_name}${error ? ` [FAILED: ${error}]` : ""}`,
    );
  }
}

// ── CRUD ────────────────────────────────────────────────────

function createSchedule(name, containerId, containerName, action, cronExpression) {
  if (!name || !containerId || !containerName || !action || !cronExpression) {
    throw new Error("All fields are required: name, containerId, containerName, action, cronExpression");
  }
  if (!["start", "stop", "restart"].includes(action)) {
    throw new Error("action must be start, stop, or restart");
  }
  const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
  if (!CONTAINER_ID_RE.test(containerId)) throw new Error("Invalid container ID format");
  if (db) {
    const count = db.prepare("SELECT COUNT(*) as c FROM scheduled_actions").get().c;
    if (count >= 50) throw new Error("Maximum 50 schedules allowed");
  }

  // Validate cron expression (5 fields)
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("cronExpression must have 5 fields: minute hour day month weekday");
  }

  const nextRun = computeNextRun(cronExpression);

  const result = db
    .prepare(
      `INSERT INTO scheduled_actions (name, container_id, container_name, action, cron_expression, next_run)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(name, containerId, containerName, action, cronExpression, nextRun);

  const schedule = db.prepare("SELECT * FROM scheduled_actions WHERE id = ?").get(result.lastInsertRowid);

  // Start the timer
  startTimer(schedule);

  return schedule;
}

function listSchedules() {
  return db.prepare("SELECT * FROM scheduled_actions ORDER BY created_at DESC").all();
}

function deleteSchedule(id) {
  stopTimer(id);
  db.prepare("DELETE FROM scheduled_actions WHERE id = ?").run(id);
}

function toggleSchedule(id, enabled) {
  db.prepare("UPDATE scheduled_actions SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);

  const schedule = db.prepare("SELECT * FROM scheduled_actions WHERE id = ?").get(id);

  if (!schedule) return null;

  if (enabled) {
    // Recompute next_run when re-enabling
    const nextRun = computeNextRun(schedule.cron_expression);
    db.prepare("UPDATE scheduled_actions SET next_run = ? WHERE id = ?").run(nextRun, id);
    startTimer(schedule);
  } else {
    stopTimer(id);
  }

  return db.prepare("SELECT * FROM scheduled_actions WHERE id = ?").get(id);
}

function getScheduleHistory(limit = 50) {
  return db.prepare("SELECT * FROM schedule_history ORDER BY executed_at DESC LIMIT ?").all(limit);
}

module.exports = {
  init,
  createSchedule,
  listSchedules,
  deleteSchedule,
  toggleSchedule,
  getScheduleHistory,
};
