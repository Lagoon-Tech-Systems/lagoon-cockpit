/**
 * Unit tests for scripts/check-versions.js — the guard that keeps the root,
 * API, app and CLI versions (and the app config) in lockstep.
 */
const path = require("path");
const { collectVersions, findMismatches } = require("../../../scripts/check-versions.js");

const repoRoot = path.resolve(__dirname, "../../..");

describe("check-versions", () => {
  test("findMismatches returns [] when every version matches the root", () => {
    expect(
      findMismatches({
        "package.json": "2.0.0",
        "packages/api/package.json": "2.0.0",
      }),
    ).toEqual([]);
  });

  test("findMismatches flags files that differ from the root package.json", () => {
    expect(
      findMismatches({
        "package.json": "2.1.0",
        "packages/cli/package.json": "2.0.0",
      }),
    ).toEqual(["packages/cli/package.json"]);
  });

  test("collectVersions reads all five version sources", () => {
    expect(Object.keys(collectVersions(repoRoot)).sort()).toEqual([
      "package.json",
      "packages/api/package.json",
      "packages/app/app.config.js",
      "packages/app/package.json",
      "packages/cli/package.json",
    ]);
  });

  test("the repository versions are in lockstep", () => {
    expect(findMismatches(collectVersions(repoRoot))).toEqual([]);
  });
});
