import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useServerStore } from '../../src/stores/serverStore';
import { useDashboardStore } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import { useRouter } from 'expo-router';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { useLayout } from '../../src/hooks/useLayout';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { TactileCard } from '../../src/components/ui/TactileCard';
import { StatusDot } from '../../src/components/ui/StatusDot';
import Skeleton from '../../src/components/Skeleton';
import { sanitizeErrorMessage } from '../../src/lib/errors';

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

/** Returns a severity color based on a percentage value */
function severityColor(percent: number): string {
  if (percent < 30) return COLORS.optimal;
  if (percent < 60) return COLORS.green;
  if (percent < 75) return COLORS.yellow;
  if (percent < 90) return COLORS.orange;
  return COLORS.red;
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

  const rightDeg = Math.min(degrees, 180);
  const leftDeg = Math.max(degrees - 180, 0);

  return (
    <View style={{ width: size, height: size }}>
      <View style={baseCircle} />
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
      <View style={styles.ringCenter}>
        <Text style={[FONT.metric, { color: COLORS.textPrimary, fontSize: 16 }]}>
          {clampedPercent.toFixed(0)}%
        </Text>
      </View>
    </View>
  );
}

/* ─── Skeleton Placeholders ─── */
function SkeletonStatGrid() {
  return (
    <View style={styles.statGrid}>
      {[0, 1, 2, 3].map((i) => (
        <GlassCard key={i} style={styles.skeletonStatCard}>
          <Skeleton width={32} height={32} borderRadius={10} />
          <Skeleton width={60} height={32} borderRadius={8} style={{ marginTop: 10 }} />
          <Skeleton width={80} height={12} borderRadius={4} style={{ marginTop: 8 }} />
        </GlassCard>
      ))}
    </View>
  );
}

function SkeletonGaugeRow() {
  return (
    <View style={styles.section}>
      <Skeleton width={140} height={14} borderRadius={4} style={{ marginBottom: SPACING.md }} />
      <View style={styles.gaugeRow}>
        {[0, 1, 2].map((i) => (
          <GlassCard key={i} style={styles.skeletonGaugeCard}>
            <Skeleton width={64} height={64} borderRadius={32} />
            <Skeleton width={30} height={12} borderRadius={4} style={{ marginTop: 8 }} />
            <Skeleton width={50} height={10} borderRadius={4} style={{ marginTop: 4 }} />
          </GlassCard>
        ))}
      </View>
    </View>
  );
}

/* ─── Animated Section Wrapper ─── */
function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(20);

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

