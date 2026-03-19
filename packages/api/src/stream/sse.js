/**
 * Server-Sent Events broadcaster.
 * Maintains a set of connected clients and broadcasts events to all.
 */

const clients = new Set();
const MAX_SSE_CLIENTS = parseInt(process.env.MAX_SSE_CLIENTS || "50", 10);

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
    res.write(":\n\n");
  }, 30000);

  res.on("close", () => {
    clearInterval(keepalive);
    clients.delete(res);
  });
}

/** Broadcast an event to all connected clients */
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

/** Get connected client count */
function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getClientCount };
