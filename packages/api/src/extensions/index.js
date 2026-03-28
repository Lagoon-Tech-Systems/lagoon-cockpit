const fs = require("fs");
const path = require("path");

const EXTENSIONS_DIR = process.env.EXTENSIONS_DIR || path.join(__dirname, "..", "..", "extensions");

/**
 * Load all extensions from the extensions directory.
 * Each extension must export: { name, version, init(app, db, services) }
 *
 * The services object provides access to core Cockpit systems:
 *   - broadcast(event, data) — SSE broadcast to connected clients
 *   - sendPushNotification(title, body, data) — Expo push notifications
 *   - auditLog(userId, action, target, detail) — Audit trail
 *   - alertEngine — Alert rule evaluation engine
 *   - metricsHistory — Metrics history recording
 *   - webhooks — Webhook firing
 *
 * Extensions are loaded in alphabetical order by directory name.
 */
function loadExtensions(app, db, services) {
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    return [];
  }

  const loaded = [];
  let entries;

  try {
    entries = fs.readdirSync(EXTENSIONS_DIR).sort();
  } catch (err) {
    console.error(`[EXT] Failed to read extensions directory: ${err.message}`);
    return [];
  }

  for (const entry of entries) {
    const extPath = path.join(EXTENSIONS_DIR, entry);

    try {
      const stat = fs.statSync(extPath);
      if (!stat.isDirectory()) continue;

      // Check for package.json or index.js
      const hasPackageJson = fs.existsSync(path.join(extPath, "package.json"));
      const hasIndex = fs.existsSync(path.join(extPath, "index.js")) ||
                       fs.existsSync(path.join(extPath, "src", "index.js"));

      if (!hasPackageJson && !hasIndex) {
        console.warn(`[EXT] ${entry}: no package.json or index.js, skipping`);
        continue;
      }

      const ext = require(extPath);

      if (typeof ext.init !== "function") {
        console.warn(`[EXT] ${entry}: missing init() function, skipping`);
        continue;
      }

      ext.init(app, db, services);
      const info = { name: ext.name || entry, version: ext.version || "0.0.0" };
      loaded.push(info);
      console.log(`[EXT] Loaded: ${info.name} v${info.version}`);
    } catch (err) {
      console.error(`[EXT] Failed to load ${entry}: ${err.message}`);
    }
  }

  if (loaded.length > 0) {
    console.log(`[EXT] ${loaded.length} extension(s) loaded`);
  }

  return loaded;
}

module.exports = { loadExtensions };
