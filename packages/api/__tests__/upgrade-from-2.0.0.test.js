// Upgrade and rollback tests against a real 2.0.0 database (see fixtures/cockpit-2.0.0.sql).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const Database = require("better-sqlite3");
const { runMigrations } = require("../src/db/sqlite");

const FIXTURE = path.join(__dirname, "fixtures", "cockpit-2.0.0.sql");
const ROLLBACK_SCRIPT = path.join(__dirname, "..", "scripts", "rollback-trends.js");
const V2_TABLES = ["users", "push_tokens", "audit_log", "refresh_tokens"];

// `migrations` is not exported from sqlite.js, so derive the expected highest version
// from the source text of the array rather than from the migrated database itself.
function highestMigrationVersion() {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "db", "sqlite.js"), "utf8");
  const versions = [...src.matchAll(/^\s{4}version:\s*(\d+),/gm)].map((m) => Number(m[1]));
  expect(versions.length).toBeGreaterThan(0);
  return Math.max(...versions);
}

const dirs = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-upgrade-"));
  dirs.push(dir);
  const file = path.join(dir, "cockpit.db");
  const db = new Database(file);
  db.exec(fs.readFileSync(FIXTURE, "utf8"));
  return { db, file, dir };
}

const counts = (db) =>
  Object.fromEntries(V2_TABLES.map((t) => [t, db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
const tableNames = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);

let logSpy;
beforeEach(() => {
  logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

test("forward: 2.0.0 data survives migration to current", () => {
  const { db } = freshDb();
  expect(counts(db)).toEqual({ users: 1, push_tokens: 1, audit_log: 1, refresh_tokens: 1 });
  expect(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v).toBe(2);

  runMigrations(db);

  expect(counts(db)).toEqual({ users: 1, push_tokens: 1, audit_log: 1, refresh_tokens: 1 });
  expect(db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v).toBe(highestMigrationVersion());
  expect(tableNames(db)).toEqual(
    expect.arrayContaining([
      "metrics_rollup_hourly",
      "metrics_rollup_daily",
      "app_state",
      "alert_rules",
      "alert_events",
    ]),
  );
  db.close();
});

test("restart: running migrations a second time changes nothing", () => {
  const { db } = freshDb();
  runMigrations(db);
  const schemaBefore = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
  const countsBefore = counts(db);
  const migBefore = db.prepare("SELECT version, description, applied_at FROM schema_migrations ORDER BY version").all();

  runMigrations(db);

  expect(db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all()).toEqual(schemaBefore);
  expect(counts(db)).toEqual(countsBefore);
  expect(db.prepare("SELECT version, description, applied_at FROM schema_migrations ORDER BY version").all()).toEqual(
    migBefore,
  );
  db.close();
});

test("rollback: 2.0.0 code can still read and write the migrated database", () => {
  const old = freshDb();
  const oldCols = Object.fromEntries(
    V2_TABLES.map((t) => [t, old.db.prepare(`PRAGMA table_info(${t})`).all()]),
  );
  old.db.close();

  const { db } = freshDb();
  runMigrations(db);

  for (const t of V2_TABLES) {
    const now = db.prepare(`PRAGMA table_info(${t})`).all();
    const byName = new Map(now.map((c) => [c.name, c]));
    for (const c of oldCols[t]) {
      expect(byName.has(c.name)).toBe(true);
      expect(byName.get(c.name).type).toBe(c.type);
    }
    const oldNames = new Set(oldCols[t].map((c) => c.name));
    for (const c of now.filter((c) => !oldNames.has(c.name))) {
      expect({ table: t, column: c.name, ok: c.notnull === 0 || c.dflt_value !== null }).toEqual({
        table: t,
        column: c.name,
        ok: true,
      });
    }
  }

  // Exercise the exact statements 2.0.0 code issues, against the migrated schema.
  db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run("fixture-two@example.invalid", "x", "viewer");
  db.prepare("INSERT INTO push_tokens (token, user_id, server_name) VALUES (?, ?, ?)").run("ExponentPushToken[fixture-2]", "1", "fixture-server");
  db.prepare("INSERT INTO audit_log (user_id, action, target, detail) VALUES (?, ?, ?, ?)").run("1", "fixture-action-2", "t", null);
  db.prepare("INSERT INTO refresh_tokens (hash, user_id, role, fingerprint, expires_at) VALUES (?, ?, ?, ?, ?)").run("fixture-refresh-hash-2", "1", "admin", null, 4102444800);
  expect(counts(db)).toEqual({ users: 2, push_tokens: 2, audit_log: 2, refresh_tokens: 2 });
  expect(db.prepare("SELECT email FROM users WHERE id = 1").get().email).toBe("fixture-user@example.invalid");
  db.close();
});

test("rollback script: trends rollback keeps 2.0.0 rows", () => {
  const { db, file, dir } = freshDb();
  runMigrations(db);
  db.close();

  execFileSync("node", [ROLLBACK_SCRIPT, "--db", file], { stdio: "pipe" });

  const after = new Database(file, { readonly: true });
  const names = tableNames(after);
  expect(names).not.toContain("metrics_rollup_hourly");
  expect(names).not.toContain("metrics_rollup_daily");
  expect(counts(after)).toEqual({ users: 1, push_tokens: 1, audit_log: 1, refresh_tokens: 1 });
  after.close();

  const backups = fs.readdirSync(dir).filter((f) => f.startsWith("cockpit.db.backup-"));
  expect(backups.length).toBe(1);
});
