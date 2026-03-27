import { View, TextInput, FlatList, RefreshControl, StyleSheet, Alert, ScrollView } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useDashboardStore, type ContainerSummary } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import ContainerCard from '../../src/components/ContainerCard';
import { Text, TouchableOpacity } from 'react-native';

type Filter = 'all' | 'running' | 'stopped' | 'unhealthy';

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

const FILTER_COLORS: Record<Filter, string> = {
  all: COLORS.blue,
  running: COLORS.green,
  stopped: COLORS.red,
  unhealthy: COLORS.yellow,
};

export default function ContainersScreen() {
  const router = useRouter();
  const { containers, setContainers } = useDashboardStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchContainers = useCallback(async () => {
    try {
      const data = await apiFetch<{ containers: ContainerSummary[] }>('/api/containers');
      setContainers(data.containers);
    } catch (err) {
      console.error('Failed to fetch containers:', err);
    }
  }, [setContainers]);

  useEffect(() => { fetchContainers(); }, [fetchContainers]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchContainers();
    setRefreshing(false);
  }, [fetchContainers]);

  const filtered = containers.filter((c) => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'running') return c.state === 'running';
    if (filter === 'stopped') return c.state !== 'running';
    if (filter === 'unhealthy') return c.health === 'unhealthy';
    return true;
  });

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const handleBulkAction = async (action: 'start' | 'stop' | 'restart') => {
    if (selectedIds.size === 0) return;
    Alert.alert(
      `${action.charAt(0).toUpperCase() + action.slice(1)} ${selectedIds.size} containers?`,
      'This action will affect all selected containers.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          style: action === 'stop' ? 'destructive' : 'default',
          onPress: async () => {
            setBulkLoading(true);
            try {
              await apiFetch('/api/containers/bulk', {
                method: 'POST',
                body: JSON.stringify({ ids: Array.from(selectedIds), action }),
              });
              setSelectedIds(new Set());
              setBulkMode(false);
              await fetchContainers();
            } catch (err) {
              Alert.alert('Failed', err instanceof Error ? err.message : 'Bulk action failed');
            } finally {
              setBulkLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleQuickAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await apiFetch(`/api/containers/${id}/${action}`, { method: 'POST' });
      await fetchContainers();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : 'Action failed');
    }
  };

  const runningCount = containers.filter(c => c.state === 'running').length;
  const stoppedCount = containers.filter(c => c.state !== 'running').length;
  const unhealthyCount = containers.filter(c => c.health === 'unhealthy').length;

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: containers.length },
    { key: 'running', label: 'Running', count: runningCount },
    { key: 'stopped', label: 'Stopped', count: stoppedCount },
    { key: 'unhealthy', label: 'Unhealthy', count: unhealthyCount },
  ];

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {containers.length} containers
          <Text style={{ color: COLORS.green }}> {'\u2022'} {runningCount} running</Text>
          {stoppedCount > 0 && <Text style={{ color: COLORS.red }}> {'\u2022'} {stoppedCount} stopped</Text>}
          {unhealthyCount > 0 && <Text style={{ color: COLORS.yellow }}> {'\u2022'} {unhealthyCount} unhealthy</Text>}
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>{'\u{1F50D}'}</Text>
        <TextInput
          style={styles.search}
          placeholder="Search containers..."
          placeholderTextColor={COLORS.textTertiary}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {filters.map((f) => {
          const isActive = filter === f.key;
          const pillColor = FILTER_COLORS[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                isActive && { backgroundColor: pillColor + '26', borderColor: pillColor },
              ]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[
                styles.filterText,
                isActive && { color: pillColor },
              ]}>
                {f.label}
              </Text>
              <View style={[
                styles.filterCount,
                isActive && { backgroundColor: pillColor + '33' },
              ]}>
                <Text style={[
                  styles.filterCountText,
                  isActive && { color: pillColor },
                ]}>
                  {f.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* Bulk mode toggle inline with filters */}
        <TouchableOpacity
          style={[
            styles.filterPill,
            bulkMode && { backgroundColor: COLORS.purple + '26', borderColor: COLORS.purple },
          ]}
          onPress={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
        >
          <Text style={[
            styles.filterText,
            bulkMode && { color: COLORS.purple },
          ]}>
            {bulkMode ? `${selectedIds.size} selected` : 'Select'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Container list */}
      <FlatList
        data={filtered}
        renderItem={({ item }) => (
          <ContainerCard
            container={item}
            onPress={() => bulkMode ? toggleSelect(item.id) : router.push(`/containers/${item.id}`)}
            onLongPress={() => { setBulkMode(true); toggleSelect(item.id); }}
            selected={bulkMode ? selectedIds.has(item.id) : undefined}
            showQuickActions={!bulkMode}
            onQuickAction={handleQuickAction}
          />
        )}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No containers found</Text>}
      />

      {/* Floating bulk action bar */}
      {bulkMode && selectedIds.size > 0 && (
        <View style={styles.bulkBar}>
          <View style={styles.bulkInner}>
            <Text style={styles.bulkCount}>{selectedIds.size} selected</Text>
            <View style={styles.bulkActions}>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: COLORS.green + '26' }]}
                onPress={() => handleBulkAction('start')}
                disabled={bulkLoading}
              >
                <Text style={[styles.bulkBtnIcon, { color: COLORS.green }]}>{'\u25B6'}</Text>
                <Text style={[styles.bulkBtnText, { color: COLORS.green }]}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: COLORS.red + '26' }]}
                onPress={() => handleBulkAction('stop')}
                disabled={bulkLoading}
              >
                <Text style={[styles.bulkBtnIcon, { color: COLORS.red }]}>{'\u25A0'}</Text>
                <Text style={[styles.bulkBtnText, { color: COLORS.red }]}>Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: COLORS.blue + '26' }]}
                onPress={() => handleBulkAction('restart')}
                disabled={bulkLoading}
              >
                <Text style={[styles.bulkBtnIcon, { color: COLORS.blue }]}>{'\u21BB'}</Text>
                <Text style={[styles.bulkBtnText, { color: COLORS.blue }]}>Restart</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },

  summaryBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  summaryText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  search: {
    flex: 1,
    paddingVertical: 12,
    color: COLORS.textPrimary,
    fontSize: 15,
  },

  filterScroll: {
    maxHeight: 52,
    marginBottom: 8,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  filterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
    minHeight: 44,
  },
  filterText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  filterCount: {
    backgroundColor: COLORS.border,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  filterCountText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },

  list: { paddingHorizontal: 16, paddingBottom: 100 },
  empty: { color: COLORS.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 60 },

  bulkBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 30,
    paddingTop: 12,
    backgroundColor: COLORS.bg + 'EE',
  },
  bulkInner: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.purple + '44',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bulkCount: {
    color: COLORS.purple,
    fontSize: 14,
    fontWeight: '700',
  },
  bulkActions: {
    flexDirection: 'row',
    gap: 8,
  },
  bulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },
  bulkBtnIcon: {
    fontSize: 12,
    fontWeight: '700',
  },
  bulkBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
