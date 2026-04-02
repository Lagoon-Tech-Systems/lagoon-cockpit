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

type MonitorType = 'http' | 'tcp' | 'dns';
type CheckStatus = 'up' | 'down' | 'degraded';

interface MonitorDetail {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  interval_seconds: number;
  is_paused: boolean;
  config: Record<string, unknown> | null;
  notify_channels: string[] | null;
  created_at: string;
  latest_check: {
    status: CheckStatus;
    response_time_ms: number | null;
    status_code: number | null;
    checked_at: string;
  } | null;
}

interface Check {
  id: string;
  status: CheckStatus;
  response_time_ms: number | null;
  status_code: number | null;
  checked_at: string;
  error: string | null;
}

interface UptimeStats {
  uptime_24h: number | null;
  uptime_7d: number | null;
  uptime_30d: number | null;
  avg_response_24h: number | null;
  total_checks: number;
  total_incidents: number;
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

const STATUS_LABELS: Record<CheckStatus, string> = {
  up: 'Up',
  down: 'Down',
  degraded: 'Degraded',
};

/* ---------- Helpers ---------- */

function formatResponseTime(ms: number | null): string {
  if (ms === null) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(pct: number | null): string {
  if (pct === null) return '--';
  return `${pct.toFixed(2)}%`;
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function formatCheckTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getUptimeColor(pct: number | null): string {
  if (pct === null) return COLORS.textTertiary;
  if (pct >= 99.5) return COLORS.green;
  if (pct >= 95) return COLORS.yellow;
  return COLORS.red;
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

function UptimeDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [monitor, setMonitor] = useState<MonitorDetail | null>(null);
  const [stats, setStats] = useState<UptimeStats | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [togglingPause, setTogglingPause] = useState(false);
  const [runningCheck, setRunningCheck] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [monitorRes, statsRes, checksRes] = await Promise.all([
        apiFetch<MonitorDetail>(`${PRO_API}/uptime/monitors/${id}`),
        apiFetch<UptimeStats>(`${PRO_API}/uptime/monitors/${id}/stats`),
        apiFetch<{ checks: Check[] }>(`${PRO_API}/uptime/monitors/${id}/checks?limit=20`),
      ]);
      setMonitor(monitorRes);
      setStats(statsRes);
      setChecks(checksRes.checks ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load monitor');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll(false);
    setRefreshing(false);
  };

  const handleTogglePause = async () => {
    if (!monitor || !id) return;
    setTogglingPause(true);
    try {
      const action = monitor.is_paused ? 'resume' : 'pause';
      await apiFetch(`${PRO_API}/uptime/monitors/${id}/${action}`, { method: 'POST' });
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to update monitor');
      Alert.alert('Error', message);
    } finally {
      setTogglingPause(false);
    }
  };

  const handleManualCheck = async () => {
    if (!id) return;
    setRunningCheck(true);
    try {
      await apiFetch(`${PRO_API}/uptime/monitors/${id}/check`, { method: 'POST' });
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to run check');
      Alert.alert('Error', message);
    } finally {
      setRunningCheck(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Monitor',
      'Are you sure you want to delete this monitor? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${PRO_API}/uptime/monitors/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete monitor');
              Alert.alert('Error', message);
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  /* ---------- Render ---------- */

  const renderHeader = () => {
    if (!monitor) return null;
    const typeColor = TYPE_COLORS[monitor.type];
    const typeIcon = TYPE_ICONS[monitor.type];
    const checkStatus = monitor.latest_check?.status;
    const statusColor = monitor.is_paused
      ? COLORS.textTertiary
      : checkStatus
        ? STATUS_COLORS[checkStatus]
        : COLORS.textTertiary;
    const statusLabel = monitor.is_paused
      ? 'Paused'
      : checkStatus
        ? STATUS_LABELS[checkStatus]
        : 'Pending';

    return (
      <View>
        {/* Header Card */}
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.headerCard} elevated>
            {/* Status indicator */}
            <View style={styles.statusRow}>
              <View style={[styles.statusDotLarge, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
            </View>

            <Text style={styles.headerTitle}>{monitor.name}</Text>

            {/* Badges */}
            <View style={styles.headerBadges}>
              <View style={[styles.badge, { backgroundColor: typeColor + '20', borderColor: typeColor }]}>
                <Ionicons name={typeIcon} size={12} color={typeColor} />
                <Text style={[styles.badgeText, { color: typeColor }]}>
                  {monitor.type.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Meta */}
            <View style={styles.headerMeta}>
              <View style={styles.metaItem}>
                <Ionicons name="link-outline" size={14} color={COLORS.textTertiary} />
                <Text style={styles.metaTextMono} numberOfLines={1}>{monitor.target}</Text>
              </View>
              <View style={styles.metaItem}>
                <Ionicons name="timer-outline" size={14} color={COLORS.textTertiary} />
                <Text style={styles.metaText}>
                  Every {formatInterval(monitor.interval_seconds)}
                </Text>
              </View>
              {monitor.latest_check && (
                <View style={styles.metaItem}>
                  <Ionicons name="speedometer-outline" size={14} color={COLORS.textTertiary} />
                  <Text style={styles.metaText}>
                    {formatResponseTime(monitor.latest_check.response_time_ms)} response
                  </Text>
                </View>
              )}
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Stats Cards */}
        {stats && (
          <FadeSlideIn delay={100}>
            <View style={styles.statsRow}>
              <GlassCard style={styles.statCard}>
                <Text style={styles.statLabel}>24H</Text>
                <Text style={[styles.statMetric, { color: getUptimeColor(stats.uptime_24h) }]}>
                  {formatUptime(stats.uptime_24h)}
                </Text>
              </GlassCard>
              <GlassCard style={styles.statCard}>
                <Text style={styles.statLabel}>7D</Text>
                <Text style={[styles.statMetric, { color: getUptimeColor(stats.uptime_7d) }]}>
                  {formatUptime(stats.uptime_7d)}
                </Text>
              </GlassCard>
              <GlassCard style={styles.statCard}>
                <Text style={styles.statLabel}>30D</Text>
                <Text style={[styles.statMetric, { color: getUptimeColor(stats.uptime_30d) }]}>
                  {formatUptime(stats.uptime_30d)}
                </Text>
              </GlassCard>
            </View>
          </FadeSlideIn>
        )}

        {stats && (
          <FadeSlideIn delay={150}>
            <View style={styles.statsSecondary}>
              <GlassCard style={styles.statSecondaryCard}>
                <View style={styles.statSecondaryRow}>
                  <View style={styles.statSecondaryItem}>
                    <Ionicons name="speedometer-outline" size={16} color={COLORS.blue} />
                    <Text style={styles.statSecondaryValue}>
                      {formatResponseTime(stats.avg_response_24h)}
                    </Text>
                    <Text style={styles.statSecondaryLabel}>Avg Response (24h)</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statSecondaryItem}>
                    <Ionicons name="analytics-outline" size={16} color={COLORS.purple} />
                    <Text style={styles.statSecondaryValue}>{stats.total_checks}</Text>
                    <Text style={styles.statSecondaryLabel}>Total Checks</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statSecondaryItem}>
                    <Ionicons name="alert-circle-outline" size={16} color={COLORS.red} />
                    <Text style={styles.statSecondaryValue}>{stats.total_incidents}</Text>
                    <Text style={styles.statSecondaryLabel}>Incidents</Text>
                  </View>
                </View>
              </GlassCard>
            </View>
          </FadeSlideIn>
        )}

        {/* Action Buttons */}
        <FadeSlideIn delay={200}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleTogglePause}
              disabled={togglingPause}
            >
              {togglingPause ? (
                <ActivityIndicator size="small" color={COLORS.blue} />
              ) : (
                <>
                  <Ionicons
                    name={monitor.is_paused ? 'play' : 'pause'}
                    size={18}
                    color={COLORS.blue}
                  />
                  <Text style={styles.actionBtnText}>
                    {monitor.is_paused ? 'Resume' : 'Pause'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleManualCheck}
              disabled={runningCheck}
            >
              {runningCheck ? (
                <ActivityIndicator size="small" color={COLORS.green} />
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color={COLORS.green} />
                  <Text style={[styles.actionBtnText, { color: COLORS.green }]}>Check Now</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => router.push(`/manage/uptime-create?id=${id}` as any)}
            >
              <Ionicons name="create-outline" size={18} color={COLORS.orange} />
              <Text style={[styles.actionBtnText, { color: COLORS.orange }]}>Edit</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.red} />
              <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                {deleting ? 'Deleting...' : 'Delete'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>

        {/* Recent checks header */}
        <FadeSlideIn delay={300}>
          <Text style={styles.sectionTitle}>Recent Checks</Text>
        </FadeSlideIn>
      </View>
    );
  };

  const renderCheck = ({ item, index }: { item: Check; index: number }) => {
    const statusColor = STATUS_COLORS[item.status];

    return (
      <FadeSlideIn delay={350 + index * 30}>
        <View style={styles.checkItem}>
          <View style={[styles.checkDot, { backgroundColor: statusColor }]} />
          <View style={styles.checkContent}>
            <View style={styles.checkTopRow}>
              <Text style={styles.checkTime}>{formatCheckTime(item.checked_at)}</Text>
              <Text style={[styles.checkStatus, { color: statusColor }]}>
                {STATUS_LABELS[item.status]}
              </Text>
            </View>
            <View style={styles.checkMetaRow}>
              {item.response_time_ms !== null && (
                <Text style={styles.checkMeta}>
                  {formatResponseTime(item.response_time_ms)}
                </Text>
              )}
              {item.status_code !== null && (
                <Text style={styles.checkMeta}>HTTP {item.status_code}</Text>
              )}
              {item.error && (
                <Text style={[styles.checkMeta, { color: COLORS.red }]} numberOfLines={1}>
                  {item.error}
                </Text>
              )}
            </View>
          </View>
        </View>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Loading */}
      {loading && !refreshing && (
        <View style={{ padding: SPACING.lg }}>
          <View style={styles.skeletonCard}>
            <View style={{ width: 200, height: 20, borderRadius: 4, backgroundColor: COLORS.border }} />
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 12 }}>
              <View style={{ width: 70, height: 24, borderRadius: 12, backgroundColor: COLORS.border }} />
            </View>
            <View style={{ width: '100%' as any, height: 14, borderRadius: 4, marginTop: 12, backgroundColor: COLORS.border }} />
            <View style={{ width: 150, height: 14, borderRadius: 4, marginTop: 6, backgroundColor: COLORS.border }} />
          </View>
          <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.skeletonCard, { flex: 1 }]}>
                <View style={{ width: 30, height: 12, borderRadius: 4, backgroundColor: COLORS.border }} />
                <View style={{ width: 60, height: 28, borderRadius: 4, marginTop: 8, backgroundColor: COLORS.border }} />
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Error */}
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
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      )}

      {/* Content */}
      {!loading && !error && monitor && (
        <FlatList
          data={checks}
          renderItem={renderCheck}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.contentList}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <View style={styles.emptyChecks}>
              <Ionicons name="pulse-outline" size={32} color={COLORS.textTertiary} />
              <Text style={styles.emptyChecksText}>No checks recorded yet</Text>
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.blue}
              colors={[COLORS.blue]}
              progressBackgroundColor={COLORS.card}
            />
          }
        />
      )}
    </View>
  );
}