/* ─── Main Screen ─── */
export default function OverviewScreen() {
  const router = useRouter();
  const layout = useLayout();
  const { serverName, disconnect } = useServerStore();
  const { overview, setOverview, containers, setContainers, stacks, setStacks, alerts } = useDashboardStore();
  const platform = useDashboardStore((s) => s.platform);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setError(null);

      const overviewData = await apiFetch<any>('/api/overview');
      setOverview(overviewData);

      const detectedPlatform = overviewData.platform === 'windows' ? 'windows' : 'linux';

      if (detectedPlatform === 'windows') {
        const servicesData = await apiFetch<any>('/api/services');
        useDashboardStore.getState().setServices(servicesData.services);
      } else {
        const [containerData, stackData] = await Promise.all([
          apiFetch<any>('/api/containers'),
          apiFetch<any>('/api/stacks'),
        ]);
        setContainers(containerData.containers);
        setStacks(stackData.stacks);
      }
    } catch (err) {
      console.error('[COCKPIT] Failed to fetch overview:', err);
      setError(sanitizeErrorMessage(err, 'Failed to load dashboard'));
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
    health === 'unhealthy' ? COLORS.yellow : state === 'running' ? COLORS.green : state === 'exited' ? COLORS.red : COLORS.orange;

  return (
    <ScreenErrorBoundary screenName="Overview">
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, layout.isTablet && styles.contentTablet]}
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
      {/* ── 1. Server Header ── */}
      <View style={styles.headerBanner}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={[FONT.hero, styles.serverName]}>{serverName || 'Server'}</Text>
            <View style={styles.headerMeta}>
              <StatusDot status="healthy" size={8} />
              {sys && (
                <View style={styles.uptimeBadge}>
                  <Text style={[FONT.bodyMedium, styles.uptimeText]}>
                    Up {formatUptime(sys.uptimeSeconds)}
                  </Text>
                </View>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.liveContainer}>
              <StatusDot status="healthy" size={5} />
              <Text style={[FONT.label, styles.liveText]}>Live</Text>
            </View>
            <TouchableOpacity
              style={styles.switchBtn}
              onPress={() => {
                disconnect();
                router.replace('/');
              }}
              accessibilityRole="button"
              accessibilityLabel="Switch server"
            >
              <Text style={[FONT.bodyMedium, { color: COLORS.textSecondary, fontSize: 13 }]}>Switch</Text>
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
        <GlassCard style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.red} />
          <Text style={[FONT.heading, { color: COLORS.textPrimary, marginTop: SPACING.xs }]}>
            Connection Error
          </Text>
          <Text style={[FONT.body, styles.errorText]}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchAll}>
            <Ionicons name="refresh" size={16} color={COLORS.blue} />
            <Text style={[FONT.bodyMedium, { color: COLORS.blue }]}>Retry</Text>
          </TouchableOpacity>
        </GlassCard>
      )}

      {/* ── 2. Quick Stat Cards — Windows ── */}
      {overview && platform === 'windows' && (
        <FadeSlideIn delay={0}>
          <View style={styles.statGrid}>
            <GlassCard style={styles.statCardInner} elevated>
              <View style={[styles.statIcon, { backgroundColor: COLORS.blue + '20' }]}>
                <Ionicons name="cog-outline" size={16} color={COLORS.blue} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>
                {overview.services?.total ?? 0}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>SERVICES</Text>
            </GlassCard>

            <GlassCard style={styles.statCardInner} elevated>
              <View style={[styles.statIcon, { backgroundColor: COLORS.green + '20' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.green} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>
                {overview.services?.running ?? 0}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>RUNNING</Text>
            </GlassCard>

            <GlassCard style={styles.statCardInner} elevated>
              <View style={[styles.statIcon, { backgroundColor: COLORS.red + '20' }]}>
                <Ionicons name="stop-circle-outline" size={16} color={COLORS.red} />
              </View>
              <Text style={[
                FONT.metric,
                { color: (overview.services?.stopped ?? 0) > 0 ? COLORS.red : COLORS.textPrimary },
              ]}>
                {overview.services?.stopped ?? 0}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>STOPPED</Text>
            </GlassCard>

            <GlassCard style={styles.statCardInner} elevated>
              <View style={[styles.statIcon, { backgroundColor: COLORS.purple + '20' }]}>
                <Ionicons name="list-outline" size={16} color={COLORS.purple} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>-</Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>PROCESSES</Text>
            </GlassCard>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 2. Quick Stat Cards — Linux ── */}
      {overview && platform !== 'windows' && (
        <FadeSlideIn delay={0}>
          <View style={styles.statGrid}>
            <TactileCard
              style={styles.statCardOuter}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: COLORS.blue + '20' }]}>
                <Ionicons name="cube-outline" size={16} color={COLORS.blue} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>
                {overview.containers.running + overview.containers.stopped}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>CONTAINERS</Text>
            </TactileCard>

            <TactileCard
              style={styles.statCardOuter}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: COLORS.green + '20' }]}>
                <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.green} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>
                {overview.containers.running}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>RUNNING</Text>
            </TactileCard>

            <TactileCard
              style={styles.statCardOuter}
              onPress={() => router.push('/(tabs)/containers')}
            >
              <View style={[styles.statIcon, { backgroundColor: COLORS.red + '20' }]}>
                <Ionicons name="stop-circle-outline" size={16} color={COLORS.red} />
              </View>
              <Text style={[
                FONT.metric,
                { color: overview.containers.stopped > 0 ? COLORS.red : COLORS.textPrimary },
              ]}>
                {overview.containers.stopped}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>STOPPED</Text>
            </TactileCard>

            <TactileCard
              style={styles.statCardOuter}
              onPress={() => router.push('/(tabs)/stacks')}
            >
              <View style={[styles.statIcon, { backgroundColor: COLORS.purple + '20' }]}>
                <Ionicons name="layers-outline" size={16} color={COLORS.purple} />
              </View>
              <Text style={[FONT.metric, { color: COLORS.textPrimary }]}>
                {overview.stacks.total}
              </Text>
              <Text style={[FONT.label, { color: COLORS.textTertiary }]}>STACKS</Text>
            </TactileCard>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 3. System Gauges ── */}
      {sys && (
        <FadeSlideIn delay={100}>
          <View style={styles.section}>
            <Text style={[FONT.label, { color: COLORS.textTertiary, marginBottom: SPACING.md }]}>
              SYSTEM RESOURCES
            </Text>
            <View style={styles.gaugeRow}>
              {/* CPU */}
              <GlassCard
                elevated
                style={StyleSheet.flatten([
                  styles.gaugeCardInner,
                  sys.cpuPercent > 70 ? SHADOW.glow(severityColor(sys.cpuPercent)) : undefined,
                ])}
              >
                <MaterialCommunityIcons name="cpu-64-bit" size={16} color={COLORS.textTertiary} style={{ marginBottom: SPACING.xs }} />
                <ProgressRing size={70} strokeWidth={6} percent={sys.cpuPercent} color={severityColor(sys.cpuPercent)} />
                <Text style={[FONT.label, { color: COLORS.textSecondary, marginTop: SPACING.sm }]}>CPU</Text>
                <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 10 }]}>{sys.cpuCount} cores</Text>
              </GlassCard>

              {/* RAM */}
              <GlassCard
                elevated
                style={StyleSheet.flatten([
                  styles.gaugeCardInner,
                  sys.memory.percent > 70 ? SHADOW.glow(severityColor(sys.memory.percent)) : undefined,
                ])}
              >
                <MaterialCommunityIcons name="memory" size={16} color={COLORS.textTertiary} style={{ marginBottom: SPACING.xs }} />
                <ProgressRing size={70} strokeWidth={6} percent={sys.memory.percent} color={severityColor(sys.memory.percent)} />
                <Text style={[FONT.label, { color: COLORS.textSecondary, marginTop: SPACING.sm }]}>RAM</Text>
                <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 10 }]}>{formatBytes(sys.memory.used)}</Text>
              </GlassCard>

              {/* Disk */}
              <GlassCard
                elevated
                style={StyleSheet.flatten([
                  styles.gaugeCardInner,
                  sys.disk.percent > 70 ? SHADOW.glow(severityColor(sys.disk.percent)) : undefined,
                ])}
              >
                <MaterialCommunityIcons name="harddisk" size={16} color={COLORS.textTertiary} style={{ marginBottom: SPACING.xs }} />
                <ProgressRing size={70} strokeWidth={6} percent={sys.disk.percent} color={severityColor(sys.disk.percent)} />
                <Text style={[FONT.label, { color: COLORS.textSecondary, marginTop: SPACING.sm }]}>Disk</Text>
                <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 10 }]}>{formatBytes(sys.disk.used)}</Text>
              </GlassCard>
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* ── 4. Load Average (Linux only) ── */}
      {sys && sys.load && platform !== 'windows' && (
        <GlassCard elevated style={styles.loadCard}>
          <Text style={[FONT.label, { color: COLORS.textTertiary }]}>LOAD AVG</Text>
          <View style={styles.loadValues}>
            <Text style={[FONT.mono, { color: COLORS.textPrimary, fontSize: 15 }]}>{sys.load.load1.toFixed(2)}</Text>
            <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 18 }]}>{'\u00B7'}</Text>
            <Text style={[FONT.mono, { color: COLORS.textPrimary, fontSize: 15 }]}>{sys.load.load5.toFixed(2)}</Text>
            <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 18 }]}>{'\u00B7'}</Text>
            <Text style={[FONT.mono, { color: COLORS.textPrimary, fontSize: 15 }]}>{sys.load.load15.toFixed(2)}</Text>
          </View>
        </GlassCard>
      )}

      {/* ── 5. Problem Containers (Linux only) ── */}
      {platform !== 'windows' && problemContainers.length > 0 && (
        <FadeSlideIn delay={200}>
          <View style={styles.section}>
            <Text style={[FONT.label, { color: COLORS.red, marginBottom: SPACING.md }]}>
              ATTENTION REQUIRED
            </Text>
            <GlassCard noPadding style={styles.problemSection}>
              {problemContainers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.problemRow}
                  onPress={() => router.push(`/containers/${c.id}`)}
                >
                  <StatusDot
                    status={c.health === 'unhealthy' ? 'warning' : c.state === 'exited' ? 'critical' : 'elevated'}
                    size={8}
                  />
                  <Text style={[FONT.bodyMedium, { color: COLORS.textPrimary, flex: 1 }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={[FONT.label, { color: COLORS.red }]}>
                    {c.health === 'unhealthy' ? 'unhealthy' : c.state}
                  </Text>
                </TouchableOpacity>
              ))}
            </GlassCard>
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
            <Text style={[FONT.label, { color: COLORS.textTertiary }]}>RECENT ACTIVITY</Text>
            {alerts.length > 0 && (
              <Text style={[FONT.bodyMedium, { color: COLORS.blue, fontSize: 12 }]}>
                {alerts.length} alerts ›
              </Text>
            )}
          </TouchableOpacity>

          {alerts.length === 0 ? (
            <GlassCard elevated style={styles.allGood}>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.green} />
              <Text style={[FONT.bodyMedium, { color: COLORS.green }]}>All systems operational</Text>
            </GlassCard>
          ) : (
            <GlassCard elevated noPadding>
              <View style={{ padding: SPACING.lg }}>
                {alerts.slice(0, 5).map((alert, i) => {
                  const stateColor = alertColorForState(alert.currentState || '');
                  const isLast = i === Math.min(alerts.length, 5) - 1;
                  return (
                    <View key={i} style={styles.timelineItem}>
                      <View style={styles.timelineTrack}>
                        <View style={[styles.timelineDot, { backgroundColor: stateColor }]} />
                        {!isLast && <View style={styles.timelineLine} />}
                      </View>
                      <View style={styles.timelineContent}>
                        <Text style={[FONT.bodyMedium, { color: COLORS.textPrimary, fontSize: 13 }]}>
                          {alert.containerName || alert.type}
                        </Text>
                        <Text style={[FONT.body, { color: stateColor, fontSize: 12 }]}>
                          {alert.currentState || alert.message}
                        </Text>
                        <Text style={[FONT.body, { color: COLORS.textTertiary, fontSize: 11, marginTop: 2 }]}>
                          {new Date(alert.timestamp).toLocaleTimeString()}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </GlassCard>
          )}
        </View>
      </FadeSlideIn>

      {/* Bottom spacer */}
      {overview && (
        <Text style={[FONT.body, styles.footer]}>
          Last update {new Date(overview.timestamp).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
    </ScreenErrorBoundary>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 48, backgroundColor: COLORS.bgDeep },
  contentTablet: { paddingHorizontal: SPACING.xxxl, maxWidth: 960, alignSelf: 'center', width: '100%' as any },

  /* Header */
  headerBanner: {
    marginBottom: SPACING.xxl,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flex: 1 },
  serverName: {
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  uptimeBadge: {
    backgroundColor: COLORS.green + '18',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
  },
  uptimeText: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  headerRight: { alignItems: 'flex-end', gap: SPACING.md },
  switchBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.glass,
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
    minHeight: 44,
    justifyContent: 'center',
  },

  /* Live indicator */
  liveContainer: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  liveText: { color: COLORS.green, fontSize: 11 },

  /* Quick stat grid */
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xl,
    marginBottom: SPACING.xxxl,
  },
  /* For TactileCard (wraps GlassCard internally) */
  statCardOuter: {
    flex: 1,
    minWidth: 150,
  },
  /* For GlassCard used directly (Windows) */
  statCardInner: {
    flex: 1,
    minWidth: 150,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },

  /* Section */
  section: { marginBottom: SPACING.xxxl },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },

  /* Gauges */
  gaugeRow: { flexDirection: 'row', gap: SPACING.xl },
  gaugeCardInner: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.lg,
  },

  /* Load average */
  loadCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.xxxl,
  },
  loadValues: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },

  /* Problem containers */
  problemSection: {
    borderWidth: 1,
    borderColor: COLORS.red + '30',
  },
  problemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.red + '15',
  },

  /* All good */
  allGood: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: SPACING.md,
  },

  /* Timeline */
  timelineItem: { flexDirection: 'row', minHeight: 48 },
  timelineTrack: { width: 20, alignItems: 'center' },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 2 },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.border,
    marginTop: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  timelineContent: { flex: 1, paddingLeft: SPACING.sm, paddingBottom: SPACING.md },

  /* Error */
  errorCard: {
    borderWidth: 1,
    borderColor: COLORS.red + '30',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xxxl,
    gap: SPACING.md,
  },
  errorText: {
    color: COLORS.red,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.blue + '1A',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.sm,
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },

  /* Ring center */
  ringCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  /* Skeleton cards */
  skeletonStatCard: {
    flex: 1,
    minWidth: 150,
  },
  skeletonGaugeCard: {
    flex: 1,
    alignItems: 'center',
  },

  /* Footer */
  footer: {
    color: COLORS.textTertiary,
    fontSize: 10,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});
