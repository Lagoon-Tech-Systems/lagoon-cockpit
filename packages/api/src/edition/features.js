/**
 * Feature registry — defines which features belong to which edition.
 * This is the single source of truth for feature gating across the entire app.
 */

// Every feature and the minimum edition that includes it
const FEATURE_EDITIONS = {
  // ── CE features (always available) ───────────────────────
  containers: "ce",
  stacks: "ce",
  system_metrics: "ce",
  alerts_basic: "ce", // up to CE limit
  sse_stream: "ce",
  cli: "ce",
  biometric_lock: "ce",
  push_basic: "ce", // registration only, no advanced channels
  webhooks_basic: "ce", // up to CE limit
  schedules_basic: "ce", // up to CE limit
  integrations_basic: "ce", // up to CE limit (2 built-in)

  // ── Pro features ─────────────────────────────────────────
  push_notifications: "pro",
  incidents: "pro",
  remediation: "pro",
  status_pages: "pro",
  uptime_monitoring: "pro",
  chatops: "pro",
  rbac: "pro",
  audit_trail: "pro",
  sla: "pro",
  multi_server: "pro", // unlimited servers
  alerts_unlimited: "pro",
  webhooks_unlimited: "pro",
  schedules_unlimited: "pro",
  integrations_pro: "pro", // up to Pro limit (10)
  reports: "pro",

  // ── Enterprise features ──────────────────────────────────
  sso_saml: "enterprise",
  white_label: "enterprise",
  custom_roles: "enterprise",
  ip_allowlist: "enterprise",
  mtls: "enterprise",
  encryption_at_rest: "enterprise",
  integrations_unlimited: "enterprise",
  compliance_logging: "enterprise",
};

// Edition hierarchy (higher rank includes all lower features)
const EDITION_RANK = {
  ce: 0,
  pro: 1,
  enterprise: 2,
  private: 3, // Private gets everything
};

// Default limits for CE (no license key)
const CE_LIMITS = {
  servers: 3,
  alertRules: 5,
  users: 1,
  webhooks: 3,
  schedules: 5,
  integrations: 2,
};

// Default limits for Pro
const PRO_LIMITS = {
  servers: 20,
  alertRules: 100,
  users: 5,
  webhooks: 50,
  schedules: 50,
  integrations: 10,
  auditRetentionDays: 30,
};

/**
 * Check if an edition has access to a feature.
 * @param {string} editionName - "ce", "pro", "enterprise", or "private"
 * @param {string} feature - Feature key from FEATURE_EDITIONS
 * @returns {boolean}
 */
function hasFeature(editionName, feature) {
  const required = FEATURE_EDITIONS[feature];
  if (!required) return false;
  if (editionName === "private") return true;
  const editionRank = EDITION_RANK[editionName] ?? 0;
  const requiredRank = EDITION_RANK[required] ?? 0;
  return editionRank >= requiredRank;
}

/**
 * Get the minimum edition required for a feature.
 * @param {string} feature
 * @returns {string|null}
 */
function requiredEdition(feature) {
  return FEATURE_EDITIONS[feature] || null;
}

/**
 * Get all features available for an edition.
 * @param {string} editionName
 * @returns {string[]}
 */
function availableFeatures(editionName) {
  return Object.keys(FEATURE_EDITIONS).filter((f) => hasFeature(editionName, f));
}

/**
 * Get the default limits for an edition.
 * @param {string} editionName
 * @returns {object}
 */
function defaultLimits(editionName) {
  if (editionName === "private" || editionName === "enterprise") {
    return {}; // No limits
  }
  if (editionName === "pro") return { ...PRO_LIMITS };
  return { ...CE_LIMITS };
}

module.exports = {
  FEATURE_EDITIONS,
  EDITION_RANK,
  CE_LIMITS,
  PRO_LIMITS,
  hasFeature,
  requiredEdition,
  availableFeatures,
  defaultLimits,
};
