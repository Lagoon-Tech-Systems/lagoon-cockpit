const fs = require("fs");
const path = require("path");

const DEFAULT_EXTENSIONS_DIR = path.resolve(__dirname, "..", "..", "extensions");
const EXTENSIONS_DIR = process.env.EXTENSIONS_DIR ? path.resolve(process.env.EXTENSIONS_DIR) : DEFAULT_EXTENSIONS_DIR;

/**
 * Load all extensions from the extensions directory.
 * Each extension must export: { name, version, init(app, services) }
 *
 * Security:
 *   - EXTENSIONS_DIR must resolve to the default path or an absolute path
 *   - Symlinks are resolved and validated against the base directory
 *   - Extensions get a scoped router (force-prefixed to /api/ext/<name>)
 *   - Extensions do NOT get raw db or app access
 *
 * Extensions are loaded in alphabetical order by directory name.
 */
function loadExtensions(app, db, services) {
  // Validate extensions directory is safe
  if (EXTENSIONS_DIR !== DEFAULT_EXTENSIONS_DIR) {
    console.warn(`[EXT] Custom EXTENSIONS_DIR: ${EXTENSIONS_DIR}`);
  }

  if (!fs.existsSync(EXTENSIONS_DIR)) {
    return [];
  }

  // Resolve real path to prevent symlink escapes
  let realDir;
  try {
    realDir = fs.realpathSync(EXTENSIONS_DIR);
  } catch (err) {
    console.error(`[EXT] Cannot resolve extensions directory: ${err.message}`);
    return [];
  }

  const loaded = [];
  let entries;

  try {
    entries = fs.readdirSync(realDir).sort();
  } catch (err) {
    console.error(`[EXT] Failed to read extensions directory: ${err.message}`);
    return [];
  }

  for (const entry of entries) {
    const extPath = path.join(realDir, entry);

    try {
      // Resolve real path to catch symlinks pointing outside extensions dir
      const realExtPath = fs.realpathSync(extPath);
      if (!realExtPath.startsWith(realDir + path.sep) && realExtPath !== realDir) {
        console.warn(`[EXT] ${entry}: symlink escapes extensions directory, skipping`);
        continue;
      }

      const stat = fs.statSync(realExtPath);
      if (!stat.isDirectory()) continue;

      // Check for package.json or index.js
      const hasPackageJson = fs.existsSync(path.join(realExtPath, "package.json"));
      const hasIndex =
        fs.existsSync(path.join(realExtPath, "index.js")) || fs.existsSync(path.join(realExtPath, "src", "index.js"));

      if (!hasPackageJson && !hasIndex) {
        console.warn(`[EXT] ${entry}: no package.json or index.js, skipping`);
        continue;
      }

      const ext = require(realExtPath);

      if (typeof ext.init !== "function") {
        console.warn(`[EXT] ${entry}: missing init() function, skipping`);
        continue;
      }

      // Create a scoped services object (no raw db handle)
      const express = require("express");
      const extRouter = express.Router();
      const extName = ext.name || entry;

      const scopedServices = {
        broadcast: services.broadcast,
        sendPushNotification: services.sendPushNotification,
        auditLog: services.auditLog,
        alertEngine: services.alertEngine,
        metricsHistory: services.metricsHistory,
        webhooks: services.webhooks,
        db: createScopedDb(db, extName),
      };

      ext.init(extRouter, scopedServices);

      // Mount public routes WITHOUT auth (if extension exposes them)
      if (ext.publicRoutes) {
        app.use(`/api/ext/${extName}/status-pages`, ext.publicRoutes);
      }

      // Mount extension router under /api/ext/<name> (auth required)
      const { requireAuth } = require("../auth/middleware");
      app.use(`/api/ext/${extName}`, requireAuth, extRouter);

      const info = { name: extName, version: ext.version || "0.0.0" };
      loaded.push(info);
      console.log(`[EXT] Loaded: ${info.name} v${info.version} -> /api/ext/${extName}`);
    } catch (err) {
      console.error(`[EXT] Failed to load ${entry}: ${err.message}`);
    }
  }

  if (loaded.length > 0) {
    console.log(`[EXT] ${loaded.length} extension(s) loaded`);
  }

  return loaded;
}

