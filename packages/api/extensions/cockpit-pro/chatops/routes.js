const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { requireRole } = require("../helpers/auth");

let db = null;
let services = null;

const VALID_PLATFORMS = ["telegram", "slack"];
const VALID_EVENTS = [
  "alert.fired", "alert.resolved",
  "incident.created", "incident.updated", "incident.resolved",
  "uptime.down", "uptime.up",
  "status_page.update",
  "test",
];

// ── Initialization ────────────────────────────────────────
function init(svc) {
  services = svc;
  db = services.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_chatops_channels (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL CHECK(platform IN ('telegram', 'slack')),
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      events TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_pro_chatops_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id TEXT NOT NULL REFERENCES ext_cockpit_pro_chatops_channels(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
      error TEXT,
      sent_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_cp_chatops_chan_platform ON ext_cockpit_pro_chatops_channels(platform);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_chatops_msg_channel ON ext_cockpit_pro_chatops_messages(channel_id);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_chatops_msg_sent ON ext_cockpit_pro_chatops_messages(sent_at);
    CREATE INDEX IF NOT EXISTS idx_ext_cp_chatops_msg_status ON ext_cockpit_pro_chatops_messages(status);
  `);

  // Purge messages older than 30 days on startup
  cleanupOldMessages();
}

// ── Message retention cleanup ─────────────────────────────
const MESSAGE_RETENTION_DAYS = 30;

function cleanupOldMessages() {
  if (!db) return;
  const result = db.prepare(
    "DELETE FROM ext_cockpit_pro_chatops_messages WHERE sent_at < datetime('now', ?)"
  ).run(`-${MESSAGE_RETENTION_DAYS} days`);
  if (result.changes > 0) {
    console.log(`[chatops] Cleaned up ${result.changes} messages older than ${MESSAGE_RETENTION_DAYS} days`);
  }
}

// ── Message formatting ────────────────────────────────────

function escapeMarkdownV2(text) {
  if (!text) return "";
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

function formatMessage(platform, eventType, payload) {
  const p = payload || {};

  if (platform === "telegram") {
    return formatTelegram(eventType, p);
  }
  return formatSlack(eventType, p);
}

function formatTelegram(eventType, p) {
  const lines = [];

  switch (eventType) {
    case "alert.fired":
      lines.push(`*🔴 Alert Fired*`);
      if (p.name) lines.push(`Name: ${escapeMarkdownV2(p.name)}`);
      if (p.severity) lines.push(`Severity: ${escapeMarkdownV2(p.severity)}`);
      if (p.value !== undefined) lines.push(`Value: ${escapeMarkdownV2(String(p.value))}`);
      if (p.threshold !== undefined) lines.push(`Threshold: ${escapeMarkdownV2(String(p.threshold))}`);
      break;
    case "alert.resolved":
      lines.push(`*✅ Alert Resolved*`);
      if (p.name) lines.push(`Name: ${escapeMarkdownV2(p.name)}`);
      break;
    case "incident.created":
      lines.push(`*🚨 Incident Created*`);
      if (p.title) lines.push(`Title: ${escapeMarkdownV2(p.title)}`);
      if (p.severity) lines.push(`Severity: ${escapeMarkdownV2(p.severity)}`);
      if (p.status) lines.push(`Status: ${escapeMarkdownV2(p.status)}`);
      break;
    case "incident.updated":
      lines.push(`*🔄 Incident Updated*`);
      if (p.title) lines.push(`Title: ${escapeMarkdownV2(p.title)}`);
      if (p.status) lines.push(`Status: ${escapeMarkdownV2(p.status)}`);
      if (p.severity) lines.push(`Severity: ${escapeMarkdownV2(p.severity)}`);
      break;
    case "incident.resolved":
      lines.push(`*✅ Incident Resolved*`);
      if (p.title) lines.push(`Title: ${escapeMarkdownV2(p.title)}`);
      break;
    case "uptime.down":
      lines.push(`*⬇️ Monitor Down*`);
      if (p.name) lines.push(`Monitor: ${escapeMarkdownV2(p.name)}`);
      if (p.url) lines.push(`URL: ${escapeMarkdownV2(p.url)}`);
      if (p.error) lines.push(`Error: ${escapeMarkdownV2(p.error)}`);
      break;
    case "uptime.up":
      lines.push(`*⬆️ Monitor Up*`);
      if (p.name) lines.push(`Monitor: ${escapeMarkdownV2(p.name)}`);
      if (p.url) lines.push(`URL: ${escapeMarkdownV2(p.url)}`);
      if (p.responseTime !== undefined) lines.push(`Response: ${escapeMarkdownV2(String(p.responseTime))}ms`);
      break;
    case "status_page.update":
      lines.push(`*📋 Status Page Updated*`);
      if (p.title) lines.push(`${escapeMarkdownV2(p.title)}`);
      if (p.message) lines.push(`${escapeMarkdownV2(p.message)}`);
      break;
    case "test":
      lines.push(`*🧪 Test Message*`);
      lines.push(escapeMarkdownV2("ChatOps test from Lagoon Cockpit"));
      break;
    default:
      lines.push(`*📣 ${escapeMarkdownV2(eventType)}*`);
      lines.push(escapeMarkdownV2(JSON.stringify(p).slice(0, 300)));
  }

  return {
    parse_mode: "MarkdownV2",
    text: lines.join("\n"),
  };
}

function getSlackEmoji(eventType) {
  const map = {
    "alert.fired": ":rotating_light:",
    "alert.resolved": ":white_check_mark:",
    "incident.created": ":fire:",
    "incident.updated": ":arrows_counterclockwise:",
    "incident.resolved": ":white_check_mark:",
    "uptime.down": ":red_circle:",
    "uptime.up": ":large_green_circle:",
    "status_page.update": ":clipboard:",
    "test": ":test_tube:",
  };
  return map[eventType] || ":loudspeaker:";
}

function formatSlack(eventType, p) {
  const emoji = getSlackEmoji(eventType);
  const lines = [];

  switch (eventType) {
    case "alert.fired":
      lines.push(`${emoji} *Alert Fired*`);
      if (p.name) lines.push(`*Name:* ${p.name}`);
      if (p.severity) lines.push(`*Severity:* ${p.severity}`);
      if (p.value !== undefined) lines.push(`*Value:* ${p.value}`);
      if (p.threshold !== undefined) lines.push(`*Threshold:* ${p.threshold}`);
      break;
    case "alert.resolved":
      lines.push(`${emoji} *Alert Resolved*`);
      if (p.name) lines.push(`*Name:* ${p.name}`);
      break;
    case "incident.created":
      lines.push(`${emoji} *Incident Created*`);
      if (p.title) lines.push(`*Title:* ${p.title}`);
      if (p.severity) lines.push(`*Severity:* ${p.severity}`);
      if (p.status) lines.push(`*Status:* ${p.status}`);
      break;
    case "incident.updated":
      lines.push(`${emoji} *Incident Updated*`);
      if (p.title) lines.push(`*Title:* ${p.title}`);
      if (p.status) lines.push(`*Status:* ${p.status}`);
      if (p.severity) lines.push(`*Severity:* ${p.severity}`);
      break;
    case "incident.resolved":
      lines.push(`${emoji} *Incident Resolved*`);
      if (p.title) lines.push(`*Title:* ${p.title}`);
      break;
    case "uptime.down":
      lines.push(`${emoji} *Monitor Down*`);
      if (p.name) lines.push(`*Monitor:* ${p.name}`);
      if (p.url) lines.push(`*URL:* ${p.url}`);
      if (p.error) lines.push(`*Error:* ${p.error}`);
      break;
    case "uptime.up":
      lines.push(`${emoji} *Monitor Up*`);
      if (p.name) lines.push(`*Monitor:* ${p.name}`);
      if (p.url) lines.push(`*URL:* ${p.url}`);
      if (p.responseTime !== undefined) lines.push(`*Response:* ${p.responseTime}ms`);
      break;
    case "status_page.update":
      lines.push(`${emoji} *Status Page Updated*`);
      if (p.title) lines.push(p.title);
      if (p.message) lines.push(p.message);
      break;
    case "test":
      lines.push(`${emoji} *Test Message*`);
      lines.push("ChatOps test from Lagoon Cockpit");
      break;
    default:
      lines.push(`${emoji} *${eventType}*`);
      lines.push(JSON.stringify(p).slice(0, 300));
  }

  const text = lines.join("\n");
  return {
    text,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
    ],
  };
}

// ── Rate limiter (per-channel, in-memory) ─────────────────
const RATE_LIMIT_MAX = 30;        // max messages per channel per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute window
const rateBuckets = new Map();    // channelId -> [timestamp, ...]

function isRateLimited(channelId) {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;

  let timestamps = rateBuckets.get(channelId);
  if (!timestamps) {
    timestamps = [];
    rateBuckets.set(channelId, timestamps);
  }

  // Prune expired entries
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true;
  }

  timestamps.push(now);
  return false;
}

// ── Delivery functions ────────────────────────────────────

async function sendTelegram(config, message) {
  const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chat_id,
      text: message.text,
      parse_mode: message.parse_mode,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
  return res.json();
}

async function sendSlack(config, message) {
  const res = await fetch(config.webhook_url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Slack webhook ${res.status}: ${body}`);
  }
}

