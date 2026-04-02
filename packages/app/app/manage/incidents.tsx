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
import Skeleton from '../../src/components/Skeleton';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

const PRO_API = '/api/ext/cockpit-pro';

/* ---------- Types ---------- */

type Severity = 'critical' | 'high' | 'medium' | 'low';
type IncidentStatus = 'open' | 'investigating' | 'identified' | 'monitoring' | 'resolved';

interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  commander: string | null;
  description: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface IncidentsResponse {
  incidents: Incident[];
}

/* ---------- Constants ---------- */

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: COLORS.red,
  high: COLORS.orange,
  medium: COLORS.yellow,
  low: COLORS.blue,
};

const SEVERITY_ICONS: Record<Severity, keyof typeof Ionicons.glyphMap> = {
  critical: 'flame',
  high: 'alert-circle',
  medium: 'warning',
  low: 'information-circle',
};

interface StatusFilter {
  key: 'all' | IncidentStatus;
  label: string;
}

const STATUS_FILTERS: StatusFilter[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'investigating', label: 'Investigating' },
  { key: 'identified', label: 'Identified' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'resolved', label: 'Resolved' },
];

/* ---------- Helpers ---------- */

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function getStatusColor(status: IncidentStatus): string {
  switch (status) {
    case 'open':
      return COLORS.red;
    case 'investigating':
      return COLORS.orange;
    case 'identified':
      return COLORS.yellow;
    case 'monitoring':
      return COLORS.blue;
    case 'resolved':
      return COLORS.green;
    default:
      return COLORS.textSecondary;
  }
}

/* ---------- Skeleton ---------- */

function SkeletonIncidents() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <Skeleton width={10} height={40} borderRadius={5} />
            <View style={{ flex: 1 }}>
              <Skeleton width={180} height={16} borderRadius={4} />
              <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 8 }}>
                <Skeleton width={60} height={20} borderRadius={10} />
                <Skeleton width={80} height={20} borderRadius={10} />
              </View>
              <Skeleton width={120} height={12} borderRadius={4} style={{ marginTop: 8 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
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

function IncidentsListContent() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIncidents = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await apiFetch<IncidentsResponse>(`${PRO_API}/incidents?${params.toString()}`);
      setIncidents(res.incidents ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load incidents');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchIncidents(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchIncidents();
  };

  const renderIncident = ({ item, index }: { item: Incident; index: number }) => {
    const sevColor = SEVERITY_COLORS[item.severity];
    const sevIcon = SEVERITY_ICONS[item.severity];
    const statColor = getStatusColor(item.status);

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.incidentCard}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/incident-detail?id=${item.id}` as any)}
        >
          {/* Severity stripe on left edge */}
          <View style={[styles.severityStripe, { backgroundColor: sevColor }]} />

          <View style={styles.incidentBody}>
            {/* Title row */}
            <Text style={styles.incidentTitle} numberOfLines={2}>
              {item.title}
            </Text>

            {/* Badges row */}
            <View style={styles.badgeRow}>
              {/* Severity badge */}
              <View style={[styles.badge, { backgroundColor: sevColor + '20', borderColor: sevColor }]}>
                <Ionicons name={sevIcon} size={12} color={sevColor} />
                <Text style={[styles.badgeText, { color: sevColor }]}>
                  {item.severity.charAt(0).toUpperCase() + item.severity.slice(1)}
                </Text>
              </View>

              {/* Status badge */}
              <View style={[styles.badge, { backgroundColor: statColor + '20', borderColor: statColor }]}>
                <View style={[styles.statusDot, { backgroundColor: statColor }]} />
                <Text style={[styles.badgeText, { color: statColor }]}>
                  {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </Text>
              </View>
            </View>

            {/* Meta row */}
            <View style={styles.metaRow}>
              {item.commander && (
                <View style={styles.metaItem}>
                  <Ionicons name="person-outline" size={12} color={COLORS.textTertiary} />
                  <Text style={styles.metaText}>{item.commander}</Text>
                </View>
              )}
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={12} color={COLORS.textTertiary} />
                <Text style={styles.metaText}>{formatRelativeTime(item.created_at)}</Text>
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
      {/* Status Filter Chips */}
      <FlatList
        horizontal
        data={STATUS_FILTERS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        renderItem={({ item: sf }) => {
          const isActive = statusFilter === sf.key;
          const chipColor = sf.key === 'all' ? COLORS.blue : getStatusColor(sf.key as IncidentStatus);
          return (
            <TouchableOpacity
              style={[
                styles.chip,
                isActive && { backgroundColor: chipColor + '25', borderColor: chipColor },
              ]}
              onPress={() => setStatusFilter(sf.key)}
            >
              {sf.key !== 'all' && (
                <View style={[styles.chipDot, { backgroundColor: chipColor }]} />
              )}
              <Text style={[styles.chipText, isActive && { color: chipColor }]}>
                {sf.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* Loading skeleton */}
      {loading && !refreshing && <SkeletonIncidents />}

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

      {/* Incident list */}
      {!loading && !error && (
        <FlatList
          data={incidents}
          renderItem={renderIncident}
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
                name="shield-checkmark-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No incidents</Text>
              <Text style={styles.emptySubtext}>
                {statusFilter === 'all'
                  ? 'All clear — no incidents reported yet'
                  : `No ${statusFilter} incidents found`}
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Create Incident */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/manage/incident-create' as any)}
      >
        <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function IncidentsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Incidents', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="incidents">
        <IncidentsListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* Filter chips */
  chipRow: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  /* Incident card */
  incidentCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  severityStripe: {
    width: 4,
  },
  incidentBody: {
    flex: 1,
    padding: 14,
  },
  incidentTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  badgeRow: {
    flexDirection: 'row',
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
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
    marginHorizontal: SPACING.lg,
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
    backgroundColor: COLORS.red,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.elevated,
  },
});