/**
 * Create a scoped DB interface for extensions.
 * Extensions can only create/access tables prefixed with ext_<name>_.
 */
function createScopedDb(db, extName) {
  const prefix = `ext_${extName.replace(/[^a-z0-9]/gi, "_")}_`;

  return {
    exec(sql) {
      validateExtSql(sql, prefix);
      return db.exec(sql);
    },
    prepare(sql) {
      validateExtSql(sql, prefix);
      return db.prepare(sql);
    },
  };
}

function validateExtSql(sql, prefix) {
  // Normalize: strip CTE wrappers so the inner bodies get validated too.
  // CTEs use "WITH name AS (SELECT ...)" syntax and can nest dangerous statements
  // that would bypass table-name checks if only the outer query is inspected.
  const normalized = stripCteWrappers(sql);

  // Block dangerous DDL/DCL statements that extensions must never execute,
  // regardless of table prefix. Check the full (normalized) SQL.
  const dangerousPatterns = [
    /\bDROP\s+TABLE\b/i,
    /\bDROP\s+INDEX\b/i,
    /\bALTER\s+TABLE\b/i,
    /\bATTACH\s+DATABASE\b/i,
    /\bDETACH\s+DATABASE\b/i,
    /\bPRAGMA\b/i,
    /\bCREATE\s+TRIGGER\b/i,
    /\bCREATE\s+VIEW\b/i,
    /\bLOAD_EXTENSION\b/i,
  ];
  for (const pattern of dangerousPatterns) {
    if (pattern.test(normalized)) {
      throw new Error(`Extension "${prefix.slice(4, -1)}" cannot execute prohibited SQL statement.`);
    }
  }

  // Allow CREATE TABLE, INSERT, SELECT, UPDATE, DELETE only on ext_ prefixed tables.
  // Run against the normalized SQL so CTE bodies are included.
  const tablePattern = /(?:FROM|INTO|UPDATE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+(\w+)/gi;
  let match;
  while ((match = tablePattern.exec(normalized)) !== null) {
    const tableName = match[1].toLowerCase();
    if (!tableName.startsWith(prefix.toLowerCase()) && tableName !== "sqlite_master") {
      throw new Error(`Extension "${prefix.slice(4, -1)}" cannot access table "${match[1]}". Use "${prefix}" prefix.`);
    }
  }
}

/**
 * Strip CTE (WITH ... AS (...)) wrappers so the bodies are exposed for validation.
 * Returns the SQL with CTE definitions inlined as plain text (parentheses removed)
 * so table-name patterns inside CTEs are caught by the main regex.
 */
function stripCteWrappers(sql) {
  // Match WITH ... AS (...), ... AS (...) prefix.
  // We do a simple parenthesis-depth walk to correctly find the CTE bodies
  // even when they contain nested parentheses.
  const withMatch = sql.match(/^\s*WITH\s+/i);
  if (!withMatch) return sql;

  // Walk past the WITH keyword and collect all CTE body text + the final query
  let pos = withMatch[0].length;
  let result = "";

  while (pos < sql.length) {
    // Skip CTE name and optional column list up to "AS"
    const asMatch = sql.slice(pos).match(/^[\w]+\s*(?:\([^)]*\))?\s*AS\s*/i);
    if (!asMatch) break;
    pos += asMatch[0].length;

    // Extract the parenthesized CTE body by counting depth
    if (sql[pos] !== "(") break;
    let depth = 1;
    const bodyStart = pos + 1;
    pos++;
    while (pos < sql.length && depth > 0) {
      if (sql[pos] === "(") depth++;
      else if (sql[pos] === ")") depth--;
      pos++;
    }
    // bodyStart..pos-1 is the CTE body (without outer parens)
    result += " " + sql.slice(bodyStart, pos - 1);

    // Skip optional comma between CTEs
    const commaMatch = sql.slice(pos).match(/^\s*,\s*/);
    if (commaMatch) {
      pos += commaMatch[0].length;
    } else {
      break;
    }
  }

  // Append the main query after the CTEs
  result += " " + sql.slice(pos);
  return result;
}

module.exports = { loadExtensions };