async function deliverToChannel(channel, eventType, payload) {
  // Rate-limit: max 30 messages per channel per minute
  if (isRateLimited(channel.id)) {
    db.prepare(
      "INSERT INTO ext_cockpit_pro_chatops_messages (channel_id, event_type, payload, status, error) VALUES (?, ?, ?, 'failed', ?)"
    ).run(channel.id, eventType, JSON.stringify(payload), "Rate limited: exceeded 30 messages/minute for this channel");
    return;
  }

  const config = JSON.parse(channel.config);
  const message = formatMessage(channel.platform, eventType, payload);

  try {
    if (channel.platform === "telegram") {
      await sendTelegram(config, message);
    } else {
      await sendSlack(config, message);
    }

    db.prepare(
      "INSERT INTO ext_cockpit_pro_chatops_messages (channel_id, event_type, payload, status) VALUES (?, ?, ?, 'sent')"
    ).run(channel.id, eventType, JSON.stringify(payload));
  } catch (err) {
    db.prepare(
      "INSERT INTO ext_cockpit_pro_chatops_messages (channel_id, event_type, payload, status, error) VALUES (?, ?, ?, 'failed', ?)"
    ).run(channel.id, eventType, JSON.stringify(payload), err.message);
  }
}

// ── Validation helpers ────────────────────────────────────

