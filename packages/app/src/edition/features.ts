/**
 * Client-side feature definitions — mirrors the API's edition/features.js.
 * Used for UI-level gating (greying out, lock badges, upgrade prompts).
 * Actual enforcement is always server-side.
 */

export const FEATURE_EDITIONS: Record<string, string> = {
  // CE features
  containers: "ce",
  stacks: "ce",
  system_metrics: "ce",
  alerts_basic: "ce",
  sse_stream: "ce",
  cli: "ce",
  biometric_lock: "ce",
  webhooks_basic: "ce",
  schedules_basic: "ce",
  integrations_basic: "ce",

  // Pro features
  push_notifications: "pro",
  incidents: "pro",
  remediation: "pro",
  status_pages: "pro",
  uptime_monitoring: "pro",
  chatops: "pro",
  rbac: "pro",
  audit_trail: "pro",
  sla: "pro",
  multi_server: "pro",
  alerts_unlimited: "pro",
  webhooks_unlimited: "pro",
  schedules_unlimited: "pro",
  integrations_pro: "pro",
  reports: "pro",

  // Pro features (basic tier)
  push_basic: "pro",

  // Enterprise features
  sso_saml: "enterprise",
  white_label: "enterprise",
  custom_roles: "enterprise",
  ip_allowlist: "enterprise",
  mtls: "enterprise",
  encryption_at_rest: "enterprise",
  compliance_logging: "enterprise",
  integrations_unlimited: "enterprise",
};

export const EDITION_RANK: Record<string, number> = {
  ce: 0,
  pro: 1,
  enterprise: 2,
  private: 3,
};

export const EDITION_LABELS: Record<string, string> = {
  ce: "Community",
  pro: "Pro",
  enterprise: "Enterprise",
  private: "Private",
};

export function getRequiredEdition(feature: string): string | null {
  return FEATURE_EDITIONS[feature] || null;
}

// Default limits mirror — keep in sync with packages/api/src/edition/features.js.
// Used only for client-side fallback display; server response is authoritative.
export const CE_LIMITS: Record<string, number> = {
  servers: 3,
  alertRules: 5,
  users: 1,
  webhooks: 3,
  schedules: 5,
  integrations: 2,
  metricsRetentionDays: 30,
};

export const PRO_LIMITS: Record<string, number> = {
  servers: 20,
  alertRules: 100,
  users: 5,
  webhooks: 50,
  schedules: 50,
  integrations: 10,
  auditRetentionDays: 30,
  metricsRetentionDays: 365,
};
