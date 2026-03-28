import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore } from '../../src/stores/serverStore';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';

interface MenuItem {
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  route: string;
  adminOnly?: boolean;
}

const MENU_ITEMS: MenuItem[] = [
  { label: 'System Map', description: 'Visual node-graph of all infrastructure', icon: 'map', iconColor: COLORS.blue, route: '/manage/system-map' },
  { label: 'Disk Usage', description: 'Storage breakdown + system prune', icon: 'save', iconColor: COLORS.purple, route: '/manage/disk' },
  { label: 'Images', description: 'Manage Docker images', icon: 'cube', iconColor: COLORS.orange, route: '/manage/images' },
  { label: 'Networks', description: 'Docker network topology', icon: 'globe', iconColor: COLORS.teal, route: '/manage/networks' },
  { label: 'Metrics History', description: 'CPU/RAM/disk trends over time', icon: 'stats-chart', iconColor: COLORS.green, route: '/manage/metrics' },
  { label: 'Alert Rules', description: 'Custom threshold-based alerts', icon: 'notifications', iconColor: COLORS.yellow, route: '/manage/alert-rules', adminOnly: true },
  { label: 'Webhooks', description: 'Fire events to Slack/Discord/n8n', icon: 'link', iconColor: COLORS.indigo, route: '/manage/webhooks', adminOnly: true },
  { label: 'Activity Log', description: 'Who did what and when', icon: 'list', iconColor: COLORS.textSecondary, route: '/manage/activity' },
  { label: 'Scheduled Actions', description: 'Cron-based container automation', icon: 'calendar', iconColor: COLORS.rose, route: '/manage/schedules', adminOnly: true },
  { label: 'Maintenance Mode', description: 'Pause alerts during planned work', icon: 'build', iconColor: COLORS.yellow, route: '/manage/maintenance', adminOnly: true },
  { label: 'Server Settings', description: 'Manage server profiles', icon: 'settings', iconColor: COLORS.textSecondary, route: '/settings' },
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
            <View style={[styles.menuIconContainer, { backgroundColor: item.iconColor + '20' }]}>
              <Ionicons name={item.icon} size={20} color={item.iconColor} />
            </View>
            <View style={styles.menuContent}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.menuDesc}>{item.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={COLORS.border} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Monitoring</Text>
        {visibleItems.slice(4, 7).map((item) => (
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
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Operations</Text>
        {visibleItems.slice(7).map((item) => (
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
