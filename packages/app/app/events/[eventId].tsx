import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { sanitizeErrorMessage } from '../../src/lib/errors';
import { useColors, RADIUS, SPACING, FONT } from '../../src/theme/tokens';
import type { ColorPalette } from '../../src/theme/colors';
import TriageChart, { type TriageMetricKey } from '../../src/components/TriageChart';
import type { TrendBucket, TrendsResponse } from '../../src/lib/trendsApi';

/**
 * Alert event triage screen (Task C5, board gate G-S1 — verdict-first layout).
 *
 * ── C1/G-G1 chart decision (recorded here per the task brief) ──────────────
 * Chart = TriageChart (packages/app/src/components/TriageChart.tsx): extends
 * the existing Sparkline bar-chart technique with two overlays — a dashed
 * threshold line and a vertical trip marker — as plain absolutely-positioned
 * Views. No gifted-charts, no react-native-svg. Sparkline.tsx itself is
 * untouched; TriageChart is a new, separate component.
 *
 * ── Scope (read-only) ───────────────────────────────────────────────────────
 * Only `alert_rule` events route here (see useNotifications.ts — the other
 * notification type, container state changes, does not deep-link to /events).
 * This screen builds the HOST evidence module ("Top consumers right now").
 * It deliberately does NOT build a container log-tail module — see the SEAM
 * comment below. There are no Restart/Stop/Snooze actions; C3b is deferred.
 */

interface AlertEvent {
  id: number;
  rule_id: number | null;
  rule_name: string;
  metric: string;
  value: number;
  threshold: number;
  message: string | null;
  severity: 'info' | 'warn' | 'critical' | null;
  created_at: string; // SQLite `datetime('now')` text, UTC, no offset
}

interface ContainerListItem {
  id: string;
  name: string;
  state: string;
}

interface ContainerDetailResponse {
  stats: { cpuPercent: number; memoryPercent: number } | null;
}

interface TopConsumerRow {
  id: string;
  name: string;
  cpuPercent: number;
  memoryPercent: number;
}

/** metric -> (trend-bucket column, display label) — per the controller's mapping. */
const METRIC_MAP: Record<string, { bucketKey: TriageMetricKey; label: string }> = {
  cpu_percent: { bucketKey: 'cpu_avg', label: 'CPU' },
  memory_percent: { bucketKey: 'memory_avg', label: 'Memory' },
  disk_percent: { bucketKey: 'disk_avg', label: 'Disk' },
  load_1: { bucketKey: 'load_avg', label: 'Load' },
  container_stopped: { bucketKey: 'container_running_avg', label: 'running containers' },
};
const DEFAULT_METRIC_INFO = { bucketKey: 'cpu_avg' as TriageMetricKey, label: '' };

/**
 * SQLite `datetime('now')` yields "YYYY-MM-DD HH:MM:SS" — a space separator and
 * no timezone, always UTC. `new Date("...SSZ")` (bare `+ 'Z'` append with the
 * space still in place) is not reliably parsed across JS engines, so this
 * normalizes to ISO 8601 first, mirroring the pattern already proven in
 * packages/api/__tests__/metrics-history-api.test.js.
 */
function parseSqliteUtc(raw: string): Date {
  const hasTz = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw);
  const iso = hasTz ? raw : raw.replace(' ', 'T') + 'Z';
  return new Date(iso);
}

function formatRelative(date: Date): string {
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'triggered just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `triggered ${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `triggered ${diffHr} hr ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `triggered ${diffDay} d ago`;
}

