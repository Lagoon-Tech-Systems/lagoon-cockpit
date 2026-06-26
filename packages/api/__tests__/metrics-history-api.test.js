/**
 * Tests for GET /api/metrics/history: range/from-to/legacy precedence,
 * adversarial-input guards, edition clamp on every path, tier auto-select,
 * MAX_POINTS auto-promote, and exact legacy-shape backward compatibility.
 */
const {
  RANGE_DAYS,
  MAX_POINTS,
  parseRequest,
  clampDays,
  selectTier,
} = require("../src/routes/history-query");

describe("history-query: parseRequest precedence + adversarial guards", () => {
  test("range wins over from/to and hours", () => {
    const r = parseRequest({ range: "7d", from: "1", to: "2", hours: "168" });
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("range");
    expect(r.requestedDays).toBe(7);
  });

  test("unknown range value is rejected with 400", () => {
    const r = parseRequest({ range: "13d" });
    expect(r.error.status).toBe(400);
    expect(r.error.body.error).toMatch(/range/i);
  });

  test("array range param is rejected with 400", () => {
    const r = parseRequest({ range: ["7d", "1y"] });
    expect(r.error.status).toBe(400);
    expect(r.error.body.error).toMatch(/single string/i);
  });

  test("from/to used when no range; requestedDays derived from span", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = parseRequest({ from: String(now - 2 * 86400), to: String(now) });
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("fromto");
    expect(r.requestedDays).toBe(2);
    expect(r.toEpoch).toBeGreaterThan(r.fromEpoch);
  });

  test("from without to is rejected with 400", () => {
    const r = parseRequest({ from: "1750000000" });
    expect(r.error.status).toBe(400);
  });

  test("from >= to is rejected with 400", () => {
    const r = parseRequest({ from: "200", to: "100" });
    expect(r.error.status).toBe(400);
  });

  test("NaN from is rejected with 400", () => {
    const r = parseRequest({ from: "abc", to: "200" });
    expect(r.error.status).toBe(400);
  });

  test("negative from is rejected with 400", () => {
    const r = parseRequest({ from: "-5", to: "200" });
    expect(r.error.status).toBe(400);
  });

  test("overflow from (1e30) is rejected with 400", () => {
    const r = parseRequest({ from: "1e30", to: "2e30" });
    expect(r.error.status).toBe(400);
  });

  test("legacy hours path: default 24 when nothing supplied", () => {
    const r = parseRequest({});
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("legacy");
    expect(r.hours).toBe(24);
    expect(r.requestedDays).toBeCloseTo(1, 5);
  });

  test("legacy hours=8760 parses and requestedDays reflects 365 (within [1,730])", () => {
    const r = parseRequest({ hours: "8760" });
    expect(r.mode).toBe("legacy");
    expect(r.hours).toBe(8760);
    expect(r.requestedDays).toBeCloseTo(365, 0);
  });

  test("legacy hours=1e9 is coerced: requestedDays clamped to 730", () => {
    const r = parseRequest({ hours: "1e9" });
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("legacy");
    expect(r.requestedDays).toBe(730);
  });

  test("legacy hours=99999999999 is coerced: requestedDays clamped to 730", () => {
    const r = parseRequest({ hours: "99999999999" });
    expect(r.error).toBeUndefined();
    expect(r.mode).toBe("legacy");
    expect(r.requestedDays).toBe(730);
  });

  test("range path includes fromEpoch: null and toEpoch: null", () => {
    const r = parseRequest({ range: "7d" });
    expect(r.error).toBeUndefined();
    expect(r.fromEpoch).toBeNull();
    expect(r.toEpoch).toBeNull();
  });

  test("legacy path (no args) includes fromEpoch: null and toEpoch: null", () => {
    const r = parseRequest({});
    expect(r.error).toBeUndefined();
    expect(r.fromEpoch).toBeNull();
    expect(r.toEpoch).toBeNull();
  });

  test("legacy path (hours supplied) includes fromEpoch: null and toEpoch: null", () => {
    const r = parseRequest({ hours: "48" });
    expect(r.error).toBeUndefined();
    expect(r.fromEpoch).toBeNull();
    expect(r.toEpoch).toBeNull();
  });

  test("array from param is rejected with 400", () => {
    const r = parseRequest({ from: ["100", "200"], to: "300" });
    expect(r.error.status).toBe(400);
    expect(r.error.body.error).toMatch(/single string/i);
  });

  test("array to param is rejected with 400", () => {
    const r = parseRequest({ from: "100", to: ["200", "300"] });
    expect(r.error.status).toBe(400);
    expect(r.error.body.error).toMatch(/single string/i);
  });

  test("array hours param is rejected with 400", () => {
    const r = parseRequest({ hours: ["24", "48"] });
    expect(r.error.status).toBe(400);
  });

  test("hours=NaN is rejected with 400", () => {
    const r = parseRequest({ hours: "notanumber" });
    expect(r.error.status).toBe(400);
  });

  test("hours=-3 is rejected with 400", () => {
    const r = parseRequest({ hours: "-3" });
    expect(r.error.status).toBe(400);
  });
});

