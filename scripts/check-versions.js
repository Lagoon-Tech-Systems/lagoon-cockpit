#!/usr/bin/env node
/**
 * Verifies that the product version is identical everywhere it is declared.
 * The root package.json is the reference (release-please bumps it).
 * Usage: node scripts/check-versions.js   (exit 1 on any mismatch)
 */
const fs = require("fs");
const path = require("path");

const PACKAGE_FILES = [
  "package.json",
  "packages/api/package.json",
  "packages/app/package.json",
  "packages/cli/package.json",
];
const APP_CONFIG = "packages/app/app.config.js";

function readText(repoRoot, rel) {
  const file = path.join(repoRoot, rel);
  if (!fs.existsSync(file)) throw new Error(`${rel}: file not found`);
  return fs.readFileSync(file, "utf8");
}

function collectVersions(repoRoot) {
  const versions = {};
  for (const rel of PACKAGE_FILES) {
    const { version } = JSON.parse(readText(repoRoot, rel));
    if (typeof version !== "string" || !version) {
      throw new Error(`${rel}: no "version" field`);
    }
    versions[rel] = version;
  }
  // Read as text: app.config.js may pull in Expo and must not be required.
  const match = readText(repoRoot, APP_CONFIG).match(/^\s*version:\s*["']([^"']+)["']/m);
  if (!match) throw new Error(`${APP_CONFIG}: no version string found`);
  versions[APP_CONFIG] = match[1];
  return versions;
}

function findMismatches(versions) {
  const expected = versions["package.json"];
  return Object.keys(versions)
    .filter((key) => key !== "package.json" && versions[key] !== expected)
    .sort();
}

if (require.main === module) {
  const versions = collectVersions(path.resolve(__dirname, ".."));
  const mismatches = findMismatches(versions);
  if (mismatches.length) {
    for (const key of mismatches) {
      console.error(`${key}: ${versions[key]} (expected ${versions["package.json"]})`);
    }
    process.exit(1);
  }
  console.log(`All versions match ${versions["package.json"]}`);
}

module.exports = { collectVersions, findMismatches };
