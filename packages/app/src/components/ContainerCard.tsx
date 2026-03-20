import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import StatusBadge from './StatusBadge';
import type { ContainerSummary } from '../stores/dashboardStore';

interface ContainerCardProps {
  container: ContainerSummary;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  showQuickActions?: boolean;
  onQuickAction?: (id: string, action: 'start' | 'stop' | 'restart') => void;
}

export default function ContainerCard({
  container, onPress, onLongPress, selected, showQuickActions, onQuickAction,
}: ContainerCardProps) {
  const isRunning = container.state === 'running';

  const confirmAction = (action: 'start' | 'stop' | 'restart') => {
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} "${container.name}"?`,
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: action.charAt(0).toUpperCase() + action.slice(1), onPress: () => onQuickAction?.(container.id, action) },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
    >
      <View style={styles.header}>
        {selected !== undefined && (
          <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
            {selected && <Text style={styles.checkmark}>{'\u2713'}</Text>}
          </View>
        )}
        <Text style={styles.name} numberOfLines={1}>{container.name}</Text>
        <StatusBadge status={container.state} size="sm" />
      </View>
      <Text style={styles.image} numberOfLines={1}>{container.image}</Text>
      <View style={styles.footer}>
        {container.composeProject ? (
          <Text style={styles.tag}>{container.composeProject}</Text>
        ) : <View />}
        <Text style={styles.status}>{container.status}</Text>
      </View>

      {/* Quick Actions */}
      {showQuickActions && onQuickAction && (
        <View style={styles.quickActions}>
          {!isRunning && (
            <TouchableOpacity style={[styles.qBtn, { backgroundColor: '#166534' }]} onPress={() => confirmAction('start')}>
              <Text style={styles.qBtnText}>{'\u25B6'} Start</Text>
            </TouchableOpacity>
          )}
          {isRunning && (
            <TouchableOpacity style={[styles.qBtn, { backgroundColor: '#991B1B' }]} onPress={() => confirmAction('stop')}>
              <Text style={styles.qBtnText}>{'\u25A0'} Stop</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.qBtn, { backgroundColor: '#1E40AF' }]} onPress={() => confirmAction('restart')}>
            <Text style={styles.qBtnText}>{'\u21BB'} Restart</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827', borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#1F2937',
  },
  cardSelected: { borderColor: '#7C3AED', backgroundColor: '#1A1033' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: '#6B7280',
    marginRight: 8, justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '700' },
  name: { color: '#F9FAFB', fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  image: { color: '#6B7280', fontSize: 12, marginBottom: 8 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tag: {
    color: '#60A5FA', fontSize: 11, backgroundColor: '#1E3A5F',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
  },
  status: { color: '#9CA3AF', fontSize: 12 },
  quickActions: { flexDirection: 'row', gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#1F2937' },
  qBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  qBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