function validatePlatform(platform) {
  if (!platform || !VALID_PLATFORMS.includes(platform)) {
    return `platform must be one of: ${VALID_PLATFORMS.join(", ")}`;
  }
  return null;
}

function validateConfig(platform, config) {
  if (!config || typeof config !== "object") {
    return "config is required and must be an object";
  }
  if (platform === "telegram") {
    if (!config.bot_token || !config.chat_id) {
      return "Telegram config requires bot_token and chat_id";
    }
  } else if (platform === "slack") {
    if (!config.webhook_url) {
      return "Slack config requires webhook_url";
    }
  }
  return null;
}

function validateEvents(events) {
  if (events !== undefined) {
    if (!Array.isArray(events)) return "events must be an array";
    for (const e of events) {
      if (!VALID_EVENTS.includes(e)) {
        return `Invalid event type: ${e}. Valid types: ${VALID_EVENTS.join(", ")}`;
      }
    }
  }
  return null;
}

// ── Config redaction ──────────────────────────────────────

function redactConfig(config, platform) {
  if (!config || typeof config !== "object") return config;
  const redacted = { ...config };
  if (platform === "telegram") {
    if (redacted.bot_token) {
      const last4 = String(redacted.bot_token).slice(-4);
      redacted.bot_token = `***${last4}`;
    }
  } else if (platform === "slack") {
    if (redacted.webhook_url) {
      redacted.webhook_url = "https://hooks.slack.com/***";
    }
  }
  return redacted;
}

