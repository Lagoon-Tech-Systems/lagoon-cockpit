import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';
import StatusBadge from '../../src/components/StatusBadge';
import MetricGauge from '../../src/components/MetricGauge';
import LogViewer from '../../src/components/LogViewer';
import ActionSheet from '../../src/components/ActionSheet';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

interface ContainerDetail {
  Name: string;
  State: { Status: string; StartedAt: string; FinishedAt: string; RestartCount?: number };
  Config: { Image: string; Env?: string[] };
  HostConfig: { RestartPolicy?: { Name: string } };
  NetworkSettings: { Networks: Record<string, unknown> };
}

interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  pids: number;
}

export default function ContainerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userRole = useServerStore((s) => s.userRole);
  const canAct = userRole === 'admin' || userRole === 'operator';

  const [detail, setDetail] = useState<ContainerDetail | null>(null);
  const [stats, setStats] = useState<ContainerStats | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAction, setShowAction] = useState<'start' | 'stop' | 'restart' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'stats' | 'logs'>('stats');

  const fetchDetail = useCallback(async () => {
    try {
      const data = await apiFetch<{ container: ContainerDetail; stats: ContainerStats | null }>(
        `/api/containers/${id}`
      );
      setDetail(data.container);
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch container:', err);
    }
  }, [id]);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await apiFetch<{ lines: string[] }>(`/api/containers/${id}/logs?tail=200`);
      setLogs(data.lines);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
    fetchLogs();
  }, [fetchDetail, fetchLogs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchDetail(), fetchLogs()]);
    setRefreshing(false);
  }, [fetchDetail, fetchLogs]);

  const handleAction = async () => {
    if (!showAction) return;
    setActionLoading(true);
    try {
      await apiFetch(`/api/containers/${id}/${showAction}`, { method: 'POST' });
      setShowAction(null);
      await fetchDetail();
    } catch (err) {
      console.error('Action failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const name = detail?.Name?.replace(/^\//, '') || id;
  const state = detail?.State?.Status || 'unknown';
  const restartCount = detail?.State?.RestartCount ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: name, headerBackTitle: 'Back' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
      >
        {/* Header */}
        <View style={styles.header}>
          <StatusBadge status={state} />
          <Text style={styles.image}>{detail?.Config?.Image}</Text>
          {restartCount > 0 && (
            <Text style={styles.restarts}>Restarts: {restartCount}</Text>
          )}
        </View>

        {/* Actions */}
        {canAct && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#166534' }]}
              onPress={() => setShowAction('start')}
              disabled={state === 'running'}
            >
              <Text style={styles.actionText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#991B1B' }]}
              onPress={() => setShowAction('stop')}
              disabled={state !== 'running'}
            >
              <Text style={styles.actionText}>Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: '#1E40AF' }]}
              onPress={() => setShowAction('restart')}
            >
              <Text style={styles.actionText}>Restart</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tab Toggle */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'stats' && styles.tabActive]}
            onPress={() => setActiveTab('stats')}
          >
            <Text style={[styles.tabText, activeTab === 'stats' && styles.tabTextActive]}>Stats</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'logs' && styles.tabActive]}
            onPress={() => { setActiveTab('logs'); fetchLogs(); }}
          >
            <Text style={[styles.tabText, activeTab === 'logs' && styles.tabTextActive]}>Logs</Text>
          </TouchableOpacity>
        </View>

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <View style={styles.statsSection}>
            <MetricGauge label="CPU" value={stats.cpuPercent} />
            <MetricGauge
              label="Memory"
              value={stats.memoryPercent}
              detail={`${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)}`}
            />
            <View style={styles.statGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatBytes(stats.networkRx)}</Text>
                <Text style={styles.statLabel}>Net RX</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{formatBytes(stats.networkTx)}</Text>
                <Text style={styles.statLabel}>Net TX</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats.pids}</Text>
                <Text style={styles.statLabel}>PIDs</Text>
              </View>
            </View>
          </View>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <View style={styles.logSection}>
            <LogViewer lines={logs} />
          </View>
        )}
      </ScrollView>

      {/* Action Confirmation */}
      <ActionSheet
        visible={!!showAction}
        title={`${showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''} Container`}
        message={`Are you sure you want to ${showAction} "${name}"?`}
        confirmLabel={showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''}
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
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
  image: { color: '#6B7280', fontSize: 13, marginTop: 8 },
  restarts: { color: '#F59E0B', fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1F2937', alignItems: 'center' },
  tabActive: { backgroundColor: '#2563EB' },
  tabText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  statsSection: {},
  statGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statItem: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  statValue: { color: '#F9FAFB', fontSize: 15, fontWeight: '700' },
  statLabel: { color: '#6B7280', fontSize: 11, marginTop: 4 },
  logSection: { height: 400 },
});
