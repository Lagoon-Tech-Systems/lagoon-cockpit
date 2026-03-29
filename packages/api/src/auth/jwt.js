const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change-me-in-production") {
  console.error("[FATAL] JWT_SECRET must be set to a strong random value in .env");
  process.exit(1);
}
const ACCESS_TTL = "15m";
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let db = null;

/** Initialize JWT module with SQLite database for persistent refresh tokens */
function initJwt(database) {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      fingerprint TEXT,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_expires ON refresh_tokens(expires_at);
  `);

  // Cleanup expired tokens on init
  cleanupRefreshTokens();
}

/** Sign a new access token with unique jti for revocation tracking */
function signAccessToken(payload) {
  const jti = crypto.randomUUID();
  return jwt.sign({ ...payload, jti }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/** Verify an access token */
function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
}

/**
 * Generate a new refresh token and store it in SQLite.
 * @param {string} userId
 * @param {string} role
 * @param {string} [fingerprint] - Optional request fingerprint for binding
 * @returns {string} The raw refresh token (send to client)
 */
function generateRefreshToken(userId, role, fingerprint) {
  const token = crypto.randomBytes(48).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + REFRESH_TTL_MS;

  if (db) {
    db.prepare("INSERT INTO refresh_tokens (hash, user_id, role, fingerprint, expires_at) VALUES (?, ?, ?, ?, ?)").run(
      hash,
      userId,
      role,
      fingerprint || null,
      expiresAt,
    );
  }

  return token;
}

/**
 * Validate a refresh token. Implements one-time-use rotation:
 * the token is deleted on use, caller must issue a new one.
 * @param {string} token - The raw refresh token
 * @param {string} [fingerprint] - Optional fingerprint to validate binding
 * @returns {{ userId: string, role: string } | null}
 */
function validateRefreshToken(token, fingerprint) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  if (!db) return null;

  // H8: Wrap read + delete in a transaction to prevent race conditions
  // where the same refresh token could be used concurrently
  const result = db.transaction(() => {
    const entry = db.prepare("SELECT * FROM refresh_tokens WHERE hash = ?").get(hash);
    if (!entry) return null;

    // Always delete the token (one-time use rotation)
    db.prepare("DELETE FROM refresh_tokens WHERE hash = ?").run(hash);

    // Check expiration
    if (Date.now() > entry.expires_at) return null;

    // Check fingerprint binding if configured and present
    if (entry.fingerprint && fingerprint && entry.fingerprint !== fingerprint) {
      console.warn(`[AUTH] Refresh token fingerprint mismatch for user ${entry.user_id}`);
      // Potential token theft — revoke all tokens for this user
      db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(entry.user_id);
      return null;
    }

    return { userId: entry.user_id, role: entry.role };
  })();

  return result;
}

/** Revoke all refresh tokens for a user (e.g., on password change or forced logout) */
function revokeUserTokens(userId) {
  if (!db) return;
  db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").run(userId);
}

/** Cleanup expired refresh tokens */
function cleanupRefreshTokens() {
  if (!db) return;
  const deleted = db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?").run(Date.now());
  if (deleted.changes > 0) {
    console.log(`[AUTH] Cleaned up ${deleted.changes} expired refresh tokens`);
  }
}

// Cleanup every hour
setInterval(cleanupRefreshTokens, 60 * 60 * 1000);

module.exports = {
  initJwt,
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  validateRefreshToken,
  revokeUserTokens,
};
