import { View, TextInput, FlatList, RefreshControl, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useDashboardStore, type ContainerSummary, type WindowsService } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import ContainerCard from '../../src/components/ContainerCard';
import Skeleton from '../../src/components/Skeleton';
import { Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { useLayout } from '../../src/hooks/useLayout';
import ScreenErrorBoundary from '../../src/components/ScreenErrorBoundary';
import * as Haptics from 'expo-haptics';
import { sanitizeErrorMessage } from '../../src/lib/errors';
import { FadeIn } from '../../src/components/ui/FadeIn';

type Filter = 'all' | 'running' | 'stopped' | 'unhealthy';
type WinFilter = 'all' | 'running' | 'stopped';

const FILTER_COLORS: Record<Filter, string> = {
  all: COLORS.blue,
  running: COLORS.green,
  stopped: COLORS.red,
  unhealthy: COLORS.yellow,
};

const WIN_FILTER_COLORS: Record<WinFilter, string> = {
  all: COLORS.blue,
  running: COLORS.green,
  stopped: COLORS.red,
};

const SERVICE_STATUS_COLOR: Record<string, string> = {
  Running: COLORS.green,
  Stopped: COLORS.red,
  StartPending: COLORS.yellow,
  StopPending: COLORS.yellow,
  Paused: COLORS.yellow,
  ContinuePending: COLORS.yellow,
  PausePending: COLORS.yellow,
};

function getServiceStatusColor(status: string): string {
  return SERVICE_STATUS_COLOR[status] ?? COLORS.textTertiary;
}

/* ──────────────────────────────────────────────
   Windows Services sub-component
   ────────────────────────────────────────────── */

function WindowsServicesView() {
  const platform = useDashboardStore((s) => s.platform);
  const services = useDashboardStore((s) => s.services);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WinFilter>('all');
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const fetchServices = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<{ services: WindowsService[] }>('/api/services');
      useDashboardStore.getState().setServices(data.services);
      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to fetch services:', err);
      setError(sanitizeErrorMessage(err, 'Failed to load services'));
    }
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchServices();
    setRefreshing(false);
  }, [fetchServices]);

  const filtered = services.filter((s) => {
    if (search) {
      const q = search.toLowerCase();
      if (!s.displayName.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
    }
    if (filter === 'running') return s.status === 'Running';
    if (filter === 'stopped') return s.status === 'Stopped';
    return true;
  });

  const handleServiceAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    Alert.alert(
      `${label} service?`,
      `This will ${action} "${name}".`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: label,
          style: action === 'stop' ? 'destructive' : 'default',
          onPress: async () => {
            setActionLoading(name);
            try {
              await apiFetch(`/api/services/${name}/${action}`, { method: 'POST' });
              await fetchServices();
            } catch (err) {
              Alert.alert('Failed', sanitizeErrorMessage(err, 'Action failed'));
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const runningCount = services.filter(s => s.status === 'Running').length;
  const stoppedCount = services.filter(s => s.status === 'Stopped').length;

  const filters: { key: WinFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: services.length },
    { key: 'running', label: 'Running', count: runningCount },
    { key: 'stopped', label: 'Stopped', count: stoppedCount },
  ];

  return (
    <View style={styles.container}>
      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {services.length} services
          <Text style={{ color: COLORS.green }}> {'\u2022'} {runningCount} running</Text>
          {stoppedCount > 0 && <Text style={{ color: COLORS.red }}> {'\u2022'} {stoppedCount} stopped</Text>}
        </Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={16} color={COLORS.textTertiary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.search}
          placeholder="Search services..."
          placeholderTextColor={COLORS.textTertiary}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search services"
          accessibilityRole="search"
        />
      </View>

      {/* Filter pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll} contentContainerStyle={styles.filterRow}>
        {filters.map((f) => {
          const isActive = filter === f.key;
          const pillColor = WIN_FILTER_COLORS[f.key];
          return (
            <TouchableOpacity
              key={f.key}
              style={[
                styles.filterPill,
                isActive && { backgroundColor: pillColor + '26', borderColor: pillColor },
              ]}
              onPress={() => setFilter(f.key)}
              accessibilityRole="button"
              accessibilityLabel={`Filter: ${f.label}, ${f.count}`}
              accessibilityState={{ selected: isActive }}
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
      </ScrollView>

      {/* Error state */}
      {error && !isLoaded && services.length === 0 && (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.red} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchServices}>
            <Ionicons name="refresh" size={16} color={COLORS.blue} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Skeleton loading state */}
      {!isLoaded && !error && services.length === 0 && (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View>
                  <Skeleton width={140} height={16} borderRadius={4} />
                  <Skeleton width={200} height={12} borderRadius={4} style={{ marginTop: 6 }} />
                </View>
                <Skeleton width={70} height={24} borderRadius={12} />
              </View>
              <Skeleton width={'100%'} height={4} borderRadius={2} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <Skeleton width={60} height={12} borderRadius={4} />
                <Skeleton width={80} height={12} borderRadius={4} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Service list */}
      {(isLoaded || services.length > 0) && (
        <FlatList
          data={filtered}
          renderItem={({ item, index }) => {
            const statusColor = getServiceStatusColor(item.status);
            const isActioning = actionLoading === item.name;
            return (
              <FadeIn index={index}>
                <View style={[styles.serviceCard, { borderLeftColor: statusColor }]}>
                  {/* Header row */}
                  <View style={styles.serviceHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.serviceName} numberOfLines={1}>{item.displayName}</Text>
                        {item.protected && (
                          <View style={styles.protectedBadge}>
                            <Ionicons name="shield-checkmark" size={10} color={COLORS.orange} />
                            <Text style={styles.protectedText}>protected</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.serviceSubName} numberOfLines={1}>{item.name}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusColor + '26' }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <Text style={[styles.statusText, { color: statusColor }]}>{item.status}</Text>
                    </View>
                  </View>

                  {/* Info row */}
                  <View style={styles.serviceInfo}>
                    <View style={styles.serviceInfoItem}>
                      <Ionicons name="settings-outline" size={12} color={COLORS.textTertiary} />
                      <Text style={styles.serviceInfoText}>{item.startType}</Text>
                    </View>
                    {item.pid > 0 && (
                      <View style={styles.serviceInfoItem}>
                        <Ionicons name="code-slash-outline" size={12} color={COLORS.textTertiary} />
                        <Text style={styles.serviceInfoText}>PID {item.pid}</Text>
                      </View>
                    )}
                  </View>

                  {/* Action buttons */}
                  <View style={styles.serviceActions}>
                    {isActioning ? (
                      <ActivityIndicator size="small" color={COLORS.blue} />
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: COLORS.green + '1A' }]}
                          onPress={() => handleServiceAction(item.name, 'start')}
                          disabled={item.status === 'Running'}
                          accessibilityRole="button"
                          accessibilityLabel={`Start ${item.displayName}`}
                          accessibilityState={{ disabled: item.status === 'Running' }}
                        >
                          <Ionicons name="play" size={14} color={item.status === 'Running' ? COLORS.textTertiary : COLORS.green} />
                          <Text style={[styles.actionBtnText, { color: item.status === 'Running' ? COLORS.textTertiary : COLORS.green }]}>Start</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: COLORS.red + '1A' }]}
                          onPress={() => handleServiceAction(item.name, 'stop')}
                          disabled={item.status === 'Stopped'}
                          accessibilityRole="button"
                          accessibilityLabel={`Stop ${item.displayName}`}
                          accessibilityState={{ disabled: item.status === 'Stopped' }}
                        >
                          <Ionicons name="stop" size={14} color={item.status === 'Stopped' ? COLORS.textTertiary : COLORS.red} />
                          <Text style={[styles.actionBtnText, { color: item.status === 'Stopped' ? COLORS.textTertiary : COLORS.red }]}>Stop</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, { backgroundColor: COLORS.blue + '1A' }]}
                          onPress={() => handleServiceAction(item.name, 'restart')}
                          disabled={item.status === 'Stopped'}
                          accessibilityRole="button"
                          accessibilityLabel={`Restart ${item.displayName}`}
                          accessibilityState={{ disabled: item.status === 'Stopped' }}
                        >
                          <Ionicons name="refresh-circle" size={14} color={item.status === 'Stopped' ? COLORS.textTertiary : COLORS.blue} />
                          <Text style={[styles.actionBtnText, { color: item.status === 'Stopped' ? COLORS.textTertiary : COLORS.blue }]}>Restart</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
                </View>
              </FadeIn>
            );
          }}
          keyExtractor={(item) => item.name}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No services found</Text>}
        />
      )}
    </View>
  );
}

