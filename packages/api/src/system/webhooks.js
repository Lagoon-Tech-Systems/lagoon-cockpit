/**
 * Webhook integrations.
 * Fire HTTP webhooks on events (container down, alerts, etc.)
 */
const https = require("https");
const http = require("http");

let db = null;

function init(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT 'container.down',
      headers TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now'))
    );
  `);
}

// SSRF protection: block internal/private IPs
const BLOCKED_HOSTS = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.|localhost|::1|\[::1\])/i;

function validateWebhookUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("URL must be http or https");
  if (BLOCKED_HOSTS.test(parsed.hostname)) throw new Error("URL cannot target private/internal addresses");
  return parsed;
}

/** Create a webhook */
function createWebhook(name, url, events = "container.down", headers = {}) {
  if (!db) throw new Error("Webhooks not initialized");
  validateWebhookUrl(url);
  const count = db.prepare("SELECT COUNT(*) as c FROM webhooks").get().c;
  if (count >= 50) throw new Error("Maximum 50 webhooks allowed");
  const result = db
    .prepare("INSERT INTO webhooks (name, url, events, headers) VALUES (?, ?, ?, ?)")
    .run(name, url, events, JSON.stringify(headers));
  return { id: result.lastInsertRowid, name, url, events };
}

/** List all webhooks */
function listWebhooks() {
  if (!db) return [];
  return db
    .prepare("SELECT * FROM webhooks ORDER BY created_at DESC")
    .all()
    .map((w) => ({
      ...w,
      headers: JSON.parse(w.headers || "{}"),
      events: w.events.split(",").map((e) => e.trim()),
    }));
}

/** Delete a webhook */
function deleteWebhook(id) {
  if (!db) return;
  db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
}

/** Toggle a webhook */
function toggleWebhook(id, enabled) {
  if (!db) return;
  db.prepare("UPDATE webhooks SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

/** Fire webhooks for a given event */
async function fireWebhooks(event, payload) {
  if (!db) return;
  const hooks = db.prepare("SELECT * FROM webhooks WHERE enabled = 1").all();

  for (const hook of hooks) {
    const events = hook.events.split(",").map((e) => e.trim());
    if (!events.includes(event) && !events.includes("*")) continue;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });
    const headers = { "Content-Type": "application/json", ...JSON.parse(hook.headers || "{}") };

    try {
      const client = hook.url.startsWith("https") ? https : http;
      const url = new URL(hook.url);

      await new Promise((resolve, reject) => {
        const req = client.request(
          {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: "POST",
            headers,
            timeout: 10000,
          },
          (res) => {
            res.resume();
            res.on("end", resolve);
          },
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("timeout"));
        });
        req.write(body);
        req.end();
      });
    } catch (err) {
      console.error(`[WEBHOOK] Failed to fire ${hook.name}: ${err.message}`);
    }
  }
}

module.exports = { init, createWebhook, listWebhooks, deleteWebhook, toggleWebhook, fireWebhooks };
