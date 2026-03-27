import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useServerStore } from '../../src/stores/serverStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

interface MenuItem {
  label: string;
  description: string;
  icon: string;
  route: string;
  adminOnly?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'System Map', description: 'Visual node-graph of all infrastructure', icon: '\u{1F5FA}', route: '/manage/system-map' },
  { label: 'Disk Usage', description: 'Storage breakdown + system prune', icon: '\u{1F4BE}', route: '/manage/disk' },
  { label: 'Images', description: 'Manage Docker images', icon: '\u{1F4E6}', route: '/manage/images' },
  { label: 'Networks', description: 'Docker network topology', icon: '\u{1F310}', route: '/manage/networks' },
  { label: 'Metrics History', description: 'CPU/RAM/disk trends over time', icon: '\u{1F4C8}', route: '/manage/metrics' },
  { label: 'Grafana Monitoring', description: 'Live Grafana dashboards', icon: '\u{1F4CA}', route: '/manage/monitoring' },
  { label: 'Alert Rules', description: 'Custom threshold-based alerts', icon: '\u{1F514}', route: '/manage/alert-rules', adminOnly: true },
  { label: 'Webhooks', description: 'Fire events to Slack/Discord/n8n', icon: '\u{1F517}', route: '/manage/webhooks', adminOnly: true },
  { label: 'Activity Log', description: 'Who did what and when', icon: '\u{1F4CB}', route: '/manage/activity' },
  { label: 'Scheduled Actions', description: 'Cron-based container automation', icon: '\u{23F0}', route: '/manage/schedules', adminOnly: true },
  { label: 'Maintenance Mode', description: 'Pause alerts during planned work', icon: '\u{1F6E0}', route: '/manage/maintenance', adminOnly: true },
  { label: 'Server Settings', description: 'Manage server profiles', icon: '\u{2699}', route: '/settings' },
];

export default function ManageScreen() {
  const router = useRouter();
  const userRole = useServerStore((s) => s.userRole);
  const isAdmin = userRole === 'admin';

  const visibleItems = MENU_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Manage</Text>
      <Text style={styles.subtitle}>Infrastructure tools and configuration</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Docker Resources</Text>
        {visibleItems.slice(0, 4).map((item) => (
          <TouchableOpacity key={item.route} style={styles.menuItem} onPress={() => router.push(item.route as any)}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.description}</Text>
            </View>
            <Text style={styles.menuArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Monitoring</Text>
        {visibleItems.slice(4, 8).map((item) => (
          <TouchableOpacity key={item.route} style={styles.menuItem} onPress={() => router.push(item.route as any)}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.description}</Text>
            </View>
            {item.adminOnly && <Text style={styles.adminBadge}>Admin</Text>}
            <Text style={styles.menuArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operations</Text>
        {visibleItems.slice(8).map((item) => (
          <TouchableOpacity key={item.route} style={styles.menuItem} onPress={() => router.push(item.route as any)}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.description}</Text>
            </View>
            {item.adminOnly && <Text style={styles.adminBadge}>Admin</Text>}
            <Text style={styles.menuArrow}>{'\u203A'}</Text>
          </TouchableOpacity>
        ))}
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
  menuIcon: { fontSize: 24 },
  menuContent: { flex: 1 },
  menuLabel: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  menuDesc: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
  menuArrow: { color: COLORS.border, fontSize: 24 },
  adminBadge: {
    color: COLORS.yellow, fontSize: 10, fontWeight: '700', backgroundColor: '#422006',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden', marginRight: 4,
  },
});
