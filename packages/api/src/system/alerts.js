/**
 * Alert rules engine.
 * Custom threshold-based alerts stored in SQLite.
 */

let db = null;
let pushNotify = null;
const activeAlerts = new Map(); // ruleId -> { triggeredAt, count }

function init(database, pushFn) {
  db = database;
  pushNotify = pushFn;

  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      metric TEXT NOT NULL,
      operator TEXT NOT NULL CHECK(operator IN ('>', '<', '>=', '<=', '==')),
      threshold REAL NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER,
      rule_name TEXT,
      metric TEXT,
      value REAL,
      threshold REAL,
      message TEXT,
      created_at DATETIME DEFAULT (datetime('now')),
      FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at);
  `);
}

/** Create an alert rule */
function createRule(name, metric, operator, threshold, durationSeconds = 0) {
  if (!db) throw new Error("Alert engine not initialized");
  const validMetrics = ["cpu_percent", "memory_percent", "disk_percent", "load_1", "container_stopped"];
  if (!validMetrics.includes(metric)) throw new Error(`Invalid metric: ${metric}`);
  const count = db.prepare("SELECT COUNT(*) as c FROM alert_rules").get().c;
  if (count >= 100) throw new Error("Maximum 100 alert rules allowed");

  const result = db
    .prepare("INSERT INTO alert_rules (name, metric, operator, threshold, duration_seconds) VALUES (?, ?, ?, ?, ?)")
    .run(name, metric, operator, threshold, durationSeconds);

  return { id: result.lastInsertRowid, name, metric, operator, threshold, durationSeconds };
}

/** List all rules */
function listRules() {
  if (!db) return [];
  return db.prepare("SELECT * FROM alert_rules ORDER BY created_at DESC").all();
}

/** Delete a rule */
function deleteRule(id) {
  if (!db) return;
  db.prepare("DELETE FROM alert_rules WHERE id = ?").run(id);
  activeAlerts.delete(id);
}

/** Toggle a rule */
function toggleRule(id, enabled) {
  if (!db) return;
  db.prepare("UPDATE alert_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
  if (!enabled) activeAlerts.delete(id);
}

/** Get alert event history */
function getAlertEvents(limit = 50) {
  if (!db) return [];
  return db.prepare("SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?").all(Math.min(limit, 500));
}

/** Evaluate all rules against current metrics */
function evaluateRules(metrics, containerStats) {
  if (!db) return;

  const rules = db.prepare("SELECT * FROM alert_rules WHERE enabled = 1").all();
  const values = {
    cpu_percent: metrics.cpuPercent,
    memory_percent: metrics.memory.percent,
    disk_percent: metrics.disk.percent,
    load_1: metrics.load.load1,
    container_stopped: containerStats.stopped,
  };

  for (const rule of rules) {
    const value = values[rule.metric];
    if (value === undefined) continue;

    const triggered = compare(value, rule.operator, rule.threshold);

    if (triggered) {
      const existing = activeAlerts.get(rule.id);
      const now = Date.now();

      if (!existing) {
        // First time threshold is breached — start tracking
        activeAlerts.set(rule.id, { triggeredAt: now, notifiedAt: 0 });
      }

      const state = activeAlerts.get(rule.id);
      const elapsed = (now - state.triggeredAt) / 1000;

      // Check if duration threshold is met and cooldown has passed (15 min)
      const COOLDOWN_MS = 15 * 60 * 1000;
      if (elapsed >= rule.duration_seconds && now - state.notifiedAt >= COOLDOWN_MS) {
        const message = `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.operator} ${rule.threshold})`;

        db.prepare(
          "INSERT INTO alert_events (rule_id, rule_name, metric, value, threshold, message) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(rule.id, rule.name, rule.metric, value, rule.threshold, message);

        state.notifiedAt = now;

        if (pushNotify) {
          pushNotify(`Alert: ${rule.name}`, message, { type: "alert_rule", ruleId: rule.id }).catch(() => {});
        }
      }
    } else {
      // Clear active alert when condition resolves
      activeAlerts.delete(rule.id);
    }
  }
}

function compare(value, operator, threshold) {
  switch (operator) {
    case ">":
      return value > threshold;
    case "<":
      return value < threshold;
    case ">=":
      return value >= threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
    default:
      return false;
  }
}

module.exports = { init, createRule, listRules, deleteRule, toggleRule, getAlertEvents, evaluateRules };
