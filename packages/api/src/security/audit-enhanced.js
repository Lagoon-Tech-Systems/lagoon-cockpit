const { requestFingerprint } = require("./crypto");

/**
 * Enhanced audit logging middleware.
 * Logs every mutation (POST/PUT/DELETE) with IP, user agent, and request fingerprint.
 * Read-only requests (GET, HEAD, OPTIONS) are not logged.
 */

const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);
const SKIP_PATHS = new Set(["/health", "/", "/api/stream"]);

/**
 * Create enhanced audit middleware.
 * @param {Function} auditLogFn - The auditLog(userId, action, target, detail) function from sqlite.js
 */
function enhancedAudit(auditLogFn) {
  return (req, res, next) => {
    if (!MUTATION_METHODS.has(req.method)) return next();
    if (SKIP_PATHS.has(req.path)) return next();

    // Capture response status after response is sent
    const originalEnd = res.end;
    res.end = function (...args) {
      const userId = req.user?.id || req.user?.email || "anonymous";
      const ip = req.ip || req.connection.remoteAddress || "unknown";
      const ua = (req.headers["user-agent"] || "unknown").slice(0, 256);
      const fingerprint = requestFingerprint(req);
      const requestId = res.getHeader("X-Request-ID") || "none";

      const detail = JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ip,
        ua,
        fingerprint,
        requestId,
      });

      try {
        auditLogFn(userId, `${req.method} ${req.path}`, req.path, detail);
      } catch {
        // Audit logging should never break the request
      }

      originalEnd.apply(res, args);
    };

    next();
  };
}

module.exports = { enhancedAudit };
