import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';

/* ---------- types ---------- */
interface Schedule {
  id: number;
  name: string;
  container_id: string;
  container_name: string;
  action: 'start' | 'stop' | 'restart';
  cron_expression: string;
  enabled: number;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

interface ScheduleHistoryEntry {
  id: number;
  schedule_name: string;
  container_name: string;
  action: string;
  success: number;
  error: string | null;
  executed_at: string;
}

interface Container {
  id: string;
  name: string;
  state: string;
}

/* ---------- constants ---------- */
const ACTIONS = ['start', 'stop', 'restart'] as const;

const CRON_PRESETS: { label: string; value: string }[] = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Daily at 3 AM', value: '0 3 * * *' },
  { label: 'Daily at midnight', value: '0 0 * * *' },
  { label: 'Weekly Sunday 2 AM', value: '0 2 * * 0' },
  { label: 'Every 30 minutes', value: '*/30 * * * *' },
  { label: 'Custom', value: '' },
];

/* ---------- helpers ---------- */
const ACTION_COLORS: Record<string, { bg: string; text: string }> = {
  start: { bg: '#064E3B', text: '#6EE7B7' },
  stop: { bg: '#7F1D1D', text: '#FCA5A5' },
  restart: { bg: '#1E3A5F', text: '#93C5FD' },
};

