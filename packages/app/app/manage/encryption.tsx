import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
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

interface EncryptionStatus {
  enabled: boolean;
  algorithm: string;
  key_id?: string;
  last_rotation?: string;
  next_rotation?: string;
}

interface EncryptionConfig {
  auto_rotate: boolean;
  rotation_interval_days?: number;
  algorithm: string;
}

interface RotationEntry {
  id: string;
  key_id: string;
  algorithm: string;
  rotated_at: string;
  rotated_by?: string;
  reason?: string;
}

interface RotationsResponse {
  rotations: RotationEntry[];
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

/* ---------- Helpers ---------- */

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------- Screen ---------- */

function EncryptionContent() {
  const [status, setStatus] = useState<EncryptionStatus | null>(null);
  const [config, setConfig] = useState<EncryptionConfig | null>(null);
  const [rotations, setRotations] = useState<RotationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [updatingConfig, setUpdatingConfig] = useState(false);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [statusRes, configRes, rotRes] = await Promise.all([
        apiFetch<EncryptionStatus>(`${ENT_API}/encryption/status`),
        apiFetch<EncryptionConfig>(`${ENT_API}/encryption/config`),
        apiFetch<RotationsResponse>(`${ENT_API}/encryption/rotations`),
      ]);
      setStatus(statusRes);
      setConfig(configRes);
      setRotations(rotRes.rotations ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load encryption data');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll(false);
    setRefreshing(false);
  };

  const handleRotateKey = () => {
    Alert.alert(
      'Rotate Encryption Key',
      'This will generate a new encryption key and re-encrypt all data. This may take a few minutes. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rotate',
          style: 'destructive',
          onPress: async () => {
            setRotating(true);
            try {
              await apiFetch(`${ENT_API}/encryption/rotate-key`, { method: 'POST' });
              await fetchAll(false);
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to rotate key');
              Alert.alert('Error', message);
            } finally {
              setRotating(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleAutoRotate = async (value: boolean) => {
    if (!config) return;
    setUpdatingConfig(true);
    try {
      await apiFetch(`${ENT_API}/encryption/config`, {
        method: 'PUT',
        body: JSON.stringify({ ...config, auto_rotate: value }),
      });
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to update config');
      Alert.alert('Error', message);
    } finally {
      setUpdatingConfig(false);
    }
  };

  /* ---------- Render ---------- */

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <View style={{ padding: SPACING.lg }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ backgroundColor: COLORS.border, width: 180, height: 16, borderRadius: 4 }} />
              <View style={{ backgroundColor: COLORS.border, width: 100, height: 28, borderRadius: 4, marginTop: SPACING.md }} />
              <View style={{ backgroundColor: COLORS.border, width: '100%', height: 6, borderRadius: 3, marginTop: SPACING.md }} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (!loading && error) {
    return (
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
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </View>
    );
  }

  return (
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
      {/* Status Card */}
      {status && (
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.sectionCard} elevated>
            <Text style={styles.sectionTitle}>Encryption Status</Text>

            <View style={styles.statusHeader}>
              <View style={[
                styles.statusIndicator,
                { backgroundColor: status.enabled ? COLORS.green + '20' : COLORS.red + '20' },
              ]}>
                <Ionicons
                  name={status.enabled ? 'shield-checkmark' : 'shield-outline'}
                  size={32}
                  color={status.enabled ? COLORS.green : COLORS.red}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[
                  styles.statusText,
                  { color: status.enabled ? COLORS.green : COLORS.red },
                ]}>
                  {status.enabled ? 'Encryption Active' : 'Encryption Disabled'}
                </Text>
                <Text style={styles.algorithmText}>{status.algorithm}</Text>
              </View>
            </View>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Key ID</Text>
              <Text style={styles.configValue}>{status.key_id ?? '—'}</Text>
            </View>
            {status.last_rotation && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Last Rotation</Text>
                <Text style={styles.configValue}>{formatDateTime(status.last_rotation)}</Text>
              </View>
            )}
            {status.next_rotation && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Next Rotation</Text>
                <Text style={styles.configValue}>{formatDateTime(status.next_rotation)}</Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>
      )}

      {/* Config Card */}
      {config && (
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Configuration</Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Auto-Rotate Keys</Text>
                <Text style={styles.switchHint}>
                  Automatically rotate encryption keys on a schedule
                </Text>
              </View>
              <Switch
                value={config.auto_rotate}
                onValueChange={handleToggleAutoRotate}
                disabled={updatingConfig}
                trackColor={{ false: COLORS.border, true: COLORS.green + '60' }}
                thumbColor={config.auto_rotate ? COLORS.green : COLORS.textTertiary}
              />
            </View>

            {config.rotation_interval_days && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Rotation Interval</Text>
                <Text style={styles.configValue}>{config.rotation_interval_days} days</Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>
      )}

      {/* Rotate Key Button */}
      <FadeSlideIn delay={150}>
        <TouchableOpacity
          style={styles.rotateBtn}
          onPress={handleRotateKey}
          disabled={rotating}
          activeOpacity={0.8}
        >
          {rotating ? (
            <ActivityIndicator size="small" color={COLORS.buttonPrimaryText} />
          ) : (
            <Ionicons name="refresh" size={20} color={COLORS.buttonPrimaryText} />
          )}
          <Text style={styles.rotateBtnText}>
            {rotating ? 'Rotating...' : 'Rotate Key Now'}
          </Text>
        </TouchableOpacity>
      </FadeSlideIn>

      {/* Rotation History */}
      <FadeSlideIn delay={200}>
        <GlassCard style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Rotation History</Text>
            <View style={[styles.countBadge, rotations.length > 0 && { backgroundColor: COLORS.blue + '20' }]}>
              <Text style={[styles.countBadgeText, rotations.length > 0 && { color: COLORS.blue }]}>
                {rotations.length}
              </Text>
            </View>
          </View>

          {rotations.length === 0 ? (
            <View style={styles.emptySection}>
              <Ionicons name="key-outline" size={32} color={COLORS.textTertiary} />
              <Text style={styles.emptySessionText}>No rotation history</Text>
            </View>
          ) : (
            rotations.map((rotation, index) => (
              <View key={rotation.id} style={[styles.rotationItem, index < rotations.length - 1 && styles.rotationItemBorder]}>
                <View style={styles.rotationHeader}>
                  <Ionicons name="key-outline" size={16} color={COLORS.indigo} />
                  <Text style={styles.rotationKeyId} numberOfLines={1}>
                    {rotation.key_id}
                  </Text>
                </View>
                <View style={styles.rotationDetails}>
                  <Text style={styles.rotationAlgorithm}>{rotation.algorithm}</Text>
                  <Text style={styles.rotationTime}>{formatDateTime(rotation.rotated_at)}</Text>
                </View>
                {rotation.rotated_by && (
                  <Text style={styles.rotationBy}>by {rotation.rotated_by}</Text>
                )}
              </View>
            ))
          )}
        </GlassCard>
      </FadeSlideIn>
    </ScrollView>
  );
}

export default function EncryptionScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Encryption at Rest', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="encryption_at_rest">
        <EncryptionContent />
      </FeatureGate>
    </>
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
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },

  /* Status header */
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    marginBottom: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  statusIndicator: {
    width: 56,
    height: 56,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  algorithmText: {
    color: COLORS.textTertiary,
    fontSize: 13,
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

  /* Switch row */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
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

  /* Rotate button */
  rotateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.indigo,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  rotateBtnText: {
    color: COLORS.buttonPrimaryText,
    fontSize: 16,
    fontWeight: '700',
  },

  /* Count badge */
  countBadge: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  countBadgeText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },

  /* Rotation items */
  emptySection: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptySessionText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  rotationItem: {
    paddingVertical: SPACING.md,
  },
  rotationItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  rotationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  rotationKeyId: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  rotationDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginLeft: 24,
  },
  rotationAlgorithm: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  rotationTime: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  rotationBy: {
    color: COLORS.textTertiary,
    fontSize: 11,
    marginLeft: 24,
    marginTop: 2,
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
    paddingVertical: 60,
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
