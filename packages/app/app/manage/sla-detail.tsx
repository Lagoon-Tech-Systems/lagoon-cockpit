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

type PeriodType = 'monthly' | 'quarterly' | 'yearly';

interface SlaDefinition {
  id: string;
  name: string;
  target_uptime: number;
  period_type: PeriodType;
  monitor_id: string | null;
  description: string | null;
}

interface ErrorBudget {
  target_uptime: number;
  period_type: PeriodType;
  current_uptime: number;
  error_budget_total_minutes: number;
  error_budget_used_minutes: number;
  error_budget_remaining_minutes: number;
  burn_rate: number;
  period_start: string;
  period_end: string;
}

interface Breach {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number;
  description: string | null;
}

interface BreachesResponse {
  breaches: Breach[];
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

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDuration(minutes: number): string {
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
}

function getBurnRateLabel(rate: number): { label: string; color: string } {
  if (rate <= 1) return { label: 'Normal', color: COLORS.green };
  if (rate <= 2) return { label: 'Elevated', color: COLORS.yellow };
  if (rate <= 5) return { label: 'High', color: COLORS.orange };
  return { label: 'Critical', color: COLORS.red };
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

function SlaDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [definition, setDefinition] = useState<SlaDefinition | null>(null);
  const [budget, setBudget] = useState<ErrorBudget | null>(null);
  const [breaches, setBreaches] = useState<Breach[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [defRes, budgetRes, breachRes] = await Promise.all([
        apiFetch<SlaDefinition>(`${PRO_API}/sla/definitions/${id}`),
        apiFetch<ErrorBudget>(`${PRO_API}/sla/definitions/${id}/budget`),
        apiFetch<BreachesResponse>(`${PRO_API}/sla/definitions/${id}/breaches`),
      ]);
      setDefinition(defRes);
      setBudget(budgetRes);
      setBreaches(breachRes.breaches ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load SLA details');
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

  const handleRecalculate = async () => {
    if (!id) return;
    setRecalculating(true);
    try {
      await apiFetch(`${PRO_API}/sla/definitions/${id}/recalculate`, { method: 'POST' });
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to recalculate');
      Alert.alert('Error', message);
    } finally {
      setRecalculating(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete SLA',
      'Are you sure you want to delete this SLA definition? All periods and breaches will be removed. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${PRO_API}/sla/definitions/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete SLA');
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
        <Stack.Screen options={{ title: 'SLA', headerBackTitle: 'SLAs' }} />
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
        <Stack.Screen options={{ title: 'SLA', headerBackTitle: 'SLAs' }} />
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!definition) return null;

  const periodColor = PERIOD_COLORS[definition.period_type] ?? COLORS.blue;
  const budgetUsed = budget?.error_budget_used_minutes ?? 0;
  const budgetTotal = budget?.error_budget_total_minutes ?? 1;
  const budgetRatio = budgetTotal > 0 ? Math.min(budgetUsed / budgetTotal, 1) : 0;
  const budgetBarColor = budgetRatio <= 0.5 ? COLORS.green : budgetRatio <= 0.8 ? COLORS.yellow : COLORS.red;
  const burnRate = budget?.burn_rate ?? 0;
  const burnInfo = getBurnRateLabel(burnRate);
  const currentUptime = budget?.current_uptime ?? 0;
  const uptimeColor = currentUptime >= definition.target_uptime
    ? COLORS.green
    : currentUptime >= definition.target_uptime - 0.5
      ? COLORS.yellow
      : COLORS.red;

  return (
    <>
      <Stack.Screen
        options={{
          title: definition.name,
          headerBackTitle: 'SLAs',
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
              <Text style={styles.headerTitle}>{definition.name}</Text>
              <TouchableOpacity
                onPress={() => router.push(`/manage/sla-create?id=${id}` as any)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="create-outline" size={20} color={COLORS.blue} />
              </TouchableOpacity>
            </View>

            {definition.description && (
              <Text style={styles.headerDescription}>{definition.description}</Text>
            )}

            <View style={styles.headerBadges}>
              <View style={[styles.badge, { backgroundColor: periodColor + '20', borderColor: periodColor }]}>
                <Ionicons name="calendar-outline" size={12} color={periodColor} />
                <Text style={[styles.badgeText, { color: periodColor }]}>
                  {PERIOD_LABELS[definition.period_type]}
                </Text>
              </View>
              {definition.monitor_id && (
                <View style={[styles.badge, { backgroundColor: COLORS.green + '20', borderColor: COLORS.green }]}>
                  <Ionicons name="pulse-outline" size={12} color={COLORS.green} />
                  <Text style={[styles.badgeText, { color: COLORS.green }]}>Linked Monitor</Text>
                </View>
              )}
            </View>

            {/* Large target uptime */}
            <View style={styles.targetSection}>
              <Text style={styles.targetLabel}>Target Uptime</Text>
              <Text style={styles.targetMetric}>{definition.target_uptime}%</Text>
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Error Budget Card */}
        {budget && (
          <FadeSlideIn delay={100}>
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Error Budget</Text>

              {/* Period range */}
              <Text style={styles.periodRange}>
                {formatDate(budget.period_start)} — {formatDate(budget.period_end)}
              </Text>

              {/* Remaining minutes — big metric */}
              <View style={styles.budgetMetricRow}>
                <View style={styles.budgetMetricBlock}>
                  <Text style={[styles.budgetBigNumber, { color: budgetBarColor }]}>
                    {formatDuration(budget.error_budget_remaining_minutes)}
                  </Text>
                  <Text style={styles.budgetMetricLabel}>Remaining</Text>
                </View>
                <View style={styles.budgetMetricBlock}>
                  <Text style={styles.budgetSmallNumber}>
                    {formatDuration(budget.error_budget_total_minutes)}
                  </Text>
                  <Text style={styles.budgetMetricLabel}>Total Budget</Text>
                </View>
              </View>

              {/* Progress bar */}
              <View style={styles.budgetBarBg}>
                <View
                  style={[
                    styles.budgetBarFill,
                    {
                      width: `${Math.max(budgetRatio * 100, 1)}%`,
                      backgroundColor: budgetBarColor,
                    },
                  ]}
                />
              </View>
              <Text style={styles.budgetBarLabel}>
                {formatDuration(budgetUsed)} of {formatDuration(budgetTotal)} used ({(budgetRatio * 100).toFixed(1)}%)
              </Text>

              {/* Burn rate */}
              <View style={styles.burnRateRow}>
                <Text style={styles.burnRateLabel}>Burn Rate</Text>
                <View style={[styles.badge, { backgroundColor: burnInfo.color + '20', borderColor: burnInfo.color }]}>
                  <Text style={[styles.badgeText, { color: burnInfo.color }]}>
                    {burnRate.toFixed(2)}x — {burnInfo.label}
                  </Text>
                </View>
              </View>

              {/* Uptime comparison */}
              <View style={styles.uptimeCompare}>
                <View style={styles.uptimeCompareItem}>
                  <Text style={[styles.uptimeCompareValue, { color: uptimeColor }]}>
                    {currentUptime.toFixed(definition.target_uptime >= 99.99 ? 4 : 2)}%
                  </Text>
                  <Text style={styles.uptimeCompareLabel}>Current</Text>
                </View>
                <Ionicons
                  name={currentUptime >= definition.target_uptime ? 'checkmark-circle' : 'close-circle'}
                  size={24}
                  color={uptimeColor}
                />
                <View style={styles.uptimeCompareItem}>
                  <Text style={styles.uptimeCompareValue}>
                    {definition.target_uptime}%
                  </Text>
                  <Text style={styles.uptimeCompareLabel}>Target</Text>
                </View>
              </View>
            </GlassCard>
          </FadeSlideIn>
        )}

        {/* Breaches Section */}
        <FadeSlideIn delay={200}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Recent Breaches</Text>
              <View style={[styles.countBadge, breaches.length > 0 && { backgroundColor: COLORS.red + '20' }]}>
                <Text style={[styles.countBadgeText, breaches.length > 0 && { color: COLORS.red }]}>
                  {breaches.length}
                </Text>
              </View>
            </View>

            {breaches.length === 0 ? (
              <View style={styles.emptyBreaches}>
                <Ionicons name="shield-checkmark-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptyBreachText}>No breaches recorded</Text>
              </View>
            ) : (
              breaches.slice(0, 10).map((breach, index) => (
                <View key={breach.id} style={[styles.breachItem, index < breaches.length - 1 && styles.breachItemBorder]}>
                  <View style={styles.breachHeader}>
                    <Ionicons name="alert-circle" size={16} color={COLORS.red} />
                    <Text style={styles.breachTime}>{formatDateTime(breach.started_at)}</Text>
                  </View>
                  <View style={styles.breachDetails}>
                    <View style={styles.breachDuration}>
                      <Ionicons name="timer-outline" size={14} color={COLORS.textTertiary} />
                      <Text style={styles.breachDurationText}>
                        {formatDuration(breach.duration_minutes)}
                      </Text>
                    </View>
                    {breach.description && (
                      <Text style={styles.breachDescription} numberOfLines={2}>
                        {breach.description}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        <FadeSlideIn delay={300}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={handleRecalculate}
              disabled={recalculating}
            >
              {recalculating ? (
                <ActivityIndicator size="small" color={COLORS.blue} />
              ) : (
                <Ionicons name="refresh" size={18} color={COLORS.blue} />
              )}
              <Text style={styles.actionBtnText}>
                {recalculating ? 'Recalculating...' : 'Recalculate'}
              </Text>
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
      </ScrollView>
    </>
  );
}

export default function SlaDetailScreen() {
  return (
    <FeatureGate feature="sla">
      <SlaDetailContent />
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
  headerDescription: {
    ...FONT.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.md,
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
  targetSection: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  targetLabel: {
    ...FONT.label,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  targetMetric: {
    ...FONT.metric,
    color: COLORS.textPrimary,
    fontSize: 28,
  },

  /* Section card */
  sectionCard: {
    marginBottom: SPACING.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  periodRange: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginBottom: SPACING.lg,
  },

  /* Budget metrics */
  budgetMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.lg,
  },
  budgetMetricBlock: {
    alignItems: 'center',
  },
  budgetBigNumber: {
    ...FONT.metric,
    lineHeight: 32,
  },
  budgetSmallNumber: {
    ...FONT.heading,
    color: COLORS.textSecondary,
  },
  budgetMetricLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },

  /* Budget bar */
  budgetBarBg: {
    height: 8,
    backgroundColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: SPACING.xs,
  },
  budgetBarFill: {
    height: 8,
    borderRadius: 4,
  },
  budgetBarLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: SPACING.lg,
  },

  /* Burn rate */
  burnRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.lg,
  },
  burnRateLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },

  /* Uptime comparison */
  uptimeCompare: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xl,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  uptimeCompareItem: {
    alignItems: 'center',
  },
  uptimeCompareValue: {
    ...FONT.heading,
    color: COLORS.textPrimary,
  },
  uptimeCompareLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },

  /* Breaches */
  countBadge: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  countBadgeText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyBreaches: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptyBreachText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  breachItem: {
    paddingVertical: SPACING.md,
  },
  breachItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  breachHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  breachTime: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  breachDetails: {
    marginLeft: 24,
  },
  breachDuration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: SPACING.xs,
  },
  breachDurationText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  breachDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
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
  deleteBtn: {
    flex: 0,
    paddingHorizontal: SPACING.lg,
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
