import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { Stack } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';

/* ---------- types ---------- */
interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
}

const EVENT_OPTIONS = ['container.down', 'container.state_change', 'alert.rule', '*'];

export default function WebhooksScreen() {
  const { userRole } = useServerStore();
  const isAdmin = userRole === 'admin';

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);

  /* form state */
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [eventsInput, setEventsInput] = useState('');
  const [headers, setHeaders] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchWebhooks = useCallback(async () => {
    try {
      const res = await apiFetch<{ webhooks: Webhook[] }>('/api/webhooks');
      setWebhooks(res.webhooks ?? []);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }, []);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWebhooks();
    setRefreshing(false);
  };

  /* delete webhook */
  const deleteWebhook = (wh: Webhook) => {
    Alert.alert('Delete Webhook', `Remove "${wh.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/api/webhooks/${wh.id}`, { method: 'DELETE' });
            setWebhooks((prev) => prev.filter((w) => w.id !== wh.id));
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  /* add webhook */
  const addWebhook = async () => {
    if (!name.trim() || !url.trim()) {
      Alert.alert('Validation', 'Name and URL are required.');
      return;
    }

    const events = eventsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (events.length === 0) {
      Alert.alert('Validation', 'At least one event is required.');
      return;
    }

    let parsedHeaders: Record<string, string> = {};
    if (headers.trim()) {
      try {
        parsedHeaders = JSON.parse(headers.trim());
      } catch {
        Alert.alert('Validation', 'Headers must be valid JSON (e.g. {"X-Key":"val"})');
        return;
      }
    }

    setSaving(true);
    try {
      await apiFetch('/api/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          url: url.trim(),
          events,
          headers: parsedHeaders,
        }),
      });
      setName('');
      setUrl('');
      setEventsInput('');
      setHeaders('');
      setShowForm(false);
      await fetchWebhooks();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Webhooks', headerBackTitle: 'Manage' }} />
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
      >
        {/* Header */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Webhooks</Text>
          {isAdmin && (
            <TouchableOpacity onPress={() => setShowForm(!showForm)}>
              <Text style={styles.addText}>{showForm ? 'Cancel' : '+ Add Webhook'}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Add Form */}
        {showForm && isAdmin && (
          <View style={styles.formCard}>
            <TextInput
              style={styles.input}
              placeholder="Webhook name"
              placeholderTextColor="#6B7280"
              value={name}
              onChangeText={setName}
            />
            <TextInput
              style={styles.input}
              placeholder="URL (https://...)"
              placeholderTextColor="#6B7280"
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
            <TextInput
              style={styles.input}
              placeholder="Events (comma-separated: container.down, *)"
              placeholderTextColor="#6B7280"
              value={eventsInput}
              onChangeText={setEventsInput}
              autoCapitalize="none"
            />
            <Text style={styles.hintText}>
              Options: {EVENT_OPTIONS.join(', ')}
            </Text>
            <TextInput
              style={[styles.input, { height: 60 }]}
              placeholder='Headers JSON (optional): {"X-Key":"val"}'
              placeholderTextColor="#6B7280"
              value={headers}
              onChangeText={setHeaders}
              autoCapitalize="none"
              multiline
            />
            <TouchableOpacity
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
              onPress={addWebhook}
              disabled={saving}
            >
              <Text style={styles.saveText}>{saving ? 'Saving...' : 'Save Webhook'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Webhooks list */}
        {webhooks.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>{'\u{1F517}'}</Text>
            <Text style={styles.emptyText}>No webhooks configured</Text>
            <Text style={styles.emptySubtext}>
              Webhooks send HTTP POST notifications when events occur
            </Text>
          </View>
        ) : (
          webhooks.map((wh) => (
            <View key={wh.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{wh.name}</Text>
                  <Text style={styles.cardUrl} numberOfLines={1}>
                    {wh.url}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusBadge,
                    { backgroundColor: wh.enabled ? '#064E3B' : '#7F1D1D' },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      { color: wh.enabled ? '#6EE7B7' : '#FCA5A5' },
                    ]}
                  >
                    {wh.enabled ? 'Active' : 'Disabled'}
                  </Text>
                </View>
              </View>

              <View style={styles.eventsRow}>
                {(wh.events ?? []).map((ev, i) => (
                  <View key={i} style={styles.eventTag}>
                    <Text style={styles.eventTagText}>{ev}</Text>
                  </View>
                ))}
              </View>

              {isAdmin && (
                <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteWebhook(wh)}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              )}
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

  /* cards */
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  cardName: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  cardUrl: { color: '#6B7280', fontSize: 12, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  statusText: { fontSize: 11, fontWeight: '600' },
  eventsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  eventTag: {
    backgroundColor: '#1F2937',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  eventTagText: { color: '#60A5FA', fontSize: 11, fontWeight: '500' },
  deleteBtn: { marginTop: 12, alignSelf: 'flex-start' },
  deleteText: { color: '#EF4444', fontSize: 13, fontWeight: '500' },

  /* empty */
  emptyContainer: { alignItems: 'center', marginVertical: 40 },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: '#F9FAFB', fontSize: 16, fontWeight: '600', marginBottom: 4 },
  emptySubtext: { color: '#6B7280', fontSize: 13, textAlign: 'center' },
});
