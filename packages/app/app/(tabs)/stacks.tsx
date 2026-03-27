import { View, FlatList, RefreshControl, StyleSheet, Text } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useDashboardStore, type StackSummary } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import StackCard from '../../src/components/StackCard';
import { COLORS } from '../../src/theme/tokens';

export default function StacksScreen() {
  const router = useRouter();
  const { stacks, setStacks } = useDashboardStore();
  const [refreshing, setRefreshing] = useState(false);

  const fetchStacks = useCallback(async () => {
    try {
      const data = await apiFetch<{ stacks: StackSummary[] }>('/api/stacks');
      setStacks(data.stacks);
    } catch (err) {
      console.error('Failed to fetch stacks:', err);
    }
  }, [setStacks]);

  useEffect(() => {
    fetchStacks();
  }, [fetchStacks]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStacks();
    setRefreshing(false);
  }, [fetchStacks]);

  return (
    <View style={styles.container}>
      <FlatList
        data={stacks}
        renderItem={({ item }) => (
          <StackCard stack={item} onPress={() => router.push(`/stacks/${item.name}`)} />
        )}
        keyExtractor={(item) => item.name}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No compose stacks found</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: 16, paddingBottom: 20 },
  empty: { color: COLORS.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
});
