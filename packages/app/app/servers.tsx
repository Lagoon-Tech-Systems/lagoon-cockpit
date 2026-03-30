import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  RefreshControl,
  Platform,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useState, useEffect, useRef, useCallback } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, withRepeat, withSequence, Easing } from 'react-native-reanimated';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { COLORS, RADIUS, SPACING } from '../src/theme/tokens';
import Skeleton from '../src/components/Skeleton';
import { TactileCard } from '../src/components/ui/TactileCard';

/* ─── Constants ─── */
const REFRESH_INTERVAL = 30_000; // 30 seconds
const FETCH_TIMEOUT = 8_000; // 8 second timeout per request
const CPU_WARN = 85;
const MEM_WARN = 85;

/* ─── Secure storage helper (mirrors serverStore) ─── */
const storage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
};

/* ─── Types ─── */
type ServerStatus = 'healthy' | 'degraded' | 'unreachable' | 'loading';

interface ServerHealthData {
  status: ServerStatus;
  platform?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  containerCount?: number;
  serviceCount?: number;
  uptimeSeconds?: number;
  lastChecked: number;
}

/* ─── Helpers ─── */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function statusColor(status: ServerStatus): string {
  switch (status) {
    case 'healthy':
      return COLORS.green;
    case 'degraded':
      return COLORS.yellow;
    case 'unreachable':
      return COLORS.red;
    default:
      return COLORS.textTertiary;
  }
}

async function fetchWithTimeout(url: string, opts: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Pulsing status dot ─── */
function PulsingDot({ color, size = 14 }: { color: string; size?: number }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(withSequence(withTiming(1.4, { duration: 1000 }), withTiming(1, { duration: 1000 })), -1);
    opacity.value = withRepeat(withSequence(withTiming(0.4, { duration: 1000 }), withTiming(1, { duration: 1000 })), -1);
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <View style={{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }, pulseStyle]}
      />
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: (size * 0.6) / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/* ─── Skeleton card ─── */
function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.cardHeader}>
        <Skeleton width={14} height={14} borderRadius={7} />
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Skeleton width={140} height={16} borderRadius={4} />
          <Skeleton width={200} height={12} borderRadius={4} style={{ marginTop: 6 }} />
        </View>
      </View>
      <View style={styles.metricsRow}>
        <Skeleton width={70} height={36} borderRadius={8} />
        <Skeleton width={70} height={36} borderRadius={8} />
        <Skeleton width={70} height={36} borderRadius={8} />
      </View>
    </View>
  );
}

/* ─── FadeSlideIn ─── */
function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 350, easing: Easing.out(Easing.ease) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 350, easing: Easing.out(Easing.ease) }));
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

