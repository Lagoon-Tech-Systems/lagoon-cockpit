const { verifyAccessToken } = require("./jwt");

// Rate limiting for auth endpoints
const failedAttempts = new Map(); // IP -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/** Check if IP is rate limited */
function isRateLimited(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    failedAttempts.delete(ip);
    return false;
  }
  return false;
}

/** Record a failed auth attempt */
function recordFailedAttempt(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: null };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
  }
  failedAttempts.set(ip, entry);
}

/** Clear failed attempts on success */
function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

// Periodically clean up expired lockouts to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of failedAttempts) {
    if (entry.lockedUntil && now >= entry.lockedUntil) {
      failedAttempts.delete(ip);
    }
  }
}, 60 * 60 * 1000); // Every hour

/** Rate limit middleware for auth routes */
function rateLimitAuth(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Too many failed attempts. Try again in 15 minutes.",
    });
  }
  req._authIp = ip;
  next();
}

/** JWT authentication middleware */
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid Authorization header" });
  }

  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
}

/** Role check middleware factory */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = {
  rateLimitAuth,
  recordFailedAttempt,
  clearFailedAttempts,
  requireAuth,
  requireRole,
};
