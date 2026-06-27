/**
 * AGPL §13 Corresponding-Source offer. The /source route MUST stay PUBLIC
 * (no auth) and point at the public CE repo — network users of this modified
 * AGPL program are entitled to the offer without authenticating. This guard
 * fails if someone auth-gates it or changes the source URL/license.
 */
const request = require("supertest");
const express = require("express");

// Minimal env so the router module loads without a real DB/auth backend.
process.env.API_KEY = process.env.API_KEY || "src-test-key";
process.env.JWT_SECRET = process.env.JWT_SECRET || "src-test-secret";

const systemRoutes = require("../src/routes/system");

const app = express();
app.use(systemRoutes);

describe("GET /source (AGPL §13)", () => {
  test("is reachable WITHOUT auth and returns the CE source offer", async () => {
    const res = await request(app).get("/source"); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body.license).toBe("AGPL-3.0-only");
    expect(res.body.source).toBe(
      "https://github.com/Lagoon-Tech-Systems/lagoon-cockpit",
    );
    expect(typeof res.body.version).toBe("string");
    expect(res.body.notice).toMatch(/AGPL/);
  });
});
