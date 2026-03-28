import React from "react";
import { View, Text, StyleSheet, Linking, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING, FONT } from "../theme/tokens";
import { EDITION_LABELS, getRequiredEdition } from "./features";

interface UpgradePromptProps {
  /** Feature key that triggered the prompt */
  feature: string;
  /** Optional compact mode (inline vs full-screen) */
  compact?: boolean;
}

/**
 * Shown when a user taps a feature they don't have access to.
 * Displays the required edition and a CTA to upgrade.
 */
export function UpgradePrompt({ feature, compact }: UpgradePromptProps) {
  const required = getRequiredEdition(feature);
  const label = required ? EDITION_LABELS[required] || required : "Pro";

  const handleUpgrade = () => {
    Linking.openURL("https://lagoontechsystems.com/upgrade");
  };

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <Ionicons name="lock-closed" size={14} color={COLORS.yellow} />
        <Text style={styles.compactText}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="lock-closed" size={32} color={COLORS.yellow} />
      </View>
      <Text style={styles.title}>{label} Feature</Text>
      <Text style={styles.description}>
        This feature requires the {label} edition. Upgrade to unlock advanced monitoring, incident management, and more.
      </Text>
      <TouchableOpacity style={styles.button} onPress={handleUpgrade}>
        <Text style={styles.buttonText}>Learn More</Text>
        <Ionicons name="open-outline" size={16} color={COLORS.bg} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.xxl,
    gap: SPACING.md,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.yellow + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.sm,
  },
  title: {
    color: COLORS.textPrimary,
    ...FONT.title,
    textAlign: "center",
  },
  description: {
    color: COLORS.textSecondary,
    ...FONT.body,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.xs,
    backgroundColor: COLORS.yellow,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  buttonText: {
    color: COLORS.bg,
    fontWeight: "700",
    fontSize: 15,
  },
  // Compact variant (for inline badges)
  compactContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: COLORS.yellow + "20",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  compactText: {
    color: COLORS.yellow,
    fontSize: 10,
    fontWeight: "700",
  },
});
