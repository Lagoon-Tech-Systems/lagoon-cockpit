/**
 * Integration tests — auth flow, health check, container operations.
 *
 * These tests spin up the Express app with a temporary SQLite DB and
 * mock the Docker socket so they run in CI without Docker.
 */
const request = require("supertest");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Test environment setup ───────────────────────────────
const TEST_API_KEY = "test-api-key-" + Date.now();
const TEST_JWT_SECRET = "test-jwt-secret-" + Date.now();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-test-"));

process.env.API_KEY = TEST_API_KEY;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.AUTH_MODE = "key";
process.env.DATA_DIR = tmpDir;
process.env.SERVER_NAME = "Test Server";
process.env.PORT = "0"; // random port

// Mock Docker client before requiring app modules
jest.mock("../src/docker/client", () => ({
  dockerAPI: jest.fn(async (method, apiPath) => {
    if (apiPath === "/_ping") return "OK";
    if (apiPath === "/containers/json") {
      return [
        {
          Id: "abc123def456",
          Names: ["/test-container"],
          Image: "nginx:latest",
          State: "running",
          Status: "Up 2 hours",
          Labels: {},
        },
      ];
    }
    if (apiPath === "/info") {
      return { Containers: 2, ContainersRunning: 1, ContainersStopped: 1, Images: 5 };
    }
    if (apiPath === "/system/df") {
      return { Containers: [], Images: [], Volumes: [], BuildCache: [] };
    }
    if (apiPath.match(/\/containers\/[a-f0-9]+\/json/)) {
      return {
        Id: "abc123def456",
        Name: "/test-container",
        State: { Status: "running", Running: true, Health: { Status: "healthy" } },
        Config: { Image: "nginx:latest", Labels: {} },
        HostConfig: {},
      };
    }
    if (apiPath.match(/\/containers\/[a-f0-9]+\/stats/)) {
      return {
        cpu_stats: { cpu_usage: { total_usage: 1000 }, system_cpu_usage: 100000, online_cpus: 2 },
        precpu_stats: { cpu_usage: { total_usage: 900 }, system_cpu_usage: 99000 },
        memory_stats: { usage: 50000000, limit: 256000000 },
        networks: {},
      };
    }
    return null;
  }),
}));

// ── Build a minimal Express app for testing ──────────────
const express = require("express");
const db = require("../src/db/sqlite");
const { initJwt } = require("../src/auth/jwt");

const database = db.init();
initJwt(database);

const app = express();
app.use(express.json());

// Mount routes
const authRoutes = require("../src/routes/auth");
const systemRoutes = require("../src/routes/system");
const containerRoutes = require("../src/routes/containers");

app.get("/health", async (_req, res) => {
  const checks = { api: "ok", db: "ok", docker: "ok" };
  let status = 200;
  try { database.prepare("SELECT 1").get(); } catch { checks.db = "error"; status = 503; }
  try { await require("../src/docker/client").dockerAPI("GET", "/_ping", null, { timeout: 3000 }); } catch { checks.docker = "error"; status = 503; }
  res.status(status).json({ status: status === 200 ? "ok" : "degraded", checks, uptime: process.uptime(), timestamp: new Date().toISOString() });
});

const manageRoutes = require("../src/routes/manage");

app.use(authRoutes);
app.use(systemRoutes);
app.use(containerRoutes);
app.use(manageRoutes);

// ── Helpers ──────────────────────────────────────────────
let accessToken = null;
let refreshToken = null;

afterAll(() => {
  // Stop background intervals to prevent open handle warnings
  const { stopCleanup } = require("../src/auth/jwt");
  const { stopLockoutCleanup } = require("../src/auth/middleware");
  stopCleanup();
  stopLockoutCleanup();
  try { database.close(); } catch { /* ignore */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Health Check Tests ───────────────────────────────────
describe("GET /health (deep health check)", () => {
  test("returns ok with all checks passing", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.api).toBe("ok");
    expect(res.body.checks.db).toBe("ok");
    expect(res.body.checks.docker).toBe("ok");
    expect(res.body.uptime).toBeGreaterThan(0);
    expect(res.body.timestamp).toBeDefined();
  });

  test("returns degraded when Docker is down", async () => {
    const { dockerAPI } = require("../src/docker/client");
    dockerAPI.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.checks.docker).toBe("error");
    expect(res.body.checks.db).toBe("ok");
  });
});

