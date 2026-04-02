import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

interface CertificateAuthority {
  id: string;
  subject: string;
  issuer?: string;
  not_after: string;
  created_at: string;
}

interface MtlsAgent {
  id: string;
  name: string;
  fingerprint?: string;
  enabled: boolean;
  last_seen?: string;
  status: string;
}

interface CaListResponse {
  cas: CertificateAuthority[];
}

interface AgentListResponse {
  agents: MtlsAgent[];
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

type TabKey = 'cas' | 'agents';

const STATUS_COLORS: Record<string, string> = {
  active: COLORS.green,
  inactive: COLORS.textTertiary,
  revoked: COLORS.red,
};

/* ---------- Staggered Animation ---------- */

function FadeSlideIn({ delay, children }: { delay: number; children: React.ReactNode }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(16);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 400, easing: Easing.out(Easing.ease) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 400, easing: Easing.out(Easing.ease) }));
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      {children}
    </Animated.View>
  );
}

/* ---------- Helpers ---------- */

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ---------- Screen ---------- */

function MtlsListContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('cas');
  const [cas, setCas] = useState<CertificateAuthority[]>([]);
  const [agents, setAgents] = useState<MtlsAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [caRes, agentRes] = await Promise.all([
        apiFetch<CaListResponse>(`${ENT_API}/mtls/ca`),
        apiFetch<AgentListResponse>(`${ENT_API}/mtls/agents`),
      ]);
      setCas(caRes.cas ?? []);
      setAgents(agentRes.agents ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load mTLS data');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchData();
  };

  const renderCa = ({ item, index }: { item: CertificateAuthority; index: number }) => {
    const isExpired = new Date(item.not_after) < new Date();
    return (
      <FadeSlideIn delay={index * 50}>
        <View style={styles.card}>
          <View style={styles.cardBody}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.subject}
              </Text>
              <View style={[
                styles.badge,
                {
                  backgroundColor: (isExpired ? COLORS.red : COLORS.green) + '20',
                  borderColor: isExpired ? COLORS.red : COLORS.green,
                },
              ]}>
                <Text style={[styles.badgeText, { color: isExpired ? COLORS.red : COLORS.green }]}>
                  {isExpired ? 'EXPIRED' : 'VALID'}
                </Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <Ionicons name="calendar-outline" size={12} color={COLORS.textTertiary} />
              <Text style={styles.dateText}>
                Expires {formatDate(item.not_after)}
              </Text>
            </View>
          </View>
        </View>
      </FadeSlideIn>
    );
  };

  const renderAgent = ({ item, index }: { item: MtlsAgent; index: number }) => {
    const statusColor = STATUS_COLORS[item.status] ?? COLORS.textTertiary;
    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/mtls-detail?id=${item.id}` as any)}
        >
          <View style={styles.cardBody}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[
                styles.badge,
                {
                  backgroundColor: statusColor + '20',
                  borderColor: statusColor,
                },
              ]}>
                <Text style={[styles.badgeText, { color: statusColor }]}>
                  {item.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <View style={[
                styles.enabledDot,
                { backgroundColor: item.enabled ? COLORS.green : COLORS.textTertiary },
              ]} />
              <Text style={[
                styles.enabledText,
                { color: item.enabled ? COLORS.green : COLORS.textTertiary },
              ]}>
                {item.enabled ? 'Enabled' : 'Disabled'}
              </Text>
              <View style={{ flex: 1 }} />
              {item.last_seen && (
                <Text style={styles.dateText}>
                  Last seen {formatDateTime(item.last_seen)}
                </Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textTertiary} style={{ alignSelf: 'center', marginRight: SPACING.md }} />
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  return (
    <View style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'cas' && styles.tabActive]}
          onPress={() => setActiveTab('cas')}
        >
          <Ionicons name="ribbon-outline" size={16} color={activeTab === 'cas' ? COLORS.blue : COLORS.textTertiary} />
          <Text style={[styles.tabText, activeTab === 'cas' && styles.tabTextActive]}>
            CAs ({cas.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'agents' && styles.tabActive]}
          onPress={() => setActiveTab('agents')}
        >
          <Ionicons name="hardware-chip-outline" size={16} color={activeTab === 'agents' ? COLORS.blue : COLORS.textTertiary} />
          <Text style={[styles.tabText, activeTab === 'agents' && styles.tabTextActive]}>
            Agents ({agents.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Loading */}
      {loading && !refreshing && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
                <View style={{ backgroundColor: COLORS.border, width: 160, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 60, height: 20, borderRadius: 10 }} />
              </View>
              <View style={{ flexDirection: 'row', gap: SPACING.lg }}>
                <View style={{ backgroundColor: COLORS.border, width: 100, height: 14, borderRadius: 4 }} />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Error state */}
      {!loading && error && (
        <GlassCard style={styles.errorCard}>
          <View style={styles.centerContainer}>
            <Ionicons
              name="warning"
              size={48}
              color={COLORS.yellow}
              style={{ marginBottom: SPACING.lg }}
            />
            <Text style={styles.errorTitle}>Failed to Load</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      )}

      {/* CAs tab */}
      {!loading && !error && activeTab === 'cas' && (
        <FlatList
          data={cas}
          renderItem={renderCa}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.blue}
              colors={[COLORS.blue]}
              progressBackgroundColor={COLORS.card}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Ionicons
                name="ribbon-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No Certificate Authorities</Text>
              <Text style={styles.emptySubtext}>
                Upload a CA certificate to enable mutual TLS
              </Text>
            </View>
          }
        />
      )}

      {/* Agents tab */}
      {!loading && !error && activeTab === 'agents' && (
        <FlatList
          data={agents}
          renderItem={renderAgent}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.blue}
              colors={[COLORS.blue]}
              progressBackgroundColor={COLORS.card}
            />
          }
          ListEmptyComponent={
            <View style={styles.centerContainer}>
              <Ionicons
                name="hardware-chip-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No agents registered</Text>
              <Text style={styles.emptySubtext}>
                Register an agent to authenticate via client certificate
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Register Agent (only on agents tab) */}
      {activeTab === 'agents' && (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.8}
          onPress={() => router.push('/manage/mtls-create' as any)}
        >
          <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function MtlsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'mTLS', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="mtls">
        <MtlsListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

  /* Tabs */
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tabActive: {
    backgroundColor: COLORS.blue + '15',
    borderColor: COLORS.blue,
  },
  tabText: {
    color: COLORS.textTertiary,
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: COLORS.blue,
  },

  /* Card */
  card: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  cardBody: {
    flex: 1,
    padding: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  cardName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  /* Status row */
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  enabledDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  enabledText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dateText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  /* Center / Error / Empty */
  errorCard: {
    marginHorizontal: SPACING.lg,
    marginTop: 60,
  },
  centerContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: SPACING.xxl,
  },
  errorTitle: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: SPACING.sm,
  },
  errorText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: SPACING.xl,
  },
  retryBtn: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.xl,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  retryText: {
    color: COLORS.blue,
    fontWeight: '600',
    fontSize: 14,
  },
  emptyText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    color: COLORS.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },

  /* FAB */
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.elevated,
  },
});
