/**
 * Sliding window rate limiter with pluggable store.
 * Default: in-memory Map. Drop-in Redis adapter for multi-instance scaling.
 */

// ── Store interface ──────────────────────────────────────────
// A store must implement: increment(key, windowMs) → { count, resetMs }

/** In-memory sliding window store (default) */
class MemoryStore {
  constructor() {
    this.windows = new Map();
    // Cleanup stale entries every 5 minutes
    this._cleanup = setInterval(
      () => {
        const cutoff = Date.now() - 5 * 60 * 1000;
        for (const [key, timestamps] of this.windows) {
          while (timestamps.length > 0 && timestamps[0] <= cutoff) timestamps.shift();
          if (timestamps.length === 0) this.windows.delete(key);
        }
      },
      5 * 60 * 1000,
    );
  }

  /** Returns { count, oldestTs } after recording the hit */
  increment(key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    timestamps.push(now);
    return { count: timestamps.length, oldestTs: timestamps[0] };
  }
}

/**
 * Redis store adapter (plug in when scaling to multiple instances).
 * Uses sorted sets with ZRANGEBYSCORE for sliding window.
 *
 * Usage:
 *   const Redis = require("ioredis");
 *   const redis = new Redis(process.env.REDIS_URL);
 *   const { setStore, RedisStore } = require("./rate-limiter");
 *   setStore(new RedisStore(redis));
 */
class RedisStore {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  async increment(key, windowMs) {
    const now = Date.now();
    const cutoff = now - windowMs;
    const rKey = `rl:${key}`;

    const pipeline = this.redis.pipeline();
    pipeline.zremrangebyscore(rKey, 0, cutoff);
    pipeline.zadd(rKey, now, `${now}:${Math.random()}`);
    pipeline.zcard(rKey);
    pipeline.zrange(rKey, 0, 0);
    pipeline.pexpire(rKey, windowMs);

    const results = await pipeline.exec();
    const count = results[2][1];
    const oldest = results[3][1];
    const oldestTs = oldest && oldest.length > 0 ? parseInt(oldest[0].split(":")[0], 10) : now;

    return { count, oldestTs };
  }
}

// Active store (swappable at runtime)
let activeStore = new MemoryStore();

/** Replace the rate limiter store (e.g., switch to Redis) */
function setStore(store) {
  activeStore = store;
}

const DEFAULTS = {
  windowMs: 60 * 1000,
  max: 100,
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

  return async (req, res, next) => {
    const key = keyFn(req);

    try {
      const { count, oldestTs } = await activeStore.increment(key, windowMs);

      res.set("X-RateLimit-Limit", String(max));

      if (count > max) {
        const retryAfter = Math.ceil((oldestTs + windowMs - Date.now()) / 1000);
        res.set("Retry-After", String(retryAfter));
        res.set("X-RateLimit-Remaining", "0");
        res.set("X-RateLimit-Reset", String(Math.ceil((oldestTs + windowMs) / 1000)));
        return res.status(429).json({ error: message });
      }

      res.set("X-RateLimit-Remaining", String(max - count));
      next();
    } catch (err) {
      // If store fails (e.g., Redis down), allow the request through
      console.error("[RATE-LIMIT] Store error:", err.message);
      next();
    }
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

/** Per-user rate limiter (200 req/min per user, falls back to per-IP) */
const userLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_USER_MAX || "200", 10),
  keyFn: (req) => (req.user && req.user.id ? `user:${req.user.id}` : req.ip || req.connection.remoteAddress),
});

module.exports = { createRateLimiter, globalLimiter, strictLimiter, userLimiter, setStore, RedisStore, MemoryStore };
