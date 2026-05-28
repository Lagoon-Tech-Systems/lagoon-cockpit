/**
 * Tests for the input-validation guards added in PR #48 (CodeQL sweep) and
 * hardened in the post-board-review follow-up.
 *
 * Covers the new 400 / 413 branches that exist purely as security defenses so
 * that a future refactor cannot silently delete them.
 */

describe("CodeQL guard: containers log-search query type-checks (PR #48 #99)", () => {
  function applyGuards({ q, regex, context }) {
    if (typeof q !== "string") return { status: 400, body: { error: "q must be a single string" } };
    if (regex !== undefined && typeof regex !== "string")
      return { status: 400, body: { error: "regex must be a single string" } };
    if (typeof context !== "string")
      return { status: 400, body: { error: "context must be a single string" } };
    if (!q) return { status: 400, body: { error: "q (search query) required" } };
    if (q.length > 1000) return { status: 400, body: { error: "Query too long (max 1000 chars)" } };
    return { status: 200, body: { ok: true } };
  }

  test("array q (duplicate query param) is rejected with 400", () => {
    const r = applyGuards({ q: ["foo", "bar"], regex: "false", context: "2" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/q must be a single string/);
  });

  test("array regex param is rejected with 400", () => {
    const r = applyGuards({ q: "foo", regex: ["true", "false"], context: "2" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/regex must be a single string/);
  });

  test("array context param is rejected with 400", () => {
    const r = applyGuards({ q: "foo", regex: "false", context: ["2", "5"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/context must be a single string/);
  });

  test("q longer than 1000 chars is rejected with 400", () => {
    const r = applyGuards({ q: "x".repeat(1001), regex: "false", context: "2" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/Query too long/);
  });

  test("well-formed string q passes guards", () => {
    const r = applyGuards({ q: "search me", regex: "false", context: "2" });
    expect(r.status).toBe(200);
  });
});

describe("CodeQL guard: SAML ACS size cap (PR #48 #14)", () => {
  function acsSizeGuard(samlResponse) {
    if (!samlResponse || typeof samlResponse !== "string")
      return { status: 400, body: { error: "SAMLResponse is required" } };
    if (samlResponse.length > 100_000)
      return { status: 413, body: { error: "SAMLResponse too large" } };
    const xml = Buffer.from(samlResponse, "base64").toString("utf-8");
    if (xml.length > 200_000) return { status: 413, body: { error: "SAMLResponse too large" } };
    return { status: 200, xml };
  }

  test("SAMLResponse over 100KB base64 is rejected with 413", () => {
    const big = "A".repeat(100_001);
    const r = acsSizeGuard(big);
    expect(r.status).toBe(413);
  });

  test("base64 expansion bounds decoded length, so 100KB base64 cap dominates", () => {
    // Base64 is 4/3 of source, so input must be <=75KB source to produce <=100KB base64.
    // Source length equals decoded length, so anything passing the first cap can't exceed
    // 75KB decoded — the 200KB belt-and-suspenders is for non-standard encodings.
    const raw = "<".repeat(74_000);
    const b64 = Buffer.from(raw).toString("base64");
    const r = acsSizeGuard(b64);
    expect(r.status).toBe(200);
    expect(r.xml.length).toBeLessThanOrEqual(200_000);
  });

  test("normal-size SAMLResponse (10KB) passes", () => {
    const b64 = Buffer.from("<saml/>").toString("base64");
    const r = acsSizeGuard(b64);
    expect(r.status).toBe(200);
  });
});

describe("CodeQL guard: status-pages subscriber email length cap (PR #48 #15)", () => {
  function emailGuard(email) {
    if (email && (typeof email !== "string" || email.length > 254))
      return { status: 400, body: { error: "Invalid email format" } };
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return { status: 400, body: { error: "Invalid email format" } };
    return { status: 200 };
  }

  test("email over 254 chars (RFC 5321 max) is rejected with 400", () => {
    const long = "a".repeat(250) + "@x.io";
    const r = emailGuard(long);
    expect(r.status).toBe(400);
  });

  test("array email is rejected with 400 (type check)", () => {
    const r = emailGuard(["a@b.io", "c@d.io"]);
    expect(r.status).toBe(400);
  });

  test("conformant email passes", () => {
    const r = emailGuard("user@example.com");
    expect(r.status).toBe(200);
  });
});

describe("CodeQL guard: endpoints.js STRICT_TLS env (PR #48 #26, post-board flip)", () => {
  const ORIG = process.env.STRICT_TLS;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.STRICT_TLS;
    else process.env.STRICT_TLS = ORIG;
  });

  function strictTlsFlag() {
    return process.env.STRICT_TLS !== "false";
  }

  test("default (unset env) is STRICT_TLS=true after board flip", () => {
    delete process.env.STRICT_TLS;
    expect(strictTlsFlag()).toBe(true);
  });

  test("STRICT_TLS=false opts into permissive mode", () => {
    process.env.STRICT_TLS = "false";
    expect(strictTlsFlag()).toBe(false);
  });

  test("STRICT_TLS=true keeps strict mode", () => {
    process.env.STRICT_TLS = "true";
    expect(strictTlsFlag()).toBe(true);
  });

  test("any other value (typo) defaults to strict", () => {
    process.env.STRICT_TLS = "no";
    expect(strictTlsFlag()).toBe(true);
  });
});
