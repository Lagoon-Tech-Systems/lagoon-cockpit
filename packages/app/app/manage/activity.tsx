import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { Stack } from 'expo-router';
import { apiFetch } from '../../src/lib/api';

/* ---------- types ---------- */
interface AuditEntry {
  id: string;
  user_id: string;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}

interface DaySection {
  title: string;
  data: AuditEntry[];
}

/* action → color + icon mapping */
function getActionStyle(action: string): { icon: string; color: string } {
  const a = action.toLowerCase();
  if (a.includes('start')) return { icon: '\u25B6', color: '#34D399' }; // green
  if (a.includes('stop')) return { icon: '\u23F9', color: '#F87171' }; // red
  if (a.includes('restart')) return { icon: '\u{1F504}', color: '#60A5FA' }; // blue
  if (a.includes('exec')) return { icon: '\u{1F4BB}', color: '#FBBF24' }; // yellow
  if (a.includes('prune')) return { icon: '\u{1F9F9}', color: '#FB923C' }; // orange
  if (a.includes('delete') || a.includes('remove')) return { icon: '\u{1F5D1}', color: '#F87171' };
  if (a.includes('create') || a.includes('add')) return { icon: '\u2795', color: '#34D399' };
  if (a.includes('update') || a.includes('edit')) return { icon: '\u270F', color: '#A78BFA' };
  if (a.includes('login') || a.includes('auth')) return { icon: '\u{1F511}', color: '#60A5FA' };
  return { icon: '\u2022', color: '#9CA3AF' };
}

/* group entries by day */
function groupByDay(entries: AuditEntry[]): DaySection[] {
  const map = new Map<string, AuditEntry[]>();
  for (const entry of entries) {
    const day = new Date(entry.created_at).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(entry);
  }
  return Array.from(map.entries()).map(([title, data]) => ({ title, data }));
}

export default function ActivityScreen() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiFetch<{ logs: AuditEntry[] }>('/api/audit?limit=100');
      setEntries(res.logs ?? []);
    } catch {
      /* silently fail — empty state shown */
    }
  }, []);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLogs();
    setRefreshing(false);
  };

  const sections = groupByDay(entries);

  const renderItem = ({ item }: { item: AuditEntry }) => {
    const { icon, color } = getActionStyle(item.action);
    const time = new Date(item.created_at).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    return (
      <View style={styles.entryRow}>
        {/* Timeline line + dot */}
        <View style={styles.timeline}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <View style={styles.line} />
        </View>

        {/* Content */}
        <View style={styles.entryContent}>
          <View style={styles.entryHeader}>
            <Text style={[styles.actionIcon, { color }]}>{icon}</Text>
            <Text style={styles.actionText}>{item.action}</Text>
            <Text style={styles.timeText}>{time}</Text>
          </View>
          {!!item.target && (
            <Text style={styles.targetText}>{item.target}</Text>
          )}
          {!!item.detail && (
            <Text style={styles.detailText} numberOfLines={2}>
              {item.detail}
            </Text>
          )}
          <Text style={styles.userText}>by {item.user_id}</Text>
        </View>
      </View>
    );
  };

  const renderSectionHeader = ({ section }: { section: DaySection }) => (
    <View style={styles.dayHeader}>
      <Text style={styles.dayText}>{section.title}</Text>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Activity', headerBackTitle: 'Manage' }} />
      <View style={styles.container}>
        <SectionList
          sections={sections}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>{'\u{1F4DC}'}</Text>
              <Text style={styles.emptyText}>No activity yet</Text>
              <Text style={styles.emptySubtext}>
                Actions performed on this server will appear here
              </Text>
            </View>
          }
          stickySectionHeadersEnabled={false}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  list: { padding: 16, paddingBottom: 40 },

  /* day header */
  dayHeader: {
    marginTop: 20,
    marginBottom: 12,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  dayText: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },

  /* timeline entry */
  entryRow: { flexDirection: 'row', marginBottom: 4 },
  timeline: { width: 24, alignItems: 'center' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  line: {
    flex: 1,
    width: 1,
    backgroundColor: '#1F2937',
    marginTop: 2,
  },

  /* entry content */
  entryContent: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 12,
    marginLeft: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  entryHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionIcon: { fontSize: 14 },
  actionText: { color: '#F9FAFB', fontSize: 14, fontWeight: '600', flex: 1 },
  timeText: { color: '#6B7280', fontSize: 11 },
  targetText: { color: '#60A5FA', fontSize: 13, marginTop: 4 },
  detailText: { color: '#9CA3AF', fontSize: 12, marginTop: 2 },
  userText: { color: '#6B7280', fontSize: 11, marginTop: 6 },

  /* empty */
  emptyContainer: { alignItems: 'center', marginTop: 80 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: '#F9FAFB', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
});
