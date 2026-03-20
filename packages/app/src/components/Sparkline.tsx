import { View, Text, StyleSheet } from 'react-native';

interface SparklineProps {
  data: number[];
  width: number;
  height: number;
  color: string;
  showLabels?: boolean;
}

export default function Sparkline({
  data,
  width,
  height,
  color,
  showLabels = false,
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>No data</Text>
      </View>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const barWidth = width / data.length;
  const labelHeight = showLabels ? 16 : 0;
  const chartHeight = height - labelHeight;

  return (
    <View style={{ width, height }}>
      <View style={[styles.chartArea, { width, height: chartHeight }]}>
        {data.map((value, index) => {
          const barHeight = max > 0 ? (value / max) * chartHeight : 0;
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
                opacity: 0.6 + (value / (max || 1)) * 0.4,
              }}
            />
          );
        })}
      </View>
      {showLabels && (
        <View style={styles.labelRow}>
          <Text style={styles.labelText}>{min.toFixed(1)}</Text>
          <Text style={styles.labelText}>{max.toFixed(1)}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1F2937',
    borderRadius: 6,
  },
  emptyText: {
    color: '#6B7280',
    fontSize: 11,
  },
  chartArea: {
    overflow: 'hidden',
    borderRadius: 4,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 16,
    alignItems: 'flex-end',
  },
  labelText: {
    color: '#6B7280',
    fontSize: 10,
  },
});