// ── Routes: Channels CRUD ─────────────────────────────────

// List all channels
router.get("/channels", (req, res) => {
  const channels = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels ORDER BY created_at DESC"
  ).all();

  res.json({
    channels: channels.map((c) => ({
      ...c,
      config: redactConfig(JSON.parse(c.config), c.platform),
      events: JSON.parse(c.events),
      enabled: !!c.enabled,
    })),
  });
});

// Create channel
router.post("/channels", requireRole("admin", "operator"), (req, res) => {
  const { platform, name, config, events, enabled } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name is required" });
  }

  let err;
  if ((err = validatePlatform(platform))) return res.status(400).json({ error: err });
  if ((err = validateConfig(platform, config))) return res.status(400).json({ error: err });
  if ((err = validateEvents(events))) return res.status(400).json({ error: err });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO ext_cockpit_pro_chatops_channels (id, platform, name, config, events, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    id,
    platform,
    name.trim(),
    JSON.stringify(config),
    JSON.stringify(events || []),
    enabled === false ? 0 : 1,
    now,
    now
  );

  const userId = req.user?.id || "system";
  if (services?.auditLog) {
    services.auditLog(userId, "chatops.channel.create", id, `${platform}: ${name}`);
  }

  // H6: Redact sensitive fields (bot_token, webhook_url) from response
  res.status(201).json({
    id,
    platform,
    name: name.trim(),
    config: redactConfig(config, platform),
    events: events || [],
    enabled: enabled !== false,
  });
});

// Get single channel with recent messages
router.get("/channels/:id", (req, res) => {
  const channel = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels WHERE id = ?"
  ).get(req.params.id);

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const messages = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_messages WHERE channel_id = ? ORDER BY sent_at DESC LIMIT 50"
  ).all(req.params.id);

  res.json({
    ...channel,
    config: redactConfig(JSON.parse(channel.config), channel.platform),
    events: JSON.parse(channel.events),
    enabled: !!channel.enabled,
    messages: messages.map((m) => ({
      ...m,
      payload: JSON.parse(m.payload || "null"),
    })),
  });
});

// Update channel
router.put("/channels/:id", requireRole("admin", "operator"), (req, res) => {
  const channel = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels WHERE id = ?"
  ).get(req.params.id);

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const { platform, name, config, events, enabled } = req.body;
  const updatedPlatform = platform || channel.platform;

  let err;
  if (platform && (err = validatePlatform(platform))) return res.status(400).json({ error: err });
  if (config && (err = validateConfig(updatedPlatform, config))) return res.status(400).json({ error: err });
  if ((err = validateEvents(events))) return res.status(400).json({ error: err });

  const now = new Date().toISOString();
  const newName = name !== undefined ? name.trim() : channel.name;
  const newConfig = config ? JSON.stringify(config) : channel.config;
  const newEvents = events !== undefined ? JSON.stringify(events) : channel.events;
  const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : channel.enabled;
  const newPlatform = platform || channel.platform;

  db.prepare(
    "UPDATE ext_cockpit_pro_chatops_channels SET platform = ?, name = ?, config = ?, events = ?, enabled = ?, updated_at = ? WHERE id = ?"
  ).run(newPlatform, newName, newConfig, newEvents, newEnabled, now, req.params.id);

  const userId = req.user?.id || "system";
  if (services?.auditLog) {
    services.auditLog(userId, "chatops.channel.update", req.params.id, `Updated: ${newName}`);
  }

  res.json({
    id: req.params.id,
    platform: newPlatform,
    name: newName,
    config: redactConfig(config || JSON.parse(channel.config), newPlatform),
    events: events !== undefined ? events : JSON.parse(channel.events),
    enabled: !!newEnabled,
  });
});

