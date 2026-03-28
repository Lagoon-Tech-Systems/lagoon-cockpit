import React from "react";
import { useEdition } from "./useEdition";
import { UpgradePrompt } from "./UpgradePrompt";

interface FeatureGateProps {
  /** Feature key to check (e.g., "incidents", "push_notifications") */
  feature: string;
  /** Content to render if feature is available */
  children: React.ReactNode;
  /** Optional custom fallback (defaults to UpgradePrompt) */
  fallback?: React.ReactNode;
  /** If true, hides children entirely instead of showing upgrade prompt */
  hidden?: boolean;
}

/**
 * Conditionally renders children based on the current edition.
 * If the feature is not available, shows an upgrade prompt or custom fallback.
 *
 * Usage:
 *   <FeatureGate feature="incidents">
 *     <IncidentList />
 *   </FeatureGate>
 */
export function FeatureGate({ feature, children, fallback, hidden }: FeatureGateProps) {
  const { hasFeature } = useEdition();

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  if (hidden) return null;

  if (fallback) return <>{fallback}</>;

  return <UpgradePrompt feature={feature} />;
}
