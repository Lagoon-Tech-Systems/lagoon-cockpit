import { View, Text, StyleSheet } from 'react-native';
import { useState } from 'react';
import { useColors } from '../theme/tokens';
import type { TrendBucket } from '../lib/trendsApi';

/**
 * TriageChart — board gate G-G1 chart decision for the C5 triage screen.
 *
 * Extends the existing Sparkline bar-chart approach (see Sparkline.tsx) rather
 * than adopting a charting library: same absolute-positioned bar technique,
 * plus two triage-specific overlays drawn as plain Views —
 *   (a) a horizontal dashed threshold line, and
 *   (b) a vertical "trip marker" line + dot at the bucket nearest the alert's
 *       trip timestamp.
 * Implemented as a NEW component (not a Sparkline prop) so Sparkline itself
 * stays untouched, per the controller decision. Pure View-based absolute
 * positioning only — no gifted-charts, no react-native-svg dependency.
 */

/** Bucket fields this chart knows how to plot — the `*_avg` column per metric family. */
export type TriageMetricKey =
  | 'cpu_avg'
  | 'memory_avg'
  | 'disk_avg'
  | 'load_avg'
  | 'container_running_avg';

interface TriageChartProps {
  data: TrendBucket[];
  valueKey: TriageMetricKey;
  /** The alert rule's threshold value — folded into min/max normalization so
   *  the dashed line is always on-chart, even if it's outside the observed data range. */
  threshold: number;
  /** Epoch seconds of the alert trip — the bucket whose `t` is nearest this
   *  value gets the vertical marker + dot. */
  tripEpochSec: number;
  height?: number;
  /** Bar color — callers tie this to the event's severity accent for visual cohesion. */
  barColor?: string;
}

const DASH_WIDTH = 6;
const DASH_GAP = 4;
const LABEL_ROW_HEIGHT = 16;

export default function TriageChart({
  data,
  valueKey,
  threshold,
  tripEpochSec,
  height = 160,
  barColor,
}: TriageChartProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const color = barColor || colors.blue;

  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { height, backgroundColor: colors.border }]}>
        <Text style={[styles.emptyText, { color: colors.textTertiary }]}>No trend data</Text>
      </View>
    );
  }

  const chartHeight = height - LABEL_ROW_HEIGHT;
  const values = data.map((b) => Number(b[valueKey]) || 0);

  // Normalization MUST include the threshold so the dashed line never falls
  // off-chart, even when the alert value is the only point breaching it.
  let min = Math.min(...values, threshold);
  let max = Math.max(...values, threshold);
  if (max <= min) max = min + 1; // guard divide-by-zero on a perfectly flat series

  const barWidth = width > 0 ? width / data.length : 0;
  const range = max - min;
  const thresholdY = chartHeight - ((threshold - min) / range) * chartHeight;

  // Trip marker: the bucket whose `t` is nearest the event's trip timestamp.
  let tripIndex = 0;
  let bestDelta = Infinity;
  data.forEach((b, i) => {
    const delta = Math.abs(b.t - tripEpochSec);
    if (delta < bestDelta) {
      bestDelta = delta;
      tripIndex = i;
    }
  });
  const tripX = tripIndex * barWidth + barWidth / 2;
  const dashCount = width > 0 ? Math.ceil(width / (DASH_WIDTH + DASH_GAP)) : 0;

  return (
    <View style={[styles.wrapper, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.chartArea, { height: chartHeight }]}>
        {width > 0 && values.map((value, index) => {
          const barHeight = ((value - min) / range) * chartHeight;
          return (
            <View
              key={index}
              style={{
                position: 'absolute',
                left: index * barWidth,
                bottom: 0,
                width: Math.max(barWidth - 1, 1),
                height: Math.max(barHeight, 1),
                backgroundColor: color,
                borderRadius: 1,
                opacity: 0.5 + ((value - min) / range) * 0.5,
              }}
            />
          );
        })}

        {/* (a) horizontal dashed threshold line */}
        {width > 0 && Array.from({ length: dashCount }).map((_, i) => (
          <View
            key={`dash-${i}`}
            style={{
              position: 'absolute',
              left: i * (DASH_WIDTH + DASH_GAP),
              top: Math.max(0, Math.min(chartHeight - 2, thresholdY)),
              width: DASH_WIDTH,
              height: 2,
              backgroundColor: colors.textSecondary,
              opacity: 0.85,
            }}
          />
        ))}

        {/* (b) vertical trip marker line */}
        {width > 0 && (
          <View
            style={{
              position: 'absolute',
              left: tripX - 1,
              top: 0,
              width: 2,
              height: chartHeight,
              backgroundColor: colors.red,
              opacity: 0.75,
            }}
          />
        )}
      </View>

      {/* Trip marker dot — rendered outside the chart-area View (which bounds the
          bars/threshold line) so it can sit right at the top edge without being clipped. */}
      {width > 0 && (
        <View
          style={{
            position: 'absolute',
            left: tripX - 4,
            top: -4,
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: colors.red,
            borderWidth: 1,
            borderColor: colors.bg,
          }}
        />
      )}

      <View style={styles.labelRow}>
        <Text style={[styles.labelText, { color: colors.textTertiary }]}>{min.toFixed(1)}</Text>
        <Text style={[styles.labelText, { color: colors.textTertiary }]}>{max.toFixed(1)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  empty: {
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  emptyText: {
    fontSize: 12,
  },
  chartArea: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: LABEL_ROW_HEIGHT,
    alignItems: 'flex-end',
  },
  labelText: {
    fontSize: 10,
  },
});
