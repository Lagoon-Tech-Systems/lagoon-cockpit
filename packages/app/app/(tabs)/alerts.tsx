import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useDashboardStore, type Alert } from '../../src/stores/dashboardStore';
import Skeleton from '../../src/components/Skeleton';
import { useLayout } from '../../src/hooks/useLayout';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import { COLORS, RADIUS, SPACING, SHADOW } from '../../src/theme/tokens';

function getAlertIconProps(alert: Alert): { name: keyof typeof Ionicons.glyphMap; color: string } {
  if (alert.currentState === 'running') return { name: 'checkmark-circle', color: COLORS.green };
  if (alert.currentState === 'exited' || alert.currentState === 'dead') return { name: 'close-circle', color: COLORS.red };
  if (alert.type === 'container_state_change') return { name: 'cube-outline', color: COLORS.orange };
  return { name: 'alert-circle', color: COLORS.yellow };
}

/* Skeleton loading placeholder for alerts */
function SkeletonAlerts() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <Skeleton width={18} height={18} borderRadius={9} />
            <View style={{ flex: 1 }}>
              <Skeleton width={140} height={14} borderRadius={4} />
              <Skeleton width={200} height={12} borderRadius={4} style={{ marginTop: 6 }} />
              <Skeleton width={100} height={10} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

/* Animated wrapper for staggered entry */
function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      {children}
    </Animated.View>
  );
}

export default function AlertsScreen() {
  const { alerts, clearAlerts, isLoading } = useDashboardStore();
  const { listColumns } = useLayout();
  const isLoaded = !isLoading;

  const renderAlert = ({ item, index }: { item: Alert; index: number }) => {
    const iconProps = getAlertIconProps(item);
    return (
      <View style={listColumns > 1 ? { flex: 1 } : undefined}>
      <FadeSlideIn delay={index * 60}>
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
      </FadeSlideIn>
      </View>
    );
  };

  return (
    <ScreenErrorBoundary screenName="Alerts">
    <View style={styles.container}>
      {alerts.length > 0 && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={clearAlerts}
          accessibilityRole="button"
          accessibilityLabel={`Clear all ${alerts.length} alerts`}
        >
          <Text style={styles.clearText}>Clear All</Text>
        </TouchableOpacity>
      )}

      {/* Skeleton loading state — shown when alerts array is empty and potentially still loading */}
      {!isLoaded && alerts.length === 0 && <SkeletonAlerts />}

      {isLoaded && (
        <FlatList
          data={alerts}
          renderItem={renderAlert}
          keyExtractor={(_, i) => String(i)}
          numColumns={listColumns}
          key={`alerts-${listColumns}`}
          {...(listColumns > 1 && { columnWrapperStyle: { gap: SPACING.sm } })}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="checkmark-circle" size={48} color={COLORS.green} style={{ marginBottom: SPACING.lg }} />
              <Text style={styles.emptyText}>No alerts</Text>
              <Text style={styles.emptySubtext}>Everything is running smoothly</Text>
            </View>
          }
        />
      )}
    </View>
    </ScreenErrorBoundary>
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
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.glass,
  },
  clearText: { color: COLORS.textSecondary, fontSize: 13 },
  list: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  alertItem: {
    flexDirection: 'row',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  alertContent: { flex: 1 },
  alertTitle: { color: COLORS.textPrimary, fontSize: 14, fontWeight: '600', marginBottom: 2 },
  alertDetail: { color: COLORS.textSecondary, fontSize: 13, marginBottom: 4 },
  alertTime: { color: COLORS.textTertiary, fontSize: 11 },
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyText: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: COLORS.textTertiary, fontSize: 14 },
});
