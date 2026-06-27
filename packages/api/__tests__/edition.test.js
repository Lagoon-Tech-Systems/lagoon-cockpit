const { hasFeature, availableFeatures, defaultLimits, resolveRetentionDays, CE_LIMITS, PRO_LIMITS } = require("../src/edition/features");

describe("Edition Features", () => {
  test("CE has basic container features", () => {
    expect(hasFeature("ce", "containers")).toBe(true);
    expect(hasFeature("ce", "stacks")).toBe(true);
    expect(hasFeature("ce", "system_metrics")).toBe(true);
    expect(hasFeature("ce", "sse_stream")).toBe(true);
  });

  test("CE does not have Pro features", () => {
    expect(hasFeature("ce", "incidents")).toBe(false);
    expect(hasFeature("ce", "remediation")).toBe(false);
    expect(hasFeature("ce", "status_pages")).toBe(false);
    expect(hasFeature("ce", "sso_saml")).toBe(false);
  });

  test("Pro has CE + Pro features", () => {
    expect(hasFeature("pro", "containers")).toBe(true);
    expect(hasFeature("pro", "incidents")).toBe(true);
    expect(hasFeature("pro", "remediation")).toBe(true);
    expect(hasFeature("pro", "uptime_monitoring")).toBe(true);
  });

  test("Pro does not have Enterprise features", () => {
    expect(hasFeature("pro", "sso_saml")).toBe(false);
    expect(hasFeature("pro", "white_label")).toBe(false);
  });

  test("Enterprise has everything except private-only", () => {
    expect(hasFeature("enterprise", "containers")).toBe(true);
    expect(hasFeature("enterprise", "incidents")).toBe(true);
    expect(hasFeature("enterprise", "sso_saml")).toBe(true);
    expect(hasFeature("enterprise", "white_label")).toBe(true);
  });

  test("Private has everything", () => {
    expect(hasFeature("private", "containers")).toBe(true);
    expect(hasFeature("private", "incidents")).toBe(true);
    expect(hasFeature("private", "sso_saml")).toBe(true);
    expect(hasFeature("private", "white_label")).toBe(true);
  });

  test("Unknown feature returns false", () => {
    expect(hasFeature("private", "nonexistent_feature")).toBe(false);
    expect(hasFeature("ce", "")).toBe(false);
  });

  test("CE limits are correct", () => {
    const limits = defaultLimits("ce");
    expect(limits.servers).toBe(3);
    expect(limits.alertRules).toBe(5);
    expect(limits.users).toBe(1);
    expect(limits.webhooks).toBe(3);
    expect(limits.integrations).toBe(2);
  });

  test("Pro limits are higher", () => {
    const limits = defaultLimits("pro");
    expect(limits.servers).toBe(20);
    expect(limits.alertRules).toBe(100);
    expect(limits.integrations).toBe(10);
  });

  test("Private/Enterprise have no limits", () => {
    const privLimits = defaultLimits("private");
    const entLimits = defaultLimits("enterprise");
    expect(Object.keys(privLimits)).toHaveLength(0);
    expect(Object.keys(entLimits)).toHaveLength(0);
  });

  test("metricsRetentionDays present in both limit maps with values 90/365", () => {
    expect(CE_LIMITS.metricsRetentionDays).toBe(90);
    expect(PRO_LIMITS.metricsRetentionDays).toBe(365);
  });

  test("defaultLimits surfaces metricsRetentionDays for ce and pro", () => {
    expect(defaultLimits("ce").metricsRetentionDays).toBe(90);
    expect(defaultLimits("pro").metricsRetentionDays).toBe(365);
  });

  test("availableFeatures returns correct count per edition", () => {
    const ceFeatures = availableFeatures("ce");
    const proFeatures = availableFeatures("pro");
    const entFeatures = availableFeatures("enterprise");
    expect(ceFeatures.length).toBeGreaterThan(0);
    expect(proFeatures.length).toBeGreaterThan(ceFeatures.length);
    expect(entFeatures.length).toBeGreaterThan(proFeatures.length);
  });
});

describe("resolveRetentionDays", () => {
  test("enterprise resolves to 730 regardless of limits", () => {
    expect(resolveRetentionDays({ name: "enterprise", limits: {} })).toBe(730);
  });

  test("private resolves to 730 regardless of limits", () => {
    expect(resolveRetentionDays({ name: "private", limits: {} })).toBe(730);
  });

  test("ce without metricsRetentionDays claim resolves to 90", () => {
    expect(resolveRetentionDays({ name: "ce", limits: {} })).toBe(90);
  });

  test("pro WITHOUT metricsRetentionDays claim falls back to 365, not the CE floor", () => {
    // pre-existing Pro JWT minted before this feature has no claim
    expect(resolveRetentionDays({ name: "pro", limits: {} })).toBe(365);
  });

  test("explicit finite limit wins for ce and pro", () => {
    expect(resolveRetentionDays({ name: "ce", limits: { metricsRetentionDays: 30 } })).toBe(30);
    expect(resolveRetentionDays({ name: "pro", limits: { metricsRetentionDays: 365 } })).toBe(365);
  });

  test("unknown / missing edition fails closed to CE floor (90)", () => {
    expect(resolveRetentionDays(undefined)).toBe(90);
    expect(resolveRetentionDays({})).toBe(90);
    expect(resolveRetentionDays({ name: "bogus", limits: {} })).toBe(90);
  });

  test("non-finite limit value is ignored (falls back by edition name)", () => {
    expect(resolveRetentionDays({ name: "pro", limits: { metricsRetentionDays: Infinity } })).toBe(365);
    expect(resolveRetentionDays({ name: "ce", limits: { metricsRetentionDays: NaN } })).toBe(90);
  });
});

describe("metricsRetentionDays cross-surface parity", () => {
  const proSharedEdition = require("/home/bigabou/automation/projects/cockpit-pro/packages/shared/src/edition.js");

  test("CE value matches across API and cockpit-pro shared", () => {
    expect(CE_LIMITS.metricsRetentionDays).toBe(90);
    expect(proSharedEdition.CE_LIMITS.metricsRetentionDays).toBe(90);
    expect(proSharedEdition.CE_LIMITS.metricsRetentionDays).toBe(CE_LIMITS.metricsRetentionDays);
  });

  test("Pro value matches across API and cockpit-pro shared", () => {
    expect(PRO_LIMITS.metricsRetentionDays).toBe(365);
    expect(proSharedEdition.PRO_LIMITS.metricsRetentionDays).toBe(365);
    expect(proSharedEdition.PRO_LIMITS.metricsRetentionDays).toBe(PRO_LIMITS.metricsRetentionDays);
  });
});
