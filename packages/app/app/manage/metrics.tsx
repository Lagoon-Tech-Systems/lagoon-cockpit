import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import Sparkline from '../../src/components/Sparkline';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

interface MetricPoint {
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  load_1: number;
  container_total: number;
  container_running: number;
  created_at: string;
}

interface MetricSummary {
  cpu_avg: number;
  cpu_max: number;
  cpu_min: number;
  memory_avg: number;
  memory_max: number;
  disk_avg: number;
  disk_max: number;
  load_avg: number;
  load_max: number;
  data_points: number;
}

interface MetricsResponse {
  history: MetricPoint[];
  summary: MetricSummary;
}

/* ---------- Constants ---------- */

const TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
] as const;

/* ---------- Screen ---------- */

export default function MetricsHistoryScreen() {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  const fetchMetrics = useCallback(async (showRefresh = false) => {
    try {
      if (showRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const res = await apiFetch<MetricsResponse>(
        `/api/metrics/history?hours=${hours}`
      );
      setData(res);
    } catch (err: unknown) {
      setError(sanitizeErrorMessage(err, 'Failed to load metrics'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [hours]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  const onRefresh = useCallback(() => fetchMetrics(true), [fetchMetrics]);

  const latest = data?.history?.[data.history.length - 1] ?? null;
  const summary = data?.summary ?? null;

  /* ---------- Helpers ---------- */

  function extractSeries(key: keyof MetricPoint): number[] {
    if (!data?.history) return [];
    return data.history.map((p) => Number(p[key]));
  }

  function renderCard(
    title: string,
    seriesKey: keyof MetricPoint,
    currentValue: number | undefined,
    avg: number | undefined,
    max: number | undefined,
    unit: string,
    color: string,
  ) {
    const series = extractSeries(seriesKey);
    return (
      <View style={styles.card} key={title}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={[styles.cardCurrent, { color }]}>
            {currentValue != null ? currentValue.toFixed(1) : '--'}{unit}
          </Text>
        </View>
        <View style={styles.sparklineWrap}>
          <Sparkline
            data={series}
            width={280}
            height={64}
            color={color}
            showLabels
          />
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>
              {avg != null ? avg.toFixed(1) : '--'}{unit}
            </Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Max</Text>
            <Text style={styles.statValue}>
              {max != null ? max.toFixed(1) : '--'}{unit}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  /* ---------- Render ---------- */

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          title: 'Metrics History',
          headerStyle: { backgroundColor: COLORS.bg },
          headerTintColor: COLORS.textPrimary,
        }}
      />

      {/* Time Range Selector */}
      <View style={styles.rangeRow}>
        {TIME_RANGES.map((r) => (
          <TouchableOpacity
            key={r.label}
            style={[
              styles.rangeBtn,
              hours === r.hours && styles.rangeBtnActive,
            ]}
            onPress={() => setHours(r.hours)}
          >
            <Text
              style={[
                styles.rangeBtnText,
                hours === r.hours && styles.rangeBtnTextActive,
              ]}
            >
              {r.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchMetrics()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
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
          {renderCard(
            'CPU',
            'cpu_percent',
            latest?.cpu_percent,
            summary?.cpu_avg,
            summary?.cpu_max,
            '%',
            COLORS.blue,
          )}
          {renderCard(
            'Memory',
            'memory_percent',
            latest?.memory_percent,
            summary?.memory_avg,
            summary?.memory_max,
            '%',
            COLORS.purple,
          )}
          {renderCard(
            'Disk',
            'disk_percent',
            latest?.disk_percent,
            summary?.disk_avg,
            summary?.disk_max,
            '%',
            COLORS.yellow,
          )}
          {renderCard(
            'Load (1m)',
            'load_1',
            latest?.load_1,
            summary?.load_avg,
            summary?.load_max,
            '',
            COLORS.green,
          )}

          {/* Summary Footer */}
          {summary && (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Summary</Text>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Data Points</Text>
                <Text style={styles.summaryValue}>{summary.data_points}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>CPU Min</Text>
                <Text style={styles.summaryValue}>
                  {summary.cpu_min.toFixed(1)}%
                </Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Time Range</Text>
                <Text style={styles.summaryValue}>
                  {TIME_RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`}
                </Text>
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.red,
    fontSize: 14,
    marginBottom: SPACING.md,
    textAlign: 'center',
    paddingHorizontal: SPACING.xxl,
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

  /* Range Selector */
  rangeRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
    alignItems: 'center',
  },
  rangeBtnActive: {
    backgroundColor: COLORS.blue,
  },
  rangeBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rangeBtnTextActive: {
    color: COLORS.bg,
  },

  /* Scroll */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: 40,
  },

  /* Metric Card */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  cardTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  cardCurrent: {
    fontSize: 20,
    fontWeight: '700',
  },
  sparklineWrap: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SPACING.lg,
  },
  statItem: {
    flex: 1,
    backgroundColor: COLORS.border,
    borderRadius: RADIUS.sm,
    padding: 10,
    alignItems: 'center',
  },
  statLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },

  /* Summary Card */
  summaryCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginTop: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  summaryTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: SPACING.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  summaryLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  summaryValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
