/**
 * Phase 1 — app_state get/set helpers in the metricsHistory module.
 * Round-trips values through the app_state table; verifies upsert + null-miss.
 */
const path = require("path");
const fs = require("fs");
const os = require("os");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-appstate-"));
process.env.DATA_DIR = tmpDir;

const sqlite = require("../src/db/sqlite");
const metricsHistory = require("../src/system/history");

describe("app_state get/set", () => {
  let db;

  beforeAll(() => {
    db = sqlite.init(); // runs v3 migration -> app_state exists
    metricsHistory.init(db);
  });

  afterAll(() => {
    if (db) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("getState returns null for an unknown key", () => {
    expect(metricsHistory.getState("nope_missing")).toBeNull();
  });

  test("setState then getState round-trips a value", () => {
    metricsHistory.setState("backfill_v1_done", "1");
    expect(metricsHistory.getState("backfill_v1_done")).toBe("1");
  });

  test("setState upserts (overwrites) an existing key without throwing", () => {
    metricsHistory.setState("rollup_watermark_hourly", "100");
    metricsHistory.setState("rollup_watermark_hourly", "200");
    expect(metricsHistory.getState("rollup_watermark_hourly")).toBe("200");

    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM app_state WHERE key = ?")
      .get("rollup_watermark_hourly");
    expect(rows.n).toBe(1);
  });
});
