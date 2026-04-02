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

interface MtlsAgent {
  id: string;
  name: string;
  fingerprint?: string;
  certificate?: string;
  enabled: boolean;
  status: string;
  last_seen?: string;
  last_verified?: string;
  created_at: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.green,
  inactive: COLORS.textTertiary,
  revoked: COLORS.red,
};

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

function MtlsDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [agent, setAgent] = useState<MtlsAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAgent = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<MtlsAgent>(`${ENT_API}/mtls/agents/${id}`);
      setAgent(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load agent');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAgent(false);
    setRefreshing(false);
  };

  const handleToggle = async () => {
    if (!id || !agent) return;
    setToggling(true);
    try {
      await apiFetch(`${ENT_API}/mtls/agents/${id}/toggle`, { method: 'PUT' });
      await fetchAgent(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to toggle agent');
      Alert.alert('Error', message);
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Remove Agent',
      'Are you sure you want to remove this agent? Its client certificate will no longer be accepted. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${ENT_API}/mtls/agents/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to remove agent');
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
        <Stack.Screen options={{ title: 'Agent', headerBackTitle: 'mTLS' }} />
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
        <Stack.Screen options={{ title: 'Agent', headerBackTitle: 'mTLS' }} />
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAgent()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!agent) return null;

  const statusColor = STATUS_COLORS[agent.status] ?? COLORS.textTertiary;

  return (
    <>
      <Stack.Screen
        options={{
          title: agent.name,
          headerBackTitle: 'mTLS',
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
              <Text style={styles.headerTitle}>{agent.name}</Text>
            </View>

            <View style={styles.headerBadges}>
              <View style={[
                styles.badge,
                {
                  backgroundColor: statusColor + '20',
                  borderColor: statusColor,
                },
              ]}>
                <Text style={[styles.badgeText, { color: statusColor }]}>
                  {agent.status.toUpperCase()}
                </Text>
              </View>
              <View style={[
                styles.badge,
                {
                  backgroundColor: (agent.enabled ? COLORS.green : COLORS.textTertiary) + '20',
                  borderColor: agent.enabled ? COLORS.green : COLORS.textTertiary,
                },
              ]}>
                <Ionicons
                  name={agent.enabled ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={agent.enabled ? COLORS.green : COLORS.textTertiary}
                />
                <Text style={[styles.badgeText, { color: agent.enabled ? COLORS.green : COLORS.textTertiary }]}>
                  {agent.enabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>
            </View>

            {/* Toggle button */}
            <TouchableOpacity
              style={[styles.toggleBtn, agent.enabled && styles.toggleBtnActive]}
              onPress={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={agent.enabled ? COLORS.red : COLORS.green} />
              ) : (
                <Ionicons
                  name={agent.enabled ? 'pause-circle-outline' : 'play-circle-outline'}
                  size={18}
                  color={agent.enabled ? COLORS.red : COLORS.green}
                />
              )}
              <Text style={[styles.toggleBtnText, { color: agent.enabled ? COLORS.red : COLORS.green }]}>
                {toggling ? 'Updating...' : agent.enabled ? 'Disable' : 'Enable'}
              </Text>
            </TouchableOpacity>
          </GlassCard>
        </FadeSlideIn>

        {/* Details Card */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Details</Text>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Name</Text>
              <Text style={styles.configValue}>{agent.name}</Text>
            </View>
            {agent.fingerprint && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Fingerprint</Text>
                <Text style={styles.configValueMono} numberOfLines={2}>{agent.fingerprint}</Text>
              </View>
            )}
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Status</Text>
              <Text style={[styles.configValue, { color: statusColor }]}>{agent.status}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Created</Text>
              <Text style={styles.configValue}>{formatDateTime(agent.created_at)}</Text>
            </View>
            {agent.last_seen && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Last Seen</Text>
                <Text style={styles.configValue}>{formatDateTime(agent.last_seen)}</Text>
              </View>
            )}
            {agent.last_verified && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Last Verified</Text>
                <Text style={styles.configValue}>{formatDateTime(agent.last_verified)}</Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        <FadeSlideIn delay={200}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.red} />
              <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                {deleting ? 'Removing...' : 'Remove Agent'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </>
  );
}

export default function MtlsDetailScreen() {
  return (
    <FeatureGate feature="mtls">
      <MtlsDetailContent />
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
  configValueMono: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
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
