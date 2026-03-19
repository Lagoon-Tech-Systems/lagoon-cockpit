import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { useServerStore } from '../../src/stores/serverStore';
import { useDashboardStore } from '../../src/stores/dashboardStore';
import { apiFetch } from '../../src/lib/api';
import MetricGauge from '../../src/components/MetricGauge';
import ServerPicker from '../../src/components/ServerPicker';
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
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function OverviewScreen() {
  const router = useRouter();
  const { serverName } = useServerStore();
  const { overview, setOverview, alerts } = useDashboardStore();
  const [refreshing, setRefreshing] = useState(false);

  const fetchOverview = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/api/overview');
      setOverview(data);
    } catch (err) {
      console.error('Failed to fetch overview:', err);
    }
  }, [setOverview]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchOverview();
    setRefreshing(false);
  }, [fetchOverview]);

  const sys = overview?.system;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
    >
      <ServerPicker onAddServer={() => router.replace('/')} />

      {/* Server Info */}
      <View style={styles.section}>
        <Text style={styles.serverName}>{serverName || 'Server'}</Text>
        {sys && (
          <Text style={styles.uptime}>
            Uptime: {formatUptime(sys.uptimeSeconds)} | Load: {sys.load.load1.toFixed(2)}
          </Text>
        )}
      </View>

      {/* System Metrics */}
      {sys && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System</Text>
          <MetricGauge
            label="CPU"
            value={sys.cpuPercent}
            detail={`${sys.cpuCount} cores | Load: ${sys.load.load1.toFixed(2)}, ${sys.load.load5.toFixed(2)}, ${sys.load.load15.toFixed(2)}`}
          />
          <MetricGauge
            label="Memory"
            value={sys.memory.percent}
            detail={`${formatBytes(sys.memory.used)} / ${formatBytes(sys.memory.total)}`}
          />
          <MetricGauge
            label="Disk"
            value={sys.disk.percent}
            detail={`${formatBytes(sys.disk.used)} / ${formatBytes(sys.disk.total)}`}
          />
        </View>
      )}

      {/* Container Summary */}
      {overview && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Containers</Text>
          <View style={styles.statRow}>
            <StatBox label="Total" value={overview.containers.total} color="#F9FAFB" />
            <StatBox label="Running" value={overview.containers.running} color="#22C55E" />
            <StatBox label="Stopped" value={overview.containers.stopped} color="#EF4444" />
            <StatBox label="Unhealthy" value={overview.containers.unhealthy} color="#F59E0B" />
          </View>
        </View>
      )}

      {/* Stack Summary */}
      {overview && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Stacks</Text>
          <View style={styles.statRow}>
            <StatBox label="Total" value={overview.stacks.total} color="#F9FAFB" />
            <StatBox
              label="Health"
              value={overview.stacks.allHealthy ? 'OK' : '!'}
              color={overview.stacks.allHealthy ? '#22C55E' : '#EF4444'}
            />
          </View>
        </View>
      )}

      {/* Recent Alerts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Alerts</Text>
        {alerts.length === 0 ? (
          <Text style={styles.empty}>No recent alerts</Text>
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
          Last updated: {new Date(overview.timestamp).toLocaleTimeString()}
        </Text>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  serverName: { color: '#F9FAFB', fontSize: 24, fontWeight: '800', marginTop: 16 },
  uptime: { color: '#6B7280', fontSize: 13, marginTop: 4 },
  sectionTitle: { color: '#9CA3AF', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  statRow: { flexDirection: 'row', gap: 10 },
  statBox: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { color: '#6B7280', fontSize: 11, marginTop: 4 },
  empty: { color: '#6B7280', fontSize: 14, fontStyle: 'italic' },
  alertItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  alertDot: { fontSize: 10 },
  alertText: { color: '#D1D5DB', fontSize: 13 },
  alertTime: { color: '#6B7280', fontSize: 11 },
  lastUpdated: { color: '#374151', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
