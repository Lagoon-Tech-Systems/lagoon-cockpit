import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useLicenseStore } from "./LicenseStore";
import { useServerStore } from "../stores/serverStore";
import { COLORS, SPACING, FONT } from "../theme/tokens";

interface EditionProviderProps {
  children: React.ReactNode;
}

/**
 * Edition context provider.
 * Fetches edition info from the API when the user authenticates.
 * Wraps the app root and displays a grace mode banner if needed.
 */
export function EditionProvider({ children }: EditionProviderProps) {
  const accessToken = useServerStore((s) => s.accessToken);
  const fetchEdition = useLicenseStore((s) => s.fetchEdition);
  const graceMode = useLicenseStore((s) => s.graceMode);
  const graceDaysLeft = useLicenseStore((s) => (s as any).graceDaysLeft);

  // Fetch edition info when authenticated
  useEffect(() => {
    if (accessToken) {
      fetchEdition();
    }
  }, [accessToken]);

  return (
    <View style={styles.container}>
      {graceMode && (
        <View style={styles.graceBanner}>
          <Text style={styles.graceText}>
            License expired — {graceDaysLeft || "few"} days remaining in grace period
          </Text>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  graceBanner: {
    backgroundColor: "#7C2D12",
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  graceText: {
    color: COLORS.yellow,
    ...FONT.body,
    fontSize: 12,
    textAlign: "center",
    fontWeight: "600",
  },
});