/* ──────────────────────────────────────────────
   Main screen — delegates to Windows or Linux
   ────────────────────────────────────────────── */

export default function ContainersScreen() {
  const platform = useDashboardStore((s) => s.platform);

  return (
    <ScreenErrorBoundary screenName="Containers">
      {platform === 'windows' ? <WindowsServicesView /> : <LinuxContainersView />}
    </ScreenErrorBoundary>
  );
}

/* ──────────────────────────────────────────────
   Linux Containers view (original behaviour)
   ────────────────────────────────────────────── */

function LinuxContainersView() {
  const router = useRouter();
  const layout = useLayout();
  const { containers, setContainers } = useDashboardStore();
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchContainers = useCallback(async () => {
    try {
      setError(null);
      const data = await apiFetch<{ containers: ContainerSummary[] }>('/api/containers');
      setContainers(data.containers);
      setIsLoaded(true);
    } catch (err) {
      console.error('Failed to fetch containers:', err);
      setError(sanitizeErrorMessage(err, 'Failed to load containers'));
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
              Alert.alert('Failed', sanitizeErrorMessage(err, 'Bulk action failed'));
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
      Alert.alert('Failed', sanitizeErrorMessage(err, 'Action failed'));
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
        <Ionicons name="search" size={16} color={COLORS.textTertiary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.search}
          placeholder="Search containers..."
          placeholderTextColor={COLORS.textTertiary}
          value={search}
          onChangeText={setSearch}
          accessibilityLabel="Search containers"
          accessibilityRole="search"
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
              accessibilityRole="button"
              accessibilityLabel={`Filter: ${f.label}, ${f.count}`}
              accessibilityState={{ selected: isActive }}
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
          accessibilityRole="button"
          accessibilityLabel={bulkMode ? `Bulk select mode, ${selectedIds.size} selected` : 'Toggle bulk select'}
          accessibilityState={{ selected: bulkMode }}
        >
          <Text style={[
            styles.filterText,
            bulkMode && { color: COLORS.purple },
          ]}>
            {bulkMode ? `${selectedIds.size} selected` : 'Select'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Error state */}
      {error && !isLoaded && containers.length === 0 && (
        <View style={styles.errorCard}>
          <Ionicons name="cloud-offline-outline" size={32} color={COLORS.red} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorMessage}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchContainers}>
            <Ionicons name="refresh" size={16} color={COLORS.blue} />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Skeleton loading state */}
      {!isLoaded && !error && containers.length === 0 && (
        <View style={styles.list}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
                <View>
                  <Skeleton width={140} height={16} borderRadius={4} />
                  <Skeleton width={200} height={12} borderRadius={4} style={{ marginTop: 6 }} />
                </View>
                <Skeleton width={70} height={24} borderRadius={12} />
              </View>
              <Skeleton width={'100%'} height={4} borderRadius={2} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <Skeleton width={60} height={12} borderRadius={4} />
                <Skeleton width={80} height={12} borderRadius={4} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Container list */}
      {(isLoaded || containers.length > 0) && (
        <FlatList
          key={`list-${layout.listColumns}`}
          data={filtered}
          numColumns={layout.listColumns}
          columnWrapperStyle={layout.listColumns > 1 ? { gap: SPACING.sm } : undefined}
          renderItem={({ item, index }) => {
            return (
              <FadeIn index={index} style={layout.listColumns > 1 ? { flex: 1 } : undefined}>
                <ContainerCard
                  container={item}
                  onPress={() => bulkMode ? toggleSelect(item.id) : router.push(`/containers/${item.id}`)}
                  onLongPress={() => { setBulkMode(true); toggleSelect(item.id); }}
                  selected={bulkMode ? selectedIds.has(item.id) : undefined}
                  showQuickActions={!bulkMode}
                  onQuickAction={handleQuickAction}
                />
              </FadeIn>
            );
          }}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No containers found</Text>}
        />
      )}

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
                accessibilityRole="button"
                accessibilityLabel={`Start ${selectedIds.size} selected containers`}
              >
                <Ionicons name="play" size={14} color={COLORS.green} />
                <Text style={[styles.bulkBtnText, { color: COLORS.green }]}>Start</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: COLORS.red + '26' }]}
                onPress={() => handleBulkAction('stop')}
                disabled={bulkLoading}
                accessibilityRole="button"
                accessibilityLabel={`Stop ${selectedIds.size} selected containers`}
              >
                <Ionicons name="stop" size={14} color={COLORS.red} />
                <Text style={[styles.bulkBtnText, { color: COLORS.red }]}>Stop</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bulkBtn, { backgroundColor: COLORS.blue + '26' }]}
                onPress={() => handleBulkAction('restart')}
                disabled={bulkLoading}
                accessibilityRole="button"
                accessibilityLabel={`Restart ${selectedIds.size} selected containers`}
              >
                <Ionicons name="refresh-circle" size={14} color={COLORS.blue} />
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
    margin: SPACING.lg,
    marginBottom: SPACING.sm,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.xl,
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

  errorCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.red + '30',
    padding: SPACING.xxxl,
    margin: SPACING.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    ...SHADOW.card,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  errorMessage: {
    color: COLORS.red,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
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

  list: { paddingHorizontal: 16, paddingBottom: 100 },
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.border,
  },
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
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.purple + '44',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...SHADOW.elevated,
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
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.xl,
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

  // ── Windows service card styles ──
  serviceCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderLeftWidth: 4,
    ...SHADOW.card,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  serviceName: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  serviceSubName: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  protectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.orange + '1A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 3,
  },
  protectedText: {
    color: COLORS.orange,
    fontSize: 10,
    fontWeight: '600',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  serviceInfo: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  serviceInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  serviceInfoText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  serviceActions: {
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.md,
    gap: 4,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
