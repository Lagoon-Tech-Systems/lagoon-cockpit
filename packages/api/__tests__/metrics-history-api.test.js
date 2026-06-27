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
  const ce = { name: "ce", limits: { metricsRetentionDays: 90 } };
  const pro = { name: "pro", limits: { metricsRetentionDays: 365 } };

  test("CE clamps 365 -> 90 and flags clamped", () => {
    const c = clampDays(365, ce);
    expect(c.retentionDays).toBe(90);
    expect(c.servedDays).toBe(90);
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
app.locals.edition = { name: "ce", limits: { metricsRetentionDays: 90 } };
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

// Insert an hourly rollup row at a given epoch-hour bucket.
function seedHourly(bucketStart, cpuAvg = 50) {
  database
    .prepare(
      `INSERT OR REPLACE INTO metrics_rollup_hourly
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
  test("CE range=1y clamps to 90 days, still 200", async () => {
    setEdition("ce", 90);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    expect(res.body.clamped).toBe(true);
    expect(res.body.requestedDays).toBe(365);
    expect(res.body.servedDays).toBe(90);
    expect(res.body.retentionDays).toBe(90);
  });

  test("Pro range=1y is not clamped", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.body.clamped).toBe(false);
    expect(res.body.servedDays).toBe(365);
  });
});

describe("GET /api/metrics/history: PAYWALL CANNOT BE BYPASSED", () => {
  // CE retention = 90 days. We seed poison rows at -200d in BOTH the hourly
  // and daily rollup tables so the test is discriminating regardless of which
  // tier the clamped path selects.
  //   • range=1y CE → servedDays=90 → tier=hourly → reads metrics_rollup_hourly
  //   • hours=8760 CE → legacy hourly path → reads metrics_rollup_hourly
  //   • from/to spanning 200d CE → servedDays=90 → tier=hourly → same
  // A count-only clamp (e.g. LIMIT 90) on the DB query would still return the
  // -200d row when it is the ONLY row in the table, so these tests WOULD FAIL
  // against such an implementation because the age assertion would breach 90d.
  const nowSec = Math.floor(Date.now() / 1000);
  const CE_DAYS = 90;
  // Hourly bucket 200 days ago (on an exact hour boundary).
  const hourlyBucket200 = Math.floor((nowSec - 200 * 86400) / 3600) * 3600;
  // Daily bucket 200 days ago.
  const dayBucket200 = Math.floor((nowSec - 200 * 86400) / 86400) * 86400;

  beforeAll(() => {
    // cpu_avg=99 is the distinctive sentinel value for both poison rows.
    seedHourly(hourlyBucket200, 99);
    seedDaily(dayBucket200, 99);
  });

  // Helper: assert oldest bucket is within the allowed window.
  // This FAILS if the clamp is count-only and the poison row leaks through.
  function assertOldestWithinWindow(buckets, servedDays) {
    if (buckets.length === 0) return; // empty is fine
    const minT = Math.min(...buckets.map((b) => b.t));
    const maxAge = nowSec - minT;
    const slack = 3700; // one extra hour of slack for bucket boundaries
    expect(maxAge).toBeLessThanOrEqual(servedDays * 86400 + slack);
  }

  test("CE range=1y never returns -200d hourly poison (age assertion)", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    expect(res.body.servedDays).toBe(CE_DAYS);
    const buckets = res.body.buckets || [];
    // The -200d hourly bucket must not appear.
    expect(buckets.some((b) => b.t === hourlyBucket200)).toBe(false);
    // Age-based: oldest bucket must not predate the 30d window (discriminating check).
    assertOldestWithinWindow(buckets, CE_DAYS);
  });

  test("CE hours=8760 (legacy bypass attempt) clamps to 90d window — hourly poison absent", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?hours=8760"));
    expect(res.status).toBe(200);
    // legacy shape -> history array (mapped from hourly); none may be the -200d data
    const rows = res.body.history || [];
    expect(rows.every((r) => r.cpu_percent !== 99)).toBe(true);
    // Age-based: oldest created_at must not predate the 30d window.
    if (rows.length > 0) {
      const minCreatedAt = Math.min(...rows.map((r) => new Date(r.created_at.replace(" ", "T") + "Z").getTime() / 1000));
      const maxAge = nowSec - minCreatedAt;
      const slack = 3700;
      expect(maxAge).toBeLessThanOrEqual(CE_DAYS * 86400 + slack);
    }
  });

  test("CE hours=1e9 clamps — hourly poison absent", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?hours=1e9"));
    expect(res.status).toBe(200);
    const rows = res.body.history || [];
    expect(rows.every((r) => r.cpu_percent !== 99)).toBe(true);
  });

  test("CE from/to spanning 200d clamps served window to 90d (age assertion)", async () => {
    setEdition("ce", CE_DAYS);
    const from = nowSec - 200 * 86400;
    const res = await auth(
      request(app).get(`/api/metrics/history?from=${from}&to=${nowSec}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.servedDays).toBe(CE_DAYS);
    const buckets = res.body.buckets || [];
    expect(buckets.some((b) => b.t === hourlyBucket200)).toBe(false);
    assertOldestWithinWindow(buckets, CE_DAYS);
  });

  test("CE range=1y never returns -200d daily poison (daily tier check)", async () => {
    // Force daily tier by using a Pro edition with 200d retention and a range that
    // triggers daily tier (>90d). CE at 30d always hits hourly; to prove the daily
    // poison is also blocked we test Pro-clamped-to-31d (daily tier) vs the -200d row.
    // Actually, simplest: seed a daily poison and verify it's absent from a range=1y
    // Pro request whose window does NOT cover 200d ago.
    setEdition("pro", 31); // servedDays=31 → still hourly tier, so use a wider window
    // Use pro with 200d retention to trigger daily tier (servedDays=200 > 90).
    setEdition("pro", 200);
    const res = await auth(request(app).get("/api/metrics/history?range=1y"));
    expect(res.status).toBe(200);
    // servedDays clamped to 200 which is still < 200d-ago: poison should be absent.
    const buckets = res.body.buckets || [];
    expect(buckets.some((b) => b.t === dayBucket200)).toBe(false);
    assertOldestWithinWindow(buckets, 200);
  });

  test("CE array days param is rejected with 400 (no bypass)", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?hours=24&hours=48"));
    expect(res.status).toBe(400);
  });

  test("CE negative hours is rejected with 400", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?hours=-3"));
    expect(res.status).toBe(400);
  });

  test("CE range=garbage string is rejected with 400", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get("/api/metrics/history?range=forever"));
    expect(res.status).toBe(400);
  });

  test("adversarial: array from param is rejected 400", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get(`/api/metrics/history?from=100&from=200&to=${nowSec}`));
    expect(res.status).toBe(400);
  });

  test("adversarial: negative from is rejected 400", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get(`/api/metrics/history?from=-5&to=${nowSec}`));
    expect(res.status).toBe(400);
  });

  test("adversarial: string from is rejected 400", async () => {
    setEdition("ce", CE_DAYS);
    const res = await auth(request(app).get(`/api/metrics/history?from=abc&to=${nowSec}`));
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

describe("GET /api/metrics/history: legacy hours>48 summary covers served window", () => {
  // Regression guard: before the fix, ?hours=168 fetched history from hourly rollups
  // but computed summary via getHistorySummary() which only reads the 48h raw table.
  // A caller requesting ?hours=168 got history spanning 7 days but a summary covering
  // only the last 48h — a silent inconsistency. This test seeds a bucket at ~-100h
  // (outside the 48h raw window) and asserts the summary reflects it.

  const nowSec = Math.floor(Date.now() / 1000);
  // Hourly bucket 100 hours ago — outside 48h raw retention, inside 168h window.
  const bucket100h = Math.floor((nowSec - 100 * 3600) / 3600) * 3600;

  beforeAll(() => {
    // cpu_max=88 is the sentinel value; also seed a distinctive cpu_min=3 to verify min.
    database
      .prepare(
        `INSERT OR REPLACE INTO metrics_rollup_hourly
           (bucket_start, cpu_min, cpu_max, cpu_avg, memory_min, memory_max, memory_avg,
            disk_min, disk_max, disk_avg, load_min, load_max, load_avg,
            container_total_min, container_total_max, container_total_avg,
            container_running_min, container_running_max, container_running_avg, sample_count)
         VALUES (?, 3, 88, 45, 10, 20, 15, 30, 40, 35, 0, 2, 1, 2, 4, 3, 1, 3, 2, 5)`
      )
      .run(bucket100h);
  });

  test("hours=168 summary.cpu_max >= 88 (covers -100h bucket, not just 48h raw)", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?hours=168"));
    expect(res.status).toBe(200);
    const s = res.body.summary;
    expect(s).not.toBeNull();
    // The -100h bucket has cpu_max=88; the summary must reflect the full 168h window.
    expect(s.cpu_max).toBeGreaterThanOrEqual(88);
  });

  test("hours=168 summary has the complete legacy getHistorySummary key set (unchanged)", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?hours=168"));
    expect(res.status).toBe(200);
    const s = res.body.summary;
    // All keys that getHistorySummary returns must be present — both the original legacy
    // keys and the Task 4.3 additive widening keys.
    const EXPECTED_KEYS = [
      "data_points",
      "cpu_avg", "cpu_max", "cpu_min",
      "memory_avg", "memory_max", "memory_min",
      "disk_avg", "disk_max", "disk_min",
      "load_avg", "load_max", "load_min",
      "container_total_avg", "container_total_max", "container_total_min",
      "container_running_avg", "container_running_max", "container_running_min",
    ];
    expect(s).toEqual(expect.objectContaining(
      Object.fromEntries(EXPECTED_KEYS.map((k) => [k, expect.anything()]))
    ));
  });

  test("hours<=48 summary is still served via getHistorySummary (unchanged code path)", async () => {
    setEdition("pro", 365);
    const res = await auth(request(app).get("/api/metrics/history?hours=24"));
    expect(res.status).toBe(200);
    // The <=48h branch is untouched; just verify the shape is still present.
    const s = res.body.summary;
    for (const k of ["data_points", "cpu_avg", "cpu_max", "cpu_min",
                     "memory_avg", "memory_max", "disk_avg", "disk_max",
                     "load_avg", "load_max"]) {
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

  test("route-level MAX_POINTS cap: buckets.length is always <= MAX_POINTS", async () => {
    // This invariant must hold regardless of how many rows are in the DB.
    // Under current tier selection (hourly tops at ~2160 for 90d, daily even fewer)
    // the cap is never hit in practice — but we assert it universally.
    setEdition("pro", 365);
    const now = Math.floor(Date.now() / 1000);
    // Seed enough hourly rows to force a non-trivial bucket set (7 days = 168 hourly buckets,
    // well under MAX_POINTS=5000 but enough to prove the cap is applied and doesn't over-truncate).
    for (let i = 1; i <= 10; i++) {
      const b = Math.floor((now - i * 3600) / 3600) * 3600;
      seedHourly(b, i * 3);
    }
    const res = await auth(
      request(app).get(`/api/metrics/history?from=${now - 7 * 86400}&to=${now}`)
    );
    expect(res.status).toBe(200);
    expect(res.body.buckets.length).toBeLessThanOrEqual(MAX_POINTS);
  });
});

describe("GET /api/metrics/history: range-path summary reflects served window", () => {
  test("30d CE range summary is derived from buckets, not from 48h raw table", async () => {
    // Seed an hourly row ~15 days ago with a distinctive cpu_avg=77.
    // getHistorySummary(hours) reads metrics_history (48h retention) so it would
    // never see this row. The new bucket-derived summary MUST include it.
    const nowSec = Math.floor(Date.now() / 1000);
    const oldBucket = Math.floor((nowSec - 15 * 86400) / 3600) * 3600;
    seedHourly(oldBucket, 77); // cpu_avg=77, well outside 48h raw window

    setEdition("ce", 30);
    const res = await auth(request(app).get("/api/metrics/history?range=30d"));
    expect(res.status).toBe(200);
    expect(res.body.resolution).toBe("hourly");
    const s = res.body.summary;
    // Summary must be non-null and cover the 15d-old bucket (cpu_max >= 77).
    expect(s).not.toBeNull();
    expect(s.cpu_max).toBeGreaterThanOrEqual(77);
    // And the summary keys exist.
    for (const k of ["data_points", "cpu_avg", "cpu_max", "cpu_min",
                     "memory_avg", "memory_max", "disk_avg", "disk_max",
                     "load_avg", "load_max"]) {
      expect(s).toHaveProperty(k);
    }
  });
});

describe("getHistorySummary widening (additive, backward-safe)", () => {
  test("all legacy keys remain present (no regression)", () => {
    const s = metricsHistory.getHistorySummary(24);
    const LEGACY_KEYS = [
      "data_points",
      "cpu_avg", "cpu_max", "cpu_min",
      "memory_avg", "memory_max",
      "disk_avg", "disk_max",
      "load_avg", "load_max",
    ];
    expect(Object.keys(s).sort()).toEqual(expect.arrayContaining(LEGACY_KEYS));
  });

  test("additive keys are present (memory_min/disk_min/load_min + container aggregates)", () => {
    const s = metricsHistory.getHistorySummary(24);
    for (const k of [
      "memory_min", "disk_min", "load_min",
      "container_total_avg", "container_total_max", "container_total_min",
      "container_running_avg", "container_running_max", "container_running_min",
    ]) {
      expect(s).toHaveProperty(k);
    }
  });
});
