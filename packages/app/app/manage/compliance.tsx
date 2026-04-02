import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
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

interface ComplianceLog {
  id: string;
  event_type: string;
  actor: string;
  severity: 'info' | 'warning' | 'critical' | 'error';
  timestamp: string;
  message?: string;
}

interface ComplianceStats {
  total: number;
  by_severity: Record<string, number>;
  last_24h: number;
}

interface LogsResponse {
  logs: ComplianceLog[];
  total?: number;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

const SEVERITY_COLORS: Record<string, string> = {
  info: COLORS.blue,
  warning: COLORS.yellow,
  critical: COLORS.red,
  error: COLORS.orange,
};

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
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------- Header Button ---------- */

function ComplianceSettingsButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push('/manage/compliance-config' as any)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Ionicons name="settings-outline" size={22} color={COLORS.blue} />
    </TouchableOpacity>
  );
}

/* ---------- Screen ---------- */

function ComplianceListContent() {
  const router = useRouter();
  const [logs, setLogs] = useState<ComplianceLog[]>([]);
  const [stats, setStats] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [logsRes, statsRes] = await Promise.all([
        apiFetch<LogsResponse>(`${ENT_API}/compliance/logs`),
        apiFetch<ComplianceStats>(`${ENT_API}/compliance/stats`),
      ]);
      setLogs(logsRes.logs ?? []);
      setStats(statsRes);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load compliance logs');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchData();
  };

  const handleExport = async () => {
    try {
      await apiFetch(`${ENT_API}/compliance/export`);
      Alert.alert('Export Started', 'The compliance log export has been initiated. You will be notified when it is ready.');
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to export logs');
      Alert.alert('Error', message);
    }
  };

  const renderLog = ({ item, index }: { item: ComplianceLog; index: number }) => {
    const severityColor = SEVERITY_COLORS[item.severity] ?? COLORS.blue;

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/compliance-detail?id=${item.id}` as any)}
        >
          <View style={styles.cardBody}>
            {/* Event type + severity badge */}
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.event_type}
              </Text>
              <View style={[styles.badge, { backgroundColor: severityColor + '20', borderColor: severityColor }]}>
                <Text style={[styles.badgeText, { color: severityColor }]}>
                  {item.severity.toUpperCase()}
                </Text>
              </View>
            </View>

            {/* Actor + timestamp */}
            <View style={styles.statusRow}>
              <Ionicons name="person-outline" size={12} color={COLORS.textTertiary} />
              <Text style={styles.actorText} numberOfLines={1}>
                {item.actor}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.dateText}>
                {formatDateTime(item.timestamp)}
              </Text>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} style={{ alignSelf: 'center', marginRight: SPACING.md }} />
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  const renderHeader = () => {
    if (!stats) return null;
    return (
      <FadeSlideIn delay={0}>
        <GlassCard style={styles.statsCard} elevated>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total Logs</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.last_24h}</Text>
              <Text style={styles.statLabel}>Last 24h</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.red }]}>
                {stats.by_severity?.critical ?? 0}
              </Text>
              <Text style={styles.statLabel}>Critical</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: COLORS.yellow }]}>
                {stats.by_severity?.warning ?? 0}
              </Text>
              <Text style={styles.statLabel}>Warnings</Text>
            </View>
          </View>
        </GlassCard>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Loading */}
      {loading && !refreshing && (
        <View style={styles.list}>
          <View style={styles.skeletonCard}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={{ alignItems: 'center', gap: SPACING.xs }}>
                  <View style={{ backgroundColor: COLORS.border, width: 40, height: 24, borderRadius: 4 }} />
                  <View style={{ backgroundColor: COLORS.border, width: 50, height: 12, borderRadius: 4 }} />
                </View>
              ))}
            </View>
          </View>
          {[0, 1, 2, 3].map((i) => (
            <View key={`sk-${i}`} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
                <View style={{ backgroundColor: COLORS.border, width: 140, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 60, height: 20, borderRadius: 10 }} />
              </View>
              <View style={{ flexDirection: 'row', gap: SPACING.lg }}>
                <View style={{ backgroundColor: COLORS.border, width: 80, height: 14, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 80, height: 14, borderRadius: 4 }} />
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

      {/* Log list */}
      {!loading && !error && (
        <FlatList
          data={logs}
          renderItem={renderLog}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={renderHeader}
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
                name="document-text-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No compliance logs</Text>
              <Text style={styles.emptySubtext}>
                Compliance events will appear here as they are recorded
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Export */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={handleExport}
      >
        <Ionicons name="download-outline" size={24} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function ComplianceScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: 'Compliance Logs',
          headerBackTitle: 'Manage',
          headerRight: () => (
            <ComplianceSettingsButton />
          ),
        }}
      />
      <FeatureGate feature="compliance_logging">
        <ComplianceListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* Stats card */
  statsCard: {
    marginBottom: SPACING.md,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    ...FONT.title,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  statLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
  },

  /* Card */
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  cardName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.sm,
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

  /* Status row */
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  actorText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  dateText: {
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
