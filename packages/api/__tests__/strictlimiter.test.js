/**
 * Integration tests — strictLimiter wired onto destructive container/stack
 * routes (board gate G-P2).
 *
 * Mirrors the app-bootstrap pattern in api.test.js / alert-event-read.test.js
 * (temp SQLite DB, mocked Docker socket, real auth flow), trimmed to only the
 * auth + container routes needed here. Kept in its own file so hammering a
 * route to its rate-limit ceiling doesn't pollute other suites' shared app
 * instance/timing.
 *
 * strictLimiter (src/security/rate-limiter.js:138-142) is a sliding-window
 * limiter: windowMs 60_000, max 10, keyed by req.ip (default keyFn at
 * rate-limiter.js:102). There is no exported "STRICT_LIMIT" constant, so the
 * max is hardcoded below with a citation to that line.
 *
 * express-rate-limit-style gotcha (per task brief): the limiter keys by IP,
 * and supertest requests all share the same socket IP by default. This file
 * sets `app.set("trust proxy", 1)` (matching src/index.js:271 in the real
 * app) and gives each test block its own X-Forwarded-For IP so the two
 * describe blocks below can't bleed rate-limit state into each other.
 */
const request = require("supertest");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ── Test environment setup ───────────────────────────────
const TEST_API_KEY = "test-api-key-" + Date.now();
const TEST_JWT_SECRET = "test-jwt-secret-" + Date.now();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-test-strictlimiter-"));

process.env.API_KEY = TEST_API_KEY;
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.AUTH_MODE = "key";
process.env.DATA_DIR = tmpDir;
process.env.SERVER_NAME = "Test Server";
process.env.PORT = "0";

// Mock Docker client before requiring app modules — the destructive route
// under test (POST /:id/restart) only needs a cheap resolved dockerAPI call.
jest.mock("../src/docker/client", () => ({
  dockerAPI: jest.fn(async (_method, apiPath) => {
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
// Match src/index.js:271 so X-Forwarded-For per-test-block isolation works.
app.set("trust proxy", 1);

const authRoutes = require("../src/routes/auth");
const containerRoutes = require("../src/routes/containers");

app.use(authRoutes);
app.use(containerRoutes);

afterAll(() => {
  const { stopCleanup } = require("../src/auth/jwt");
  const { stopLockoutCleanup } = require("../src/auth/middleware");
  stopCleanup();
  stopLockoutCleanup();
  try {
    database.close();
  } catch {
    /* ignore */
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let accessToken = null;

beforeAll(async () => {
  const res = await request(app).post("/auth/token").send({ apiKey: TEST_API_KEY });
  expect(res.status).toBe(200);
  expect(res.body.role).toBe("admin");
  accessToken = res.body.accessToken;
});

// strictLimiter: windowMs 60_000, max 10 — src/security/rate-limiter.js:138-142.
const STRICT_LIMIT = 10;
const CONTAINER_ID = "abc123def456";

describe("strictLimiter throttles destructive container routes (G-P2)", () => {
  test("POST /api/containers/:id/restart returns 429 within limit+1 requests", async () => {
    let sawStatus = [];
    let got429 = false;

    for (let i = 0; i < STRICT_LIMIT + 1; i++) {
      const res = await request(app)
        .post(`/api/containers/${CONTAINER_ID}/restart`)
        .set("Authorization", `Bearer ${accessToken}`)
        .set("X-Forwarded-For", "10.60.1.1");
      sawStatus.push(res.status);
      if (res.status === 429) {
        got429 = true;
        expect(res.body.error).toMatch(/too many/i);
        break;
      }
    }

    expect(got429).toBe(true);
    expect(sawStatus.length).toBeLessThanOrEqual(STRICT_LIMIT + 1);
  });
});

describe("read-only routes are not throttled by strictLimiter", () => {
  test("GET /api/containers never 429s under the same hammering count", async () => {
    for (let i = 0; i < STRICT_LIMIT + 1; i++) {
      const res = await request(app)
        .get("/api/containers")
        .set("Authorization", `Bearer ${accessToken}`)
        .set("X-Forwarded-For", "10.60.1.2");
      expect(res.status).not.toBe(429);
      expect(res.status).toBe(200);
    }
  });
});
