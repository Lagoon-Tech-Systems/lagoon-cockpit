/**
 * Server-Sent Events broadcaster with pluggable pub/sub transport.
 * Default: in-process broadcast. Drop-in Redis pub/sub for multi-instance scaling.
 */

const clients = new Set();
const MAX_SSE_CLIENTS = parseInt(process.env.MAX_SSE_CLIENTS || "50", 10);
const SSE_CHANNEL = "cockpit:sse";

/** Add a new SSE client */
function addClient(res) {
  if (clients.size >= MAX_SSE_CLIENTS) {
    res.status(503).json({ error: "Too many SSE connections" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Disable Nginx buffering
  });
  res.write(":\n\n"); // Initial comment to establish connection

  clients.add(res);

  // Send keepalive every 30s to prevent timeout
  const keepalive = setInterval(() => {
    try {
      if (!res.destroyed) res.write(":\n\n");
      else {
        clearInterval(keepalive);
        clients.delete(res);
      }
    } catch {
      clearInterval(keepalive);
      clients.delete(res);
    }
  }, 30000);

  res.on("close", () => {
    clearInterval(keepalive);
    clients.delete(res);
  });
}

/** Write an SSE payload to all local clients */
function deliverToClients(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      if (!client.destroyed) client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

// ── Pub/Sub transport ────────────────────────────────────────

let pubClient = null;

/**
 * Enable Redis pub/sub for multi-instance SSE broadcasting.
 *
 * Usage:
 *   const Redis = require("ioredis");
 *   const pub = new Redis(process.env.REDIS_URL);
 *   const sub = new Redis(process.env.REDIS_URL);
 *   enableRedisPubSub(pub, sub);
 *
 * @param {object} pub - Redis client for publishing
 * @param {object} sub - Redis client for subscribing (must be dedicated)
 */
function enableRedisPubSub(pub, sub) {
  pubClient = pub;
  sub.subscribe(SSE_CHANNEL);
  sub.on("message", (channel, message) => {
    if (channel !== SSE_CHANNEL) return;
    try {
      const { event, data } = JSON.parse(message);
      deliverToClients(event, data);
    } catch {
      /* ignore malformed messages */
    }
  });
  console.log("[SSE] Redis pub/sub enabled for multi-instance broadcasting");
}

/**
 * Broadcast an event to all connected clients.
 * If Redis pub/sub is enabled, publishes to Redis (all instances receive it).
 * Otherwise, delivers directly to local clients.
 */
function broadcast(event, data) {
  if (pubClient) {
    pubClient.publish(SSE_CHANNEL, JSON.stringify({ event, data })).catch((err) => {
      console.error("[SSE] Redis publish error:", err.message);
      // Fallback to local delivery
      deliverToClients(event, data);
    });
  } else {
    deliverToClients(event, data);
  }
}

/** Get connected client count */
function getClientCount() {
  return clients.size;
}

/** Close all connected SSE clients (used during graceful shutdown) */
function closeAllClients() {
  for (const client of clients) {
    client.end();
  }
  clients.clear();
}

module.exports = { addClient, broadcast, getClientCount, closeAllClients, enableRedisPubSub };
