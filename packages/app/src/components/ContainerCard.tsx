import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import StatusBadge from './StatusBadge';
import type { ContainerSummary } from '../stores/dashboardStore';

interface ContainerCardProps {
  container: ContainerSummary;
  onPress: () => void;
}

export default function ContainerCard({ container, onPress }: ContainerCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {container.name}
        </Text>
        <StatusBadge status={container.state} size="sm" />
      </View>
      <Text style={styles.image} numberOfLines={1}>
        {container.image}
      </Text>
      <View style={styles.footer}>
        {container.composeProject ? (
          <Text style={styles.tag}>{container.composeProject}</Text>
        ) : null}
        <Text style={styles.status}>{container.status}</Text>
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
    marginBottom: 6,
  },
  name: { color: '#F9FAFB', fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  image: { color: '#6B7280', fontSize: 12, marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: {
    color: '#60A5FA',
    fontSize: 11,
    backgroundColor: '#1E3A5F',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  status: { color: '#9CA3AF', fontSize: 12 },
});
