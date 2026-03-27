import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import type { ContainerSummary } from '../stores/dashboardStore';

interface ContainerCardProps {
  container: ContainerSummary;
  onPress: () => void;
  onLongPress?: () => void;
  selected?: boolean;
  showQuickActions?: boolean;
  onQuickAction?: (id: string, action: 'start' | 'stop' | 'restart') => void;
}

const COLORS = {
  bg: '#1C1C1E',
  card: '#2C2C2E',
  border: '#3A3A3C',
  blue: '#4A90FF',
  green: '#34D399',
  red: '#FF6B6B',
  purple: '#A78BFA',
  orange: '#FB923C',
  yellow: '#FBBF24',
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
};

function getStatusColor(state: string, health?: string) {
  if (health === 'unhealthy') return COLORS.yellow;
  if (state === 'running') return COLORS.green;
  return COLORS.red;
}

function getStatusLabel(state: string, health?: string) {
  if (health === 'unhealthy') return 'Unhealthy';
  if (state === 'running') return 'Running';
  return 'Stopped';
}

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <View style={miniBarStyles.track}>
      <View style={[miniBarStyles.fill, { width: `${Math.min(value, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

const miniBarStyles = StyleSheet.create({
  track: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3A3C',
    flex: 1,
  },
  fill: {
    height: 4,
    borderRadius: 2,
  },
});

export default function ContainerCard({
  container, onPress, onLongPress, selected, showQuickActions, onQuickAction,
}: ContainerCardProps) {
  const isRunning = container.state === 'running';
  const statusColor = getStatusColor(container.state, container.health ?? undefined);
  const statusLabel = getStatusLabel(container.state, container.health ?? undefined);

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
      style={[
        styles.card,
        { borderLeftColor: statusColor },
        selected && styles.cardSelected,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Container ${container.name}, ${statusLabel}`}
      accessibilityState={{ selected: selected ?? false }}
    >
      {/* Top row: checkbox (if bulk), name, status badge */}
      <View style={styles.topRow}>
        <View style={styles.nameArea}>
          {selected !== undefined && (
            <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
              {selected && <Text style={styles.checkmark}>{'\u2713'}</Text>}
            </View>
          )}
          <View style={styles.nameCol}>
            <Text style={styles.name} numberOfLines={1}>{container.name}</Text>
            <Text style={styles.image} numberOfLines={1}>{container.image}</Text>
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + '1A' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      </View>

      {/* Resource bars (if available) */}
      {(container as any).cpuPercent !== undefined || (container as any).memoryPercent !== undefined ? (
        <View style={styles.resourceRow}>
          {(container as any).cpuPercent !== undefined && (
            <View style={styles.resourceItem}>
              <View style={styles.resourceLabelRow}>
                <Text style={styles.resourceLabel}>CPU</Text>
                <Text style={styles.resourceValue}>{((container as any).cpuPercent ?? 0).toFixed(1)}%</Text>
              </View>
              <MiniBar value={(container as any).cpuPercent ?? 0} color={COLORS.blue} />
            </View>
          )}
          {(container as any).memoryPercent !== undefined && (
            <View style={styles.resourceItem}>
              <View style={styles.resourceLabelRow}>
                <Text style={styles.resourceLabel}>MEM</Text>
                <Text style={styles.resourceValue}>{((container as any).memoryPercent ?? 0).toFixed(1)}%</Text>
              </View>
              <MiniBar value={(container as any).memoryPercent ?? 0} color={COLORS.purple} />
            </View>
          )}
        </View>
      ) : null}

      {/* Footer: compose project tag + status text */}
      <View style={styles.footer}>
        {container.composeProject ? (
          <View style={styles.tagContainer}>
            <Text style={styles.tag}>{container.composeProject}</Text>
          </View>
        ) : <View />}
        <Text style={styles.statusDetail}>{container.status}</Text>
      </View>

      {/* Quick Actions */}
      {showQuickActions && onQuickAction && (
        <View style={styles.quickActions}>
          {!isRunning && (
            <TouchableOpacity style={[styles.qBtn, { backgroundColor: COLORS.green + '1A' }]} onPress={() => confirmAction('start')} accessibilityRole="button" accessibilityLabel="Start container">
              <Text style={[styles.qBtnIcon, { color: COLORS.green }]}>{'\u25B6'}</Text>
            </TouchableOpacity>
          )}
          {isRunning && (
            <TouchableOpacity style={[styles.qBtn, { backgroundColor: COLORS.red + '1A' }]} onPress={() => confirmAction('stop')} accessibilityRole="button" accessibilityLabel="Stop container">
              <Text style={[styles.qBtnIcon, { color: COLORS.red }]}>{'\u25A0'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.qBtn, { backgroundColor: COLORS.blue + '1A' }]} onPress={() => confirmAction('restart')} accessibilityRole="button" accessibilityLabel="Restart container">
            <Text style={[styles.qBtnIcon, { color: COLORS.blue }]}>{'\u21BB'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.green,
  },
  cardSelected: {
    borderColor: COLORS.purple,
    shadowColor: COLORS.purple,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  nameArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: COLORS.textTertiary,
    marginRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.purple,
    borderColor: COLORS.purple,
  },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },
  nameCol: {
    flex: 1,
  },
  name: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  image: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  resourceRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  resourceItem: {
    flex: 1,
    gap: 4,
  },
  resourceLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resourceLabel: {
    color: COLORS.textTertiary,
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  resourceValue: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tagContainer: {
    backgroundColor: COLORS.blue + '1A',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  tag: {
    color: COLORS.blue,
    fontSize: 11,
    fontWeight: '500',
  },
  statusDetail: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    justifyContent: 'flex-end',
  },
  qBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qBtnIcon: {
    fontSize: 16,
    fontWeight: '700',
  },
});
