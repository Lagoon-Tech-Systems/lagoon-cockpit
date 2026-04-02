import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

type MonitorType = 'http' | 'tcp' | 'dns';
type CheckStatus = 'up' | 'down' | 'degraded';

interface Monitor {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  interval_seconds: number;
  is_paused: boolean;
  latest_check: {
    status: CheckStatus;
    response_time_ms: number | null;
    checked_at: string;
  } | null;
  uptime_24h: number | null;
}

interface MonitorsResponse {
  monitors: Monitor[];
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

const TYPE_COLORS: Record<MonitorType, string> = {
  http: COLORS.blue,
  tcp: COLORS.purple,
  dns: COLORS.teal,
};

const TYPE_ICONS: Record<MonitorType, keyof typeof Ionicons.glyphMap> = {
  http: 'globe-outline',
  tcp: 'git-network-outline',
  dns: 'server-outline',
};

const STATUS_COLORS: Record<CheckStatus, string> = {
  up: COLORS.green,
  down: COLORS.red,
  degraded: COLORS.yellow,
};

/* ---------- Helpers ---------- */

function formatResponseTime(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(pct: number | null): string {
  if (pct === null) return '--';
  return `${pct.toFixed(1)}%`;
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

function UptimeListContent() {
  const router = useRouter();
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMonitors = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<MonitorsResponse>(`${PRO_API}/uptime/monitors`);
      setMonitors(res.monitors ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load monitors');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
  }, [fetchMonitors]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMonitors(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchMonitors();
  };

  const renderMonitor = ({ item, index }: { item: Monitor; index: number }) => {
    const typeColor = TYPE_COLORS[item.type];
    const typeIcon = TYPE_ICONS[item.type];
    const isPaused = item.is_paused;
    const checkStatus = item.latest_check?.status;
    const statusColor = isPaused
      ? COLORS.textTertiary
      : checkStatus
        ? STATUS_COLORS[checkStatus]
        : COLORS.textTertiary;

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={[styles.monitorCard, isPaused && styles.monitorCardPaused]}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/uptime-detail?id=${item.id}` as any)}
        >
          {/* Status stripe */}
          <View style={[styles.statusStripe, { backgroundColor: statusColor }]} />

          <View style={styles.monitorBody}>
            {/* Top row: name + status dot */}
            <View style={styles.topRow}>
              <Text style={[styles.monitorName, isPaused && styles.textMuted]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.statusIndicator}>
                {isPaused ? (
                  <View style={styles.pausedBadge}>
                    <Ionicons name="pause" size={10} color={COLORS.textTertiary} />
                    <Text style={styles.pausedText}>Paused</Text>
                  </View>
                ) : (
                  <View style={[styles.statusDotLarge, { backgroundColor: statusColor }]} />
                )}
              </View>
            </View>

            {/* Badges row */}
            <View style={styles.badgeRow}>
              {/* Type badge */}
              <View style={[styles.badge, { backgroundColor: typeColor + '20', borderColor: typeColor }]}>
                <Ionicons name={typeIcon} size={12} color={typeColor} />
                <Text style={[styles.badgeText, { color: typeColor }]}>
                  {item.type.toUpperCase()}
                </Text>
              </View>

              {/* Target */}
              <Text style={styles.targetText} numberOfLines={1}>
                {item.target}
              </Text>
            </View>

            {/* Meta row: response time + uptime */}
            <View style={styles.metaRow}>
              {item.latest_check && (
                <View style={styles.metaItem}>
                  <Ionicons name="speedometer-outline" size={12} color={COLORS.textTertiary} />
                  <Text style={styles.metaText}>
                    {formatResponseTime(item.latest_check.response_time_ms)}
                  </Text>
                </View>
              )}
              <View style={styles.metaItem}>
                <Ionicons name="trending-up-outline" size={12} color={COLORS.textTertiary} />
                <Text style={styles.metaText}>
                  {formatUptime(item.uptime_24h)} (24h)
                </Text>
              </View>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} style={{ alignSelf: 'center' }} />
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Loading */}
      {loading && !refreshing && (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
                <View style={{ width: 4, height: 40, borderRadius: 2, backgroundColor: COLORS.border }} />
                <View style={{ flex: 1 }}>
                  <View style={{ width: 160, height: 16, borderRadius: 4, backgroundColor: COLORS.border }} />
                  <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 8 }}>
                    <View style={{ width: 50, height: 20, borderRadius: 10, backgroundColor: COLORS.border }} />
                    <View style={{ width: 120, height: 20, borderRadius: 10, backgroundColor: COLORS.border }} />
                  </View>
                  <View style={{ width: 100, height: 12, borderRadius: 4, marginTop: 8, backgroundColor: COLORS.border }} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Error state */}
      {!loading && error && (
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
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      )}

      {/* Monitor list */}
      {!loading && !error && (
        <FlatList
          data={monitors}
          renderItem={renderMonitor}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.blue}
              colors={[COLORS.blue]}
              progressBackgroundColor={COLORS.card}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Ionicons
                name="pulse-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No monitors</Text>
              <Text style={styles.emptySubtext}>
                Add your first uptime monitor to start tracking
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Create Monitor */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/manage/uptime-create' as any)}
      >
        <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function UptimeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Uptime Monitors', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="uptime_monitoring">
        <UptimeListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* Monitor card */
  monitorCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  monitorCardPaused: {
    opacity: 0.6,
  },
  statusStripe: {
    width: 4,
  },
  monitorBody: {
    flex: 1,
    padding: 14,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  monitorName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.sm,
  },
  textMuted: {
    color: COLORS.textTertiary,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDotLarge: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  pausedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: COLORS.border,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  pausedText: {
    color: COLORS.textTertiary,
    fontSize: 10,
    fontWeight: '600',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
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
  targetText: {
    flex: 1,
    color: COLORS.textSecondary,
    fontSize: 12,
    ...FONT.mono,
  },
  metaRow: {
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: COLORS.textTertiary,
    fontSize: 12,
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

  /* Center / Error / Empty */
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
  emptyText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    color: COLORS.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },

  /* FAB */
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.elevated,
  },
});