/* ─── Server Card ─── */
function ServerCard({
  profile,
  health,
  index,
  onConnect,
}: {
  profile: ServerProfile;
  health: ServerHealthData | undefined;
  index: number;
  onConnect: (profile: ServerProfile) => void;
}) {
  const status = health?.status ?? 'loading';
  const color = statusColor(status);
  const isLoading = status === 'loading';

  return (
    <FadeSlideIn delay={index * 60}>
      <TactileCard
        style={styles.card}
        onPress={() => onConnect(profile)}
      >
        {/* Header: status dot + name + URL */}
        <View style={styles.cardHeader}>
          {isLoading ? (
            <Skeleton width={14} height={14} borderRadius={7} />
          ) : (
            <PulsingDot color={color} size={14} />
          )}
          <View style={styles.cardHeaderText}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {profile.name}
              </Text>
              {health?.platform && (
                <View style={[styles.platformBadge, {
                  backgroundColor: health.platform === 'windows'
                    ? COLORS.blue + '20'
                    : COLORS.green + '20',
                }]}>
                  <Ionicons
                    name={health.platform === 'windows' ? 'logo-windows' : 'logo-tux'}
                    size={10}
                    color={health.platform === 'windows' ? COLORS.blue : COLORS.green}
                  />
                  <Text style={[styles.platformText, {
                    color: health.platform === 'windows' ? COLORS.blue : COLORS.green,
                  }]}>
                    {health.platform === 'windows' ? 'Windows' : 'Linux'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={styles.cardUrl} numberOfLines={1}>
              {profile.url}
            </Text>
          </View>
        </View>

        {/* Metrics row */}
        {health && !isLoading && (
          <View style={styles.metricsRow}>
            {health.cpuPercent != null && (
              <View style={styles.metricBox}>
                <Text style={[
                  styles.metricValue,
                  health.cpuPercent >= CPU_WARN && { color: COLORS.yellow },
                ]}>
                  {health.cpuPercent.toFixed(0)}%
                </Text>
                <Text style={styles.metricLabel}>CPU</Text>
              </View>
            )}
            {health.memoryPercent != null && (
              <View style={styles.metricBox}>
                <Text style={[
                  styles.metricValue,
                  health.memoryPercent >= MEM_WARN && { color: COLORS.yellow },
                ]}>
                  {health.memoryPercent.toFixed(0)}%
                </Text>
                <Text style={styles.metricLabel}>MEM</Text>
              </View>
            )}
            {health.containerCount != null && (
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>{health.containerCount}</Text>
                <Text style={styles.metricLabel}>
                  {health.platform === 'windows' ? 'SVCS' : 'CTR'}
                </Text>
              </View>
            )}
            {health.uptimeSeconds != null && (
              <View style={styles.metricBox}>
                <Text style={styles.metricValue}>{formatUptime(health.uptimeSeconds)}</Text>
                <Text style={styles.metricLabel}>UP</Text>
              </View>
            )}
          </View>
        )}

        {/* Status bar */}
        {health && !isLoading && (
          <View style={styles.cardFooter}>
            <View style={styles.statusRow}>
              <View style={[styles.statusDotSmall, { backgroundColor: color }]} />
              <Text style={[styles.statusText, { color }]}>
                {status === 'healthy' ? 'Healthy' : status === 'degraded' ? 'Degraded' : 'Unreachable'}
              </Text>
            </View>
            <Text style={styles.checkedText}>{timeAgo(health.lastChecked)}</Text>
          </View>
        )}

        {/* Unreachable hint */}
        {status === 'unreachable' && (
          <View style={styles.unreachableHint}>
            <Ionicons name="cloud-offline-outline" size={14} color={COLORS.red} />
            <Text style={styles.unreachableText}>Cannot reach server</Text>
          </View>
        )}

        {/* Connect chevron */}
        <View style={styles.chevronContainer}>
          <Ionicons name="chevron-forward" size={18} color={COLORS.textTertiary} />
        </View>
      </TactileCard>
    </FadeSlideIn>
  );
}

/* ─── Main Screen ─── */
export default function ServersScreen() {
  const router = useRouter();
  const { profiles, loadProfiles, setActiveProfile, authenticate } = useServerStore();
  const [healthMap, setHealthMap] = useState<Record<string, ServerHealthData>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch health for a single profile, updating state as it arrives
  const fetchProfileHealth = useCallback(async (profile: ServerProfile) => {
    let status: ServerStatus = 'unreachable';
    let platform: string | undefined;
    let cpuPercent: number | undefined;
    let memoryPercent: number | undefined;
    let containerCount: number | undefined;
    let serviceCount: number | undefined;
    let uptimeSeconds: number | undefined;

    // Get stored credential for auth header
    const cred = await storage.getItem(`cockpit_cred_${profile.id}`);
    const authHeaders: Record<string, string> = {};

    // If we have a stored credential and auth mode is key, use it as bearer
    if (cred && profile.authMode === 'key') {
      // First try to get an access token by authenticating, but fall back to API key header
      authHeaders['X-API-Key'] = cred;
    }

    // 1. Health check
    try {
      const healthRes = await fetchWithTimeout(`${profile.url}/health`, {
        method: 'GET',
        headers: authHeaders,
      });
      if (healthRes.ok) {
        status = 'healthy';
      }
    } catch {
      // unreachable
    }

    // 2. Overview data (only if health succeeded)
    if (status !== 'unreachable') {
      try {
        // Try to get a token for authenticated requests
        let token: string | null = null;
        if (cred) {
          try {
            const endpoint = profile.authMode === 'key' ? '/auth/token' : '/auth/login';
            const body = profile.authMode === 'key'
              ? { apiKey: cred }
              : { email: '', password: cred };
            const authRes = await fetchWithTimeout(`${profile.url}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (authRes.ok) {
              const authData = await authRes.json();
              token = authData.accessToken;
            }
          } catch {
            // proceed without token
          }
        }

        const overviewHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          ...authHeaders,
        };
        if (token) {
          overviewHeaders['Authorization'] = `Bearer ${token}`;
        }

        const overviewRes = await fetchWithTimeout(`${profile.url}/api/overview`, {
          method: 'GET',
          headers: overviewHeaders,
        });
        if (overviewRes.ok) {
          const data = await overviewRes.json();
          platform = data.platform || 'linux';
          const sys = data.system;
          if (sys) {
            cpuPercent = sys.cpuPercent;
            memoryPercent = sys.memory?.percent;
            uptimeSeconds = sys.uptimeSeconds;
          }
          // Container or service counts
          if (data.containers) {
            containerCount = (data.containers.running ?? 0) + (data.containers.stopped ?? 0);
          }
          if (data.services) {
            containerCount = data.services.total ?? 0;
          }

          // Determine degraded status
          if (
            (cpuPercent != null && cpuPercent >= CPU_WARN) ||
            (memoryPercent != null && memoryPercent >= MEM_WARN)
          ) {
            status = 'degraded';
          }
        }
      } catch {
        // overview fetch failed but health was OK — still healthy, just no metrics
      }
    }

    const healthData: ServerHealthData = {
      status,
      platform,
      cpuPercent,
      memoryPercent,
      containerCount,
      serviceCount,
      uptimeSeconds,
      lastChecked: Date.now(),
    };

    // Update state immediately for this profile (stream in results)
    setHealthMap((prev) => ({ ...prev, [profile.id]: healthData }));
  }, []);

  // Fetch all profiles in parallel, results stream in as they complete
  const fetchAllHealth = useCallback(async () => {
    const currentProfiles = useServerStore.getState().profiles;
    if (currentProfiles.length === 0) return;

    // Mark loading for any profiles without data
    setHealthMap((prev) => {
      const next = { ...prev };
      for (const p of currentProfiles) {
        if (!next[p.id]) {
          next[p.id] = { status: 'loading', lastChecked: 0 };
        }
      }
      return next;
    });

    // Fire all fetches in parallel — each updates state individually
    await Promise.allSettled(currentProfiles.map((p) => fetchProfileHealth(p)));
    setInitialLoad(false);
  }, [fetchProfileHealth]);

  // Initial load + auto-refresh
  useEffect(() => {
    loadProfiles().then(() => {
      fetchAllHealth();
    });
    intervalRef.current = setInterval(fetchAllHealth, REFRESH_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [loadProfiles, fetchAllHealth]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllHealth();
    setRefreshing(false);
  }, [fetchAllHealth]);

  // Connect to a server
  const handleConnect = useCallback(async (profile: ServerProfile) => {
    setConnecting(profile.id);
    try {
      setActiveProfile(profile.id);
      const cred = await storage.getItem(`cockpit_cred_${profile.id}`);
      if (!cred) {
        // No stored credential — go to main screen to re-add
        router.replace('/');
        return;
      }
      await authenticate(profile.id, cred);
      router.replace('/(tabs)/overview');
    } catch {
      // Auth failed — go to server select for that server
      router.replace('/');
    } finally {
      setConnecting(null);
    }
  }, [setActiveProfile, authenticate, router]);

  const renderItem = useCallback(({ item, index }: { item: ServerProfile; index: number }) => (
    <ServerCard
      profile={item}
      health={healthMap[item.id]}
      index={index}
      onConnect={handleConnect}
    />
  ), [healthMap, handleConnect]);

  const keyExtractor = useCallback((item: ServerProfile) => item.id, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'All Servers',
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.textPrimary,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '700' },
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/overview');
                }
              }}
              style={{ marginRight: Platform.OS === 'android' ? 16 : 0 }}
            >
              <Ionicons
                name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                size={24}
                color={COLORS.blue}
              />
            </TouchableOpacity>
          ),
          headerRight: () => (
            <TouchableOpacity onPress={onRefresh} style={{ padding: 4 }}>
              <Ionicons name="refresh" size={22} color={COLORS.blue} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.container}>
        {/* Summary bar */}
        {profiles.length > 0 && !initialLoad && (
          <View style={styles.summaryBar}>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: COLORS.green }]} />
              <Text style={styles.summaryText}>
                {Object.values(healthMap).filter((h) => h.status === 'healthy').length} healthy
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: COLORS.yellow }]} />
              <Text style={styles.summaryText}>
                {Object.values(healthMap).filter((h) => h.status === 'degraded').length} degraded
              </Text>
            </View>
            <View style={styles.summaryItem}>
              <View style={[styles.summaryDot, { backgroundColor: COLORS.red }]} />
              <Text style={styles.summaryText}>
                {Object.values(healthMap).filter((h) => h.status === 'unreachable').length} down
              </Text>
            </View>
          </View>
        )}

        {/* Initial skeleton state */}
        {initialLoad && profiles.length === 0 && (
          <View style={styles.skeletonList}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </View>
        )}

        {/* Empty state */}
        {!initialLoad && profiles.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="server-outline" size={48} color={COLORS.textTertiary} />
            <Text style={styles.emptyTitle}>No Servers Configured</Text>
            <Text style={styles.emptySubtitle}>
              Add a server from the main screen to start monitoring.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.replace('/')}>
              <Ionicons name="add-circle-outline" size={18} color={COLORS.blue} />
              <Text style={styles.emptyBtnText}>Add Server</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Server list */}
        {profiles.length > 0 && (
          <FlatList
            data={profiles}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={COLORS.blue}
                colors={[COLORS.blue]}
                progressBackgroundColor={COLORS.card}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </>
  );
}

/* ─── Styles ─── */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  listContent: {
    padding: SPACING.lg,
    paddingBottom: 48,
    gap: SPACING.md,
  },

  /* Summary bar */
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xl,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  summaryText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },

  /* Card */
  card: {
    position: 'relative',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  cardHeaderText: {
    flex: 1,
    marginLeft: SPACING.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  cardName: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  cardUrl: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },

  /* Platform badge */
  platformBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  platformText: {
    fontSize: 10,
    fontWeight: '600',
  },

  /* Metrics */
  metricsRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  metricBox: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
  },
  metricValue: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  metricLabel: {
    color: COLORS.textTertiary,
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 2,
  },

  /* Card footer */
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  checkedText: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },

  /* Unreachable hint */
  unreachableHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.red + '10',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  unreachableText: {
    color: COLORS.red,
    fontSize: 12,
    fontWeight: '500',
  },

  /* Chevron */
  chevronContainer: {
    position: 'absolute',
    right: SPACING.lg,
    top: SPACING.lg,
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.lg,
  },
  skeletonList: {
    padding: SPACING.lg,
    gap: SPACING.md,
  },

  /* Empty state */
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: SPACING.md,
  },
  emptyTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: SPACING.sm,
  },
  emptySubtitle: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.blue + '1A',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: RADIUS.md,
    marginTop: SPACING.md,
  },
  emptyBtnText: {
    color: COLORS.blue,
    fontSize: 15,
    fontWeight: '600',
  },
});
