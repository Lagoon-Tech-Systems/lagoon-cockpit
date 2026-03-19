const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "change-me-in-production") {
  console.error("[FATAL] JWT_SECRET must be set to a strong random value in .env");
  process.exit(1);
}
const ACCESS_TTL = "15m";
const REFRESH_TTL = "7d";

// In-memory refresh token store: Map<tokenHash, { userId, role, expiresAt }>
const refreshTokens = new Map();

/** Sign a new access token */
function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TTL });
}

/** Verify an access token */
function verifyAccessToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/** Generate a new refresh token and store it */
function generateRefreshToken(userId, role) {
  const token = crypto.randomBytes(48).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
  refreshTokens.set(hash, { userId, role, expiresAt });
  return token;
}

/** Validate a refresh token and return the payload */
function validateRefreshToken(token) {
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  const entry = refreshTokens.get(hash);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    refreshTokens.delete(hash);
    return null;
  }
  // Rotate: delete old token (caller should issue a new one)
  refreshTokens.delete(hash);
  return { userId: entry.userId, role: entry.role };
}

/** Cleanup expired refresh tokens (call periodically) */
function cleanupRefreshTokens() {
  const now = Date.now();
  for (const [hash, entry] of refreshTokens) {
    if (now > entry.expiresAt) refreshTokens.delete(hash);
  }
}

// Cleanup every hour
setInterval(cleanupRefreshTokens, 60 * 60 * 1000);

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  validateRefreshToken,
};
