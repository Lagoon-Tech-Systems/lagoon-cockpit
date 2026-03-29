const { Expo } = require("expo-server-sdk");

let expo = null;
let db = null;

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
async function sendPushNotification(title, body, data = {}) {
  if (!expo || !db) return;

  const tokens = db.prepare("SELECT token FROM push_tokens").all();
  if (tokens.length === 0) return;

  const messages = tokens
    .filter((t) => Expo.isExpoPushToken(t.token))
    .map((t) => ({
      to: t.token,
      sound: "default",
      title,
      body,
      data,
    }));

  if (messages.length === 0) return;

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
}

module.exports = { init, registerToken, removeToken, sendPushNotification };
