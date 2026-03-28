import { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';

interface Integration {
  id: string;
  adapter: string;
  name: string;
  enabled: number;
  last_pull: string | null;
  last_status: string | null;
  last_error: string | null;
  poll_interval: number;
}

export default function IntegrationsScreen() {
  const router = useRouter();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchIntegrations = useCallback(async () => {
    try {
      const data = await apiFetch<{ integrations: Integration[] }>('/api/integrations');
      setIntegrations(data.integrations);
    } catch (err: any) {
      console.error('Failed to fetch integrations:', err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  const handleTest = async (id: string, name: string) => {
    try {
      const result = await apiFetch<{ ok: boolean; message: string; latencyMs?: number }>(
        `/api/integrations/${id}/test`,
        { method: 'POST' }
      );
      Alert.alert(
        result.ok ? 'Connection OK' : 'Connection Failed',
        `${result.message}${result.latencyMs ? ` (${result.latencyMs}ms)` : ''}`
      );
    } catch (err: any) {
      Alert.alert('Test Failed', err.message);
    }
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Delete Integration', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`/api/integrations/${id}`, { method: 'DELETE' });
            setIntegrations((prev) => prev.filter((i) => i.id !== id));
          } catch (err: any) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  };

  const statusColor = (status: string | null) => {
    if (status === 'ok') return COLORS.green;
    if (status === 'error') return COLORS.red;
    return COLORS.textTertiary;
  };

  const adapterIcon = (adapter: string): keyof typeof Ionicons.glyphMap => {
    switch (adapter) {
      case 'prometheus': return 'pulse';
      case 'grafana': return 'bar-chart';
      case 'http-json': return 'code-slash';
      default: return 'extension-puzzle';
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.blue} />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Integrations' }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchIntegrations();
            }}
            tintColor={COLORS.blue}
          />
        }
      >
        <Text style={styles.title}>Integrations</Text>
        <Text style={styles.subtitle}>
          Connect external monitoring sources to pull data into Cockpit
        </Text>

        {integrations.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="git-network" size={48} color={COLORS.textTertiary} />
            <Text style={styles.emptyText}>No integrations configured</Text>
            <Text style={styles.emptySubtext}>
              Add a Prometheus, Grafana, or custom HTTP endpoint
            </Text>
          </View>
        ) : (
          integrations.map((integration) => (
            <View key={integration.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.iconContainer, { backgroundColor: COLORS.indigo + '20' }]}>
                  <Ionicons name={adapterIcon(integration.adapter)} size={20} color={COLORS.indigo} />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>{integration.name}</Text>
                  <Text style={styles.cardAdapter}>{integration.adapter}</Text>
                </View>
                <View style={[styles.statusDot, { backgroundColor: statusColor(integration.last_status) }]} />
              </View>

              {integration.last_error && (
                <Text style={styles.errorText} numberOfLines={2}>
                  {integration.last_error}
                </Text>
              )}

              <View style={styles.cardMeta}>
                <Text style={styles.metaText}>
                  Poll: {integration.poll_interval}s
                </Text>
                {integration.last_pull && (
                  <Text style={styles.metaText}>
                    Last: {new Date(integration.last_pull).toLocaleTimeString()}
                  </Text>
                )}
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleTest(integration.id, integration.name)}
                >
                  <Ionicons name="flash" size={16} color={COLORS.blue} />
                  <Text style={styles.actionText}>Test</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleDelete(integration.id, integration.name)}
                >
                  <Ionicons name="trash" size={16} color={COLORS.red} />
                  <Text style={[styles.actionText, { color: COLORS.red }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  content: { padding: SPACING.lg, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  title: { color: COLORS.textPrimary, ...FONT.hero, fontSize: 28, marginTop: SPACING.sm },
  subtitle: { color: COLORS.textTertiary, ...FONT.body, fontSize: 14, marginBottom: SPACING.xxl },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: SPACING.sm },
  emptyText: { color: COLORS.textSecondary, ...FONT.title, fontSize: 18 },
  emptySubtext: { color: COLORS.textTertiary, ...FONT.body, fontSize: 14 },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  iconContainer: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
  },
  cardInfo: { flex: 1 },
  cardName: { color: COLORS.textPrimary, ...FONT.heading, fontSize: 16 },
  cardAdapter: { color: COLORS.textTertiary, fontSize: 12, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  errorText: { color: COLORS.red, fontSize: 12, marginTop: SPACING.sm },
  cardMeta: {
    flexDirection: 'row', gap: SPACING.lg,
    marginTop: SPACING.sm, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  metaText: { color: COLORS.textTertiary, fontSize: 12 },
  cardActions: {
    flexDirection: 'row', gap: SPACING.lg,
    marginTop: SPACING.md, paddingTop: SPACING.sm,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { color: COLORS.blue, fontSize: 13, fontWeight: '500' },
});
