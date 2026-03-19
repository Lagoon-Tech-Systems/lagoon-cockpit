import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';
import type { ContainerSummary, StackSummary } from '../../src/stores/dashboardStore';
import ContainerCard from '../../src/components/ContainerCard';
import StatusBadge from '../../src/components/StatusBadge';
import ActionSheet from '../../src/components/ActionSheet';

export default function StackDetailScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const userRole = useServerStore((s) => s.userRole);
  const isAdmin = userRole === 'admin';

  const [stack, setStack] = useState<StackSummary | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAction, setShowAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchStack = useCallback(async () => {
    try {
      const data = await apiFetch<StackSummary>(`/api/stacks/${name}`);
      setStack(data);
    } catch (err) {
      console.error('Failed to fetch stack:', err);
    }
  }, [name]);

  useEffect(() => {
    fetchStack();
  }, [fetchStack]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchStack();
    setRefreshing(false);
  }, [fetchStack]);

  const handleAction = async () => {
    if (!showAction) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/stacks/${name}/${showAction}`, { method: 'POST' });
      setShowAction(null);
      await fetchStack();
    } catch (err) {
      console.error('Stack action failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: name, headerBackTitle: 'Back' }} />
      <View style={styles.container}>
        {/* Stack Info */}
        {stack && (
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>{stack.name}</Text>
              <StatusBadge status={stack.status} />
            </View>
            <Text style={styles.subtitle}>
              {stack.containerCount} container{stack.containerCount !== 1 ? 's' : ''} |{' '}
              {stack.running} running
            </Text>
          </View>
        )}

        {/* Admin Actions */}
        {isAdmin && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#166534' }]}
              onPress={() => setShowAction('start')}
            >
              <Text style={styles.actionText}>Start All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#991B1B' }]}
              onPress={() => setShowAction('stop')}
            >
              <Text style={styles.actionText}>Stop All</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#1E40AF' }]}
              onPress={() => setShowAction('restart')}
            >
              <Text style={styles.actionText}>Restart All</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Container List */}
        <FlatList
          data={stack?.containers || []}
          renderItem={({ item }: { item: ContainerSummary }) => (
            <ContainerCard
              container={item}
              onPress={() => router.push(`/containers/${item.id}`)}
            />
          )}
          keyExtractor={(item: ContainerSummary) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
          }
          contentContainerStyle={styles.list}
        />
      </View>

      {/* Action Confirmation */}
      <ActionSheet
        visible={!!showAction}
        title={`${showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''} Stack`}
        message={`Are you sure you want to ${showAction} all containers in "${name}"?`}
        confirmLabel={`${showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''} All`}
        confirmColor={showAction === 'stop' ? '#EF4444' : showAction === 'start' ? '#22C55E' : '#2563EB'}
        onConfirm={handleAction}
        onCancel={() => setShowAction(null)}
        loading={actionLoading}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: { padding: 20, paddingBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#F9FAFB', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#6B7280', fontSize: 14, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginBottom: 16 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  list: { paddingHorizontal: 20, paddingBottom: 20 },
});
