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
      setError(err instanceof Error ? err.message : 'Failed to load metrics');
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
          headerStyle: { backgroundColor: '#0D0D0D' },
          headerTintColor: '#F9FAFB',
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
          <ActivityIndicator size="large" color="#60A5FA" />
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
              tintColor="#60A5FA"
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
            '#60A5FA',
          )}
          {renderCard(
            'Memory',
            'memory_percent',
            latest?.memory_percent,
            summary?.memory_avg,
            summary?.memory_max,
            '%',
            '#A78BFA',
          )}
          {renderCard(
            'Disk',
            'disk_percent',
            latest?.disk_percent,
            summary?.disk_avg,
            summary?.disk_max,
            '%',
            '#F59E0B',
          )}
          {renderCard(
            'Load (1m)',
            'load_1',
            latest?.load_1,
            summary?.load_avg,
            summary?.load_max,
            '',
            '#34D399',
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
    backgroundColor: '#0D0D0D',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryBtn: {
    backgroundColor: '#1F2937',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: '#60A5FA',
    fontWeight: '600',
    fontSize: 14,
  },

  /* Range Selector */
  rangeRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  rangeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    alignItems: 'center',
  },
  rangeBtnActive: {
    backgroundColor: '#60A5FA',
  },
  rangeBtnText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },
  rangeBtnTextActive: {
    color: '#0D0D0D',
  },

  /* Scroll */
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },

  /* Metric Card */
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
  },
  cardCurrent: {
    fontSize: 20,
    fontWeight: '700',
  },
  sparklineWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    flex: 1,
    backgroundColor: '#1F2937',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  statLabel: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '500',
    marginBottom: 2,
  },
  statValue: {
    color: '#F9FAFB',
    fontSize: 14,
    fontWeight: '600',
  },

  /* Summary Card */
  summaryCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  summaryTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  summaryLabel: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  summaryValue: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '600',
  },
});
