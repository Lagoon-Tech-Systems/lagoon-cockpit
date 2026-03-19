import { View, TextInput, FlatList, RefreshControl, StyleSheet } from 'react-native';
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

  const fetchContainers = useCallback(async () => {
    try {
      const data = await apiFetch<{ containers: ContainerSummary[] }>('/api/containers');
      setContainers(data.containers);
    } catch (err) {
      console.error('Failed to fetch containers:', err);
    }
  }, [setContainers]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

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

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'running', label: 'Running' },
    { key: 'stopped', label: 'Stopped' },
    { key: 'unhealthy', label: 'Unhealthy' },
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
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        renderItem={({ item }) => (
          <ContainerCard
            container={item}
            onPress={() => router.push(`/containers/${item.id}`)}
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
    backgroundColor: '#111827',
    margin: 16,
    marginBottom: 8,
    borderRadius: 10,
    padding: 12,
    color: '#F9FAFB',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#1F2937',
  },
  filterBtnActive: { backgroundColor: '#2563EB' },
  filterText: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  list: { paddingHorizontal: 16, paddingBottom: 20 },
  empty: { color: '#6B7280', fontSize: 14, textAlign: 'center', marginTop: 40 },
});
