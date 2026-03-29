const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { availableFeatures, defaultLimits, CE_LIMITS } = require("./features");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const GRACE_PERIOD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Load and validate the license key.
 * Checks LICENSE_KEY env var, then data/license.key file.
 * Returns a normalized edition object.
 *
 * License keys are RS256-signed JWTs verified with the bundled public key.
 * If no license key is found, defaults to CE edition.
 */
function loadLicense() {
  const ceEdition = {
    name: "ce",
    features: availableFeatures("ce"),
    limits: { ...CE_LIMITS },
    org: null,
    exp: null,
    graceMode: false,
  };

  // Try to find a license key
  let licenseKey = process.env.LICENSE_KEY;
  if (!licenseKey) {
    const keyFile = path.join(DATA_DIR, "license.key");
    try {
      if (fs.existsSync(keyFile)) {
        licenseKey = fs.readFileSync(keyFile, "utf-8").trim();
      }
    } catch {
      // No license file — CE mode
    }
  }

  if (!licenseKey) {
    console.log("[LICENSE] No license key found — running in CE mode");
    return ceEdition;
  }

  // Load public key for verification
  let publicKey;
  const pubKeyPath = path.join(__dirname, "license-pubkey.pem");
  try {
    publicKey = fs.readFileSync(pubKeyPath, "utf-8");
  } catch {
    console.warn("[LICENSE] No public key found at", pubKeyPath, "— falling back to CE mode");
    return ceEdition;
  }

  // Verify and decode
  try {
    const decoded = jwt.verify(licenseKey, publicKey, {
      algorithms: ["RS256"],
      issuer: "lagoon-cockpit-licensing",
      audience: "lagoon-cockpit-api",
    });

    const editionName = decoded.edition || "ce";
    const features = decoded.features || availableFeatures(editionName);
    const limits = decoded.limits || defaultLimits(editionName);

    console.log(
      `[LICENSE] Valid license: ${editionName} | org=${decoded.org || "none"} | expires=${decoded.exp ? new Date(decoded.exp * 1000).toISOString() : "never"}`,
    );

    return {
      name: editionName,
      features,
      limits,
      org: decoded.org || null,
      customer: decoded.sub || null,
      exp: decoded.exp || null,
      graceMode: false,
    };
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      // Check grace period
      const expiredAt = err.expiredAt?.getTime() || 0;
      const graceEnd = expiredAt + GRACE_PERIOD_MS;

      if (Date.now() < graceEnd) {
        // Within grace period — decode without verification to get claims
        const decoded = jwt.decode(licenseKey);
        const editionName = decoded?.edition || "ce";
        const daysLeft = Math.ceil((graceEnd - Date.now()) / (24 * 60 * 60 * 1000));

        console.warn(
          `[LICENSE] License expired but within grace period (${daysLeft} days left) — ${editionName} features still active`,
        );

        return {
          name: editionName,
          features: decoded?.features || availableFeatures(editionName),
          limits: decoded?.limits || defaultLimits(editionName),
          org: decoded?.org || null,
          customer: decoded?.sub || null,
          exp: decoded?.exp || null,
          graceMode: true,
          graceDaysLeft: daysLeft,
        };
      }

      console.warn("[LICENSE] License expired and grace period ended — falling back to CE");
      return ceEdition;
    }

    console.error("[LICENSE] Invalid license key:", err.message, "— falling back to CE");
    return ceEdition;
  }
}

module.exports = { loadLicense };
