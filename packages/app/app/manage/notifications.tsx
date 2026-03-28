import { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { Stack } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { useNotificationStore } from '../../src/stores/notificationStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

const PREFS_KEY = 'cockpit_notification_prefs';

const storage = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') return localStorage.getItem(key);
    return SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return; }
    return SecureStore.setItemAsync(key, value);
  },
};

interface NotificationPrefs {
  containerCrash: boolean;
  serviceStateChange: boolean;
  highCpu: boolean;
  highMemory: boolean;
  sslExpiry: boolean;
}

const DEFAULT_PREFS: NotificationPrefs = {
  containerCrash: true,
  serviceStateChange: true,
  highCpu: true,
  highMemory: true,
  sslExpiry: true,
};

interface PrefItem {
  key: keyof NotificationPrefs;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}

const PREF_ITEMS: PrefItem[] = [
  {
    key: 'containerCrash',
    label: 'Container Crashes',
    description: 'Get notified when a container stops unexpectedly',
    icon: 'warning',
    iconColor: COLORS.red,
  },
  {
    key: 'serviceStateChange',
    label: 'Service State Changes',
    description: 'Alerts when services start, stop, or restart',
    icon: 'swap-vertical',
    iconColor: COLORS.orange,
  },
  {
    key: 'highCpu',
    label: 'High CPU Alerts',
    description: 'Notify when CPU usage exceeds alert thresholds',
    icon: 'speedometer',
    iconColor: COLORS.yellow,
  },
  {
    key: 'highMemory',
    label: 'High Memory Alerts',
    description: 'Notify when memory usage exceeds alert thresholds',
    icon: 'hardware-chip',
    iconColor: COLORS.purple,
  },
  {
    key: 'sslExpiry',
    label: 'SSL Expiry Warnings',
    description: 'Warn before SSL certificates expire',
    icon: 'shield-checkmark',
    iconColor: COLORS.green,
  },
];

export default function NotificationsScreen() {
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const isRegistered = useNotificationStore((s) => s.isRegistered);
  const pushToken = useNotificationStore((s) => s.pushToken);

  // Load saved preferences
  useEffect(() => {
    (async () => {
      try {
        const raw = await storage.getItem(PREFS_KEY);
        if (raw) {
          setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) });
        }
      } catch {
        // Use defaults on error
      }
      setLoaded(true);
    })();
  }, []);

  const togglePref = useCallback(
    async (key: keyof NotificationPrefs) => {
      const updated = { ...prefs, [key]: !prefs[key] };
      setPrefs(updated);
      try {
        await storage.setItem(PREFS_KEY, JSON.stringify(updated));
      } catch {
        Alert.alert('Error', 'Failed to save notification preferences');
      }
    },
    [prefs]
  );

  if (!loaded) return null;

  return (
    <>
      <Stack.Screen options={{ title: 'Notifications', headerBackTitle: 'Manage' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Registration status */}
        <View style={styles.statusCard}>
          <View style={styles.statusRow}>
            <Ionicons
              name={isRegistered ? 'checkmark-circle' : 'close-circle'}
              size={20}
              color={isRegistered ? COLORS.green : COLORS.red}
            />
            <Text style={styles.statusText}>
              {isRegistered ? 'Push notifications active' : 'Push notifications not registered'}
            </Text>
          </View>
          {pushToken && (
            <Text style={styles.tokenText} numberOfLines={1}>
              Token: {pushToken.slice(0, 30)}...
            </Text>
          )}
          {!isRegistered && (
            <Text style={styles.hintText}>
              Notifications require a physical device and granted permissions.
            </Text>
          )}
        </View>

        {/* Preferences */}
        <Text style={styles.sectionTitle}>Alert Categories</Text>
        <Text style={styles.sectionSubtitle}>
          Choose which alerts trigger push notifications on this device
        </Text>

        {PREF_ITEMS.map((item) => (
          <View key={item.key} style={styles.prefCard}>
            <View style={[styles.prefIcon, { backgroundColor: item.iconColor + '20' }]}>
              <Ionicons name={item.icon} size={20} color={item.iconColor} />
            </View>
            <View style={styles.prefContent}>
              <Text style={styles.prefLabel}>{item.label}</Text>
              <Text style={styles.prefDesc}>{item.description}</Text>
            </View>
            <Switch
              value={prefs[item.key]}
              onValueChange={() => togglePref(item.key)}
              trackColor={{ false: COLORS.border, true: '#1D4ED8' }}
              thumbColor={prefs[item.key] ? COLORS.blue : COLORS.textTertiary}
            />
          </View>
        ))}

        <View style={styles.footer}>
          <Ionicons name="information-circle-outline" size={16} color={COLORS.textTertiary} />
          <Text style={styles.footerText}>
            Preferences are stored locally on this device. Server-side alert rules control which
            events fire — these toggles filter what reaches your phone.
          </Text>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 40 },

  statusCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.xxl,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  statusText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  tokenText: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontFamily: 'monospace',
    marginTop: SPACING.sm,
  },
  hintText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginTop: SPACING.sm,
    lineHeight: 18,
  },

  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: SPACING.xs,
  },
  sectionSubtitle: {
    color: COLORS.textTertiary,
    fontSize: 13,
    marginBottom: SPACING.lg,
  },

  prefCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  prefIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefContent: { flex: 1 },
  prefLabel: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  prefDesc: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },

  footer: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.xs,
  },
  footerText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },
});
