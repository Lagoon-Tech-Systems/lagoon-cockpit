import { View, Text, StyleSheet } from 'react-native';
import { useDashboardStore } from '../stores/dashboardStore';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useTheme } from '../theme/ThemeProvider';
import { FONT, SPACING } from '../theme/tokens';

/**
 * Shows a banner when offline or SSE is reconnecting.
 * Renders nothing when connected and online.
 */
export default function ConnectionBanner() {
  const sseStatus = useDashboardStore((s) => s.sseStatus);
  const isOnline = useNetworkStatus();
  const { colors } = useTheme();

  if (isOnline && sseStatus !== 'reconnecting') return null;

  const isOffline = !isOnline;
  const bg = isOffline ? colors.dangerBg : colors.warningBg;
  const fg = isOffline ? colors.dangerText : colors.warningText;
  const message = isOffline ? 'No internet connection' : 'Reconnecting...';

  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  text: {
    ...FONT.bodyMedium,
    fontSize: 13,
  },
});