describe("history-query: clampDays by edition", () => {
  const ce = { name: "ce", limits: { metricsRetentionDays: 30 } };
  const pro = { name: "pro", limits: { metricsRetentionDays: 365 } };

  test("CE clamps 365 -> 30 and flags clamped", () => {
    const c = clampDays(365, ce);
    expect(c.retentionDays).toBe(30);
    expect(c.servedDays).toBe(30);
    expect(c.clamped).toBe(true);
  });

  test("CE within limit (7) is not clamped", () => {
    const c = clampDays(7, ce);
    expect(c.servedDays).toBe(7);
    expect(c.clamped).toBe(false);
  });

  test("Pro serves 365 unclamped", () => {
    const c = clampDays(365, pro);
    expect(c.retentionDays).toBe(365);
    expect(c.servedDays).toBe(365);
    expect(c.clamped).toBe(false);
  });

  test("days coerced into [1,730] before clamp (1e9 -> 730 then edition)", () => {
    const c = clampDays(1e9, pro);
    expect(c.servedDays).toBe(365);
    expect(c.clamped).toBe(true);
  });
});

describe("history-query: selectTier + MAX_POINTS", () => {
  test("<=0.5 day -> raw", () => {
    expect(selectTier(0.5)).toBe("raw");
    expect(selectTier(0.4)).toBe("raw");
  });
  test("1..90 days -> hourly", () => {
    expect(selectTier(1)).toBe("hourly");
    expect(selectTier(90)).toBe("hourly");
  });
  test(">90 days -> daily", () => {
    expect(selectTier(91)).toBe("daily");
    expect(selectTier(365)).toBe("daily");
  });
  test("MAX_POINTS is 5000", () => {
    expect(MAX_POINTS).toBe(5000);
  });
  test("RANGE_DAYS maps the five pills", () => {
    expect(RANGE_DAYS).toEqual({ "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 });
  });
});

// ── HTTP-level integration (real SQLite + supertest) ─────────────────────────
const request = require("supertest");
const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");

const HTTP_API_KEY = "hist-api-key-" + Date.now();
const HTTP_JWT_SECRET = "hist-jwt-secret-" + Date.now();
const httpTmp = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-hist-"));
process.env.API_KEY = HTTP_API_KEY;
process.env.JWT_SECRET = HTTP_JWT_SECRET;
process.env.AUTH_MODE = "key";
process.env.DATA_DIR = httpTmp;
process.env.SERVER_NAME = "Hist Test";

const db = require("../src/db/sqlite");
const { initJwt } = require("../src/auth/jwt");
const metricsHistory = require("../src/system/history");

const database = db.init();
initJwt(database);
metricsHistory.init(database);

const app = express();
app.use(express.json());
// Default edition is CE; individual tests overwrite app.locals.edition.
app.locals.edition = { name: "ce", limits: { metricsRetentionDays: 30 } };
const authRoutes = require("../src/routes/auth");
const systemRoutes = require("../src/routes/system");
app.use(authRoutes);
app.use(systemRoutes);

function setEdition(name, retentionDays) {
  app.locals.edition =
    retentionDays === undefined
      ? { name, limits: {} }
      : { name, limits: { metricsRetentionDays: retentionDays } };
}

// Insert a raw metrics_history row at a specific UTC datetime string.
function seedRaw(createdAt, cpu = 10, mem = 20, disk = 30, load = 0.5, ct = 5, cr = 4) {
  database
    .prepare(
      `INSERT INTO metrics_history
         (cpu_percent, memory_percent, disk_percent, load_1, container_total, container_running, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(cpu, mem, disk, load, ct, cr, createdAt);
}

// Insert a daily rollup row at a given epoch-day bucket.
function seedDaily(bucketStart, cpuAvg = 50) {
  database
    .prepare(
      `INSERT OR REPLACE INTO metrics_rollup_daily
         (bucket_start, cpu_min, cpu_max, cpu_avg, memory_min, memory_max, memory_avg,
          disk_min, disk_max, disk_avg, load_min, load_max, load_avg,
          container_total_min, container_total_max, container_total_avg,
          container_running_min, container_running_max, container_running_avg, sample_count)
       VALUES (?, ?, ?, ?, 1,2,1.5, 1,2,1.5, 0,1,0.5, 1,2,1.5, 1,2,1.5, 1)`
    )
    .run(bucketStart, cpuAvg, cpuAvg, cpuAvg);
}

let token;
beforeAll(async () => {
  const res = await request(app).post("/auth/token").send({ apiKey: HTTP_API_KEY });
  token = res.body.accessToken;
});
afterAll(() => {
  const { stopCleanup } = require("../src/auth/jwt");
  const { stopLockoutCleanup } = require("../src/auth/middleware");
  stopCleanup();
  stopLockoutCleanup();
  try { database.close(); } catch { /* ignore */ }
  fs.rmSync(httpTmp, { recursive: true, force: true });
});

const auth = (req) => req.set("Authorization", `Bearer ${token}`);

describe("GET /api/metrics/history: range -> tier selection", () => {
  test("range=24h -> hourly resolution + buckets shape", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?range=24h"));
    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("hourly");
    expect(Array.isArray(res.body.buckets)).toBe(true);
    expect(res.body).toHaveProperty("summary");
    expect(res.body.requestedDays).toBe(1);
    expect(res.body.servedDays).toBe(1);
    expect(res.body.clamped).toBe(false);
    expect(res.body.retentionDays).toBe(365);
  });

  test("range=1y on Pro -> daily resolution, unclamped", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("daily");
    expect(res.body.servedDays).toBe(365);
    expect(res.body.clamped).toBe(false);
  });
});

describe("GET /api/metrics/history: edition clamp (200 + clamped:true)", () => {
  test("CE range=1y clamps to 30 days, still 200", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    expect(res.body.clamped).toBe(true);
    expect(res.body.requestedDays).toBe(365);
    expect(res.body.servedDays).toBe(30);
    expect(res.body.retentionDays).toBe(30);
  });

  test("Pro range=1y is not clamped", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.body.clamped).toBe(false);
    expect(res.body.servedDays).toBe(365);
  });
});

describe("GET /api/metrics/history: PAYWALL CANNOT BE BYPASSED", () => {
  // Seed a daily row 200 days in the past. CE retention is 30d => must never appear.
  const nowSec = Math.floor(Date.now() / 1000);
  const dayBucket200 = Math.floor((nowSec - 200 * 86400) / 86400) * 86400;
  beforeAll(() => {
    seedDaily(dayBucket200, 99); // distinctive cpu_avg=99 marks the forbidden row
  });

  const forbidden = (res) =>
    (res.body.buckets || []).every((b) => b.t >= dayBucket200 + 86400) || // not before
    !(res.body.buckets || []).some((b) => b.t === dayBucket200);

  test("CE range=1y never returns the -200d daily row", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    expect(res.body.servedDays).toBe(30);
    expect((res.body.buckets || []).some((b) => b.t === dayBucket200)).toBe(false);
  });

  test("CE hours=8760 (legacy bypass attempt) clamps to 30d window", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?hours=8760"));
    expect(res.status).toBe(200);
    // legacy shape -> history array; none of its rows may be the -200d data
    const rows = res.body.history || [];
    expect(rows.every((r) => r.cpu_percent !== 99)).toBe(true);
  });

  test("CE from/to spanning 200d clamps served window to 30d", async () => {
    setEdition("ce", 30);
    const from = nowSec - 200 * 86400;
    const res = await auth(
      request(app).get(`/api/metrics/history?from=${from}&to=${nowSec}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.servedDays).toBe(30);
    expect((res.body.buckets || []).some((b) => b.t === dayBucket200)).toBe(false);
  });

  test("CE array days param is rejected with 400 (no bypass)", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?hours=24&hours=48"));
    expect(res.status).toBe(400);
  });

  test("CE negative hours is rejected with 400", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?hours=-3"));
    expect(res.status).toBe(400);
  });

  test("CE hours=1e9 clamps, never leaks -200d", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?hours=1e9"));
    expect(res.status).toBe(200);
    const rows = res.body.history || [];
    expect(rows.every((r) => r.cpu_percent !== 99)).toBe(true);
  });

  test("CE range=garbage string is rejected with 400", async () => {
    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?range=forever"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/metrics/history: legacy backward-compat", () => {
  test("hours<=48 returns EXACT legacy {history, summary} shape (no buckets)", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?hours=24"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("history");
    expect(res.body).toHaveProperty("summary");
    expect(res.body).not.toHaveProperty("buckets");
    expect(res.body).not.toHaveProperty("resolution");
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  test("hours=168 (~7d) still works, served via hourly mapped to raw field names", async () => {
    setEdition("pro", 365);
    // seed an hourly rollup row ~3 days ago so the mapped history is non-empty
    const b = Math.floor((Date.now() / 1000 - 3 * 86400) / 3600) * 3600;
    database
      .prepare(
        `INSERT OR REPLACE INTO metrics_rollup_hourly
           (bucket_start, cpu_min, cpu_max, cpu_avg, memory_min, memory_max, memory_avg,
            disk_min, disk_max, disk_avg, load_min, load_max, load_avg,
            container_total_min, container_total_max, container_total_avg,
            container_running_min, container_running_max, container_running_avg, sample_count)
         VALUES (?, 5,15,11, 20,30,25, 40,50,45, 0,1,0.5, 4,6,5, 3,5,4, 12)`
      )
      .run(b);
    const res = await auth(request(app).get("/api/metrics/history?hours=168"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("history");
    expect(res.body).not.toHaveProperty("buckets");
    // mapped rows expose raw-row field names
    const sample = res.body.history.find((r) => r.cpu_percent === 11);
    expect(sample).toBeDefined();
    expect(sample).toHaveProperty("memory_percent");
    expect(sample).toHaveProperty("disk_percent");
    expect(sample).toHaveProperty("load_1");
    expect(sample).toHaveProperty("created_at");
  });

  test("summary backward-compat: all legacy keys present in legacy path", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?hours=24"));
    const s = res.body.summary;
    for (const k of [
      "data_points", "cpu_avg", "cpu_max", "cpu_min",
      "memory_avg", "memory_max", "disk_avg", "disk_max",
      "load_avg", "load_max",
    ]) {
      expect(s).toHaveProperty(k);
    }
  });
});

describe("GET /api/metrics/history: MAX_POINTS auto-promote", () => {
  test("a hugely zoomed raw from/to promotes off raw to a coarser tier", async () => {
    setEdition("enterprise"); // 730d cap, no metricsRetentionDays key
    const now = Math.floor(Date.now() / 1000);
    // 60-day from/to: raw would be ~ huge -> must NOT be raw
    const res = await auth(
      request(app).get(`/api/metrics/history?from=${now - 60 * 86400}&to=${now}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.resolution).not.toBe("raw");
  });
});
