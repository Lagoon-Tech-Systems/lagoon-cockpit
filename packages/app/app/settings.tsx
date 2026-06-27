import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { useAuthStore } from '../src/stores/authStore';
import { useNotificationStore } from '../src/stores/notificationStore';
import { useEdition } from '../src/edition/useEdition';
import { EDITION_LABELS } from '../src/edition/features';
import { RADIUS, SPACING, FONT } from '../src/theme/tokens';
import { useTheme } from '../src/theme/ThemeProvider';
import type { ThemeMode } from '../src/theme/themeStore';
import { GlassCard } from '../src/components/ui/GlassCard';

/* ── Theme mode option ───────────────────────── */
interface ThemeModeOption {
  value: ThemeMode;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const THEME_OPTIONS: ThemeModeOption[] = [
  { value: 'light', label: 'Light', icon: 'sunny' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'phone-portrait-outline' },
];

/* ── Settings row component ──────────────────── */
function SettingsRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  showChevron = false,
  rightElement,
  textPrimary,
  textSecondary,
  border,
  isLast = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightElement?: React.ReactNode;
  textPrimary: string;
  textSecondary: string;
  border: string;
  isLast?: boolean;
}) {
  const Container = onPress ? TouchableOpacity : View;
  return (
    <Container
      onPress={onPress}
      style={[rowStyles.container, !isLast && { borderBottomWidth: 1, borderBottomColor: border }]}
      activeOpacity={0.6}
    >
      <View style={[rowStyles.iconWrap, { backgroundColor: iconColor + '18' }]}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={rowStyles.content}>
        <Text style={[rowStyles.label, { color: textPrimary }]}>{label}</Text>
        {value ? <Text style={[rowStyles.value, { color: textSecondary }]}>{value}</Text> : null}
      </View>
      {rightElement}
      {showChevron && (
        <Ionicons name="chevron-forward" size={18} color={textSecondary} style={{ marginLeft: 4 }} />
      )}
    </Container>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: SPACING.lg,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  content: {
    flex: 1,
  },
  label: {
    ...FONT.bodyMedium,
    fontSize: 15,
  },
  value: {
    fontSize: 13,
    marginTop: 1,
  },
});

/* ── Section header ──────────────────────────── */
function SectionHeader({ title, color }: { title: string; color: string }) {
  return (
    <Text style={[sectionStyles.title, { color }]}>
      {title}
    </Text>
  );
}

const sectionStyles = StyleSheet.create({
  title: {
    ...FONT.label,
    fontSize: 13,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xxl,
    marginLeft: SPACING.xs,
  },
});