export default function UptimeDetailScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Monitor Details', headerBackTitle: 'Monitors' }} />
      <FeatureGate feature="uptime_monitoring">
        <UptimeDetailContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  contentList: { padding: SPACING.lg, paddingBottom: 100 },

  /* Header card */
  headerCard: {
    marginBottom: SPACING.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  statusDotLarge: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headerTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
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
  headerMeta: {
    gap: SPACING.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  metaTextMono: {
    ...FONT.mono,
    color: COLORS.textSecondary,
    flex: 1,
  },

  /* Stats */
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  statLabel: {
    ...FONT.label,
    color: COLORS.textTertiary,
    marginBottom: SPACING.xs,
  },
  statMetric: {
    ...FONT.metric,
  },
  statsSecondary: {
    marginBottom: SPACING.md,
  },
  statSecondaryCard: {
    paddingVertical: SPACING.md,
  },
  statSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statSecondaryItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statSecondaryValue: {
    ...FONT.heading,
    color: COLORS.textPrimary,
  },
  statSecondaryLabel: {
    color: COLORS.textTertiary,
    fontSize: 10,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
  },

  /* Action buttons */
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
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

  /* Section title */
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
  },

  /* Check items */
  checkItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  checkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    marginRight: SPACING.md,
  },
  checkContent: {
    flex: 1,
  },
  checkTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkTime: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  checkStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  checkMetaRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  checkMeta: {
    ...FONT.mono,
    color: COLORS.textTertiary,
  },
  emptyChecks: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptyChecksText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
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