function severityStyle(colors: ColorPalette, severity: string | null | undefined) {
  if (severity === 'critical') return { bg: colors.dangerBg, text: colors.dangerText, accent: colors.red };
  if (severity === 'info') return { bg: colors.infoBg, text: colors.infoText, accent: colors.blue };
  // 'warn' and any unrecognized/missing severity fall back to the warn treatment.
  return { bg: colors.warningBg, text: colors.warningText, accent: colors.orange };
}

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const colors = useColors();

  const [event, setEvent] = useState<AlertEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [eventError, setEventError] = useState<string | null>(null);

  const [buckets, setBuckets] = useState<TrendBucket[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const [topConsumers, setTopConsumers] = useState<TopConsumerRow[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchEvent = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    setEventError(null);
    try {
      const data = await apiFetch<{ event: AlertEvent }>(`/api/alerts/events/${eventId}`);
      setEvent(data.event);
    } catch (err) {
      setEventError(sanitizeErrorMessage(err, 'Failed to load alert'));
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  // Trend chart — a ±30min window centered on the trip time, once the event is known.
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    (async () => {
      setChartLoading(true);
      try {
        const tripSec = Math.floor(parseSqliteUtc(event.created_at).getTime() / 1000);
        const res = await apiFetch<TrendsResponse>(
          `/api/metrics/history?from=${tripSec - 1800}&to=${tripSec + 1800}`
        );
        if (!cancelled) setBuckets(res.buckets || []);
      } catch {
        if (!cancelled) setBuckets([]);
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [event]);

  // Host evidence — "Top consumers right now". Ranks running containers by
  // cpu%+mem% and surfaces the top 3. Any failure hides the section entirely
  // rather than showing a broken/partial list.
  //
  // SEAM: container log-tail module — deliberately NOT built here. C5's scope
  // is alert_rule events only (host gauges: cpu/memory/disk/load/container-count).
  // A follow-up task covering container_state_change alerts would add a
  // collapsed log-tail section (LogViewer) alongside this one.
  useEffect(() => {
    if (!event) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await apiFetch<{ containers: ContainerListItem[] }>('/api/containers');
        const running = list.containers.filter((c) => c.state === 'running').slice(0, 10);
        if (running.length === 0) {
          if (!cancelled) setTopConsumers(null);
          return;
        }
        const results = await Promise.allSettled(
          running.map((c) => apiFetch<ContainerDetailResponse>(`/api/containers/${c.id}`))
        );
        const rows: TopConsumerRow[] = [];
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value.stats) {
            rows.push({
              id: running[i].id,
              name: running[i].name,
              cpuPercent: r.value.stats.cpuPercent || 0,
              memoryPercent: r.value.stats.memoryPercent || 0,
            });
          }
        });
        rows.sort((a, b) => (b.cpuPercent + b.memoryPercent) - (a.cpuPercent + a.memoryPercent));
        if (!cancelled) setTopConsumers(rows.length > 0 ? rows.slice(0, 3) : null);
      } catch {
        if (!cancelled) setTopConsumers(null); // hide gracefully
      }
    })();
    return () => { cancelled = true; };
  }, [event]);

  const sev = severityStyle(colors, event?.severity);
  const metricInfo = event ? (METRIC_MAP[event.metric] || DEFAULT_METRIC_INFO) : DEFAULT_METRIC_INFO;
  const tripSec = event ? Math.floor(parseSqliteUtc(event.created_at).getTime() / 1000) : 0;

  return (
    <>
      <Stack.Screen
        options={{
          title: event?.rule_name || 'Alert',
          headerBackTitle: 'Back',
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.textPrimary,
        }}
      />
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        {loading && (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color={colors.blue} />
          </View>
        )}

        {!loading && eventError && (
          <View style={styles.centerFill}>
            <Ionicons name="alert-circle" size={32} color={colors.red} style={{ marginBottom: SPACING.sm }} />
            <Text style={[styles.errorText, { color: colors.red }]}>{eventError}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.red + '1A' }]}
              onPress={fetchEvent}
              accessibilityRole="button"
              accessibilityLabel="Retry loading alert"
            >
              <Ionicons name="refresh" size={16} color={colors.red} />
              <Text style={[styles.retryText, { color: colors.red }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !eventError && event && (
          <ScrollView contentContainerStyle={styles.scrollContent}>
            {/* 1. SEVERITY HEADER BAND — verdict-first (G-S1) */}
            <View style={[styles.headerBand, { backgroundColor: sev.bg, borderLeftColor: sev.accent }]}>
              <Text style={[FONT.title, styles.verdict, { color: sev.text }]}>
                {`${event.rule_name}: ${event.metric} ${event.value}`}
              </Text>
              <Text style={[FONT.label, styles.tripTime, { color: sev.text }]}>
                {formatRelative(parseSqliteUtc(event.created_at))}
              </Text>
            </View>

            {/* 2. TREND CHART — touches the header (no gap between hero blocks) */}
            <View style={styles.chartCard}>
              {chartLoading && buckets.length === 0 ? (
                <View style={[styles.chartLoading, { height: 160 }]}>
                  <ActivityIndicator color={colors.blue} />
                </View>
              ) : (
                <TriageChart
                  data={buckets}
                  valueKey={metricInfo.bucketKey}
                  threshold={event.threshold}
                  tripEpochSec={tripSec}
                  height={160}
                  barColor={sev.accent}
                />
              )}
            </View>

            {/* 3. TOP CONSUMERS — host evidence, collapsed by default */}
            {topConsumers && topConsumers.length > 0 && (
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => setExpanded((e) => !e)}
                  accessibilityRole="button"
                  accessibilityLabel="Toggle top consumers section"
                  accessibilityState={{ expanded }}
                >
                  <Text style={[FONT.label, styles.sectionLabel, { color: colors.textTertiary }]}>
                    Top consumers right now — not necessarily the cause
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textTertiary}
                  />
                </TouchableOpacity>
                {expanded && (
                  <View style={styles.consumerList}>
                    {topConsumers.map((c) => (
                      <View key={c.id} style={[styles.consumerRow, { borderColor: colors.border }]}>
                        <Text style={[styles.consumerName, { color: colors.textPrimary }]} numberOfLines={1}>
                          {c.name}
                        </Text>
                        <Text style={[styles.consumerStat, { color: colors.textSecondary }]}>
                          {c.cpuPercent.toFixed(1)}% CPU · {c.memoryPercent.toFixed(1)}% MEM
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* 4. FOOTER DISCLAIMER (G-W2) */}
            <Text style={[FONT.label, styles.disclaimer, { color: colors.textTertiary }]}>
              Alert delivery is best-effort; not a guaranteed paging service.
            </Text>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  errorText: { fontSize: 14, textAlign: 'center', marginBottom: SPACING.md },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    minHeight: 44,
  },
  retryText: { fontSize: 14, fontWeight: '600' },

  scrollContent: { paddingBottom: SPACING.xxxl },

  // 1. Header band — full-width, severity-tinted, touches the chart below it.
  headerBand: {
    padding: SPACING.md,
    borderLeftWidth: 4,
  },
  verdict: { marginBottom: SPACING.xs },
  tripTime: {},

  // 2. Chart — no top margin, sits directly under the header band.
  chartCard: {
    padding: SPACING.md,
  },
  chartLoading: { alignItems: 'center', justifyContent: 'center' },

  // 3. Top consumers — separated from the hero group by SPACING.xl.
  section: {
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  sectionLabel: { flex: 1, marginRight: SPACING.sm },
  consumerList: { marginTop: SPACING.xs },
  consumerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
  },
  consumerName: { fontSize: 14, fontWeight: '600', flex: 1, marginRight: SPACING.sm },
  consumerStat: { fontSize: 12 },

  // 4. Footer disclaimer.
  disclaimer: {
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.md,
    textAlign: 'center',
  },
});
