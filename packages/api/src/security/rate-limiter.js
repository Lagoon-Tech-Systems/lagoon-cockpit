/**
 * Sliding window rate limiter.
 * Tracks request timestamps per IP with configurable window and max requests.
 * Memory-efficient: entries auto-expire via periodic cleanup.
 */

const windows = new Map(); // key -> [timestamps]

const DEFAULTS = {
  windowMs: 60 * 1000, // 1 minute
  max: 100, // requests per window
};

/**
 * Create a rate limiting middleware.
 * @param {object} opts - { windowMs, max, keyFn, message }
 */
function createRateLimiter(opts = {}) {
  const windowMs = opts.windowMs || DEFAULTS.windowMs;
  const max = opts.max || DEFAULTS.max;
  const keyFn = opts.keyFn || ((req) => req.ip || req.connection.remoteAddress);
  const message = opts.message || "Too many requests. Please try again later.";

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = windows.get(key);
    if (!timestamps) {
      timestamps = [];
      windows.set(key, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= max) {
      const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      res.set("X-RateLimit-Limit", String(max));
      res.set("X-RateLimit-Remaining", "0");
      res.set("X-RateLimit-Reset", String(Math.ceil((timestamps[0] + windowMs) / 1000)));
      return res.status(429).json({ error: message });
    }

    timestamps.push(now);
    res.set("X-RateLimit-Limit", String(max));
    res.set("X-RateLimit-Remaining", String(max - timestamps.length));
    next();
  };
}

/** Global rate limiter (100 req/min per IP) */
const globalLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
});

/** Strict limiter for sensitive endpoints (10 req/min per IP) */
const strictLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: "Too many requests to this endpoint. Please try again later.",
});

// Cleanup stale entries every 5 minutes
setInterval(
  () => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [key, timestamps] of windows) {
      while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
      if (timestamps.length === 0) windows.delete(key);
    }
  },
  5 * 60 * 1000,
);

module.exports = { createRateLimiter, globalLimiter, strictLimiter };
