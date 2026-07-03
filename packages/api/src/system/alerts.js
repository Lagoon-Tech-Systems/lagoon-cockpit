/**
 * Alert rules engine.
 * Custom threshold-based alerts stored in SQLite.
 */

let db = null;
let pushNotify = null;
const activeAlerts = new Map(); // ruleId -> { triggeredAt, notifiedAt, clearingSince?, clearTicks? }
let _coldStart = false; // one-shot baseline flag — see seedColdStart()

/**
 * Mark the next evaluateRules() pass as a cold-start baseline (G-T1).
 * Call once at boot, right after init(). Any rule already breaching on that
 * first pass is registered as already-notified (notifiedAt = now) so it stays
 * silent for the normal cooldown window instead of paging immediately — this
 * is what prevents a duplicate alert storm on a deploy made mid-breach.
 * The flag is one-shot: it clears after the first pass completes, so a
 * genuinely new incident that starts after boot still fires immediately.
 */
function seedColdStart() {
  _coldStart = true;
}

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
function createRule(name, metric, operator, threshold, durationSeconds = 0, severity = "warn") {
  if (!db) throw new Error("Alert engine not initialized");
  const validMetrics = ["cpu_percent", "memory_percent", "disk_percent", "load_1", "container_stopped"];
  if (!validMetrics.includes(metric)) throw new Error(`Invalid metric: ${metric}`);
  const validSeverities = ["info", "warn", "critical"];
  if (!validSeverities.includes(severity)) throw new Error(`Invalid severity: ${severity}`);
  const count = db.prepare("SELECT COUNT(*) as c FROM alert_rules").get().c;
  if (count >= 100) throw new Error("Maximum 100 alert rules allowed");

  const result = db
    .prepare(
      "INSERT INTO alert_rules (name, metric, operator, threshold, duration_seconds, severity) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(name, metric, operator, threshold, durationSeconds, severity);

  return { id: result.lastInsertRowid, name, metric, operator, threshold, durationSeconds, severity };
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

/** Get a single alert event by id, or undefined if not found / db not initialized */
function getAlertEvent(id) {
  if (!db) return undefined;
  return db.prepare("SELECT * FROM alert_events WHERE id = ?").get(id);
}

/**
 * Evaluate all rules against current metrics.
 *
 * NOTE: at idle (no SSE client) the sampler ticks every 60s, so duration_seconds is
 * effectively quantized to the sampler cadence: a rule with duration_seconds < 60 needs
 * at least one full idle tick before it can fire, and a 90s rule needs ~120s. This is
 * conservative (never pages early). Document in release notes; do not market "instant".
 */
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
        // First time threshold is breached — start tracking.
        // On the first post-boot pass (_coldStart), seed notifiedAt = now so an
        // already-breaching rule is treated as already-notified and the cooldown
        // gate suppresses an immediate storm; a genuinely new breach (not cold
        // start) still gets notifiedAt = 0 so it fires right away.
        activeAlerts.set(rule.id, { triggeredAt: now, notifiedAt: _coldStart ? now : 0 });
      }

      const state = activeAlerts.get(rule.id);

      // Re-triggering (or a still-fresh entry) means the alert is not clearing
      // right now — drop any in-progress clear tracking so a later dip back
      // toward the clear band starts its clear timer/tick count from scratch.
      delete state.clearingSince;
      state.clearTicks = 0;

      const elapsed = (now - state.triggeredAt) / 1000;

      // Check if duration threshold is met and cooldown has passed (15 min)
      const COOLDOWN_MS = 15 * 60 * 1000;
      if (elapsed >= rule.duration_seconds && now - state.notifiedAt >= COOLDOWN_MS) {
        const message = `${rule.name}: ${rule.metric} is ${value} (threshold: ${rule.operator} ${rule.threshold})`;

        const result = db
          .prepare(
            "INSERT INTO alert_events (rule_id, rule_name, metric, value, threshold, message, severity) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(rule.id, rule.name, rule.metric, value, rule.threshold, message, rule.severity || "warn");
        const eventId = result.lastInsertRowid;

        state.notifiedAt = now;

        if (pushNotify) {
          pushNotify(
            `Alert: ${rule.name}`,
            message,
            { type: "alert_rule", ruleId: rule.id, eventId, severity: rule.severity || "warn" },
            { severity: rule.severity || "warn" },
          ).catch(() => {});
        }
      }
    } else {
      // Not currently past the fire threshold. An active alert only resolves
      // once the metric has genuinely cleared — either past the hysteresis
      // band for a set duration (continuous gauges), or for K consecutive
      // ticks (== rules and the discrete container_stopped count) — so a
      // value oscillating right at the boundary doesn't re-arm and re-fire.
      const existing = activeAlerts.get(rule.id);
      if (existing) {
        const now = Date.now();
        const useDebounce = rule.operator === "==" || rule.metric === "container_stopped";

        if (useDebounce) {
          existing.clearTicks = (existing.clearTicks || 0) + 1;
          if (existing.clearTicks >= 2) {
            resolveAlert(rule, value, existing);
          }
        } else if (inClearZone(rule, value)) {
          if (existing.clearingSince == null) existing.clearingSince = now;
          const clearDurationMs = (rule.clear_duration_seconds || 0) * 1000;
          if (now - existing.clearingSince >= clearDurationMs) {
            resolveAlert(rule, value, existing);
          }
        } else {
          // Dipped below the fire threshold but hasn't crossed into the
          // clear band yet — keep the alert active and untouched.
          delete existing.clearingSince;
        }
      }
      // Rules with no active entry that aren't triggered need no action.
    }
  }

  // One-shot: the baseline pass is over — subsequent passes evaluate normally.
  if (_coldStart) _coldStart = false;
}

