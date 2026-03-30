import { View, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDashboardStore, type StackSummary, type WindowsProcess } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import StackCard from '../../src/components/StackCard';
import Skeleton from '../../src/components/Skeleton';
import { useLayout } from '../../src/hooks/useLayout';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { sanitizeErrorMessage } from '../../src/lib/errors';
import { FadeIn } from '../../src/components/ui/FadeIn';

type ProcessSortKey = 'cpu' | 'memory';

export default function StacksScreen() {
  const router = useRouter();
  const { listColumns } = useLayout();
  const { stacks, setStacks } = useDashboardStore();
  const platform = useDashboardStore((s) => s.platform);
  const processes = useDashboardStore((s) => s.processes);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  // Windows-specific state
  const [sortKey, setSortKey] = useState<ProcessSortKey>('cpu');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchStacks = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<{ stacks: StackSummary[] }>('/api/stacks');
      setStacks(data.stacks);
      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to fetch stacks:', err);
      setError(sanitizeErrorMessage(err, 'Failed to load stacks'));
    }
  }, [setStacks]);

  const fetchProcesses = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<{ processes: WindowsProcess[] }>(
        `/api/processes?limit=100&sort=${sortKey}`
      );
      useDashboardStore.getState().setProcesses(data.processes);
      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to fetch processes:', err);
      setError(sanitizeErrorMessage(err, 'Failed to load processes'));
    }
  }, [sortKey]);

  const fetchData = useCallback(async () => {
    if (platform === 'windows') {
      await fetchProcesses();
    } else {
      await fetchStacks();
    }
  }, [platform, fetchProcesses, fetchStacks]);

  useEffect(() => {
    setIsLoaded(false);
    fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const handleKillProcess = useCallback((proc: WindowsProcess) => {
    Alert.alert(
      'Kill Process',
      `Are you sure you want to kill "${proc.name}" (PID ${proc.pid})?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Kill',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`/api/processes/${proc.pid}/kill`, { method: 'POST' });
              // Refresh after kill
              const data = await apiFetch<{ processes: WindowsProcess[] }>(
                `/api/processes?limit=100&sort=cpu`
              );
              useDashboardStore.getState().setProcesses(data.processes);
            } catch (err) {
              Alert.alert('Error', sanitizeErrorMessage(err, 'Failed to kill process'));
            }
          },
        },
      ]
    );
  }, []);

  const filteredProcesses = useMemo(() => {
    if (!searchQuery.trim()) return processes;
    const q = searchQuery.toLowerCase();
    return processes.filter((p) => p.name.toLowerCase().includes(q));
  }, [processes, searchQuery]);

  /* Error state */
  if (error && !isLoaded && (platform === 'windows' ? processes.length === 0 : stacks.length === 0)) {
    return (
      <ScreenErrorBoundary screenName="Stacks">
      <View style={styles.container}>
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.red} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Ionicons name="refresh" size={16} color={COLORS.blue} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
      </ScreenErrorBoundary>
    );
  }

  /* ─── Windows: Process list ─── */
  if (platform === 'windows') {
    return (
      <ScreenErrorBoundary screenName="Stacks">
      <View style={styles.container}>
        {/* Skeleton loading state */}
        {!isLoaded && !error && processes.length === 0 && (
          <View style={styles.list}>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
                  <Skeleton width={140} height={16} borderRadius={4} />
                  <Skeleton width={50} height={16} borderRadius={4} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                  <Skeleton width={70} height={12} borderRadius={4} />
                  <Skeleton width={70} height={12} borderRadius={4} />
                  <Skeleton width={60} height={12} borderRadius={4} />
                </View>
              </View>
            ))}
          </View>
        )}

        {(isLoaded || processes.length > 0) && (
          <FlatList
            data={filteredProcesses}
            numColumns={listColumns}
            key={`procs-${listColumns}`}
            {...(listColumns > 1 && { columnWrapperStyle: { gap: SPACING.sm } })}
            ListHeaderComponent={
              <View style={styles.winHeader}>
                {/* Search bar */}
                <View style={styles.searchContainer}>
                  <Ionicons name="search" size={16} color={COLORS.textTertiary} style={styles.searchIcon} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search processes..."
                    placeholderTextColor={COLORS.textTertiary}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                      <Ionicons name="close-circle" size={16} color={COLORS.textTertiary} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Sort selector */}
                <View style={styles.sortRow}>
                  <Text style={styles.sortLabel}>Sort by</Text>
                  <TouchableOpacity
                    style={[styles.sortBtn, sortKey === 'cpu' && styles.sortBtnActive]}
                    onPress={() => setSortKey('cpu')}
                  >
                    <Ionicons name="speedometer-outline" size={14} color={sortKey === 'cpu' ? COLORS.blue : COLORS.textSecondary} />
                    <Text style={[styles.sortBtnText, sortKey === 'cpu' && styles.sortBtnTextActive]}>CPU</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.sortBtn, sortKey === 'memory' && styles.sortBtnActive]}
                    onPress={() => setSortKey('memory')}
                  >
                    <Ionicons name="hardware-chip-outline" size={14} color={sortKey === 'memory' ? COLORS.blue : COLORS.textSecondary} />
                    <Text style={[styles.sortBtnText, sortKey === 'memory' && styles.sortBtnTextActive]}>Memory</Text>
                  </TouchableOpacity>
                </View>
              </View>
            }
            renderItem={({ item, index }) => {
              return (
                <FadeIn index={index} stagger={40} slide style={listColumns > 1 ? { flex: 1 } : undefined}>
                  <View style={styles.processCard}>
                    <View style={styles.processHeader}>
                      <View style={styles.processNameRow}>
                        <Ionicons name="cog-outline" size={16} color={COLORS.textSecondary} />
                        <Text style={styles.processName} numberOfLines={1}>{item.name}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.killBtn}
                        onPress={() => handleKillProcess(item)}
                        hitSlop={8}
                      >
                        <Ionicons name="close-circle" size={18} color={COLORS.red} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.processStats}>
                      <View style={styles.processStat}>
                        <Text style={styles.processStatLabel}>PID</Text>
                        <Text style={styles.processStatValue}>{item.pid}</Text>
                      </View>
                      <View style={styles.processStat}>
                        <Text style={styles.processStatLabel}>CPU</Text>
                        <Text style={[styles.processStatValue, item.cpuPercent > 50 && { color: COLORS.red }, item.cpuPercent > 20 && item.cpuPercent <= 50 && { color: COLORS.yellow }]}>
                          {item.cpuPercent.toFixed(1)}%
                        </Text>
                      </View>
                      <View style={styles.processStat}>
                        <Text style={styles.processStatLabel}>MEM</Text>
                        <Text style={[styles.processStatValue, item.memoryMB > 500 && { color: COLORS.orange }]}>
                          {item.memoryMB.toFixed(0)} MB
                        </Text>
                      </View>
                      <View style={styles.processStat}>
                        <Text style={styles.processStatLabel}>Status</Text>
                        <Text style={[styles.processStatValue, { color: item.status === 'Running' ? COLORS.green : COLORS.textSecondary }]}>
                          {item.status}
                        </Text>
                      </View>
                    </View>

                    {item.user ? (
                      <View style={styles.processUserRow}>
                        <Ionicons name="person-outline" size={12} color={COLORS.textTertiary} />
                        <Text style={styles.processUser} numberOfLines={1}>{item.user}</Text>
                      </View>
                    ) : null}
                  </View>
                </FadeIn>
              );
            }}
            keyExtractor={(item) => `${item.pid}-${item.name}`}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
            }
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={styles.empty}>
                {searchQuery ? 'No processes match your search' : 'No processes found'}
              </Text>
            }
          />
        )}
      </View>
      </ScreenErrorBoundary>
    );
  }

  /* ─── Linux: Docker stacks (original behavior) ─── */
  return (
    <ScreenErrorBoundary screenName="Stacks">
    <View style={styles.container}>
      {/* Skeleton loading state */}
      {!isLoaded && !error && stacks.length === 0 && (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.sm }}>
                <Skeleton width={120} height={16} borderRadius={4} />
                <Skeleton width={70} height={20} borderRadius={10} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Skeleton width={90} height={12} borderRadius={4} />
                <Skeleton width={50} height={12} borderRadius={4} />
                <Skeleton width={60} height={12} borderRadius={4} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Stack list with staggered entry animations */}
      {(isLoaded || stacks.length > 0) && (
        <FlatList
          data={stacks}
          numColumns={listColumns}
          key={`stacks-${listColumns}`}
          {...(listColumns > 1 && { columnWrapperStyle: { gap: SPACING.sm } })}
          renderItem={({ item, index }) => {
            return (
              <FadeIn index={index} slide style={listColumns > 1 ? { flex: 1 } : undefined}>
                <StackCard stack={item} onPress={() => router.push(`/stacks/${item.name}`)} />
              </FadeIn>
            );
          }}
          keyExtractor={(item) => item.name}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No compose stacks found</Text>}
        />
      )}
    </View>
    </ScreenErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  empty: { color: COLORS.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  errorCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.red + '30',
    padding: SPACING.xxxl,
    margin: SPACING.lg,
    marginTop: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    ...SHADOW.card,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: SPACING.xs,
  },
  errorMessage: {
    color: COLORS.red,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: SPACING.lg,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.blue + '1A',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    gap: 6,
    marginTop: SPACING.sm,
  },
  retryText: {
    color: COLORS.blue,
    fontWeight: '600',
    fontSize: 14,
  },

  /* ─── Windows process styles ─── */
  winHeader: {
    marginBottom: SPACING.md,
    gap: SPACING.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    height: 40,
  },
  searchIcon: {
    marginRight: SPACING.sm,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textPrimary,
    fontSize: 14,
    height: 40,
    padding: 0,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  sortLabel: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    marginRight: SPACING.xs,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sortBtnActive: {
    borderColor: COLORS.borderActive,
    backgroundColor: COLORS.blueGlow,
  },
  sortBtnText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  sortBtnTextActive: {
    color: COLORS.blue,
  },
  processCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  processHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  processNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
    marginRight: SPACING.sm,
  },
  processName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  killBtn: {
    padding: 4,
  },
  processStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  processStat: {
    alignItems: 'flex-start',
  },
  processStatLabel: {
    color: COLORS.textTertiary,
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  processStatValue: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  processUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  processUser: {
    color: COLORS.textTertiary,
    fontSize: 11,
    flex: 1,
  },
});
