/**
 * Security module — aggregates all security middleware.
 * Import this single module to get the full security stack.
 */

const { securityHeaders } = require("./helmet");
const { globalLimiter, strictLimiter, createRateLimiter } = require("./rate-limiter");
const { validateBody } = require("./request-validator");
const { strictCors } = require("./cors-strict");
const { enhancedAudit } = require("./audit-enhanced");
const crypto = require("./crypto");

/**
 * Generate X-Request-ID middleware for request tracing.
 */
function requestId() {
  return (req, res, next) => {
    const id = req.headers["x-request-id"] || crypto.generateId();
    req.requestId = id;
    res.set("X-Request-ID", id);
    next();
  };
}

/**
 * HTTPS enforcement middleware (when FORCE_HTTPS=true).
 * Redirects HTTP → HTTPS and sets HSTS.
 */
function forceHttps() {
  const enabled = process.env.FORCE_HTTPS === "true";
  return (req, res, next) => {
    if (!enabled) return next();
    // Trust reverse proxy headers
    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    if (proto !== "https") {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  };
}

module.exports = {
  securityHeaders,
  globalLimiter,
  strictLimiter,
  createRateLimiter,
  validateBody,
  strictCors,
  enhancedAudit,
  requestId,
  forceHttps,
  crypto,
};
