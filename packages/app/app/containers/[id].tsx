import { View, Text, ScrollView, RefreshControl, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useState, useCallback, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';
import LogViewer from '../../src/components/LogViewer';
import ActionSheet from '../../src/components/ActionSheet';
import { COLORS } from '../../src/theme/tokens';
import { sanitizeErrorMessage } from '../../src/lib/errors';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

type Tab = 'stats' | 'logs' | 'exec' | 'env' | 'processes';

function RingGauge({ value, color, size = 80 }: { value: number; color: string; size?: number }) {
  const clampedValue = Math.min(Math.max(value, 0), 100);
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (clampedValue / 100) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Background ring using View border trick */}
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: strokeWidth,
        borderColor: COLORS.border,
        position: 'absolute',
      }} />
      {/* Foreground arc approximation using a colored border + rotation */}
      <View style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: strokeWidth,
        borderColor: 'transparent',
        borderTopColor: color,
        borderRightColor: clampedValue > 25 ? color : 'transparent',
        borderBottomColor: clampedValue > 50 ? color : 'transparent',
        borderLeftColor: clampedValue > 75 ? color : 'transparent',
        position: 'absolute',
        transform: [{ rotate: '-45deg' }],
      }} />
      {/* Center label */}
      <Text style={{ color: COLORS.textPrimary, fontSize: 18, fontWeight: '800' }}>
        {clampedValue.toFixed(1)}
      </Text>
      <Text style={{ color: COLORS.textTertiary, fontSize: 9, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 1 }}>
        %
      </Text>
    </View>
  );
}

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
  const [fetchError, setFetchError] = useState<string | null>(null);
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
      setFetchError(null);
      const data = await apiFetch<any>(`/api/containers/${id}`);
      setDetail(data.container);
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch container:', err);
      setFetchError(sanitizeErrorMessage(err, 'Failed to load container'));
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
      Alert.alert('Failed', sanitizeErrorMessage(err, 'Action failed'));
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
      setExecOutput(`$ ${execCmd}\nError: ${sanitizeErrorMessage(err, 'Failed')}`);
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
  const imageStr = detail?.Config?.Image || '';

  const statusColor = state === 'running' ? COLORS.green : COLORS.red;
  const statusLabel = state === 'running' ? 'Running' : state === 'exited' ? 'Stopped' : state.charAt(0).toUpperCase() + state.slice(1);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'stats', label: 'Stats' },
    { key: 'logs', label: 'Logs' },
    { key: 'exec', label: 'Exec' },
    { key: 'env', label: 'Env' },
    { key: 'processes', label: 'Top' },
  ];

  return (
    <>
      <Stack.Screen options={{
        title: name,
        headerBackTitle: 'Back',
        headerStyle: { backgroundColor: COLORS.bg },
        headerTintColor: COLORS.textPrimary,
      }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />}
      >
        {/* Loading State */}
        {!detail && !fetchError && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.blue} />
            <Text style={styles.loadingText}>Loading container...</Text>
          </View>
        )}

        {/* Error State */}
        {fetchError && (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle" size={18} color={COLORS.red} style={{ marginRight: 8 }} />
            <Text style={styles.errorText}>{fetchError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchDetail} accessibilityRole="button" accessibilityLabel="Retry loading">
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Hero Section */}
        <View style={styles.heroCard}>
          <View style={[styles.heroBadge, { backgroundColor: statusColor + '1A' }]}>
            <View style={[styles.heroDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.heroStatus, { color: statusColor }]}>{statusLabel}</Text>
          </View>
          <Text style={styles.heroName}>{name}</Text>
          <Text style={styles.heroImage}>{imageStr}</Text>
          {restartCount > 0 && (
            <View style={styles.restartBadge}>
              <Text style={styles.restartText}><Ionicons name="alert-circle" size={12} color={COLORS.yellow} /> {restartCount} restart{restartCount > 1 ? 's' : ''}</Text>
            </View>
          )}
        </View>

        {/* Action buttons */}
        {canAct && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
            <TouchableOpacity
              style={[styles.actionPill, { backgroundColor: COLORS.green + '1A' }]}
              onPress={() => setShowAction('start')}
              disabled={state === 'running'}
              accessibilityRole="button"
              accessibilityLabel="Start container"
            >
              <Ionicons name="play" size={14} color={COLORS.green} style={{ opacity: state === 'running' ? 0.4 : 1 }} />
              <Text style={[styles.actionLabel, { color: COLORS.green, opacity: state === 'running' ? 0.4 : 1 }]}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionPill, { backgroundColor: COLORS.red + '1A' }]}
              onPress={() => setShowAction('stop')}
              disabled={state !== 'running'}
              accessibilityRole="button"
              accessibilityLabel="Stop container"
            >
              <Ionicons name="stop" size={14} color={COLORS.red} style={{ opacity: state !== 'running' ? 0.4 : 1 }} />
              <Text style={[styles.actionLabel, { color: COLORS.red, opacity: state !== 'running' ? 0.4 : 1 }]}>Stop</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionPill, { backgroundColor: COLORS.blue + '1A' }]}
              onPress={() => setShowAction('restart')}
              accessibilityRole="button"
              accessibilityLabel="Restart container"
            >
              <Ionicons name="refresh" size={14} color={COLORS.blue} />
              <Text style={[styles.actionLabel, { color: COLORS.blue }]}>Restart</Text>
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity
                style={[styles.actionPill, { backgroundColor: COLORS.orange + '1A' }]}
                onPress={() => setShowAction('rebuild')}
                accessibilityRole="button"
                accessibilityLabel="Rebuild container"
              >
                <Ionicons name="trash" size={14} color={COLORS.orange} />
                <Text style={[styles.actionLabel, { color: COLORS.orange }]}>Rebuild</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Segmented Tab Bar */}
        <View style={styles.segmentedControl}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.segment, activeTab === t.key && styles.segmentActive]}
              onPress={() => {
                setActiveTab(t.key);
                if (t.key === 'logs') fetchLogs();
                if (t.key === 'processes') fetchProcesses();
              }}
            >
              <Text style={[styles.segmentText, activeTab === t.key && styles.segmentTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Stats Tab */}
        {activeTab === 'stats' && stats && (
          <View>
            {/* 2x2 stat grid */}
            <View style={styles.statGrid}>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>CPU</Text>
                <RingGauge value={stats.cpuPercent} color={COLORS.blue} />
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>MEMORY</Text>
                <RingGauge value={stats.memoryPercent} color={COLORS.purple} />
                <Text style={styles.statDetail}>
                  {formatBytes(stats.memoryUsage)} / {formatBytes(stats.memoryLimit)}
                </Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>NETWORK RX</Text>
                <Text style={styles.statBigNumber}>{formatBytes(stats.networkRx)}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statLabel}>NETWORK TX</Text>
                <Text style={styles.statBigNumber}>{formatBytes(stats.networkTx)}</Text>
              </View>
            </View>
            {/* PIDs row */}
            <View style={styles.pidsRow}>
              <Text style={styles.statLabel}>PIDS</Text>
              <Text style={styles.pidsValue}>{stats.pids}</Text>
            </View>
          </View>
        )}
        {activeTab === 'stats' && !stats && (
          <Text style={styles.noData}>Loading stats...</Text>
        )}

        {/* Logs Tab */}
        {activeTab === 'logs' && (
          <View>
            <View style={styles.logSearchRow}>
              <View style={styles.logSearchContainer}>
                <Ionicons name="search" size={14} color={COLORS.textTertiary} style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.logSearchInput}
                  placeholder="Search logs (regex)..."
                  placeholderTextColor={COLORS.textTertiary}
                  value={logSearch}
                  onChangeText={setLogSearch}
                  onSubmitEditing={handleLogSearch}
                  returnKeyType="search"
                />
              </View>
              <TouchableOpacity style={styles.logSearchBtn} onPress={handleLogSearch}>
                <Text style={styles.logSearchBtnText}>Search</Text>
              </TouchableOpacity>
            </View>
            {logSearchResults ? (
              <View>
                <View style={styles.searchResultBar}>
                  <Text style={styles.searchResultLabel}>{logSearchResults.length} matches</Text>
                  <TouchableOpacity onPress={() => setLogSearchResults(null)}>
                    <Text style={styles.clearSearchText}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.terminalContainer}>
                  {logSearchResults.map((m: any, i: number) => (
                    <View key={i} style={styles.logLine}>
                      <Text style={styles.logLineNumber}>{i + 1}</Text>
                      <Text style={styles.logLineText}>{m.line}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.terminalContainer}>
                {logs.map((line, i) => (
                  <View key={i} style={styles.logLine}>
                    <Text style={styles.logLineNumber}>{i + 1}</Text>
                    <Text style={styles.logLineText}>{line}</Text>
                  </View>
                ))}
                {logs.length === 0 && (
                  <Text style={styles.terminalPlaceholder}>No logs available</Text>
                )}
              </View>
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
                  <View style={styles.execInputContainer}>
                    <Text style={styles.execPrompt}>$</Text>
                    <TextInput
                      style={styles.execInput}
                      placeholder="e.g. hostname, df -h, ps aux..."
                      placeholderTextColor={COLORS.textTertiary}
                      value={execCmd}
                      onChangeText={setExecCmd}
                      onSubmitEditing={handleExec}
                      returnKeyType="send"
                      autoCapitalize="none"
                    />
                  </View>
                  <TouchableOpacity style={styles.execBtn} onPress={handleExec} disabled={execLoading}>
                    <Text style={styles.execBtnText}>{execLoading ? '...' : 'Run'}</Text>
                  </TouchableOpacity>
                </View>
                {execOutput !== null && (
                  <View style={styles.terminalContainer}>
                    {execOutput.split('\n').map((line, i) => (
                      <View key={i} style={styles.logLine}>
                        <Text style={styles.logLineNumber}>{i + 1}</Text>
                        <Text style={[
                          styles.logLineText,
                          line.startsWith('$') && { color: COLORS.blue },
                          line.startsWith('[exit:') && { color: COLORS.textTertiary },
                          line.startsWith('Error:') && { color: COLORS.red },
                        ]}>{line}</Text>
                      </View>
                    ))}
                  </View>
                )}
                <View style={styles.quickCmds}>
                  <Text style={styles.quickCmdsLabel}>QUICK COMMANDS</Text>
                  <View style={styles.quickCmdRow}>
                    {['hostname', 'uptime', 'df -h', 'ps aux', 'env', 'cat /etc/os-release'].map((cmd) => (
                      <TouchableOpacity key={cmd} style={styles.quickCmd} onPress={() => setExecCmd(cmd)}>
                        <Text style={styles.quickCmdText}>{cmd}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.noAccessCard}>
                <Ionicons name="lock-closed" size={32} color={COLORS.textTertiary} style={{ marginBottom: 8 }} />
                <Text style={styles.noAccessText}>Admin role required for exec</Text>
              </View>
            )}
          </View>
        )}

        {/* Env Tab */}
        {activeTab === 'env' && (
          <View style={styles.envContainer}>
            <View style={styles.envHeader}>
              <Text style={[styles.envHeaderCell, { flex: 0.4 }]}>KEY</Text>
              <Text style={styles.envHeaderCell}>VALUE</Text>
            </View>
            {envVars.map((env: string, i: number) => {
              const [key, ...rest] = env.split('=');
              const val = rest.join('=');
              const isSensitive = /password|secret|key|token|api/i.test(key);
              return (
                <View key={i} style={[styles.envRow, i % 2 === 0 && styles.envRowAlt]}>
                  <Text style={styles.envKey} numberOfLines={1}>{key}</Text>
                  <Text style={[styles.envVal, isSensitive && styles.envValMasked]} numberOfLines={1}>
                    {isSensitive ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : val}
                  </Text>
                </View>
              );
            })}
            {envVars.length === 0 && (
              <Text style={styles.noData}>No environment variables</Text>
            )}
          </View>
        )}

        {/* Processes Tab */}
        {activeTab === 'processes' && (
          <View style={styles.processContainer}>
            {processes?.Titles && (
              <View style={styles.processHeader}>
                {processes.Titles.map((t: string, i: number) => (
                  <Text key={i} style={[styles.processHeaderCell, i === 0 && { flex: 0, width: 50 }]}>{t}</Text>
                ))}
              </View>
            )}
            {(processes?.Processes || []).map((proc: string[], i: number) => (
              <View key={i} style={[styles.processRow, i % 2 === 0 && styles.processRowAlt]}>
                {proc.map((cell, j) => (
                  <Text key={j} style={[styles.processCell, j === 0 && { flex: 0, width: 50 }]} numberOfLines={1}>{cell}</Text>
                ))}
              </View>
            ))}
            {!processes && <Text style={styles.noData}>Loading processes...</Text>}
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
        confirmColor={showAction === 'stop' || showAction === 'rebuild' ? COLORS.red : showAction === 'start' ? COLORS.green : COLORS.blue}
        onConfirm={handleAction}
        onCancel={() => setShowAction(null)}
        loading={actionLoading}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: 16, paddingBottom: 40 },

  // Hero
  heroCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 8,
    marginBottom: 12,
  },
  heroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  heroStatus: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroName: {
    color: COLORS.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 4,
  },
  heroImage: {
    color: COLORS.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },
  restartBadge: {
    backgroundColor: COLORS.yellow + '1A',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 10,
  },
  restartText: {
    color: COLORS.yellow,
    fontSize: 12,
    fontWeight: '600',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
    paddingVertical: 2,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    gap: 8,
    minHeight: 44,
  },
  actionIcon: {
    fontSize: 14,
  },
  actionLabel: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Segmented control
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 3,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: COLORS.blue,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
  },

  // Stats
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flex: 1,
    minWidth: 150,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    minHeight: 140,
    justifyContent: 'center',
  },
  statLabel: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 10,
  },
  statDetail: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginTop: 6,
  },
  statBigNumber: {
    color: COLORS.textPrimary,
    fontSize: 32,
    fontWeight: '800',
  },
  pidsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pidsValue: {
    color: COLORS.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },

  // Logs
  logSearchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  logSearchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  logSearchIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  logSearchInput: {
    flex: 1,
    paddingVertical: 10,
    color: COLORS.textPrimary,
    fontSize: 14,
  },
  logSearchBtn: {
    backgroundColor: COLORS.blue,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  logSearchBtnText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  searchResultBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  searchResultLabel: {
    color: COLORS.blue,
    fontSize: 12,
    fontWeight: '600',
  },
  clearSearchText: {
    color: COLORS.blue,
    fontSize: 13,
    fontWeight: '600',
  },
  terminalContainer: {
    backgroundColor: COLORS.terminal,
    borderRadius: 12,
    padding: 14,
    minHeight: 200,
    maxHeight: 420,
  },
  logLine: {
    flexDirection: 'row',
    paddingVertical: 1,
  },
  logLineNumber: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontFamily: 'monospace',
    width: 36,
    textAlign: 'right',
    marginRight: 12,
    opacity: 0.6,
  },
  logLineText: {
    color: COLORS.terminalText,
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
  terminalPlaceholder: {
    color: COLORS.textTertiary,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 40,
  },

  // Exec
  execHint: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginBottom: 12,
  },
  execRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  execInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.terminal,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  execPrompt: {
    color: COLORS.green,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'monospace',
    marginRight: 8,
  },
  execInput: {
    flex: 1,
    paddingVertical: 12,
    color: COLORS.green,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  execBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  execBtnText: {
    color: COLORS.bgDeep,
    fontSize: 14,
    fontWeight: '700',
  },
  quickCmds: {
    marginTop: 8,
  },
  quickCmdsLabel: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  quickCmdRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickCmd: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickCmdText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
  },

  // Env
  envContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  envHeader: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.border + '44',
  },
  envHeaderCell: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    flex: 0.6,
  },
  envRow: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '44',
  },
  envRowAlt: {
    backgroundColor: COLORS.border + '22',
  },
  envKey: {
    color: COLORS.blue,
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '600',
    flex: 0.4,
    marginRight: 8,
  },
  envVal: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 0.6,
  },
  envValMasked: {
    color: COLORS.textTertiary,
    letterSpacing: 2,
  },

  // Processes
  processContainer: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  processHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.border + '44',
  },
  processHeaderCell: {
    color: COLORS.textTertiary,
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    textTransform: 'uppercase',
    flex: 1,
  },
  processRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border + '22',
  },
  processRowAlt: {
    backgroundColor: COLORS.border + '22',
  },
  processCell: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontFamily: 'monospace',
    flex: 1,
  },

  // Loading & Error
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 16,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  errorCard: {
    backgroundColor: COLORS.red + '12',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.red + '40',
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    gap: 10,
  },
  errorIcon: {
    fontSize: 28,
  },
  errorText: {
    color: COLORS.red,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    backgroundColor: COLORS.red + '1A',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  retryBtnText: {
    color: COLORS.red,
    fontSize: 14,
    fontWeight: '600',
  },

  // Shared
  noData: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 30,
  },
  noAccessCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 30,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  noAccessIcon: {
    fontSize: 32,
    marginBottom: 10,
  },
  noAccessText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontStyle: 'italic',
  },
});
