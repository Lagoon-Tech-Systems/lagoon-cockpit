const { Expo } = require("expo-server-sdk");

let expo = null;
let db = null;

// Per-token rolling-window push budget
const MAX_PUSHES_PER_WINDOW = 10;      // per token
const WINDOW_MS = 60 * 60 * 1000;      // rolling 1h
const _budget = new Map();             // token -> number[] (timestamps)

function _resetBudget() { _budget.clear(); }

function _withinBudget(token) {
  const now = Date.now();
  const hits = (_budget.get(token) || []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PUSHES_PER_WINDOW) { _budget.set(token, hits); return false; }
  hits.push(now); _budget.set(token, hits); return true;
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

  const tokens = db.prepare("SELECT token FROM push_tokens").all();
  if (tokens.length === 0) return 0;

  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .filter((t) => _withinBudget(t.token))
    .map((t) => ({
      to: t.token,
      sound: "default",
      title,
      body,
      data,
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

module.exports = { init, registerToken, removeToken, sendPushNotification, MAX_PUSHES_PER_WINDOW, _resetBudget };
