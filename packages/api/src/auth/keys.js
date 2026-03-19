const crypto = require("crypto");
const { signAccessToken, generateRefreshToken } = require("./jwt");

/**
 * Single-admin API key authentication.
 * The API_KEY env var is compared via constant-time hash comparison.
 */

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Validate an API key and return tokens */
function authenticateWithKey(providedKey) {
  const expectedKey = process.env.API_KEY;
  if (!expectedKey) {
    throw new Error("API_KEY not configured");
  }

  const providedHash = hashKey(providedKey);
  const expectedHash = hashKey(expectedKey);

  if (!crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(expectedHash))) {
    return null;
  }

  const userId = "admin";
  const role = "admin";

  const accessToken = signAccessToken({ sub: userId, role });
  const refreshToken = generateRefreshToken(userId, role);

  return { accessToken, refreshToken, userId, role };
}

module.exports = { authenticateWithKey };
