import { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore } from '../../src/stores/serverStore';
import { useDashboardStore } from '../../src/stores/dashboardStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

interface MenuItem {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  route: string;
  adminOnly?: boolean;
  section: 'docker' | 'monitoring' | 'operations';
  windowsOnly?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  /* Docker Resources */
  { label: 'System Map', description: 'Visual node-graph of all infrastructure', icon: 'map', iconColor: COLORS.blue, route: '/manage/system-map', section: 'docker' },
  { label: 'Disk Usage', description: 'Storage breakdown + system prune', icon: 'save', iconColor: COLORS.purple, route: '/manage/disk', section: 'docker' },
  { label: 'Images', description: 'Manage Docker images', icon: 'cube', iconColor: COLORS.orange, route: '/manage/images', section: 'docker' },
  { label: 'Networks', description: 'Docker network topology', icon: 'globe', iconColor: COLORS.teal, route: '/manage/networks', section: 'docker' },
  /* Monitoring */
  { label: 'Metrics History', description: 'CPU/RAM/disk trends over time', icon: 'stats-chart', iconColor: COLORS.green, route: '/manage/metrics', section: 'monitoring' },
  { label: 'Alert Rules', description: 'Custom threshold-based alerts', icon: 'notifications', iconColor: COLORS.yellow, route: '/manage/alert-rules', adminOnly: true, section: 'monitoring' },
  { label: 'Push Notifications', description: 'Manage mobile push alert preferences', icon: 'phone-portrait', iconColor: COLORS.teal, route: '/manage/notifications', section: 'monitoring' },
  { label: 'Webhooks', description: 'Fire events to Slack/Discord/n8n', icon: 'link', iconColor: COLORS.indigo, route: '/manage/webhooks', adminOnly: true, section: 'monitoring' },
  /* Operations */
  { label: 'Event Log', description: 'Windows Event Log viewer', icon: 'document-text', iconColor: COLORS.orange, route: '/manage/eventlog', section: 'operations', windowsOnly: true },
  { label: 'Activity Log', description: 'Who did what and when', icon: 'list', iconColor: COLORS.textSecondary, route: '/manage/activity', section: 'operations' },
  { label: 'Scheduled Actions', description: 'Cron-based container automation', icon: 'calendar', iconColor: COLORS.rose, route: '/manage/schedules', adminOnly: true, section: 'operations' },
  { label: 'Maintenance Mode', description: 'Pause alerts during planned work', icon: 'build', iconColor: COLORS.yellow, route: '/manage/maintenance', adminOnly: true, section: 'operations' },
  { label: 'Server Settings', description: 'Manage server profiles', icon: 'settings', iconColor: COLORS.textSecondary, route: '/settings', section: 'operations' },
];

function renderMenuItem(
  item: MenuItem,
  router: ReturnType<typeof useRouter>,
) {
  return (
    <TouchableOpacity key={item.route} style={styles.menuItem} onPress={() => router.push(item.route as any)}>
      <View style={[styles.menuIconContainer, { backgroundColor: item.iconColor + '20' }]}>
        <Ionicons name={item.icon} size={20} color={item.iconColor} />
      </View>
      <View style={styles.menuContent}>
        <Text style={styles.menuLabel}>{item.label}</Text>
        <Text style={styles.menuDesc}>{item.description}</Text>
      </View>
      {item.adminOnly && <Text style={styles.adminBadge}>Admin</Text>}
      <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
    </TouchableOpacity>
  );
}

export default function ManageScreen() {
  const router = useRouter();
  const userRole = useServerStore((s) => s.userRole);
  const isAdmin = userRole === 'admin';
  const platform = useDashboardStore((s) => s.platform);

  const { dockerItems, monitoringItems, operationsItems } = useMemo(() => {
    const visible = MENU_ITEMS.filter((item) => {
      if (item.adminOnly && !isAdmin) return false;
      if (item.windowsOnly && platform !== 'windows') return false;
      return true;
    });
    return {
      dockerItems: visible.filter((i) => i.section === 'docker'),
      monitoringItems: visible.filter((i) => i.section === 'monitoring'),
      operationsItems: visible.filter((i) => i.section === 'operations'),
    };
  }, [isAdmin, platform]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Manage</Text>
      <Text style={styles.subtitle}>Infrastructure tools and configuration</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Docker Resources</Text>
        {dockerItems.map((item) => renderMenuItem(item, router))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Monitoring</Text>
        {monitoringItems.map((item) => renderMenuItem(item, router))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operations</Text>
        {operationsItems.map((item) => renderMenuItem(item, router))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  title: { color: COLORS.textPrimary, fontSize: 28, fontWeight: '800', marginTop: SPACING.sm },
  subtitle: { color: COLORS.textTertiary, fontSize: 14, marginBottom: SPACING.xxl },
  section: { marginBottom: SPACING.xxl },
  sectionTitle: { color: COLORS.textSecondary, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 10 },
  menuItem: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.md,
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: SPACING.sm,
    borderWidth: 1, borderColor: COLORS.border,
  },
  menuIconContainer: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuContent: { flex: 1 },
  menuLabel: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  menuDesc: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
  adminBadge: {
    color: COLORS.yellow, fontSize: 10, fontWeight: '700', backgroundColor: '#422006',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', marginRight: 4,
  },
});
