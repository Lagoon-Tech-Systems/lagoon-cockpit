import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Animated, Easing, ActivityIndicator } from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useServerStore } from '../../src/stores/serverStore';
import { useDashboardStore } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS } from '../../src/theme/tokens';
import Skeleton from '../../src/components/Skeleton';

/* ─── Design tokens ─── */
const T = {
  ...COLORS,
  radius: RADIUS.lg,
};

/* ─── Helpers ─── */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ─── Circular Progress Ring ─── */
function ProgressRing({
  size = 70,
  strokeWidth = 5,
  percent,
  color,
}: {
  size?: number;
  strokeWidth?: number;
  percent: number;
  color: string;
}) {
  // We build a ring out of two half-circles clipped by wrapper views.
  // percent 0-100 maps to 0-360 degrees.
  const radius = size / 2;
  const clampedPercent = Math.min(Math.max(percent, 0), 100);
  const degrees = (clampedPercent / 100) * 360;

  const baseCircle = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth: strokeWidth,
    borderColor: COLORS.border,
    position: 'absolute' as const,
  };

  const halfCircle = {
    width: size,
    height: size,
    borderRadius: radius,
    borderWidth: strokeWidth,
    borderColor: color,
    position: 'absolute' as const,
  };

  // Right half rotation: fills 0-180 degrees
  const rightDeg = Math.min(degrees, 180);
  // Left half rotation: fills 180-360 degrees
  const leftDeg = Math.max(degrees - 180, 0);

  return (
    <View style={{ width: size, height: size }}>
      {/* Track ring */}
      <View style={baseCircle} />

      {/* Right half (0-180 deg) */}
      <View
        style={{
          width: size / 2,
          height: size,
          position: 'absolute',
          right: 0,
          overflow: 'hidden',
        }}
      >
        <View
          style={[
            halfCircle,
            {
              right: 0,
              borderLeftColor: 'transparent',
              borderBottomColor: 'transparent',
              transform: [{ rotate: `${rightDeg}deg` }],
            },
          ]}
        />
      </View>

      {/* Left half (180-360 deg) */}
      {degrees > 180 && (
        <View
          style={{
            width: size / 2,
            height: size,
            position: 'absolute',
            left: 0,
            overflow: 'hidden',
          }}
        >
          <View
            style={[
              halfCircle,
              {
                left: 0,
                borderRightColor: 'transparent',
                borderTopColor: 'transparent',
                transform: [{ rotate: `${leftDeg}deg` }],
              },
            ]}
          />
        </View>
      )}

      {/* Center label */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: T.textPrimary, fontSize: 16, fontWeight: '700' }}>
          {clampedPercent.toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

/* ─── Live Indicator (pulsing dot) ─── */
function LiveIndicator() {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 1000, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return (
    <View style={styles.liveContainer}>
      <Animated.View style={[styles.liveDot, { opacity }]} />
      <Text style={styles.liveText}>Live</Text>
    </View>
  );
}

/* ─── Skeleton Placeholders ─── */
function SkeletonStatGrid() {
  return (
    <View style={styles.statGrid}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.statCard}>
          <Skeleton width={32} height={32} borderRadius={10} />
          <Skeleton width={60} height={32} borderRadius={8} style={{ marginTop: 10 }} />
          <Skeleton width={80} height={12} borderRadius={4} style={{ marginTop: 8 }} />
        </View>
      ))}
    </View>
  );
}

function SkeletonGaugeRow() {
  return (
    <View style={styles.section}>
      <Skeleton width={140} height={14} borderRadius={4} style={{ marginBottom: 12 }} />
      <View style={styles.gaugeRow}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.gaugeCard}>
            <Skeleton width={64} height={64} borderRadius={32} />
            <Skeleton width={30} height={12} borderRadius={4} style={{ marginTop: 8 }} />
            <Skeleton width={50} height={10} borderRadius={4} style={{ marginTop: 4 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/* ─── Animated Section Wrapper ─── */
function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        delay,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 400,
        delay,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]);
    anim.start();
  }, [opacity, translateY, delay]);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

