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
  Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

interface IpRule {
  id: string;
  cidr: string;
  label: string;
  description?: string;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
  last_matched?: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/* ---------- Helpers ---------- */

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

function IpAllowlistDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [rule, setRule] = useState<IpRule | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchRule = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<IpRule>(`${ENT_API}/ip-allowlist/rules/${id}`);
      setRule(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load IP rule');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchRule();
  }, [fetchRule]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRule(false);
    setRefreshing(false);
  };

  const handleToggle = async () => {
    if (!id || !rule) return;
    setToggling(true);
    try {
      await apiFetch(`${ENT_API}/ip-allowlist/rules/${id}/toggle`, { method: 'PUT' });
      await fetchRule(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to toggle rule');
      Alert.alert('Error', message);
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete IP Rule',
      'Are you sure you want to delete this rule? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${ENT_API}/ip-allowlist/rules/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete rule');
              Alert.alert('Error', message);
              setDeleting(false);
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
        <Stack.Screen options={{ title: 'IP Rule', headerBackTitle: 'IP Allowlist' }} />
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
      </>
    );
  }

  if (!loading && error) {
    return (
      <>
        <Stack.Screen options={{ title: 'IP Rule', headerBackTitle: 'IP Allowlist' }} />
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchRule()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!rule) return null;

  return (
    <>
      <Stack.Screen
        options={{
          title: rule.label || rule.cidr,
          headerBackTitle: 'IP Allowlist',
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
        {/* Header Card */}
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.headerCard} elevated>
            <View style={styles.headerTopRow}>
              <Text style={styles.headerTitle}>{rule.cidr}</Text>
            </View>

            <View style={styles.headerBadges}>
              <View style={[
                styles.badge,
                {
                  backgroundColor: (rule.enabled ? COLORS.green : COLORS.textTertiary) + '20',
                  borderColor: rule.enabled ? COLORS.green : COLORS.textTertiary,
                },
              ]}>
                <Ionicons
                  name={rule.enabled ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={rule.enabled ? COLORS.green : COLORS.textTertiary}
                />
                <Text style={[styles.badgeText, { color: rule.enabled ? COLORS.green : COLORS.textTertiary }]}>
                  {rule.enabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>
            </View>

            {/* Toggle button */}
            <TouchableOpacity
              style={[styles.toggleBtn, rule.enabled && styles.toggleBtnActive]}
              onPress={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={rule.enabled ? COLORS.red : COLORS.green} />
              ) : (
                <Ionicons
                  name={rule.enabled ? 'pause-circle-outline' : 'play-circle-outline'}
                  size={18}
                  color={rule.enabled ? COLORS.red : COLORS.green}
                />
              )}
              <Text style={[styles.toggleBtnText, { color: rule.enabled ? COLORS.red : COLORS.green }]}>
                {toggling ? 'Updating...' : rule.enabled ? 'Disable' : 'Enable'}
              </Text>
            </TouchableOpacity>
          </GlassCard>
        </FadeSlideIn>

        {/* Details Card */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Details</Text>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>CIDR</Text>
              <Text style={styles.configValue}>{rule.cidr}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Label</Text>
              <Text style={styles.configValue}>{rule.label || '—'}</Text>
            </View>
            {rule.description && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Description</Text>
                <Text style={styles.configValue}>{rule.description}</Text>
              </View>
            )}
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Created</Text>
              <Text style={styles.configValue}>{formatDateTime(rule.created_at)}</Text>
            </View>
            {rule.updated_at && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Updated</Text>
                <Text style={styles.configValue}>{formatDateTime(rule.updated_at)}</Text>
              </View>
            )}
            {rule.last_matched && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Last Matched</Text>
                <Text style={styles.configValue}>{formatDateTime(rule.last_matched)}</Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        <FadeSlideIn delay={200}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/manage/ip-allowlist-edit?id=${id}` as any)}
            >
              <Ionicons name="create-outline" size={18} color={COLORS.blue} />
              <Text style={styles.actionBtnText}>Edit Rule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.red} />
              <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                {deleting ? 'Deleting...' : 'Delete Rule'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </>
  );
}

export default function IpAllowlistDetailScreen() {
  return (
    <FeatureGate feature="ip_allowlist">
      <IpAllowlistDetailContent />
    </FeatureGate>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: SPACING.lg, paddingBottom: 100 },

  /* Header card */
  headerCard: {
    marginBottom: SPACING.md,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  headerTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.md,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Toggle button */
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  toggleBtnActive: {},
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

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

  /* Action buttons */
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnText: {
    color: COLORS.blue,
    fontSize: 14,
    fontWeight: '600',
  },
  deleteBtn: {},

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
