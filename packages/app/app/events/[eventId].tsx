import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { COLORS, SPACING } from '../../src/theme/tokens';

/**
 * Alert event triage screen — placeholder.
 * Reached via deep link from an alert push (`/events/:eventId`), including
 * cold-start launches (see useNotifications.ts). The real triage UI is
 * built in the next task; this stub just proves the route exists and
 * receives the param correctly.
 */
export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Event: {eventId}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
  text: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
});
