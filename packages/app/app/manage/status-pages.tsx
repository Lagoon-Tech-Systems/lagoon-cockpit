import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
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

type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

interface StatusComponent {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
}

interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  custom_domain: string | null;
  is_public: boolean;
  components?: StatusComponent[];
}

interface StatusPagesResponse {
  pages: StatusPage[];
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

const STATUS_SEVERITY: Record<ComponentStatus, number> = {
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
  maintenance: -1,
};

const STATUS_COLORS: Record<ComponentStatus, string> = {
  operational: COLORS.green,
  degraded: COLORS.yellow,
  partial_outage: COLORS.orange,
  major_outage: COLORS.red,
  maintenance: COLORS.blue,
};

const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
};

/* ---------- Helpers ---------- */

function getOverallStatus(components?: StatusComponent[]): ComponentStatus {
  if (!components || components.length === 0) return 'operational';
  let worst: ComponentStatus = 'operational';
  let worstSeverity = 0;
  for (const comp of components) {
    const sev = STATUS_SEVERITY[comp.status];
    if (sev > worstSeverity) {
      worstSeverity = sev;
      worst = comp.status;
    }
    // maintenance is special — only show if all components are maintenance or operational
    if (comp.status === 'maintenance' && worst === 'operational') {
      worst = 'maintenance';
    }
  }
  return worst;
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

function StatusPagesListContent() {
  const router = useRouter();
  const [pages, setPages] = useState<StatusPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPages = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<StatusPagesResponse>(`${PRO_API}/status-pages`);
      setPages(res.pages ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load status pages');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPages();
  }, [fetchPages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPages(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchPages();
  };

  const renderPage = ({ item, index }: { item: StatusPage; index: number }) => {
    const overall = getOverallStatus(item.components);
    const statusColor = STATUS_COLORS[overall];
    const componentCount = item.components?.length ?? 0;

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.pageCard}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/status-page-detail?id=${item.id}` as any)}
        >
          {/* Status stripe on left edge */}
          <View style={[styles.statusStripe, { backgroundColor: statusColor }]} />

          <View style={styles.pageBody}>
            {/* Title row */}
            <Text style={styles.pageTitle} numberOfLines={1}>
              {item.name}
            </Text>

            {/* Slug */}
            <Text style={styles.slugText} numberOfLines={1}>
              /{item.slug}
            </Text>

            {/* Badges row */}
            <View style={styles.badgeRow}>
              {/* Visibility badge */}
              <View
                style={[
                  styles.badge,
                  {
                    backgroundColor: (item.is_public ? COLORS.green : COLORS.textTertiary) + '20',
                    borderColor: item.is_public ? COLORS.green : COLORS.textTertiary,
                  },
                ]}
              >
                <Ionicons
                  name={item.is_public ? 'globe-outline' : 'lock-closed-outline'}
                  size={12}
                  color={item.is_public ? COLORS.green : COLORS.textTertiary}
                />
                <Text
                  style={[
                    styles.badgeText,
                    { color: item.is_public ? COLORS.green : COLORS.textTertiary },
                  ]}
                >
                  {item.is_public ? 'Public' : 'Private'}
                </Text>
              </View>

              {/* Status badge */}
              <View
                style={[
                  styles.badge,
                  { backgroundColor: statusColor + '20', borderColor: statusColor },
                ]}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.badgeText, { color: statusColor }]}>
                  {STATUS_LABELS[overall]}
                </Text>
              </View>
            </View>

            {/* Meta row */}
            <View style={styles.metaRow}>
              <View style={styles.metaItem}>
                <Ionicons name="layers-outline" size={12} color={COLORS.textTertiary} />
                <Text style={styles.metaText}>
                  {componentCount} component{componentCount !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          </View>

          <Ionicons
            name="chevron-forward"
            size={16}
            color={COLORS.textTertiary}
            style={{ alignSelf: 'center' }}
          />
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Loading state */}
      {loading && !refreshing && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
                <View style={{ width: 4, height: 50, borderRadius: 2, backgroundColor: COLORS.border }} />
                <View style={{ flex: 1 }}>
                  <View style={{ width: 160, height: 16, borderRadius: 4, backgroundColor: COLORS.border, marginBottom: 8 }} />
                  <View style={{ width: 100, height: 12, borderRadius: 4, backgroundColor: COLORS.border, marginBottom: 8 }} />
                  <View style={{ flexDirection: 'row', gap: SPACING.sm }}>
                    <View style={{ width: 60, height: 20, borderRadius: 10, backgroundColor: COLORS.border }} />
                    <View style={{ width: 80, height: 20, borderRadius: 10, backgroundColor: COLORS.border }} />
                  </View>
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

      {/* Page list */}
      {!loading && !error && (
        <FlatList
          data={pages}
          renderItem={renderPage}
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
              <Text style={styles.emptyText}>No status pages</Text>
              <Text style={styles.emptySubtext}>
                Create a status page to keep your users informed
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Create Status Page */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/manage/status-page-create' as any)}
      >
        <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function StatusPagesScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Status Pages', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="status_pages">
        <StatusPagesListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* Page card */
  pageCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  statusStripe: {
    width: 4,
  },
  pageBody: {
    flex: 1,
    padding: 14,
  },
  pageTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  slugText: {
    fontSize: 12,
    color: COLORS.textTertiary,
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
