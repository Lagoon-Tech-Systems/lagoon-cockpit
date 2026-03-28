import { useLicenseStore } from "./LicenseStore";

/**
 * Hook for accessing edition state throughout the app.
 * Returns the current edition, feature check function, and limits.
 */
export function useEdition() {
  const edition = useLicenseStore((s) => s.edition);
  const hasFeature = useLicenseStore((s) => s.hasFeature);
  const getLimit = useLicenseStore((s) => s.getLimit);
  const isLoaded = useLicenseStore((s) => s.isLoaded);
  const graceMode = useLicenseStore((s) => s.graceMode);
  const org = useLicenseStore((s) => s.org);
  const limits = useLicenseStore((s) => s.limits);

  return {
    edition,
    hasFeature,
    getLimit,
    isLoaded,
    graceMode,
    org,
    limits,
    isPro: edition === "pro" || edition === "enterprise" || edition === "private",
    isEnterprise: edition === "enterprise" || edition === "private",
    isPrivate: edition === "private",
    isCE: edition === "ce",
  };
}
