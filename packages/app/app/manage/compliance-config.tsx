import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

interface ComplianceConfig {
  retention_days: number;
  auto_export: boolean;
  chain_verification: boolean;
  export_format?: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/* ---------- Staggered Animation ---------- */

function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      {children}
    </Animated.View>
  );
}

/* ---------- Screen ---------- */

function ComplianceConfigContent() {
  const router = useRouter();

  const [config, setConfig] = useState<ComplianceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [applyingRetention, setApplyingRetention] = useState(false);

  const fetchConfig = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ComplianceConfig>(`${ENT_API}/compliance/config`);
      setConfig(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load config');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchConfig(false);
    setRefreshing(false);
  };

  const handleUpdateConfig = async (updates: Partial<ComplianceConfig>) => {
    if (!config) return;
    setSaving(true);
    try {
      const body = { ...config, ...updates };
      await apiFetch(`${ENT_API}/compliance/config`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await fetchConfig(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to update config');
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyChain = async () => {
    setVerifying(true);
    try {
      const res = await apiFetch<{ valid: boolean; message?: string }>(`${ENT_API}/compliance/verify-chain`, {
        method: 'POST',
      });
      Alert.alert(
        res.valid ? 'Chain Verified' : 'Chain Invalid',
        res.message ?? (res.valid ? 'The compliance log chain is intact and valid.' : 'Chain integrity check failed. Some entries may have been tampered with.')
      );
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to verify chain');
      Alert.alert('Error', message);
    } finally {
      setVerifying(false);
    }
  };

  const handleApplyRetention = () => {
    Alert.alert(
      'Apply Retention Policy',
      `This will permanently delete all compliance logs older than ${config?.retention_days ?? 90} days. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Apply',
          style: 'destructive',
          onPress: async () => {
            setApplyingRetention(true);
            try {
              await apiFetch(`${ENT_API}/compliance/retention`, { method: 'DELETE' });
              Alert.alert('Success', 'Retention policy applied successfully.');
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to apply retention policy');
              Alert.alert('Error', message);
            } finally {
              setApplyingRetention(false);
            }
          },
        },
      ]
    );
  };

  /* ---------- Render ---------- */

  if (loading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ title: 'Compliance Config', headerBackTitle: 'Compliance' }} />
        <View style={styles.container}>
          <View style={{ padding: SPACING.lg }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={{ backgroundColor: COLORS.border, width: 180, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 100, height: 28, borderRadius: 4, marginTop: SPACING.md }} />
              </View>
            ))}
          </View>
        </View>
      </>
    );
  }

  if (!loading && error) {
    return (
      <>
        <Stack.Screen options={{ title: 'Compliance Config', headerBackTitle: 'Compliance' }} />
        <View style={styles.container}>
          <GlassCard style={styles.errorCard}>
            <View style={styles.centerContainer}>
              <Ionicons
                name="warning"
                size={48}
                color={COLORS.yellow}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.errorTitle}>Failed to Load</Text>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchConfig()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!config) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Compliance Config',
          headerBackTitle: 'Compliance',
        }}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.blue}
            colors={[COLORS.blue]}
            progressBackgroundColor={COLORS.card}
          />
        }
      >
        {/* Retention */}
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Retention Policy</Text>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Retention Days</Text>
              <Text style={styles.configValue}>{config.retention_days} days</Text>
            </View>

            <View style={styles.retentionButtons}>
              {[30, 60, 90, 180, 365].map((days) => (
                <TouchableOpacity
                  key={days}
                  style={[
                    styles.retentionBtn,
                    config.retention_days === days && styles.retentionBtnActive,
                  ]}
                  onPress={() => handleUpdateConfig({ retention_days: days })}
                  disabled={saving}
                >
                  <Text style={[
                    styles.retentionBtnText,
                    config.retention_days === days && styles.retentionBtnTextActive,
                  ]}>
                    {days}d
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Toggles */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Settings</Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Auto-Export</Text>
                <Text style={styles.switchHint}>Automatically export logs on a schedule</Text>
              </View>
              <Switch
                value={config.auto_export}
                onValueChange={(val) => handleUpdateConfig({ auto_export: val })}
                disabled={saving}
                trackColor={{ false: COLORS.border, true: COLORS.green + '60' }}
                thumbColor={config.auto_export ? COLORS.green : COLORS.textTertiary}
              />
            </View>

            <View style={[styles.switchRow, { marginTop: SPACING.lg }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Chain Verification</Text>
                <Text style={styles.switchHint}>Hash-chain each log entry for tamper detection</Text>
              </View>
              <Switch
                value={config.chain_verification}
                onValueChange={(val) => handleUpdateConfig({ chain_verification: val })}
                disabled={saving}
                trackColor={{ false: COLORS.border, true: COLORS.green + '60' }}
                thumbColor={config.chain_verification ? COLORS.green : COLORS.textTertiary}
              />
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Actions */}
        <FadeSlideIn delay={200}>
          <TouchableOpacity
            style={styles.verifyBtn}
            onPress={handleVerifyChain}
            disabled={verifying}
            activeOpacity={0.8}
          >
            {verifying ? (
              <ActivityIndicator size="small" color={COLORS.buttonPrimaryText} />
            ) : (
              <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.buttonPrimaryText} />
            )}
            <Text style={styles.verifyBtnText}>
              {verifying ? 'Verifying...' : 'Verify Chain Integrity'}
            </Text>
          </TouchableOpacity>
        </FadeSlideIn>

        <FadeSlideIn delay={250}>
          <TouchableOpacity
            style={styles.retentionApplyBtn}
            onPress={handleApplyRetention}
            disabled={applyingRetention}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={18} color={COLORS.red} />
            <Text style={styles.retentionApplyBtnText}>
              {applyingRetention ? 'Applying...' : 'Apply Retention Policy'}
            </Text>
          </TouchableOpacity>
        </FadeSlideIn>
      </ScrollView>
    </>
  );
}

export default function ComplianceConfigScreen() {
  return (
    <FeatureGate feature="compliance_logging">
      <ComplianceConfigContent />
    </FeatureGate>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: SPACING.lg, paddingBottom: 100 },

  /* Section card */
  sectionCard: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },

  /* Config rows */
  configRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  configLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  configValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },

  /* Retention buttons */
  retentionButtons: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
    flexWrap: 'wrap',
  },
  retentionBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  retentionBtnActive: {
    backgroundColor: COLORS.blue + '15',
    borderColor: COLORS.blue,
  },
  retentionBtnText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontWeight: '600',
  },
  retentionBtnTextActive: {
    color: COLORS.blue,
  },

  /* Switch row */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  switchLabel: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  switchHint: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },

  /* Verify button */
  verifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.blue,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  verifyBtnText: {
    color: COLORS.buttonPrimaryText,
    fontSize: 16,
    fontWeight: '700',
  },

  /* Retention apply button */
  retentionApplyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: SPACING.xl,
  },
  retentionApplyBtnText: {
    color: COLORS.red,
    fontSize: 14,
    fontWeight: '600',
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  /* Error / Center */
  errorCard: {
    marginHorizontal: SPACING.lg,
    marginTop: 60,
  },
  centerContainer: {
    alignItems: 'center',
    paddingHorizontal: SPACING.xxl,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  retryBtn: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  retryText: {
    color: COLORS.blue,
    fontWeight: '600',
    fontSize: 14,
  },
});
