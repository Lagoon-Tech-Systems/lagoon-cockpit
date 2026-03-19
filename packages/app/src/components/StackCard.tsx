import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import StatusBadge from './StatusBadge';
import type { StackSummary } from '../stores/dashboardStore';

interface StackCardProps {
  stack: StackSummary;
  onPress: () => void;
}

export default function StackCard({ stack, onPress }: StackCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.name}>{stack.name}</Text>
        <StatusBadge status={stack.status} size="sm" />
      </View>
      <View style={styles.stats}>
        <Text style={styles.stat}>
          {stack.containerCount} container{stack.containerCount !== 1 ? 's' : ''}
        </Text>
        <Text style={styles.divider}>|</Text>
        <Text style={[styles.stat, { color: '#22C55E' }]}>{stack.running} up</Text>
        {stack.stopped > 0 && (
          <>
            <Text style={styles.divider}>|</Text>
            <Text style={[styles.stat, { color: '#EF4444' }]}>{stack.stopped} down</Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  name: { color: '#F9FAFB', fontSize: 16, fontWeight: '600' },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stat: { color: '#9CA3AF', fontSize: 13 },
  divider: { color: '#374151', fontSize: 13 },
});
