import { View, Text, StyleSheet } from 'react-native';

const STATUS_COLORS: Record<string, string> = {
  running: '#22C55E',
  healthy: '#22C55E',
  exited: '#EF4444',
  stopped: '#EF4444',
  unhealthy: '#EF4444',
  restarting: '#F59E0B',
  partial: '#F59E0B',
  paused: '#6B7280',
  created: '#6B7280',
  dead: '#EF4444',
};

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const color = STATUS_COLORS[status] || '#6B7280';
  const dotSize = size === 'sm' ? 8 : 10;
  const fontSize = size === 'sm' ? 12 : 13;

  return (
    <View style={styles.container}>
      <View style={[styles.dot, { width: dotSize, height: dotSize, backgroundColor: color }]} />
      <Text style={[styles.text, { color, fontSize }]}>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { borderRadius: 5 },
  text: { fontWeight: '600', textTransform: 'capitalize' },
});
