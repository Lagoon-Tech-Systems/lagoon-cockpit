const { Expo } = require("expo-server-sdk");

let expo = null;
let db = null;

// Per-token rolling-window push budget (G-P1 anti-DoS gate).
// CRITICAL pushes get their own, larger budget so a token that has already used
// its non-critical allowance (info/warn spam) can't have a genuine CRITICAL
// alert silently dropped behind it.
const MAX_PUSHES_PER_WINDOW = 10;          // per token, non-critical
const MAX_CRITICAL_PUSHES_PER_WINDOW = 20; // per token, critical — separate bucket
const WINDOW_MS = 60 * 60 * 1000;      // rolling 1h
const _budget = new Map();             // token -> number[] (timestamps), non-critical
const _criticalBudget = new Map();     // token -> number[] (timestamps), critical

function _resetBudget() { _budget.clear(); _criticalBudget.clear(); }

// Severity → Expo delivery mapping (interruptionLevel / channelId / sound)
const SEVERITY_DELIVERY = {
  critical: { interruptionLevel: 'time-sensitive', channelId: 'cockpit-critical', sound: 'default' },
  warn:     { interruptionLevel: 'active',         channelId: 'cockpit-default',  sound: 'default' },
  info:     { interruptionLevel: 'passive',        channelId: 'cockpit-info',     sound: null },
};

function _withinBudget(token, isCritical) {
  const bucket = isCritical ? _criticalBudget : _budget;
  const max = isCritical ? MAX_CRITICAL_PUSHES_PER_WINDOW : MAX_PUSHES_PER_WINDOW;
  const now = Date.now();
  const hits = (bucket.get(token) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= max) { bucket.set(token, hits); return false; }
  hits.push(now); bucket.set(token, hits); return true;
}

/** Initialize push module */
function init(database) {
  db = database;
  const accessToken = process.env.EXPO_ACCESS_TOKEN;
  expo = new Expo(accessToken ? { accessToken } : {});
}

/** Register a push token */
function registerToken(token, userId, serverName) {
  if (!Expo.isExpoPushToken(token)) {
    throw new Error("Invalid Expo push token");
  }
  if (!db) throw new Error("Push database not initialized");

  // Upsert: replace if same token exists
  db.prepare(
    `INSERT INTO push_tokens (token, user_id, server_name, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(token) DO UPDATE SET
       user_id = excluded.user_id,
       server_name = excluded.server_name,
       updated_at = datetime('now')`,
  ).run(token, userId, serverName);
}

/** Remove a push token */
function removeToken(token) {
  if (!db) return;
  db.prepare("DELETE FROM push_tokens WHERE token = ?").run(token);
}

/** Send a push notification to all registered tokens */
async function sendPushNotification(title, body, data = {}, opts = {}) {
  if (!expo || !db) return 0;

  const tokens = opts.userId
    ? db.prepare('SELECT token FROM push_tokens WHERE user_id = ?').all(opts.userId)
    : db.prepare("SELECT token FROM push_tokens").all();
  if (tokens.length === 0) return 0;

  const sev = SEVERITY_DELIVERY[opts.severity] || SEVERITY_DELIVERY.warn;
  const isCritical = opts.severity === "critical";

  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .filter((t) => {
      if (_withinBudget(t.token, isCritical)) return true;
      console.warn(`[PUSH] budget drop: token=…${t.token.slice(-6)} severity=${opts.severity || "warn"}`);
      return false;
    })
    .map((t) => ({
      to: t.token,
      title,
      body,
      data,
      sound: sev.sound,
      interruptionLevel: sev.interruptionLevel,
      channelId: sev.channelId,
    }));

  if (messages.length === 0) return 0;

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      // Remove invalid tokens
      for (let i = 0; i < receipts.length; i++) {
        if (receipts[i].status === "error" && receipts[i].details?.error === "DeviceNotRegistered") {
          removeToken(chunk[i].to);
        }
      }
    } catch (err) {
      console.error("[PUSH] Failed to send:", err.message);
    }
  }

  return messages.length;
}

module.exports = {
  init,
  registerToken,
  removeToken,
  sendPushNotification,
  MAX_PUSHES_PER_WINDOW,
  MAX_CRITICAL_PUSHES_PER_WINDOW,
  _resetBudget,
  SEVERITY_DELIVERY,
};