// Delete channel (cascade via FK)
router.delete("/channels/:id", requireRole("admin", "operator"), (req, res) => {
  const channel = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels WHERE id = ?"
  ).get(req.params.id);

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  // Manually delete messages first in case FK cascade is not enforced
  db.transaction(() => {
    db.prepare("DELETE FROM ext_cockpit_pro_chatops_messages WHERE channel_id = ?").run(req.params.id);
    db.prepare("DELETE FROM ext_cockpit_pro_chatops_channels WHERE id = ?").run(req.params.id);
  })();

  const userId = req.user?.id || "system";
  if (services?.auditLog) {
    services.auditLog(userId, "chatops.channel.delete", req.params.id, `Deleted: ${channel.name}`);
  }

  res.json({ ok: true });
});

// ── Routes: Test ──────────────────────────────────────────

router.post("/channels/:id/test", requireRole("admin", "operator"), async (req, res) => {
  const channel = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels WHERE id = ?"
  ).get(req.params.id);

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const config = JSON.parse(channel.config);
  const message = formatMessage(channel.platform, "test", {});

  try {
    if (channel.platform === "telegram") {
      await sendTelegram(config, message);
    } else {
      await sendSlack(config, message);
    }

    db.prepare(
      "INSERT INTO ext_cockpit_pro_chatops_messages (channel_id, event_type, payload, status) VALUES (?, ?, ?, 'sent')"
    ).run(channel.id, "test", JSON.stringify({}));

    res.json({ ok: true, message: "Test message sent" });
  } catch (err) {
    db.prepare(
      "INSERT INTO ext_cockpit_pro_chatops_messages (channel_id, event_type, payload, status, error) VALUES (?, ?, ?, 'failed', ?)"
    ).run(channel.id, "test", JSON.stringify({}), err.message);

    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Routes: Message log ───────────────────────────────────

router.get("/channels/:id/messages", (req, res) => {
  const channel = db.prepare(
    "SELECT id FROM ext_cockpit_pro_chatops_channels WHERE id = ?"
  ).get(req.params.id);

  if (!channel) return res.status(404).json({ error: "Channel not found" });

  const limit = Math.min(parseInt(req.query.limit || "50", 10), 500);
  const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);

  const messages = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_messages WHERE channel_id = ? ORDER BY sent_at DESC LIMIT ? OFFSET ?"
  ).all(req.params.id, limit, offset);

  const total = db.prepare(
    "SELECT COUNT(*) as count FROM ext_cockpit_pro_chatops_messages WHERE channel_id = ?"
  ).get(req.params.id);

  res.json({
    messages: messages.map((m) => ({
      ...m,
      payload: JSON.parse(m.payload || "null"),
    })),
    total: total.count,
    limit,
    offset,
  });
});

// ── Routes: Dispatch ──────────────────────────────────────

router.post("/dispatch", requireRole("admin", "operator"), (req, res) => {
  const { event_type, payload } = req.body;

  if (!event_type) {
    return res.status(400).json({ error: "event_type is required" });
  }
  if (!VALID_EVENTS.includes(event_type)) {
    return res.status(400).json({ error: `Invalid event_type: ${event_type}. Valid: ${VALID_EVENTS.join(", ")}` });
  }

  // Find all enabled channels subscribed to this event type
  const channels = db.prepare(
    "SELECT * FROM ext_cockpit_pro_chatops_channels WHERE enabled = 1"
  ).all();

  const targets = channels.filter((c) => {
    const events = JSON.parse(c.events);
    return events.includes(event_type);
  });

  if (targets.length === 0) {
    return res.json({ ok: true, dispatched: 0 });
  }

  // Fire and forget — deliver asynchronously, respond immediately
  const dispatched = targets.length;
  for (const channel of targets) {
    deliverToChannel(channel, event_type, payload || {}).catch(() => {});
  }

  res.json({ ok: true, dispatched });
});

module.exports = { init, router };