/* ─── Main Screen ─── */
export default function OverviewScreen() {
  const router = useRouter();
  const { serverName, disconnect } = useServerStore();
  const { overview, setOverview, containers, setContainers, stacks, setStacks, alerts } = useDashboardStore();
  const platform = useDashboardStore((s) => s.platform);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);

      // Always fetch overview first to determine platform
      const overviewData = await apiFetch<any>('/api/overview');
      setOverview(overviewData);

      const detectedPlatform = overviewData.platform === 'windows' ? 'windows' : 'linux';

      if (detectedPlatform === 'windows') {
        // Windows: fetch services instead of containers/stacks
        const servicesData = await apiFetch<any>('/api/services');
        useDashboardStore.getState().setServices(servicesData.services);
      } else {
        // Linux: fetch containers and stacks as usual
        const [containerData, stackData] = await Promise.all([
          apiFetch<any>('/api/containers'),
          apiFetch<any>('/api/stacks'),
        ]);
        setContainers(containerData.containers);
        setStacks(stackData.stacks);
      }
    } catch (err) {
      console.error('[COCKPIT] Failed to fetch overview:', err);
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    }
  }, [setOverview, setContainers, setStacks]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const sys = overview?.system;
  const problemContainers = containers.filter(
    (c) => c.state !== 'running' || c.health === 'unhealthy',
  );

  const alertColorForState = (state: string, health?: string) =>
    health === 'unhealthy' ? T.yellow : state === 'running' ? T.green : state === 'exited' ? T.red : T.orange;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.blue} colors={['#4A90FF']} progressBackgroundColor="#2C2C2E" />
      }
    >
      {/* ── 1. Server Header ── */}
      <View style={styles.headerBanner}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.serverName}>{serverName || 'Server'}</Text>
            <View style={styles.headerMeta}>
              <View style={styles.greenDot} />
              {sys && (
                <View style={styles.uptimeBadge}>
                  <Text style={styles.uptimeText}>Up {formatUptime(sys.uptimeSeconds)}</Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <LiveIndicator />
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => {
                disconnect();
                router.replace('/');
              }}
              accessibilityRole="button"
              accessibilityLabel="Switch server"
            >
              <Text style={styles.switchText}>Switch</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Skeleton Loading State ── */}
      {!overview && !error && (
        <>
          <SkeletonStatGrid />
          <SkeletonGaugeRow />
        </>
      )}

      {/* ── Error State ── */}
      {error && !overview && (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={T.red} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchAll}>
            <Ionicons name="refresh" size={16} color={T.blue} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── 2. Quick Stat Cards (2x2) ── */}
      {overview && platform === 'windows' && (
        <FadeSlideIn delay={0}>
          <View style={styles.statGrid}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: T.blue + '20' }]}>
                <Ionicons name="cog-outline" size={16} color={T.blue} />
              </View>
              <Text style={styles.statNumber}>
                {overview.services?.total ?? 0}
              </Text>
              <Text style={styles.statLabel}>SERVICES</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: T.green + '20' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color={T.green} />
              </View>
              <Text style={styles.statNumber}>{overview.services?.running ?? 0}</Text>
              <Text style={styles.statLabel}>RUNNING</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: T.red + '20' }]}>
                <Ionicons name="stop-circle-outline" size={16} color={T.red} />
              </View>
              <Text style={[styles.statNumber, (overview.services?.stopped ?? 0) > 0 && { color: T.red }]}>
                {overview.services?.stopped ?? 0}
              </Text>
              <Text style={styles.statLabel}>STOPPED</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: T.purple + '20' }]}>
                <Ionicons name="list-outline" size={16} color={T.purple} />
              </View>
              <Text style={styles.statNumber}>-</Text>
              <Text style={styles.statLabel}>PROCESSES</Text>
            </View>
          </View>
        </FadeSlideIn>
      )}

      {overview && platform !== 'windows' && (
        <FadeSlideIn delay={0}>
          <View style={styles.statGrid}>
            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: T.blue + '20' }]}>
                <Ionicons name="cube-outline" size={16} color={T.blue} />
              </View>
              <Text style={styles.statNumber}>
                {overview.containers.running + overview.containers.stopped}
              </Text>
              <Text style={styles.statLabel}>CONTAINERS</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: T.green + '20' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color={T.green} />
              </View>
              <Text style={styles.statNumber}>{overview.containers.running}</Text>
              <Text style={styles.statLabel}>RUNNING</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: T.red + '20' }]}>
                <Ionicons name="stop-circle-outline" size={16} color={T.red} />
              </View>
              <Text style={[styles.statNumber, overview.containers.stopped > 0 && { color: T.red }]}>
                {overview.containers.stopped}
              </Text>
              <Text style={styles.statLabel}>STOPPED</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => router.push('/(tabs)/stacks')}
            >
              <View style={[styles.statIcon, { backgroundColor: T.purple + '20' }]}>
                <Ionicons name="layers-outline" size={16} color={T.purple} />
              </View>
              <Text style={styles.statNumber}>{overview.stacks.total}</Text>
              <Text style={styles.statLabel}>STACKS</Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 3. System Gauges ── */}
      {sys && (
        <FadeSlideIn delay={100}>
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>SYSTEM RESOURCES</Text>
            <View style={styles.gaugeRow}>
              <View style={styles.gaugeCard}>
                <MaterialCommunityIcons name="cpu-64-bit" size={16} color={T.textTertiary} style={{ marginBottom: 4 }} />
                <ProgressRing size={70} strokeWidth={6} percent={sys.cpuPercent} color={T.blue} />
                <Text style={styles.gaugeLabel}>CPU</Text>
                <Text style={styles.gaugeDetail}>{sys.cpuCount} cores</Text>
              </View>
              <View style={styles.gaugeCard}>
                <MaterialCommunityIcons name="memory" size={16} color={T.textTertiary} style={{ marginBottom: 4 }} />
                <ProgressRing
                  size={70}
                  strokeWidth={6}
                  percent={sys.memory.percent}
                  color={T.purple}
                />
                <Text style={styles.gaugeLabel}>RAM</Text>
                <Text style={styles.gaugeDetail}>{formatBytes(sys.memory.used)}</Text>
              </View>
              <View style={styles.gaugeCard}>
                <MaterialCommunityIcons name="harddisk" size={16} color={T.textTertiary} style={{ marginBottom: 4 }} />
                <ProgressRing
                  size={70}
                  strokeWidth={6}
                  percent={sys.disk.percent}
                  color={T.orange}
                />
                <Text style={styles.gaugeLabel}>Disk</Text>
                <Text style={styles.gaugeDetail}>{formatBytes(sys.disk.used)}</Text>
              </View>
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 4. Load Average (Linux only — Windows has no load average) ── */}
      {sys && sys.load && platform !== 'windows' && (
        <View style={styles.loadCard}>
          <Text style={styles.loadTitle}>LOAD AVG</Text>
          <View style={styles.loadValues}>
            <Text style={styles.loadNum}>{sys.load.load1.toFixed(2)}</Text>
            <Text style={styles.loadDot}>{'\u00B7'}</Text>
            <Text style={styles.loadNum}>{sys.load.load5.toFixed(2)}</Text>
            <Text style={styles.loadDot}>{'\u00B7'}</Text>
            <Text style={styles.loadNum}>{sys.load.load15.toFixed(2)}</Text>
          </View>
        </View>
      )}

      {/* ── 5. Problem Containers (Linux only) ── */}
      {platform !== 'windows' && problemContainers.length > 0 && (
        <FadeSlideIn delay={200}>
          <View style={styles.section}>
            <Text style={[styles.sectionHeader, { color: T.red }]}>ATTENTION REQUIRED</Text>
            <View style={styles.problemSection}>
              {problemContainers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.problemRow}
                  onPress={() => router.push(`/containers/${c.id}`)}
                >
                  <View style={styles.problemDot} />
                  <Text style={styles.problemName} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={styles.problemState}>
                    {c.health === 'unhealthy' ? 'unhealthy' : c.state}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 6. Recent Alerts (timeline) ── */}
      <FadeSlideIn delay={300}>
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.sectionHeaderRow}
          onPress={() => router.push('/(tabs)/alerts')}
        >
          <Text style={styles.sectionHeader}>RECENT ACTIVITY</Text>
          {alerts.length > 0 && (
            <Text style={styles.seeAll}>{alerts.length} alerts ›</Text>
          )}
        </TouchableOpacity>

        {alerts.length === 0 ? (
          <View style={styles.allGood}>
            <Ionicons name="checkmark-circle" size={20} color={T.green} />
            <Text style={styles.allGoodText}>All systems operational</Text>
          </View>
        ) : (
          <View style={styles.timelineCard}>
            {alerts.slice(0, 5).map((alert, i) => {
              const stateColor = alertColorForState(alert.currentState || '');
              const isLast = i === Math.min(alerts.length, 5) - 1;
              return (
                <View key={i} style={styles.timelineItem}>
                  {/* Vertical line + dot */}
                  <View style={styles.timelineTrack}>
                    <View style={[styles.timelineDot, { backgroundColor: stateColor }]} />
                    {!isLast && <View style={styles.timelineLine} />}
                  </View>
                  {/* Content */}
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineName}>
                      {alert.containerName || alert.type}
                    </Text>
                    <Text style={[styles.timelineState, { color: stateColor }]}>
                      {alert.currentState || alert.message}
                    </Text>
                    <Text style={styles.timelineTime}>
                      {new Date(alert.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
      </FadeSlideIn>

      {/* Bottom spacer */}
      {overview && (
        <Text style={styles.footer}>
          Last update {new Date(overview.timestamp).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 48 },

  /* Header */
  headerBanner: {
    marginBottom: 20,
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flex: 1 },
  serverName: {
    color: T.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 6,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.green,
  },
  uptimeBadge: {
    backgroundColor: T.green + '18',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  uptimeText: {
    color: T.green,
    fontSize: 11,
    fontWeight: '600',
  },
  headerRight: { alignItems: 'flex-end', gap: 10 },
  switchBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  switchText: { color: T.textSecondary, fontSize: 13, fontWeight: '500' },

  /* Live indicator */
  liveContainer: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: T.green,
  },
  liveText: { color: T.green, fontSize: 11, fontWeight: '600' },

  /* Quick stat grid */
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    padding: 16,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statIconText: { fontSize: 14, fontWeight: '700' },
  statNumber: {
    color: T.textPrimary,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 36,
  },
  statLabel: {
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: 4,
  },

  /* Section */
  section: { marginBottom: 24 },
  sectionHeader: {
    color: T.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  seeAll: { color: T.blue, fontSize: 12, fontWeight: '500' },

  /* Gauges */
  gaugeRow: { flexDirection: 'row', gap: 10 },
  gaugeCard: {
    flex: 1,
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 16,
    alignItems: 'center',
  },
  gaugeLabel: {
    color: T.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },
  gaugeDetail: {
    color: T.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },

  /* Load average */
  loadCard: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  loadTitle: {
    color: T.textSecondary,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  loadValues: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loadNum: {
    color: T.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  loadDot: { color: T.textTertiary, fontSize: 18 },

  /* Problem containers */
  problemSection: {
    backgroundColor: T.red + '0A',
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.red + '30',
    overflow: 'hidden',
  },
  problemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: T.red + '15',
  },
  problemDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: T.red,
  },
  problemName: {
    color: T.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  problemState: {
    color: T.red,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },

  /* All good */
  allGood: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  allGoodDot: { width: 10, height: 10, borderRadius: 5 },
  allGoodText: { color: T.green, fontSize: 14, fontWeight: '500' },

  /* Timeline */
  timelineCard: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.border,
    padding: 14,
  },
  timelineItem: { flexDirection: 'row', minHeight: 48 },
  timelineTrack: { width: 20, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: T.border,
    marginTop: 4,
    marginBottom: 4,
  },
  timelineContent: { flex: 1, paddingLeft: 8, paddingBottom: 12 },
  timelineName: { color: T.textPrimary, fontSize: 13, fontWeight: '600' },
  timelineState: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  timelineTime: { color: T.textTertiary, fontSize: 11, marginTop: 2 },

  /* Error */
  errorCard: {
    backgroundColor: T.card,
    borderRadius: T.radius,
    borderWidth: 1,
    borderColor: T.red + '30',
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    gap: 10,
  },
  errorTitle: {
    color: T.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  errorText: {
    color: T.red,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.blue + '1A',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    marginTop: 8,
  },
  retryText: {
    color: T.blue,
    fontWeight: '600',
    fontSize: 14,
  },

  /* Loading */
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  loadingText: {
    color: T.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },

  /* Footer */
  footer: {
    color: T.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 8,
  },
});
