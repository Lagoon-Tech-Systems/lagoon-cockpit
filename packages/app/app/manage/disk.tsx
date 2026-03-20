import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';

interface CategoryInfo {
  count: number;
  size: number;
}

interface DiskUsage {
  containers: CategoryInfo;
  images: CategoryInfo;
  volumes: CategoryInfo;
  buildCache: CategoryInfo;
  totalSize: number;
}

interface PruneResult {
  totalReclaimed: number;
  containers: number;
  images: number;
  volumes: number;
  networks: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

type CategoryKey = 'images' | 'containers' | 'volumes' | 'buildCache';

interface CategoryConfig {
  key: CategoryKey;
  label: string;
  color: string;
  route: string | null;
}

const CATEGORIES: CategoryConfig[] = [
  { key: 'images', label: 'Images', color: '#60A5FA', route: '/manage/images' },
  { key: 'containers', label: 'Containers', color: '#22C55E', route: null },
  { key: 'volumes', label: 'Volumes', color: '#F59E0B', route: null },
  { key: 'buildCache', label: 'Build Cache', color: '#A78BFA', route: null },
];

export default function DiskScreen() {
  const router = useRouter();
  const userRole = useServerStore((s) => s.userRole);
  const isAdmin = userRole === 'admin';

  const [disk, setDisk] = useState<DiskUsage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pruneLoading, setPruneLoading] = useState(false);

  const fetchDisk = useCallback(async () => {
    try {
      const data = await apiFetch<DiskUsage>('/api/system/disk');
      setDisk(data);
    } catch (err) {
      console.error('Failed to fetch disk usage:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to fetch disk usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDisk(); }, [fetchDisk]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDisk();
    setRefreshing(false);
  }, [fetchDisk]);

  const handlePrune = () => {
    Alert.alert(
      'System Prune',
      'This will remove:\n\n' +
        '- All stopped containers\n' +
        '- All unused networks\n' +
        '- All dangling images\n' +
        '- All unused build cache\n\n' +
        'This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Prune Everything',
          style: 'destructive',
          onPress: async () => {
            setPruneLoading(true);
            try {
              const result = await apiFetch<PruneResult>('/api/system/prune', { method: 'POST' });
              Alert.alert(
                'System Prune Complete',
                `Total reclaimed: ${formatBytes(result.totalReclaimed)}\n\n` +
                  `Containers removed: ${result.containers}\n` +
                  `Images removed: ${result.images}\n` +
                  `Volumes removed: ${result.volumes}\n` +
                  `Networks removed: ${result.networks}`
              );
              await fetchDisk();
            } catch (err) {
              Alert.alert('Prune Failed', err instanceof Error ? err.message : 'System prune failed');
            } finally {
              setPruneLoading(false);
            }
          },
        },
      ]
    );
  };

