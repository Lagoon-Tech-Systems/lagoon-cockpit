import { View, TextInput, FlatList, RefreshControl, StyleSheet, Alert } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useDashboardStore, type ContainerSummary } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import ContainerCard from '../../src/components/ContainerCard';
import { Text, TouchableOpacity } from 'react-native';

type Filter = 'all' | 'running' | 'stopped' | 'unhealthy';

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

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: containers.length },
    { key: 'running', label: 'Running', count: containers.filter(c => c.state === 'running').length },
    { key: 'stopped', label: 'Stopped', count: containers.filter(c => c.state !== 'running').length },
    { key: 'unhealthy', label: 'Unhealthy', count: containers.filter(c => c.health === 'unhealthy').length },
  ];

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.search}
        placeholder="Search containers..."
        placeholderTextColor="#6B7280"
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>
              {f.label} ({f.count})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Bulk mode toggle + actions */}
      <View style={styles.bulkBar}>
        <TouchableOpacity
          style={[styles.bulkToggle, bulkMode && styles.bulkToggleActive]}
          onPress={() => { setBulkMode(!bulkMode); setSelectedIds(new Set()); }}
        >
          <Text style={styles.bulkToggleText}>{bulkMode ? `${selectedIds.size} selected` : 'Select'}</Text>
        </TouchableOpacity>
        {bulkMode && selectedIds.size > 0 && (
          <View style={styles.bulkActions}>
            <TouchableOpacity style={[styles.bulkBtn, { backgroundColor: '#166534' }]} onPress={() => handleBulkAction('start')} disabled={bulkLoading}>
              <Text style={styles.bulkBtnText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bulkBtn, { backgroundColor: '#991B1B' }]} onPress={() => handleBulkAction('stop')} disabled={bulkLoading}>
              <Text style={styles.bulkBtnText}>Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bulkBtn, { backgroundColor: '#1E40AF' }]} onPress={() => handleBulkAction('restart')} disabled={bulkLoading}>
              <Text style={styles.bulkBtnText}>Restart</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <FlatList
        data={filtered}
        renderItem={({ item }) => (
          <ContainerCard
            container={item}
            onPress={() => bulkMode ? toggleSelect(item.id) : router.push(`/containers/${item.id}`)}
            onLongPress={() => { setBulkMode(true); toggleSelect(item.id); }}
            selected={selectedIds.has(item.id)}
            showQuickActions={!bulkMode}
            onQuickAction={handleQuickAction}
          />
        )}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No containers found</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  search: {
    backgroundColor: '#111827', margin: 16, marginBottom: 8, borderRadius: 10,
    padding: 12, color: '#F9FAFB', fontSize: 15, borderWidth: 1, borderColor: '#1F2937',
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 6, marginBottom: 8 },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#1F2937' },
  filterBtnActive: { backgroundColor: '#2563EB' },
  filterText: { color: '#9CA3AF', fontSize: 12, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  bulkBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  bulkToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1F2937' },
  bulkToggleActive: { backgroundColor: '#7C3AED' },
  bulkToggleText: { color: '#D1D5DB', fontSize: 12, fontWeight: '500' },
  bulkActions: { flexDirection: 'row', gap: 6 },
  bulkBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  bulkBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { color: '#6B7280', fontSize: 14, textAlign: 'center', marginTop: 40 },
});
