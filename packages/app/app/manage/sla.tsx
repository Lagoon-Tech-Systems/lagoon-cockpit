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

type PeriodType = 'monthly' | 'quarterly' | 'yearly';

interface SlaDefinition {
  id: string;
  name: string;
  target_uptime: number;
  period_type: PeriodType;
  monitor_id: string | null;
  description: string | null;
  current_uptime?: number;
  error_budget_remaining_minutes?: number;
  error_budget_total_minutes?: number;
  error_budget_used_minutes?: number;
}

interface SlaListResponse {
  definitions: SlaDefinition[];
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

const PERIOD_LABELS: Record<PeriodType, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
};

const PERIOD_COLORS: Record<PeriodType, string> = {
  monthly: COLORS.blue,
  quarterly: COLORS.purple,
  yearly: COLORS.orange,
};

/* ---------- Helpers ---------- */

function getUptimeColor(current: number, target: number): string {
  if (current >= target) return COLORS.green;
  if (current >= target - 0.5) return COLORS.yellow;
  return COLORS.red;
}

function getBudgetColor(used: number, total: number): string {
  if (total <= 0) return COLORS.green;
  const ratio = used / total;
  if (ratio <= 0.5) return COLORS.green;
  if (ratio <= 0.8) return COLORS.yellow;
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

function SlaListContent() {
  const router = useRouter();
  const [definitions, setDefinitions] = useState<SlaDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDefinitions = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<SlaListResponse>(`${PRO_API}/sla/definitions`);
      const defs = res.definitions ?? [];

      // Fetch budget info for each definition to get current_uptime and budget data
      const enriched = await Promise.all(
        defs.map(async (def) => {
          try {
            const budget = await apiFetch<{
              current_uptime: number;
              error_budget_total_minutes: number;
              error_budget_used_minutes: number;
              error_budget_remaining_minutes: number;
            }>(`${PRO_API}/sla/definitions/${def.id}/budget`);
            return {
              ...def,
              current_uptime: budget.current_uptime,
              error_budget_total_minutes: budget.error_budget_total_minutes,
              error_budget_used_minutes: budget.error_budget_used_minutes,
              error_budget_remaining_minutes: budget.error_budget_remaining_minutes,
            };
          } catch {
            return def;
          }
        })
      );

      setDefinitions(enriched);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load SLA definitions');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchDefinitions(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchDefinitions();
  };

  const renderDefinition = ({ item, index }: { item: SlaDefinition; index: number }) => {
    const currentUptime = item.current_uptime ?? 0;
    const uptimeColor = getUptimeColor(currentUptime, item.target_uptime);
    const periodColor = PERIOD_COLORS[item.period_type] ?? COLORS.blue;
    const budgetUsed = item.error_budget_used_minutes ?? 0;
    const budgetTotal = item.error_budget_total_minutes ?? 1;
    const budgetRatio = budgetTotal > 0 ? Math.min(budgetUsed / budgetTotal, 1) : 0;
    const budgetColor = getBudgetColor(budgetUsed, budgetTotal);

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.slaCard}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/sla-detail?id=${item.id}` as any)}
        >
          <View style={styles.slaBody}>
            {/* Name + period badge */}
            <View style={styles.cardHeaderRow}>
              <Text style={styles.slaName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.badge, { backgroundColor: periodColor + '20', borderColor: periodColor }]}>
                <Text style={[styles.badgeText, { color: periodColor }]}>
                  {PERIOD_LABELS[item.period_type]}
                </Text>
              </View>
            </View>

            {/* Uptime row */}
            <View style={styles.uptimeRow}>
              <View style={styles.uptimeBlock}>
                <Text style={[styles.uptimeValue, { color: uptimeColor }]}>
                  {currentUptime.toFixed(item.target_uptime >= 99.99 ? 4 : 2)}%
                </Text>
                <Text style={styles.uptimeLabel}>Current</Text>
              </View>
              <View style={styles.uptimeDivider} />
              <View style={styles.uptimeBlock}>
                <Text style={styles.targetValue}>
                  {item.target_uptime}%
                </Text>
                <Text style={styles.uptimeLabel}>Target</Text>
              </View>
              <View style={{ flex: 1 }} />
              <Ionicons
                name={currentUptime >= item.target_uptime ? 'checkmark-circle' : 'alert-circle'}
                size={22}
                color={uptimeColor}
              />
            </View>

            {/* Error budget bar */}
            <View style={styles.budgetSection}>
              <View style={styles.budgetLabelRow}>
                <Text style={styles.budgetLabel}>Error Budget</Text>
                <Text style={[styles.budgetPercent, { color: budgetColor }]}>
                  {(budgetRatio * 100).toFixed(1)}% used
                </Text>
              </View>
              <View style={styles.budgetBarBg}>
                <View
                  style={[
                    styles.budgetBarFill,
                    {
                      width: `${Math.max(budgetRatio * 100, 1)}%`,
                      backgroundColor: budgetColor,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} style={{ alignSelf: 'center', marginRight: SPACING.md }} />
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Loading */}
      {loading && !refreshing && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
                <View style={{ backgroundColor: COLORS.border, width: 160, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 70, height: 20, borderRadius: 10 }} />
              </View>
              <View style={{ flexDirection: 'row', gap: SPACING.lg, marginBottom: SPACING.md }}>
                <View style={{ backgroundColor: COLORS.border, width: 80, height: 28, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 80, height: 28, borderRadius: 4 }} />
              </View>
              <View style={{ backgroundColor: COLORS.border, width: '100%', height: 6, borderRadius: 3 }} />
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

      {/* SLA list */}
      {!loading && !error && (
        <FlatList
          data={definitions}
          renderItem={renderDefinition}
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
                name="document-text-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No SLA definitions</Text>
              <Text style={styles.emptySubtext}>
                Create your first SLA to start tracking uptime targets
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Create SLA */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/manage/sla-create' as any)}
      >
        <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function SlaScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'SLA Definitions', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="sla">
        <SlaListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* SLA card */
  slaCard: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  slaBody: {
    flex: 1,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  slaName: {
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

  /* Uptime row */
  uptimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  uptimeBlock: {
    alignItems: 'center',
  },
  uptimeValue: {
    ...FONT.metric,
    lineHeight: 32,
  },
  targetValue: {
    ...FONT.metric,
    color: COLORS.textSecondary,
    lineHeight: 32,
  },
  uptimeLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  uptimeDivider: {
    width: 1,
    height: 32,
    backgroundColor: COLORS.border,
    marginHorizontal: SPACING.lg,
  },

  /* Error budget bar */
  budgetSection: {},
  budgetLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  budgetLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
  },
  budgetPercent: {
    fontSize: 11,
    fontWeight: '700',
  },
  budgetBarBg: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  budgetBarFill: {
    height: 6,
    borderRadius: 3,
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
