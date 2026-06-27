#!/usr/bin/env node
/**
 * rollback-trends.js — reverse the v3 trend-history migration's DB-side state.
 *
 * Per design spec §7. Drops the rollup tables + clears the feature's app_state
 * keys, which also reverts the raw-retention window to the legacy 168h (the
 * guarded prune reads app_state.backfill_v1_done; with it gone, history.js
 * falls back to LEGACY_RAW_RETENTION_HOURS). A timestamped .backup of the DB
 * file is created FIRST.
 *
 * IMPORTANT: this restores SCHEMA + retention window, not deleted data. Raw
 * rows already pruned past 48h after backfill cannot be recovered here — that
 * requires the pre-migration snapshot (~/automation/backups/cockpit-data-pre-*.tar.gz).
 * The rollup tables themselves still hold the hourly/daily aggregates until dropped.
 *
 * Usage:
 *   node scripts/rollback-trends.js                 # uses DATA_DIR/cockpit.db
 *   node scripts/rollback-trends.js --db /path/to/cockpit.db
 *   node scripts/rollback-trends.js --dry-run       # report only, no writes
 */
"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const ROLLUP_TABLES = ["metrics_rollup_hourly", "metrics_rollup_daily"];
const STATE_KEYS = ["backfill_v1_done", "rollup_hourly_watermark", "rollup_daily_watermark"];

function parseArgs(argv) {
  const args = { db: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") args.db = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
  }
  return args;
}

function resolveDbPath(explicit) {
  if (explicit) return path.resolve(explicit);
  const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
  return path.join(DATA_DIR, "cockpit.db");
}

function tableExists(db, name) {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveDbPath(args.db);

  if (!fs.existsSync(dbPath)) {
    console.error(`[rollback-trends] DB not found: ${dbPath}`);
    process.exit(1);
  }

  // Timestamped backup FIRST (skip on dry-run).
  if (!args.dryRun) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${dbPath}.backup-${stamp}`;
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[rollback-trends] backup written: ${backupPath}`);
  } else {
    console.log("[rollback-trends] --dry-run: no backup, no writes");
  }

  const db = new Database(dbPath);
  try {
    const present = ROLLUP_TABLES.filter((t) => tableExists(db, t));
    const stateRows = tableExists(db, "app_state")
      ? db
          .prepare(
            `SELECT key FROM app_state WHERE key IN (${STATE_KEYS.map(() => "?").join(",")})`,
          )
          .all(...STATE_KEYS)
          .map((r) => r.key)
      : [];

    console.log(`[rollback-trends] rollup tables present: ${present.join(", ") || "(none)"}`);
    console.log(`[rollback-trends] app_state keys present: ${stateRows.join(", ") || "(none)"}`);

    if (args.dryRun) {
      console.log("[rollback-trends] dry-run complete — nothing changed.");
      return;
    }

    const tx = db.transaction(() => {
      for (const t of present) db.exec(`DROP TABLE IF EXISTS ${t}`);
      if (tableExists(db, "app_state")) {
        const del = db.prepare("DELETE FROM app_state WHERE key=?");
        for (const k of STATE_KEYS) del.run(k);
      }
    });
    tx();

    console.log(
      `[rollback-trends] dropped ${present.length} rollup table(s), cleared ${stateRows.length} state key(s).`,
    );
    console.log(
      "[rollback-trends] raw retention reverts to 168h (backfill_v1_done cleared). " +
        "Deploy the pre-trends image to revert code. Pruned raw >48h is NOT recovered — " +
        "restore the pre-migration snapshot for that.",
    );
  } finally {
    db.close();
  }
}

main();