/* ── Main Settings Screen ────────────────────── */
export default function SettingsScreen() {
  const router = useRouter();
  const { colors, mode, setMode, isDark } = useTheme();
  const { profiles, activeProfileId, removeProfile, disconnect } = useServerStore();
  const { edition, org, graceMode, isLoaded: editionLoaded } = useEdition();
  const isRegistered = useNotificationStore((s) => s.isRegistered);
  const [biometricSupported, setBiometricSupported] = useState(false);
  const checkBiometricSupport = useAuthStore((s) => s.checkBiometricSupport);

  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  useEffect(() => {
    checkBiometricSupport().then(setBiometricSupported);
  }, [checkBiometricSupport]);

  const handleDisconnect = () => {
    Alert.alert('Disconnect', 'Are you sure you want to disconnect from the current server?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          disconnect();
          router.replace('/');
        },
      },
    ]);
  };

  const handleDeleteProfile = (id: string, name: string) => {
    Alert.alert('Remove Server', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeProfile(id);
          if (id === activeProfileId) router.replace('/');
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.bgDeep }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ── APPEARANCE ─────────────────────────── */}
      {/* Theme toggle hidden for launch — light mode not ready (B6).
          Restore this block when FORCE_DARK is removed from themeStore. */}

      {/* ── SERVERS ────────────────────────────── */}
      <SectionHeader title="Servers" color={colors.textSecondary} />
      <GlassCard noPadding>
        {profiles.map((profile: ServerProfile, index: number) => {
          const isActive = profile.id === activeProfileId;
          return (
            <View key={profile.id}>
              <SettingsRow
                icon={isActive ? 'radio-button-on' : 'radio-button-off'}
                iconColor={isActive ? colors.green : colors.textTertiary}
                label={profile.name}
                value={`${profile.url}${isActive ? ' (active)' : ''}`}
                onPress={() => handleDeleteProfile(profile.id, profile.name)}
                showChevron={false}
                textPrimary={colors.textPrimary}
                textSecondary={colors.textTertiary}
                border={colors.border}
                isLast={index === profiles.length - 1}
                rightElement={
                  <TouchableOpacity onPress={() => handleDeleteProfile(profile.id, profile.name)}>
                    <Ionicons name="trash-outline" size={18} color={colors.red} />
                  </TouchableOpacity>
                }
              />
            </View>
          );
        })}
        {profiles.length === 0 && (
          <View style={{ paddingHorizontal: SPACING.lg, paddingVertical: SPACING.lg }}>
            <Text style={{ color: colors.textTertiary, ...FONT.body }}>
              No servers configured
            </Text>
          </View>
        )}
      </GlassCard>
      <TouchableOpacity
        style={[styles.addBtn, { borderColor: colors.glassBorder }]}
        onPress={() => router.push('/')}
        activeOpacity={0.6}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.blue} style={{ marginRight: 6 }} />
        <Text style={[styles.addText, { color: colors.blue }]}>Add Server</Text>
      </TouchableOpacity>

      {/* ── NOTIFICATIONS ──────────────────────── */}
      <SectionHeader title="Notifications" color={colors.textSecondary} />
      <GlassCard noPadding>
        <SettingsRow
          icon="notifications-outline"
          iconColor={colors.orange}
          label="Push Notifications"
          value={isRegistered ? 'Enabled' : 'Not registered'}
          onPress={() => router.push('/manage/notifications')}
          showChevron
          textPrimary={colors.textPrimary}
          textSecondary={colors.textTertiary}
          border={colors.border}
          isLast
          rightElement={
            <View style={[styles.statusBadge, { backgroundColor: isRegistered ? colors.green + '20' : colors.red + '20' }]}>
              <View style={[styles.statusDot, { backgroundColor: isRegistered ? colors.green : colors.red }]} />
            </View>
          }
        />
      </GlassCard>

      {/* ── SECURITY ───────────────────────────── */}
      <SectionHeader title="Security" color={colors.textSecondary} />
      <GlassCard noPadding>
        <SettingsRow
          icon="finger-print"
          iconColor={colors.purple}
          label="Biometric Lock"
          value={biometricSupported ? 'Available' : 'Not available on this device'}
          textPrimary={colors.textPrimary}
          textSecondary={colors.textTertiary}
          border={colors.border}
          isLast={true}
          rightElement={
            <View style={[styles.statusBadge, { backgroundColor: biometricSupported ? colors.green + '20' : colors.textTertiary + '20' }]}>
              <Ionicons
                name={biometricSupported ? 'checkmark' : 'close'}
                size={14}
                color={biometricSupported ? colors.green : colors.textTertiary}
              />
            </View>
          }
        />
      </GlassCard>
      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        Auto-lock activates after 2 minutes in background.
      </Text>

      {/* ── ABOUT ──────────────────────────────── */}
      {editionLoaded && (
        <>
          <SectionHeader title="About" color={colors.textSecondary} />
          <GlassCard noPadding>
            <SettingsRow
              icon="information-circle-outline"
              iconColor={colors.blue}
              label="Version"
              value={appVersion}
              textPrimary={colors.textPrimary}
              textSecondary={colors.textTertiary}
              border={colors.border}
            />
            <SettingsRow
              icon={edition === 'ce' ? 'shield-outline' : 'shield-checkmark'}
              iconColor={edition === 'ce' ? colors.textTertiary : colors.green}
              label="Edition"
              value={EDITION_LABELS[edition] || edition}
              textPrimary={colors.textPrimary}
              textSecondary={colors.textTertiary}
              border={colors.border}
            />
            {org && (
              <SettingsRow
                icon="business-outline"
                iconColor={colors.indigo}
                label="Organization"
                value={org}
                textPrimary={colors.textPrimary}
                textSecondary={colors.textTertiary}
                border={colors.border}
              />
            )}
            <SettingsRow
              icon="key-outline"
              iconColor={graceMode ? colors.yellow : colors.green}
              label="License"
              value={
                graceMode
                  ? 'Expired (grace period active)'
                  : edition === 'ce'
                    ? 'Free — upgrade for more features'
                    : 'Active'
              }
              textPrimary={colors.textPrimary}
              textSecondary={colors.textTertiary}
              border={colors.border}
            />
            {/* AGPL §13: offer Corresponding Source to network users of this CE instance. */}
            <SettingsRow
              icon="logo-github"
              iconColor={colors.textSecondary}
              label="Source Code (AGPL-3.0)"
              value="github.com/Lagoon-Tech-Systems/lagoon-cockpit"
              onPress={() =>
                Linking.openURL('https://github.com/Lagoon-Tech-Systems/lagoon-cockpit')
              }
              showChevron
              textPrimary={colors.textPrimary}
              textSecondary={colors.textTertiary}
              border={colors.border}
              isLast
            />
          </GlassCard>
        </>
      )}

      {/* ── ACCOUNT ────────────────────────────── */}
      <SectionHeader title="Account" color={colors.textSecondary} />
      <TouchableOpacity
        style={[styles.disconnectBtn, { backgroundColor: colors.red + '12' }]}
        onPress={handleDisconnect}
        activeOpacity={0.6}
      >
        <Ionicons name="log-out-outline" size={18} color={colors.red} style={{ marginRight: 8 }} />
        <Text style={[styles.disconnectText, { color: colors.red }]}>Disconnect</Text>
      </TouchableOpacity>

      {/* Bottom spacing */}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.xl,
    paddingBottom: 40,
  },

  /* Theme segmented control */
  themeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: RADIUS.sm,
    padding: 3,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.sm - 2,
  },
  segmentText: {
    ...FONT.bodyMedium,
    fontSize: 12,
  },

  /* Server add button */
  addBtn: {
    marginTop: SPACING.sm,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addText: {
    ...FONT.bodyMedium,
    fontSize: 14,
  },

  /* Notification status */
  statusBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  /* Footnotes */
  footnote: {
    fontSize: 12,
    marginTop: SPACING.sm,
    marginLeft: SPACING.xs,
    lineHeight: 18,
  },

  /* Disconnect */
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
  },
  disconnectText: {
    ...FONT.bodyMedium,
    fontSize: 15,
  },
});
