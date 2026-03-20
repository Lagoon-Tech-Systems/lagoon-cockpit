import { View, Text, ScrollView, RefreshControl, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';
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

type Tab = 'stats' | 'logs' | 'exec' | 'env' | 'processes';

export default function ContainerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const userRole = useServerStore((s) => s.userRole);
  const canAct = userRole === 'admin' || userRole === 'operator';
  const isAdmin = userRole === 'admin';

  const [detail, setDetail] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [processes, setProcesses] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAction, setShowAction] = useState<'start' | 'stop' | 'restart' | 'rebuild' | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('stats');

  // Exec state
  const [execCmd, setExecCmd] = useState('');
  const [execOutput, setExecOutput] = useState<string | null>(null);
  const [execLoading, setExecLoading] = useState(false);

  // Log search
  const [logSearch, setLogSearch] = useState('');
  const [logSearchResults, setLogSearchResults] = useState<any[] | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/api/containers/${id}`);
      setDetail(data.container);
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch container:', err);
    }
  }, [id]);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/api/containers/${id}/logs?tail=200`);
      setLogs(data.lines);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, [id]);

  const fetchProcesses = useCallback(async () => {
    try {
      const data = await apiFetch<any>(`/api/containers/${id}/top`);
      setProcesses(data);
    } catch (err) {
      console.error('Failed to fetch processes:', err);
    }
  }, [id]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchDetail();
    if (activeTab === 'logs') await fetchLogs();
    if (activeTab === 'processes') await fetchProcesses();
    setRefreshing(false);
  }, [fetchDetail, fetchLogs, fetchProcesses, activeTab]);

  const handleAction = async () => {
    if (!showAction) return;
    setActionLoading(true);
    try {
      const endpoint = showAction === 'rebuild'
        ? `/api/containers/${id}/rebuild`
        : `/api/containers/${id}/${showAction}`;
      const result = await apiFetch<any>(endpoint, { method: 'POST' });
      setShowAction(null);
      if (showAction === 'rebuild') {
        Alert.alert('Rebuild Complete', result.message || 'Container removed and image pulled.');
      }
      await fetchDetail();
    } catch (err) {
      Alert.alert('Failed', err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExec = async () => {
    if (!execCmd.trim()) return;
    setExecLoading(true);
    try {
      const result = await apiFetch<{ output: string; exitCode: number }>(`/api/containers/${id}/exec`, {
        method: 'POST',
        body: JSON.stringify({ command: execCmd.trim() }),
      });
      setExecOutput(`$ ${execCmd}\n${result.output}\n[exit: ${result.exitCode}]`);
    } catch (err) {
      setExecOutput(`$ ${execCmd}\nError: ${err instanceof Error ? err.message : 'Failed'}`);
    } finally {
      setExecLoading(false);
    }
  };

  const handleLogSearch = async () => {
    if (!logSearch.trim()) { setLogSearchResults(null); return; }
    try {
      const data = await apiFetch<any>(`/api/containers/${id}/logs/search?q=${encodeURIComponent(logSearch)}&regex=true`);
      setLogSearchResults(data.matches);
    } catch (err) {
      console.error('Log search failed:', err);
    }
  };

  const name = detail?.Name?.replace(/^\//, '') || id;
  const state = detail?.State?.Status || 'unknown';
  const restartCount = detail?.State?.RestartCount ?? 0;
  const envVars = detail?.Config?.Env || [];

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stats', label: 'Stats' },
    { key: 'logs', label: 'Logs' },
    { key: 'exec', label: 'Exec' },
    { key: 'env', label: 'Env' },
    { key: 'processes', label: 'Top' },
  ];

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
          {restartCount > 0 && <Text style={styles.restarts}>{'\u26A0'} Restarts: {restartCount}</Text>}
        </View>

        {/* Actions */}
        {canAct && (
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#166534' }]} onPress={() => setShowAction('start')} disabled={state === 'running'}>
              <Text style={styles.actionText}>{'\u25B6'} Start</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#991B1B' }]} onPress={() => setShowAction('stop')} disabled={state !== 'running'}>
              <Text style={styles.actionText}>{'\u25A0'} Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1E40AF' }]} onPress={() => setShowAction('restart')}>
              <Text style={styles.actionText}>{'\u21BB'} Restart</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#7C2D12' }]} onPress={() => setShowAction('rebuild')}>
                <Text style={styles.actionText}>{'\u{1F4A3}'} Rebuild</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Tab Bar */}
        <View style={styles.tabRow}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => {
                setActiveTab(t.key);
                if (t.key === 'logs') fetchLogs();
                if (t.key === 'processes') fetchProcesses();
              }}
            >
              <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <View>
            <MetricGauge label="CPU" value={stats.cpuPercent} />
            <MetricGauge label="Memory" value={stats.memoryPercent} detail={`${formatBytes(stats.memoryUsage)} / ${formatBytes(stats.memoryLimit)}`} />
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
          <View>
            <View style={styles.logSearchRow}>
              <TextInput
                style={styles.logSearchInput}
                placeholder="Search logs (regex)..."
                placeholderTextColor="#6B7280"
                value={logSearch}
                onChangeText={setLogSearch}
                onSubmitEditing={handleLogSearch}
                returnKeyType="search"
              />
              <TouchableOpacity style={styles.logSearchBtn} onPress={handleLogSearch}>
                <Text style={styles.logSearchBtnText}>{'\u{1F50D}'}</Text>
              </TouchableOpacity>
            </View>
            {logSearchResults ? (
              <View>
                <Text style={styles.searchResultLabel}>{logSearchResults.length} matches</Text>
                <LogViewer lines={logSearchResults.map((m: any) => m.line)} />
                <TouchableOpacity onPress={() => setLogSearchResults(null)} style={styles.clearSearch}>
                  <Text style={styles.clearSearchText}>Clear search</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.logSection}><LogViewer lines={logs} /></View>
            )}
          </View>
        )}

        {/* Exec Tab */}
        {activeTab === 'exec' && (
          <View>
            {isAdmin ? (
              <>
                <Text style={styles.execHint}>Run a command inside this container (whitelisted commands only)</Text>
                <View style={styles.execRow}>
                  <TextInput
                    style={styles.execInput}
                    placeholder="e.g. hostname, df -h, ps aux..."
                    placeholderTextColor="#6B7280"
                    value={execCmd}
                    onChangeText={setExecCmd}
                    onSubmitEditing={handleExec}
                    returnKeyType="send"
                    autoCapitalize="none"
                  />
                  <TouchableOpacity style={styles.execBtn} onPress={handleExec} disabled={execLoading}>
                    <Text style={styles.execBtnText}>{execLoading ? '...' : 'Run'}</Text>
                  </TouchableOpacity>
                </View>
                {execOutput !== null && (
                  <View style={styles.execOutput}>
                    <LogViewer lines={execOutput.split('\n')} autoScroll={false} />
                  </View>
                )}
                <View style={styles.quickCmds}>
                  <Text style={styles.quickCmdsLabel}>Quick commands:</Text>
                  {['hostname', 'uptime', 'df -h', 'ps aux', 'env', 'cat /etc/os-release'].map((cmd) => (
                    <TouchableOpacity key={cmd} style={styles.quickCmd} onPress={() => setExecCmd(cmd)}>
                      <Text style={styles.quickCmdText}>{cmd}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.noAccess}>Admin role required for exec</Text>
            )}
          </View>
        )}

        {/* Env Tab */}
        {activeTab === 'env' && (
          <View>
            {envVars.map((env: string, i: number) => {
              const [key, ...rest] = env.split('=');
              const val = rest.join('=');
              const isSensitive = /password|secret|key|token|api/i.test(key);
              return (
                <View key={i} style={styles.envRow}>
                  <Text style={styles.envKey}>{key}</Text>
                  <Text style={styles.envVal} numberOfLines={1}>
                    {isSensitive ? '••••••••' : val}
                  </Text>
                </View>
              );
            })}
            {envVars.length === 0 && <Text style={styles.noAccess}>No environment variables</Text>}
          </View>
        )}

        {/* Processes Tab */}
        {activeTab === 'processes' && (
          <View>
            {processes?.Titles && (
              <View style={styles.processHeader}>
                {processes.Titles.map((t: string, i: number) => (
                  <Text key={i} style={[styles.processCell, i === 0 && { flex: 0, width: 50 }]}>{t}</Text>
                ))}
              </View>
            )}
            {(processes?.Processes || []).map((proc: string[], i: number) => (
              <View key={i} style={styles.processRow}>
                {proc.map((cell, j) => (
                  <Text key={j} style={[styles.processCell, styles.processCellData, j === 0 && { flex: 0, width: 50 }]} numberOfLines={1}>{cell}</Text>
                ))}
              </View>
            ))}
            {!processes && <Text style={styles.noAccess}>Loading processes...</Text>}
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={!!showAction}
        title={`${showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''} Container`}
        message={showAction === 'rebuild'
          ? `This will STOP, REMOVE, and PULL latest image for "${name}". You'll need to recreate it via docker-compose.`
          : `Are you sure you want to ${showAction} "${name}"?`}
        confirmLabel={showAction ? showAction.charAt(0).toUpperCase() + showAction.slice(1) : ''}
        confirmColor={showAction === 'stop' || showAction === 'rebuild' ? '#EF4444' : showAction === 'start' ? '#22C55E' : '#2563EB'}
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
  actions: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  actionBtn: { flex: 1, minWidth: 70, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  actionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  tabRow: { flexDirection: 'row', gap: 6, marginBottom: 16, flexWrap: 'wrap' },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#1F2937' },
  tabActive: { backgroundColor: '#2563EB' },
  tabText: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#fff' },
  statGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  statItem: { flex: 1, backgroundColor: '#111827', borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: '#1F2937' },
  statValue: { color: '#F9FAFB', fontSize: 15, fontWeight: '700' },
  statLabel: { color: '#6B7280', fontSize: 11, marginTop: 4 },
  logSection: { height: 400 },
  logSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  logSearchInput: { flex: 1, backgroundColor: '#111827', borderRadius: 8, padding: 10, color: '#F9FAFB', fontSize: 14, borderWidth: 1, borderColor: '#1F2937' },
  logSearchBtn: { backgroundColor: '#2563EB', borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
  logSearchBtnText: { fontSize: 16 },
  searchResultLabel: { color: '#60A5FA', fontSize: 12, marginBottom: 8 },
  clearSearch: { marginTop: 8, alignItems: 'center' },
  clearSearchText: { color: '#60A5FA', fontSize: 13 },
  execHint: { color: '#6B7280', fontSize: 12, marginBottom: 10 },
  execRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  execInput: { flex: 1, backgroundColor: '#111827', borderRadius: 8, padding: 10, color: '#22C55E', fontSize: 14, fontFamily: 'monospace', borderWidth: 1, borderColor: '#1F2937' },
  execBtn: { backgroundColor: '#22C55E', borderRadius: 8, paddingHorizontal: 16, justifyContent: 'center' },
  execBtnText: { color: '#000', fontSize: 14, fontWeight: '700' },
  execOutput: { height: 200, marginBottom: 12 },
  quickCmds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickCmdsLabel: { color: '#6B7280', fontSize: 12, width: '100%', marginBottom: 4 },
  quickCmd: { backgroundColor: '#1F2937', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  quickCmdText: { color: '#D1D5DB', fontSize: 12, fontFamily: 'monospace' },
  envRow: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  envKey: { color: '#60A5FA', fontSize: 12, fontFamily: 'monospace', width: '40%' },
  envVal: { color: '#D1D5DB', fontSize: 12, fontFamily: 'monospace', flex: 1 },
  processHeader: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#374151' },
  processRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  processCell: { color: '#9CA3AF', fontSize: 10, fontFamily: 'monospace', flex: 1, fontWeight: '600' },
  processCellData: { color: '#D1D5DB', fontWeight: '400' },
  noAccess: { color: '#6B7280', fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginTop: 20 },
});