// ── Auth Flow Tests ─────────��────────────────────────────
describe("Auth flow (API key mode)", () => {
  test("POST /auth/token rejects missing apiKey", async () => {
    const res = await request(app).post("/auth/token").send({});
    expect(res.status).toBe(400);
  });

  test("POST /auth/token rejects wrong API key", async () => {
    const res = await request(app).post("/auth/token").send({ apiKey: "wrong-key" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });

  test("POST /auth/token succeeds with correct key", async () => {
    const res = await request(app).post("/auth/token").send({ apiKey: TEST_API_KEY });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    expect(res.body.role).toBe("admin");
    expect(res.body.serverName).toBe("Test Server");

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  test("POST /auth/login is rejected in key mode", async () => {
    const res = await request(app).post("/auth/login").send({ email: "a@b.c", password: "pw" });
    expect(res.status).toBe(400);
  });

  test("authenticated route works with valid token", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("lagoon-cockpit-api");
  });

  test("authenticated route rejects missing token", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(401);
  });

  test("authenticated route rejects garbage token", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Authorization", "Bearer garbage.token.here");
    expect(res.status).toBe(401);
  });

  test("POST /auth/refresh rotates tokens", async () => {
    const res = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    // Old refresh token should no longer work (one-time use)
    expect(res.body.refreshToken).not.toBe(refreshToken);

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  test("reused refresh token is rejected (rotation enforcement)", async () => {
    // Use the current valid one first
    const first = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken });
    expect(first.status).toBe(200);

    // Try to reuse same token — should fail
    const second = await request(app)
      .post("/auth/refresh")
      .send({ refreshToken });
    expect(second.status).toBe(401);

    // Update tokens for subsequent tests
    accessToken = first.body.accessToken;
    refreshToken = first.body.refreshToken;
  });
});

// ── Container Operation Tests ────────────────────────────
describe("Container operations", () => {
  test("GET /api/containers lists containers", async () => {
    const res = await request(app)
      .get("/api/containers")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.containers).toBeDefined();
    expect(Array.isArray(res.body.containers)).toBe(true);
  });

  test("GET /api/overview returns system overview", async () => {
    const res = await request(app)
      .get("/api/overview")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.containers).toBeDefined();
    expect(res.body.system).toBeDefined();
    expect(res.body.serverName).toBe("Test Server");
  });

  test("GET /api/system/metrics returns metrics", async () => {
    const res = await request(app)
      .get("/api/system/metrics")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
  });

  test("GET /api/containers requires auth", async () => {
    const res = await request(app).get("/api/containers");
    expect(res.status).toBe(401);
  });
});

// ── Audit Log Filtering Tests ───────────────────────────
describe("GET /api/audit filtering", () => {
  beforeAll(() => {
    const { auditLog } = require("../src/db/sqlite");
    auditLog("user-a", "stack.start", "stack-1", "started");
    auditLog("user-a", "stack.stop", "stack-2", "stopped");
    auditLog("user-b", "user.login", null, "logged in");
    auditLog("user-b", "stack.start", "stack-3", "started");
  });

  test("returns all logs without filters", async () => {
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(4);
  });

  test("filters by action", async () => {
    const res = await request(app)
      .get("/api/audit?action=stack.start")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.every((l) => l.action === "stack.start")).toBe(true);
    expect(res.body.total).toBe(2);
  });

  test("filters by user", async () => {
    const res = await request(app)
      .get("/api/audit?user=user-a")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.every((l) => l.user_id === "user-a")).toBe(true);
    expect(res.body.total).toBe(2);
  });

  test("filters by both action and user", async () => {
    const res = await request(app)
      .get("/api/audit?action=stack.start&user=user-b")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.logs[0].user_id).toBe("user-b");
    expect(res.body.logs[0].action).toBe("stack.start");
  });

  test("returns empty when filter matches nothing", async () => {
    const res = await request(app)
      .get("/api/audit?action=nonexistent.action")
      .set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.logs).toEqual([]);
  });
});

// ── Rate Limiting Tests ──────────────────────────────────
describe("Auth rate limiting", () => {
  test("locks out after 5 failed attempts", async () => {
    // Use a unique IP to not interfere with other tests
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/auth/token")
        .set("X-Forwarded-For", "10.99.99.99")
        .send({ apiKey: "wrong-key" });
    }

    const res = await request(app)
      .post("/auth/token")
      .set("X-Forwarded-For", "10.99.99.99")
      .send({ apiKey: TEST_API_KEY });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
  });
});
