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
