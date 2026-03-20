import { View, Text, ScrollView, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useServerStore } from '../../src/stores/serverStore';
import { useDashboardStore, type ContainerSummary } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import MetricGauge from '../../src/components/MetricGauge';
import StatusBadge from '../../src/components/StatusBadge';
import { useRouter } from 'expo-router';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function OverviewScreen() {
  const router = useRouter();
  const { serverName, disconnect } = useServerStore();
  const { overview, setOverview, containers, setContainers, stacks, setStacks, alerts } = useDashboardStore();
  const [refreshing, setRefreshing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [overviewData, containerData, stackData] = await Promise.all([
        apiFetch<any>('/api/overview'),
        apiFetch<any>('/api/containers'),
        apiFetch<any>('/api/stacks'),
      ]);
      setOverview(overviewData);
      setContainers(containerData.containers);
      setStacks(stackData.stacks);
    } catch (err) {
      console.error('[COCKPIT] Failed to fetch overview:', err);
    }
  }, [setOverview, setContainers, setStacks]);

  useEffect(() => {
    fetchAll();
    // Auto-refresh every 30s
    intervalRef.current = setInterval(fetchAll, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const sys = overview?.system;
  const problemContainers = containers.filter(c => c.state !== 'running' || c.health === 'unhealthy');
  const topMemContainers = [...containers]
    .sort((a, b) => (b.status?.match(/\d+/) ? 1 : 0) - (a.status?.match(/\d+/) ? 1 : 0))
    .slice(0, 5);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
    >
      {/* Server Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerDot} />
          <View>
            <Text style={styles.serverName}>{serverName || 'Server'}</Text>
            {sys && <Text style={styles.uptime}>Up {formatUptime(sys.uptimeSeconds)}</Text>}
          </View>
        </View>
        <TouchableOpacity style={styles.disconnectBtn} onPress={() => { disconnect(); router.replace('/'); }}>
          <Text style={styles.disconnectText}>Switch</Text>
        </TouchableOpacity>
      </View>

      {/* Quick Stats Row */}
      {overview && (
        <View style={styles.quickStats}>
          <TouchableOpacity style={styles.quickStat} onPress={() => router.push('/(tabs)/containers')}>
            <Text style={styles.quickStatValue}>{overview.containers.running}</Text>
            <Text style={styles.quickStatLabel}>Running</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.quickStat, overview.containers.stopped > 0 && styles.quickStatDanger]} onPress={() => router.push('/(tabs)/containers')}>
            <Text style={[styles.quickStatValue, overview.containers.stopped > 0 && { color: '#EF4444' }]}>{overview.containers.stopped}</Text>
            <Text style={styles.quickStatLabel}>Stopped</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickStat} onPress={() => router.push('/(tabs)/stacks')}>
            <Text style={styles.quickStatValue}>{overview.stacks.total}</Text>
            <Text style={styles.quickStatLabel}>Stacks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickStat} onPress={() => router.push('/(tabs)/alerts')}>
            <Text style={[styles.quickStatValue, alerts.length > 0 && { color: '#F59E0B' }]}>{alerts.length}</Text>
            <Text style={styles.quickStatLabel}>Alerts</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* System Gauges */}
      {sys && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System Resources</Text>
          <View style={styles.gaugeGrid}>
            <View style={styles.gaugeCard}>
              <Text style={styles.gaugeIcon}>{'\u{1F4BB}'}</Text>
              <Text style={[styles.gaugeValue, { color: sys.cpuPercent > 80 ? '#EF4444' : sys.cpuPercent > 50 ? '#F59E0B' : '#22C55E' }]}>
                {sys.cpuPercent.toFixed(1)}%
              </Text>
              <Text style={styles.gaugeLabel}>CPU</Text>
              <Text style={styles.gaugeDetail}>{sys.cpuCount} cores</Text>
            </View>
            <View style={styles.gaugeCard}>
              <Text style={styles.gaugeIcon}>{'\u{1F9E0}'}</Text>
              <Text style={[styles.gaugeValue, { color: sys.memory.percent > 85 ? '#EF4444' : sys.memory.percent > 60 ? '#F59E0B' : '#22C55E' }]}>
                {sys.memory.percent.toFixed(1)}%
              </Text>
              <Text style={styles.gaugeLabel}>RAM</Text>
              <Text style={styles.gaugeDetail}>{formatBytes(sys.memory.used)}</Text>
            </View>
            <View style={styles.gaugeCard}>
              <Text style={styles.gaugeIcon}>{'\u{1F4BE}'}</Text>
              <Text style={[styles.gaugeValue, { color: sys.disk.percent > 85 ? '#EF4444' : sys.disk.percent > 70 ? '#F59E0B' : '#22C55E' }]}>
                {sys.disk.percent.toFixed(1)}%
              </Text>
              <Text style={styles.gaugeLabel}>Disk</Text>
              <Text style={styles.gaugeDetail}>{formatBytes(sys.disk.used)}</Text>
            </View>
          </View>
          <View style={styles.loadRow}>
            <Text style={styles.loadLabel}>Load Avg:</Text>
            <Text style={styles.loadValue}>{sys.load.load1.toFixed(2)}</Text>
            <Text style={styles.loadSep}>/</Text>
            <Text style={styles.loadValue}>{sys.load.load5.toFixed(2)}</Text>
            <Text style={styles.loadSep}>/</Text>
            <Text style={styles.loadValue}>{sys.load.load15.toFixed(2)}</Text>
          </View>
        </View>
      )}

      {/* Problem Containers */}
      {problemContainers.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: '#EF4444' }]}>{'\u{26A0}'} Attention Required</Text>
          {problemContainers.map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.problemCard}
              onPress={() => router.push(`/containers/${c.id}`)}
            >
              <View style={styles.problemHeader}>
                <Text style={styles.problemName}>{c.name}</Text>
                <StatusBadge status={c.health === 'unhealthy' ? 'unhealthy' : c.state} size="sm" />
              </View>
              <Text style={styles.problemDetail}>{c.status}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Stacks Overview */}
      {stacks.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => router.push('/(tabs)/stacks')}>
            <Text style={styles.sectionTitle}>Stacks</Text>
            <Text style={styles.seeAll}>See all {'\u{203A}'}</Text>
          </TouchableOpacity>
          {stacks.slice(0, 5).map((s) => (
            <TouchableOpacity
              key={s.name}
              style={styles.stackRow}
              onPress={() => router.push(`/stacks/${s.name}`)}
            >
              <View style={[styles.stackDot, { backgroundColor: s.stopped > 0 ? '#EF4444' : '#22C55E' }]} />
              <Text style={styles.stackName}>{s.name}</Text>
              <Text style={styles.stackCount}>{s.running}/{s.containerCount}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Top Containers */}
      {containers.length > 0 && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.sectionHeader} onPress={() => router.push('/(tabs)/containers')}>
            <Text style={styles.sectionTitle}>Containers</Text>
            <Text style={styles.seeAll}>All {containers.length} {'\u{203A}'}</Text>
          </TouchableOpacity>
          {containers.slice(0, 6).map((c) => (
            <TouchableOpacity
              key={c.id}
              style={styles.containerRow}
              onPress={() => router.push(`/containers/${c.id}`)}
            >
              <View style={[styles.containerDot, { backgroundColor: c.state === 'running' ? '#22C55E' : '#EF4444' }]} />
              <Text style={styles.containerName} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.containerStatus}>{c.state}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent Alerts */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.sectionHeader} onPress={() => router.push('/(tabs)/alerts')}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
          {alerts.length > 0 && <Text style={styles.seeAll}>{alerts.length} alerts {'\u{203A}'}</Text>}
        </TouchableOpacity>
        {alerts.length === 0 ? (
          <View style={styles.allGood}>
            <Text style={styles.allGoodIcon}>{'\u{2705}'}</Text>
            <Text style={styles.allGoodText}>All systems operational</Text>
          </View>
        ) : (
          alerts.slice(0, 3).map((alert, i) => (
            <View key={i} style={styles.alertItem}>
              <Text style={styles.alertDot}>
                {alert.currentState === 'running' ? '\u{1F7E2}' : '\u{1F534}'}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.alertText}>
                  {alert.containerName || alert.type}: {alert.currentState || alert.message}
                </Text>
                <Text style={styles.alertTime}>{new Date(alert.timestamp).toLocaleTimeString()}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {overview && (
        <Text style={styles.lastUpdated}>
          Auto-refreshing every 30s | {new Date(overview.timestamp).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 40 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingTop: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
  serverName: { color: '#F9FAFB', fontSize: 22, fontWeight: '800' },
  uptime: { color: '#6B7280', fontSize: 12 },
  disconnectBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6, backgroundColor: '#1F2937' },
  disconnectText: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },

  // Quick Stats
  quickStats: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  quickStat: {
    flex: 1, backgroundColor: '#111827', borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#1F2937',
  },
  quickStatDanger: { borderColor: '#7F1D1D' },
  quickStatValue: { color: '#F9FAFB', fontSize: 28, fontWeight: '800' },
  quickStatLabel: { color: '#6B7280', fontSize: 11, marginTop: 2 },

  // Section
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1.2 },
  seeAll: { color: '#60A5FA', fontSize: 12, fontWeight: '500' },

  // Gauge Grid
  gaugeGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  gaugeCard: {
    flex: 1, backgroundColor: '#111827', borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#1F2937',
  },
  gaugeIcon: { fontSize: 20, marginBottom: 6 },
  gaugeValue: { fontSize: 22, fontWeight: '800' },
  gaugeLabel: { color: '#9CA3AF', fontSize: 11, fontWeight: '600', marginTop: 2 },
  gaugeDetail: { color: '#4B5563', fontSize: 10, marginTop: 2 },

  // Load
  loadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 8 },
  loadLabel: { color: '#6B7280', fontSize: 12 },
  loadValue: { color: '#D1D5DB', fontSize: 12, fontWeight: '600' },
  loadSep: { color: '#374151', fontSize: 12 },

  // Problem containers
  problemCard: {
    backgroundColor: '#1C1117', borderRadius: 10, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#7F1D1D',
  },
  problemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  problemName: { color: '#FCA5A5', fontSize: 14, fontWeight: '600' },
  problemDetail: { color: '#6B7280', fontSize: 12, marginTop: 4 },

  // Stacks
  stackRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#111827', borderRadius: 8, padding: 12, marginBottom: 6,
  },
  stackDot: { width: 8, height: 8, borderRadius: 4 },
  stackName: { color: '#D1D5DB', fontSize: 14, fontWeight: '500', flex: 1 },
  stackCount: { color: '#6B7280', fontSize: 13, fontWeight: '600' },

  // Containers
  containerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1F2937',
  },
  containerDot: { width: 6, height: 6, borderRadius: 3 },
  containerName: { color: '#D1D5DB', fontSize: 13, flex: 1 },
  containerStatus: { color: '#6B7280', fontSize: 12 },

  // Alerts
  allGood: { alignItems: 'center', paddingVertical: 20 },
  allGoodIcon: { fontSize: 32, marginBottom: 8 },
  allGoodText: { color: '#22C55E', fontSize: 14, fontWeight: '500' },
  alertItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  alertDot: { fontSize: 10 },
  alertText: { color: '#D1D5DB', fontSize: 13 },
  alertTime: { color: '#6B7280', fontSize: 11 },

  lastUpdated: { color: '#374151', fontSize: 10, textAlign: 'center', marginTop: 8 },
});