function cronToHuman(expr: string): string {
  const map: Record<string, string> = {
    '0 * * * *': 'Every hour',
    '0 */6 * * *': 'Every 6 hours',
    '0 3 * * *': 'Daily at 3 AM',
    '0 0 * * *': 'Daily at midnight',
    '0 2 * * 0': 'Weekly Sunday 2 AM',
    '*/30 * * * *': 'Every 30 min',
    '*/15 * * * *': 'Every 15 min',
    '0 */2 * * *': 'Every 2 hours',
    '0 */12 * * *': 'Every 12 hours',
  };
  return map[expr] || expr;
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/* ---------- component ---------- */
export default function SchedulesScreen() {
  const { userRole } = useServerStore();
  const isAdmin = userRole === 'admin';

  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [history, setHistory] = useState<ScheduleHistoryEntry[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  /* form state */
  const [name, setName] = useState('');
  const [selectedContainer, setSelectedContainer] = useState<Container | null>(null);
  const [containerIdx, setContainerIdx] = useState(0);
  const [action, setAction] = useState<typeof ACTIONS[number]>(ACTIONS[0]);
  const [actionIdx, setActionIdx] = useState(0);
  const [cronPresetIdx, setCronPresetIdx] = useState(0);
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[0].value);
  const [customCron, setCustomCron] = useState('');
  const [saving, setSaving] = useState(false);

  /* ---------- data fetching ---------- */
  const fetchData = useCallback(async () => {
    try {
      const [schedRes, histRes, ctrRes] = await Promise.all([
        apiFetch<{ schedules: Schedule[] }>('/api/schedules'),
        apiFetch<{ history: ScheduleHistoryEntry[] }>('/api/schedules/history'),
        apiFetch<{ containers: Container[] }>('/api/containers'),
      ]);
      setSchedules(schedRes.schedules ?? []);
      setHistory(histRes.history ?? []);
      const ctrs = ctrRes.containers ?? [];
      setContainers(ctrs);
      if (ctrs.length > 0 && !selectedContainer) {
        setSelectedContainer(ctrs[0]);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  /* ---------- actions ---------- */
  const toggleSchedule = async (schedule: Schedule) => {
    const newEnabled = !schedule.enabled;
    try {
      await apiFetch(`/api/schedules/${schedule.id}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: newEnabled }),
      });
      setSchedules((prev) =>
        prev.map((s) =>
          s.id === schedule.id ? { ...s, enabled: newEnabled ? 1 : 0 } : s
        )
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const deleteSchedule = (schedule: Schedule) => {
    Alert.alert('Delete Schedule', `Remove "${schedule.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/api/schedules/${schedule.id}`, { method: 'DELETE' });
            setSchedules((prev) => prev.filter((s) => s.id !== schedule.id));
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  const addSchedule = async () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required.');
      return;
    }
    if (!selectedContainer) {
      Alert.alert('Validation', 'Select a container.');
      return;
    }

    const finalCron =
      CRON_PRESETS[cronPresetIdx].value === ''
        ? customCron.trim()
        : CRON_PRESETS[cronPresetIdx].value;

    if (!finalCron) {
      Alert.alert('Validation', 'Cron expression is required.');
      return;
    }

    setSaving(true);
    try {
      await apiFetch('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          containerId: selectedContainer.id,
          containerName: selectedContainer.name,
          action,
          cronExpression: finalCron,
        }),
      });
      setName('');
      setCronPresetIdx(0);
      setCronExpression(CRON_PRESETS[0].value);
      setCustomCron('');
      setShowForm(false);
      await fetchData();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- cycle pickers ---------- */
  const cycleContainer = () => {
    if (containers.length === 0) return;
    const next = (containerIdx + 1) % containers.length;
    setContainerIdx(next);
    setSelectedContainer(containers[next]);
  };

  const cycleAction = () => {
    const next = (actionIdx + 1) % ACTIONS.length;
    setActionIdx(next);
    setAction(ACTIONS[next]);
  };

  const cycleCronPreset = () => {
    const next = (cronPresetIdx + 1) % CRON_PRESETS.length;
    setCronPresetIdx(next);
    if (CRON_PRESETS[next].value !== '') {
      setCronExpression(CRON_PRESETS[next].value);
    }
  };

  const isCustomCron = CRON_PRESETS[cronPresetIdx].value === '';

  return (
    <>
      <Stack.Screen options={{ title: 'Scheduled Actions', headerBackTitle: 'Manage' }} />
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
        }
      >
        {/* -------- Schedules Section -------- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Schedules</Text>
          {isAdmin && (
            <TouchableOpacity onPress={() => setShowForm(!showForm)}>
              <Text style={styles.addText}>{showForm ? 'Cancel' : '+ Add Schedule'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Add Schedule Form */}
        {showForm && isAdmin && (
          <View style={styles.formCard}>
            <TextInput
              style={styles.input}
              placeholder="Schedule name"
              placeholderTextColor="#6B7280"
              value={name}
              onChangeText={setName}
            />

            {/* Container picker */}
            <TouchableOpacity style={styles.pickerBtn} onPress={cycleContainer}>
              <Text style={styles.pickerLabel}>Container</Text>
              <Text style={styles.pickerValue} numberOfLines={1}>
                {selectedContainer?.name || 'No containers'}
              </Text>
            </TouchableOpacity>
            {selectedContainer && (
              <Text style={styles.hintText}>
                State: {containers.find((c) => c.id === selectedContainer.id)?.state || 'unknown'}
              </Text>
            )}

            {/* Action picker */}
            <TouchableOpacity style={styles.pickerBtn} onPress={cycleAction}>
              <Text style={styles.pickerLabel}>Action</Text>
              <Text
                style={[
                  styles.pickerValue,
                  { color: ACTION_COLORS[action]?.text || '#60A5FA' },
                ]}
              >
                {action.toUpperCase()}
              </Text>
            </TouchableOpacity>

            {/* Cron preset picker */}
            <TouchableOpacity style={styles.pickerBtn} onPress={cycleCronPreset}>
              <Text style={styles.pickerLabel}>Schedule</Text>
              <Text style={styles.pickerValue}>{CRON_PRESETS[cronPresetIdx].label}</Text>
            </TouchableOpacity>

            {isCustomCron && (
              <TextInput
                style={styles.input}
                placeholder="Cron expression (e.g. 0 3 * * *)"
                placeholderTextColor="#6B7280"
                value={customCron}
                onChangeText={setCustomCron}
                autoCapitalize="none"
              />
            )}

            {!isCustomCron && (
              <Text style={styles.hintText}>Cron: {CRON_PRESETS[cronPresetIdx].value}</Text>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
              onPress={addSchedule}
              disabled={saving}
            >
              <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Schedule'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Schedules list */}
        {schedules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u{23F0}'}</Text>
            <Text style={styles.emptyText}>No scheduled actions</Text>
            <Text style={styles.emptySubtext}>
              Schedule automatic container start/stop/restart
            </Text>
          </View>
        ) : (
          schedules.map((schedule) => {
            const colors = ACTION_COLORS[schedule.action] || ACTION_COLORS.restart;
            return (
              <View key={schedule.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{schedule.name}</Text>
                    <Text style={styles.cardContainer}>{schedule.container_name}</Text>
                    <View style={styles.metaRow}>
                      <View style={[styles.actionBadge, { backgroundColor: colors.bg }]}>
                        <Text style={[styles.actionBadgeText, { color: colors.text }]}>
                          {schedule.action.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.cronText}>{cronToHuman(schedule.cron_expression)}</Text>
                    </View>
                    <Text style={styles.timeText}>
                      Last: {formatTime(schedule.last_run)}
                    </Text>
                    <Text style={styles.timeText}>
                      Next: {formatTime(schedule.next_run)}
                    </Text>
                  </View>
                  <Switch
                    value={!!schedule.enabled}
                    onValueChange={() => toggleSchedule(schedule)}
                    trackColor={{ false: '#374151', true: '#1D4ED8' }}
                    thumbColor={schedule.enabled ? '#60A5FA' : '#6B7280'}
                  />
                </View>
                {isAdmin && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => deleteSchedule(schedule)}
                  >
                    <Text style={styles.deleteText}>Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}

        {/* -------- History Section -------- */}
        <Text style={[styles.sectionTitle, { marginTop: 32 }]}>Execution History</Text>
        {history.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptySubtext}>No executions yet</Text>
          </View>
        ) : (
          history.slice(0, 20).map((entry) => (
            <View key={entry.id} style={styles.historyCard}>
              <View style={styles.historyTop}>
                <Text style={styles.historyName}>{entry.schedule_name}</Text>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: entry.success ? '#10B981' : '#EF4444' },
                  ]}
                />
              </View>
              <Text style={styles.historyMeta}>
                {entry.action.toUpperCase()} {entry.container_name}
              </Text>
              {entry.error && <Text style={styles.historyError}>{entry.error}</Text>}
              <Text style={styles.historyTime}>{formatTime(entry.executed_at)}</Text>
            </View>
          ))
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D', padding: 16 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 8,
  },
  sectionTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  addText: { color: '#60A5FA', fontSize: 14, fontWeight: '600' },

  /* form */
  formCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  input: {
    backgroundColor: '#0D0D0D',
    borderRadius: 8,
    padding: 12,
    color: '#F9FAFB',
    fontSize: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  pickerBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0D0D0D',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  pickerLabel: { color: '#9CA3AF', fontSize: 13 },
  pickerValue: { color: '#60A5FA', fontSize: 14, fontWeight: '600', maxWidth: '60%' },
  hintText: {
    color: '#6B7280',
    fontSize: 11,
    marginBottom: 10,
    marginLeft: 4,
  },
  saveBtn: {
    backgroundColor: '#1D4ED8',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },

  /* schedule cards */
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardName: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  cardContainer: { color: '#9CA3AF', fontSize: 13, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  actionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  actionBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  cronText: { color: '#60A5FA', fontSize: 12, fontWeight: '500' },
  timeText: { color: '#6B7280', fontSize: 11, marginTop: 3 },
  deleteBtn: { marginTop: 12, alignSelf: 'flex-start' },
  deleteText: { color: '#EF4444', fontSize: 13, fontWeight: '500' },

  /* history cards */
  historyCard: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyName: { color: '#F9FAFB', fontSize: 14, fontWeight: '600' },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  historyMeta: { color: '#9CA3AF', fontSize: 12, marginTop: 4 },
  historyError: { color: '#FCA5A5', fontSize: 12, marginTop: 2 },
  historyTime: { color: '#6B7280', fontSize: 11, marginTop: 4 },

  /* empty */
  emptyContainer: { alignItems: 'center', marginVertical: 32 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: '#F9FAFB', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
});
