import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, LayoutAnimation, Platform, UIManager } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';
import { sanitizeErrorMessage } from '../../src/lib/errors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface NetworkContainer {
  id: string;
  name: string;
  ipv4: string;
}

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  containers: NetworkContainer[];
}

export default function NetworksScreen() {
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const fetchNetworks = useCallback(async () => {
    try {
      const data = await apiFetch<{ networks: DockerNetwork[] }>('/api/networks');
      setNetworks(data.networks);
    } catch (err) {
      console.error('Failed to fetch networks:', err);
      Alert.alert('Error', sanitizeErrorMessage(err, 'Failed to fetch networks'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchNetworks(); }, [fetchNetworks]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchNetworks();
    setRefreshing(false);
  }, [fetchNetworks]);

  const toggleExpand = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedIds(next);
  };

  const renderItem = ({ item }: { item: DockerNetwork }) => {
    const hasContainers = item.containers.length > 0;
    const isExpanded = expandedIds.has(item.id);
    const borderColor = hasContainers ? COLORS.blue : COLORS.border;
    const indicatorColor = hasContainers ? COLORS.blue : COLORS.textTertiary;

    return (
      <TouchableOpacity
        style={[styles.card, { borderLeftColor: borderColor, borderLeftWidth: 3 }]}
        onPress={() => hasContainers && toggleExpand(item.id)}
        activeOpacity={hasContainers ? 0.7 : 1}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.indicator, { backgroundColor: indicatorColor }]} />
            <Text style={styles.networkName}>{item.name}</Text>
          </View>
          {hasContainers && (
            <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={COLORS.textSecondary} />
          )}
        </View>

        <View style={styles.cardMeta}>
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>{item.driver}</Text>
          </View>
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>{item.scope}</Text>
          </View>
          <View style={[styles.metaBadge, hasContainers ? styles.metaBadgeActive : styles.metaBadgeInactive]}>
            <Text style={[styles.metaBadgeText, hasContainers && styles.metaBadgeTextActive]}>
              {item.containers.length} container{item.containers.length !== 1 ? 's' : ''}
            </Text>
          </View>
        </View>

        {isExpanded && hasContainers && (
          <View style={styles.containerList}>
            <View style={styles.containerListHeader}>
              <Text style={styles.containerListHeaderText}>Container</Text>
              <Text style={styles.containerListHeaderText}>IPv4</Text>
            </View>
            {item.containers.map((c) => (
              <View key={c.id} style={styles.containerRow}>
                <Text style={styles.containerName} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.containerIp}>{c.ipv4 || 'N/A'}</Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Networks', headerBackTitle: 'Back' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.blue} />
          <Text style={styles.loadingText}>Loading networks...</Text>
        </View>
      </>
    );
  }

  const activeNetworks = networks.filter((n) => n.containers.length > 0).length;

  return (
    <>
      <Stack.Screen options={{ title: 'Networks', headerBackTitle: 'Back' }} />
      <View style={styles.container}>
        {/* Summary bar */}
        <View style={styles.summary}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{networks.length}</Text>
            <Text style={styles.summaryLabel}>Total</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.blue }]}>{activeNetworks}</Text>
            <Text style={styles.summaryLabel}>Active</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={[styles.summaryValue, { color: COLORS.textTertiary }]}>{networks.length - activeNetworks}</Text>
            <Text style={styles.summaryLabel}>Empty</Text>
          </View>
        </View>

        <FlatList
          data={networks}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} colors={[COLORS.blue]} progressBackgroundColor={COLORS.card} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No networks found</Text>}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  centered: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: COLORS.textSecondary, fontSize: 14, marginTop: SPACING.md },
  summary: {
    flexDirection: 'row', backgroundColor: COLORS.card, marginHorizontal: SPACING.lg, marginTop: SPACING.lg,
    marginBottom: SPACING.sm, borderRadius: RADIUS.lg, padding: SPACING.lg, borderWidth: 1, borderColor: COLORS.border,
    justifyContent: 'space-around', alignItems: 'center',
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: { color: COLORS.textPrimary, fontSize: 22, fontWeight: '700' },
  summaryLabel: { color: COLORS.textSecondary, fontSize: 12, marginTop: 2 },
  summaryDivider: { width: 1, height: 30, backgroundColor: COLORS.border },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl, paddingTop: SPACING.sm },
  card: {
    backgroundColor: COLORS.card, borderRadius: RADIUS.lg, padding: SPACING.lg, marginBottom: 10,
    borderWidth: 1, borderColor: COLORS.border,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  indicator: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  networkName: { color: COLORS.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  chevron: { color: COLORS.textSecondary, fontSize: 12 },
  cardMeta: { flexDirection: 'row', gap: SPACING.sm },
  metaBadge: { backgroundColor: COLORS.border, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  metaBadgeActive: { backgroundColor: COLORS.infoBg },
  metaBadgeInactive: {},
  metaBadgeText: { color: COLORS.textSecondary, fontSize: 11, fontWeight: '500' },
  metaBadgeTextActive: { color: COLORS.blue },
  containerList: { marginTop: 14, borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10 },
  containerListHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  containerListHeaderText: { color: COLORS.textTertiary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  containerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border,
  },
  containerName: { color: COLORS.textPrimary, fontSize: 13, flex: 1, marginRight: SPACING.md },
  containerIp: { color: COLORS.blue, fontSize: 13, fontFamily: 'monospace' },
  empty: { color: COLORS.textTertiary, fontSize: 14, textAlign: 'center', marginTop: 40 },
});
