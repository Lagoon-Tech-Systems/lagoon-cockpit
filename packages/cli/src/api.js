const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_PATH = path.join(os.homedir(), ".cockpit.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { servers: [], active: null };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function getActiveServer() {
  const config = loadConfig();
  if (!config.active || !config.servers.length) return null;
  return config.servers.find((s) => s.name === config.active) || null;
}

/** Make an authenticated API request */
function request(method, apiPath, body = null) {
  const server = getActiveServer();
  if (!server) throw new Error("No active server. Run: cockpit connect <url> <api-key>");

  return new Promise((resolve, reject) => {
    const url = new URL(server.url + apiPath);
    const client = url.protocol === "https:" ? https : http;
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${server.token}`,
      },
      timeout: 30000,
      rejectUnauthorized: false,
    };

    const req = client.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const data = JSON.parse(raw);
          if (res.statusCode === 401) {
            // Try to refresh token
            return refreshAndRetry(method, apiPath, body).then(resolve).catch(reject);
          }
          if (res.statusCode >= 400) {
            reject(new Error(data.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        } catch {
          reject(new Error(`Invalid response: ${raw.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function authenticate(url, apiKey) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url + "/auth/token");
    const client = parsed.protocol === "https:" ? https : http;
    const body = JSON.stringify({ apiKey });
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      timeout: 10000,
      rejectUnauthorized: false,
    };

    const req = client.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          if (res.statusCode !== 200) reject(new Error(data.error || "Auth failed"));
          else resolve(data);
        } catch (e) {
          reject(new Error("Invalid auth response"));
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function refreshAndRetry(method, apiPath, body) {
  const server = getActiveServer();
  if (!server || !server.refreshToken) throw new Error("Session expired. Run: cockpit connect");

  const parsed = new URL(server.url + "/auth/refresh");
  const client = parsed.protocol === "https:" ? https : http;
  const reqBody = JSON.stringify({ refreshToken: server.refreshToken });

  const data = await new Promise((resolve, reject) => {
    const req = client.request({
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(reqBody) },
      timeout: 10000, rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { reject(new Error("Refresh failed")); }
      });
    });
    req.on("error", reject);
    req.write(reqBody);
    req.end();
  });

  // Update stored tokens
  const config = loadConfig();
  const srv = config.servers.find((s) => s.name === server.name);
  if (srv) {
    srv.token = data.accessToken;
    srv.refreshToken = data.refreshToken;
    saveConfig(config);
  }

  return request(method, apiPath, body);
}

module.exports = { loadConfig, saveConfig, getActiveServer, request, authenticate };