/**
 * Resolve an active alert: fire the recovery push + 'info' resolve event
 * (only if the rule had actually notified while active — a silent breach
 * that never crossed the duration/cooldown gate doesn't need a "resolved"
 * push), then drop it from activeAlerts so a later breach starts fresh.
 */
function resolveAlert(rule, value, state) {
  if (state.notifiedAt > 0 && pushNotify) {
    const msg = `${rule.metric} back to ${value}`;
    db.prepare(
      "INSERT INTO alert_events (rule_id, rule_name, metric, value, threshold, message, severity) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(rule.id, rule.name, rule.metric, value, rule.threshold, msg, "info");

    pushNotify(`✓ ${rule.name} resolved`, msg, { type: "resolve", ruleId: rule.id }, { severity: "info" }).catch(
      () => {},
    );
  }
  activeAlerts.delete(rule.id);
}

/**
 * True if `value` has crossed back into the "clear" zone for `rule` — the
 * derived band (or explicit clear_threshold override) that a metric must
 * cross past before an active alert is allowed to resolve. Without this
 * band, a value oscillating right at the fire threshold re-arms and
 * re-fires on every tick.
 *
 * For '==' rules there is no meaningful band (any non-equal value is
 * "not triggered"); callers fall back to the K-consecutive-tick debounce
 * for those instead of this band (the boolean returned here is a sentinel,
 * not used to gate resolution for '==').
 */
function inClearZone(rule, value) {
  const isUpper = ['>', '>='].includes(rule.operator); // alert when value high
  const isLower = ['<', '<='].includes(rule.operator); // alert when value low
  if (rule.operator === '==') return value !== rule.threshold; // handled by debounce below
  const band = rule.clear_threshold != null
    ? rule.clear_threshold
    : (isUpper ? rule.threshold - Math.max(rule.threshold * 0.05, 1)
               : rule.threshold + Math.max(rule.threshold * 0.05, 1));
  return isUpper ? value < band : isLower ? value > band : true;
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

module.exports = {
  init,
  createRule,
  listRules,
  deleteRule,
  toggleRule,
  getAlertEvents,
  getAlertEvent,
  evaluateRules,
  seedColdStart,
};
