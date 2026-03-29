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

/** Derive a 256-bit key from a passphrase (deterministic, for at-rest encryption) */
function deriveKey(secret) {
  return crypto.createHash("sha256").update(secret).digest();
}

/** AES-256-GCM encrypt. Returns "iv:authTag:ciphertext" (all hex). */
function encrypt(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let enc = cipher.update(plaintext, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}

/** AES-256-GCM decrypt. Input format: "iv:authTag:ciphertext" (all hex). */
function decrypt(encrypted, secret) {
  const key = deriveKey(secret);
  const [ivHex, tagHex, ciphertext] = encrypted.split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  let dec = decipher.update(ciphertext, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
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
  encrypt,
  decrypt,
};
