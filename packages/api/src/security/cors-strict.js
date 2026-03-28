/**
 * Strict CORS middleware.
 * - Production: only allowlisted origins
 * - No wildcard when CORS_ORIGINS is configured
 * - Preflight caching for 24 hours
 */

function strictCors(allowedOrigins = []) {
  return (req, res, next) => {
    const origin = req.headers.origin;

    if (allowedOrigins.length > 0) {
      // Strict mode: only allow configured origins
      if (origin && allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Vary", "Origin");
      }
      // If origin not in allowlist, no CORS headers are set → browser blocks the request
    } else {
      // Development fallback: allow all (only when no origins configured)
      res.header("Access-Control-Allow-Origin", "*");
    }

    res.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Expose-Headers", "X-Request-ID, X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After");
    res.header("Access-Control-Max-Age", "86400"); // Cache preflight for 24h

    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    next();
  };
}

module.exports = { strictCors };