  const getBarWidth = (size: number, total: number): number => {
    if (total === 0) return 0;
    return Math.max((size / total) * 100, 2);
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Disk Usage', headerBackTitle: 'Back' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>Analyzing disk usage...</Text>
        </View>
      </>
    );
  }

  if (!disk) {
    return (
      <>
        <Stack.Screen options={{ title: 'Disk Usage', headerBackTitle: 'Back' }} />
        <View style={styles.centered}>
          <Text style={styles.errorText}>Failed to load disk data</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchDisk}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Disk Usage', headerBackTitle: 'Back' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
      >
        {/* Total size header */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Total Docker Disk Usage</Text>
          <Text style={styles.totalValue}>{formatBytes(disk.totalSize)}</Text>
        </View>

        {/* Stacked bar overview */}
        <View style={styles.stackedBarContainer}>
          <View style={styles.stackedBar}>
            {CATEGORIES.map((cat) => {
              const size = disk[cat.key].size;
              const width = getBarWidth(size, disk.totalSize);
              if (size === 0) return null;
              return (
                <View
                  key={cat.key}
                  style={[styles.stackedSegment, { backgroundColor: cat.color, width: `${width}%` }]}
                />
              );
            })}
          </View>
          <View style={styles.legendRow}>
            {CATEGORIES.map((cat) => (
              <View key={cat.key} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: cat.color }]} />
                <Text style={styles.legendText}>{cat.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Category cards with bars */}
        {CATEGORIES.map((cat) => {
          const info = disk[cat.key];
          const percentage = disk.totalSize > 0 ? ((info.size / disk.totalSize) * 100).toFixed(1) : '0';
          const hasRoute = cat.route !== null;

          return (
            <TouchableOpacity
              key={cat.key}
              style={styles.categoryCard}
              onPress={() => hasRoute && router.push(cat.route as any)}
              activeOpacity={hasRoute ? 0.7 : 1}
            >
              <View style={styles.categoryHeader}>
                <View style={styles.categoryTitleRow}>
                  <View style={[styles.categoryDot, { backgroundColor: cat.color }]} />
                  <Text style={styles.categoryName}>{cat.label}</Text>
                  {hasRoute && <Text style={styles.categoryArrow}>{'\u203A'}</Text>}
                </View>
                <Text style={styles.categorySize}>{formatBytes(info.size)}</Text>
              </View>

              {/* Bar */}
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { backgroundColor: cat.color, width: `${getBarWidth(info.size, disk.totalSize)}%` },
                  ]}
                />
              </View>

              <View style={styles.categoryFooter}>
                <Text style={styles.categoryCount}>{info.count} item{info.count !== 1 ? 's' : ''}</Text>
                <Text style={styles.categoryPercent}>{percentage}%</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {/* System Prune button (admin only) */}
        {isAdmin && (
          <TouchableOpacity
            style={[styles.pruneBtn, pruneLoading && styles.pruneBtnDisabled]}
            onPress={handlePrune}
            disabled={pruneLoading}
          >
            {pruneLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={styles.pruneBtnText}>System Prune</Text>
                <Text style={styles.pruneSubText}>Remove all unused data</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, backgroundColor: '#0D0D0D', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#9CA3AF', fontSize: 14, marginTop: 12 },
  errorText: { color: '#EF4444', fontSize: 16, marginBottom: 16 },
  retryBtn: { backgroundColor: '#1F2937', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 8 },
  retryBtnText: { color: '#60A5FA', fontSize: 14, fontWeight: '600' },

  // Total card
  totalCard: {
    backgroundColor: '#111827', borderRadius: 16, padding: 24, marginBottom: 16,
    borderWidth: 1, borderColor: '#1F2937', alignItems: 'center',
  },
  totalLabel: { color: '#9CA3AF', fontSize: 14, marginBottom: 6 },
  totalValue: { color: '#F9FAFB', fontSize: 36, fontWeight: '800' },

  // Stacked bar
  stackedBarContainer: { marginBottom: 20 },
  stackedBar: {
    flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden',
    backgroundColor: '#1F2937',
  },
  stackedSegment: { height: '100%' },
  legendRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: '#9CA3AF', fontSize: 11 },

  // Category cards
  categoryCard: {
    backgroundColor: '#111827', borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#1F2937',
  },
  categoryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  categoryTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  categoryDot: { width: 10, height: 10, borderRadius: 5 },
  categoryName: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  categoryArrow: { color: '#9CA3AF', fontSize: 18, marginLeft: 4 },
  categorySize: { color: '#F9FAFB', fontSize: 16, fontWeight: '700' },
  barTrack: { height: 8, backgroundColor: '#1F2937', borderRadius: 4, overflow: 'hidden', marginBottom: 10 },
  barFill: { height: '100%', borderRadius: 4, minWidth: 4 },
  categoryFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  categoryCount: { color: '#9CA3AF', fontSize: 12 },
  categoryPercent: { color: '#9CA3AF', fontSize: 12, fontWeight: '500' },

  // Prune
  pruneBtn: {
    backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 16, marginTop: 10,
    alignItems: 'center',
  },
  pruneBtnDisabled: { opacity: 0.6 },
  pruneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pruneSubText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, marginTop: 2 },
});
