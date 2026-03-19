import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useDashboardStore, type Alert } from '../../src/stores/dashboardStore';

function getAlertIcon(alert: Alert): string {
  if (alert.currentState === 'running') return '\u{1F7E2}';
  if (alert.currentState === 'exited' || alert.currentState === 'dead') return '\u{1F534}';
  if (alert.type === 'container_state_change') return '\u{1F4E6}';
  return '\u{26A0}';
}

export default function AlertsScreen() {
  const { alerts, clearAlerts } = useDashboardStore();

  const renderAlert = ({ item }: { item: Alert }) => (
    <View style={styles.alertItem}>
      <Text style={styles.icon}>{getAlertIcon(item)}</Text>
      <View style={styles.alertContent}>
        <Text style={styles.alertTitle}>
          {item.containerName || item.type}
        </Text>
        <Text style={styles.alertDetail}>
          {item.previousState
            ? `${item.previousState} → ${item.currentState}`
            : item.message || item.currentState}
        </Text>
        <Text style={styles.alertTime}>
          {new Date(item.timestamp).toLocaleString()}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {alerts.length > 0 && (
        <TouchableOpacity style={styles.clearBtn} onPress={clearAlerts}>
          <Text style={styles.clearText}>Clear All</Text>
        </TouchableOpacity>
      )}

      <FlatList
        data={alerts}
        renderItem={renderAlert}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u{2705}'}</Text>
            <Text style={styles.emptyText}>No alerts</Text>
            <Text style={styles.emptySubtext}>Everything is running smoothly</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  clearBtn: {
    alignSelf: 'flex-end',
    marginRight: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#1F2937',
  },
  clearText: { color: '#9CA3AF', fontSize: 13 },
  list: { padding: 16, paddingBottom: 20 },
  alertItem: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  icon: { fontSize: 18, marginTop: 2 },
  alertContent: { flex: 1 },
  alertTitle: { color: '#F9FAFB', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertDetail: { color: '#9CA3AF', fontSize: 13, marginBottom: 4 },
  alertTime: { color: '#6B7280', fontSize: 11 },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#F9FAFB', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: '#6B7280', fontSize: 14 },
});
