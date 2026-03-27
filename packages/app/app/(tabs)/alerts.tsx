import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDashboardStore, type Alert } from '../../src/stores/dashboardStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

function getAlertIconProps(alert: Alert): { name: keyof typeof Ionicons.glyphMap; color: string } {
  if (alert.currentState === 'running') return { name: 'checkmark-circle', color: COLORS.green };
  if (alert.currentState === 'exited' || alert.currentState === 'dead') return { name: 'close-circle', color: COLORS.red };
  if (alert.type === 'container_state_change') return { name: 'cube-outline', color: COLORS.orange };
  return { name: 'alert-circle', color: COLORS.yellow };
}

export default function AlertsScreen() {
  const { alerts, clearAlerts } = useDashboardStore();

  const renderAlert = ({ item }: { item: Alert }) => {
    const iconProps = getAlertIconProps(item);
    return (
      <View style={styles.alertItem}>
        <Ionicons name={iconProps.name} size={18} color={iconProps.color} style={{ marginTop: 2 }} />
        <View style={styles.alertContent}>
          <Text style={styles.alertTitle}>
            {item.containerName || item.type}
          </Text>
          <Text style={styles.alertDetail}>
            {item.previousState
              ? `${item.previousState} \u2192 ${item.currentState}`
              : item.message || item.currentState}
          </Text>
          <Text style={styles.alertTime}>
            {new Date(item.timestamp).toLocaleString()}
          </Text>
        </View>
      </View>
    );
  };

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
            <Ionicons name="checkmark-circle" size={48} color={COLORS.green} style={{ marginBottom: SPACING.lg }} />
            <Text style={styles.emptyText}>No alerts</Text>
            <Text style={styles.emptySubtext}>Everything is running smoothly</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  clearBtn: {
    alignSelf: 'flex-end',
    marginRight: SPACING.lg,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: COLORS.border,
  },
  clearText: { color: COLORS.textSecondary, fontSize: 13 },
  list: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  alertItem: {
    flexDirection: 'row',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  alertContent: { flex: 1 },
  alertTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertDetail: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  alertTime: { color: COLORS.textTertiary, fontSize: 11 },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: COLORS.textTertiary, fontSize: 14 },
});
