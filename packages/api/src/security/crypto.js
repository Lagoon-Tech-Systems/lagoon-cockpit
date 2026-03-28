const crypto = require("crypto");

/**
 * Centralized crypto utilities.
 * All cryptographic operations should use these helpers for consistency.
 */

/** Constant-time string comparison (prevents timing attacks) */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still run timingSafeEqual to prevent length-based timing leaks
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Generate a cryptographically secure random hex string */
function secureRandom(bytes = 32) {
  return crypto.randomBytes(bytes).toString("hex");
}

/** SHA-256 hash of a string */
function sha256(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** HMAC-SHA256 for request signing / webhook verification */
function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest("hex");
}

/** Generate a UUID v4 */
function generateId() {
  return crypto.randomUUID();
}

/** Generate a request fingerprint from IP + User-Agent */
function requestFingerprint(req) {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  return sha256(`${ip}:${ua}`).slice(0, 16);
}

module.exports = {
  timingSafeEqual,
  secureRandom,
  sha256,
  hmacSha256,
  generateId,
  requestFingerprint,
};
