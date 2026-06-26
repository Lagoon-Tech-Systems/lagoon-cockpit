/**
 * Pure request-parsing + clamp + tier-selection helpers for
 * GET /api/metrics/history. Kept side-effect-free so the precedence,
 * adversarial-input, clamp, and tier-selection contracts are unit-testable
 * without HTTP (mirrors the codeql-guards.test.js applyGuards style).
 */
const { resolveRetentionDays } = require("../edition/features");

const RANGE_DAYS = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const MAX_POINTS = 5000;
const ABS_MAX_DAYS = 730; // matches the daily hard cap

function badRequest(msg) {
  return { error: { status: 400, body: { error: msg } } };
}

// A finite, positive, non-overflowing number parsed from a single string param.
function parseFinitePositive(raw, label) {
  if (Array.isArray(raw)) return { err: badRequest(`${label} must be a single string`) };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { err: badRequest(`${label} must be a finite number`) };
  if (n <= 0) return { err: badRequest(`${label} must be positive`) };
  if (n > 1e15) return { err: badRequest(`${label} out of range`) };
  return { value: n };
}

/**
 * Parse the request query into a normalized descriptor.
 * Precedence: range -> from/to -> legacy hours (default 24).
 * Returns { mode, requestedDays, fromEpoch, toEpoch, hours } or { error }.
 */
function parseRequest(query) {
  const { range, from, to, hours } = query;

  // ── range ──────────────────────────────────────────────
  if (range !== undefined) {
    if (Array.isArray(range)) return badRequest("range must be a single string");
    if (!Object.prototype.hasOwnProperty.call(RANGE_DAYS, range))
      return badRequest("range must be one of 24h,7d,30d,90d,1y");
    return { mode: "range", requestedDays: RANGE_DAYS[range], fromEpoch: null, toEpoch: null };
  }

  // ── from/to (epoch seconds) ────────────────────────────
  if (from !== undefined || to !== undefined) {
    if (from === undefined || to === undefined)
      return badRequest("from and to are both required");
    const f = parseFinitePositive(from, "from");
    if (f.err) return f.err;
    const t = parseFinitePositive(to, "to");
    if (t.err) return t.err;
    if (!(t.value > f.value)) return badRequest("to must be greater than from");
    const fromEpoch = Math.floor(f.value);
    const toEpoch = Math.floor(t.value);
    const requestedDays = (toEpoch - fromEpoch) / 86400;
    return { mode: "fromto", requestedDays, fromEpoch, toEpoch };
  }

  // ── legacy hours (default 24) ──────────────────────────
  if (hours === undefined) {
    return { mode: "legacy", hours: 24, requestedDays: 1, fromEpoch: null, toEpoch: null };
  }
  const h = parseFinitePositive(hours, "hours");
  if (h.err) return h.err;
  const hoursInt = Math.floor(h.value);
  // Coerce requestedDays into [1, ABS_MAX_DAYS] — same behaviour as clampDays pre-step.
  // The range/fromto paths rely on clampDays to enforce this; the legacy path must match.
  const rawDays = hoursInt / 24;
  const requestedDays = Math.min(Math.max(rawDays, 1), ABS_MAX_DAYS);
  return { mode: "legacy", hours: hoursInt, requestedDays, fromEpoch: null, toEpoch: null };
}

/**
 * Clamp a requested day-window by the edition retention limit.
 * requestedDays is first coerced into [1, ABS_MAX_DAYS], then min()'d
 * against resolveRetentionDays(edition). Applies on EVERY param path.
 */
function clampDays(requestedDays, edition) {
  let req = requestedDays;
  if (!Number.isFinite(req) || req < 1) req = 1;
  if (req > ABS_MAX_DAYS) req = ABS_MAX_DAYS;
  const retentionDays = resolveRetentionDays(edition);
  const servedDays = Math.min(req, retentionDays);
  return { retentionDays, servedDays, clamped: servedDays < req };
}

/**
 * Finest tier whose point budget fits, with MAX_POINTS backstop.
 *  raw    : servedDays <= 0.5  (<=12h)
 *  hourly : servedDays <= 90
 *  daily  : else
 * If the chosen tier would exceed MAX_POINTS, auto-promote coarser.
 *
 * NOTE on MAX_POINTS backstop: under current tier boundaries the while-loop is
 * intentionally slack — raw tops out at ~48 pts (0.5d × 24 × 4), hourly at
 * ~2160 pts (90d × 24), both well under 5000.  The backstop is a
 * future-proof guard for when resolution intervals or tier cutoffs change.
 * Hard enforcement of MAX_POINTS as a returned-row cap belongs in the route
 * layer (Task 4.2), not here.
 */
function selectTier(servedDays) {
  let tier = servedDays <= 0.5 ? "raw" : servedDays <= 90 ? "hourly" : "daily";
  // Backstop: estimate points; promote if over budget.
  const estPoints = (t) => {
    if (t === "raw") return servedDays * 24 * 4; // ~15s -> 4/min cap; conservative upper bound
    if (t === "hourly") return servedDays * 24;
    return servedDays;
  };
  while (tier !== "daily" && estPoints(tier) > MAX_POINTS) {
    tier = tier === "raw" ? "hourly" : "daily";
  }
  return tier;
}

module.exports = { RANGE_DAYS, MAX_POINTS, ABS_MAX_DAYS, parseRequest, clampDays, selectTier };
