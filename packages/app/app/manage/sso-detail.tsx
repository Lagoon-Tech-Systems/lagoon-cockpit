import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withDelay, Easing } from 'react-native-reanimated';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

interface SsoProvider {
  id: string;
  name: string;
  type: 'saml' | 'oidc';
  enabled: boolean;
  entity_id?: string;
  sso_url?: string;
  certificate?: string;
  redirect_uri?: string;
  metadata_url?: string;
}

interface SsoSession {
  id: string;
  user_email?: string;
  user_name?: string;
  created_at: string;
  last_active?: string;
  ip_address?: string;
}

interface SessionsResponse {
  sessions: SsoSession[];
}

interface MetadataResponse {
  metadata_url: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

const TYPE_COLORS: Record<string, string> = {
  saml: COLORS.purple,
  oidc: COLORS.blue,
};

/* ---------- Helpers ---------- */

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

/* ---------- Screen ---------- */

function SsoDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [provider, setProvider] = useState<SsoProvider | null>(null);
  const [sessions, setSessions] = useState<SsoSession[]>([]);
  const [metadataUrl, setMetadataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [provRes, sessRes, metaRes] = await Promise.all([
        apiFetch<SsoProvider>(`${ENT_API}/sso/providers/${id}`),
        apiFetch<SessionsResponse>(`${ENT_API}/sso/sessions`),
        apiFetch<MetadataResponse>(`${ENT_API}/sso/metadata`).catch(() => null),
      ]);
      setProvider(provRes);
      setSessions(sessRes.sessions ?? []);
      if (metaRes) setMetadataUrl(metaRes.metadata_url);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load SSO provider');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll(false);
    setRefreshing(false);
  };

  const handleToggle = async () => {
    if (!id || !provider) return;
    setToggling(true);
    try {
      await apiFetch(`${ENT_API}/sso/providers/${id}/toggle`, { method: 'PUT' });
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to toggle provider');
      Alert.alert('Error', message);
    } finally {
      setToggling(false);
    }
  };

  const handleRevokeSession = (sessionId: string) => {
    Alert.alert(
      'Revoke Session',
      'Are you sure you want to revoke this session? The user will need to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`${ENT_API}/sso/sessions/${sessionId}`, { method: 'DELETE' });
              await fetchAll(false);
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to revoke session');
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete SSO Provider',
      'Are you sure you want to delete this provider? All active sessions will be terminated. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${ENT_API}/sso/providers/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete provider');
              Alert.alert('Error', message);
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  /* ---------- Render ---------- */

  if (loading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ title: 'SSO Provider', headerBackTitle: 'SSO' }} />
        <View style={styles.container}>
          <View style={{ padding: SPACING.lg }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={{ backgroundColor: COLORS.border, width: 180, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 100, height: 28, borderRadius: 4, marginTop: SPACING.md }} />
                <View style={{ backgroundColor: COLORS.border, width: '100%', height: 6, borderRadius: 3, marginTop: SPACING.md }} />
              </View>
            ))}
          </View>
        </View>
      </>
    );
  }

  if (!loading && error) {
    return (
      <>
        <Stack.Screen options={{ title: 'SSO Provider', headerBackTitle: 'SSO' }} />
        <View style={styles.container}>
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchAll()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!provider) return null;

  const typeColor = TYPE_COLORS[provider.type] ?? COLORS.blue;

  return (
    <>
      <Stack.Screen
        options={{
          title: provider.name,
          headerBackTitle: 'SSO',
        }}
      />

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={COLORS.blue}
            colors={[COLORS.blue]}
            progressBackgroundColor={COLORS.card}
          />
        }
      >
        {/* Header Card */}
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.headerCard} elevated>
            <View style={styles.headerTopRow}>
              <Text style={styles.headerTitle}>{provider.name}</Text>
              <TouchableOpacity
                onPress={() => router.push(`/manage/sso-create?id=${id}` as any)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="create-outline" size={20} color={COLORS.blue} />
              </TouchableOpacity>
            </View>

            <View style={styles.headerBadges}>
              <View style={[styles.badge, { backgroundColor: typeColor + '20', borderColor: typeColor }]}>
                <Ionicons name="key-outline" size={12} color={typeColor} />
                <Text style={[styles.badgeText, { color: typeColor }]}>
                  {provider.type.toUpperCase()}
                </Text>
              </View>
              <View style={[
                styles.badge,
                {
                  backgroundColor: (provider.enabled ? COLORS.green : COLORS.textTertiary) + '20',
                  borderColor: provider.enabled ? COLORS.green : COLORS.textTertiary,
                },
              ]}>
                <Ionicons
                  name={provider.enabled ? 'checkmark-circle' : 'close-circle'}
                  size={12}
                  color={provider.enabled ? COLORS.green : COLORS.textTertiary}
                />
                <Text style={[styles.badgeText, { color: provider.enabled ? COLORS.green : COLORS.textTertiary }]}>
                  {provider.enabled ? 'Enabled' : 'Disabled'}
                </Text>
              </View>
            </View>

            {/* Toggle button */}
            <TouchableOpacity
              style={[styles.toggleBtn, provider.enabled && styles.toggleBtnActive]}
              onPress={handleToggle}
              disabled={toggling}
            >
              {toggling ? (
                <ActivityIndicator size="small" color={provider.enabled ? COLORS.red : COLORS.green} />
              ) : (
                <Ionicons
                  name={provider.enabled ? 'pause-circle-outline' : 'play-circle-outline'}
                  size={18}
                  color={provider.enabled ? COLORS.red : COLORS.green}
                />
              )}
              <Text style={[styles.toggleBtnText, { color: provider.enabled ? COLORS.red : COLORS.green }]}>
                {toggling ? 'Updating...' : provider.enabled ? 'Disable' : 'Enable'}
              </Text>
            </TouchableOpacity>
          </GlassCard>
        </FadeSlideIn>

        {/* Configuration Card */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Configuration</Text>

            {provider.entity_id && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Entity ID</Text>
                <Text style={styles.configValue} numberOfLines={2}>{provider.entity_id}</Text>
              </View>
            )}
            {provider.sso_url && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>SSO URL</Text>
                <Text style={styles.configValue} numberOfLines={2}>{provider.sso_url}</Text>
              </View>
            )}
            {provider.redirect_uri && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Redirect URI</Text>
                <Text style={styles.configValue} numberOfLines={2}>{provider.redirect_uri}</Text>
              </View>
            )}
            {metadataUrl && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Metadata URL</Text>
                <Text style={styles.configValue} numberOfLines={2}>{metadataUrl}</Text>
              </View>
            )}
            {provider.certificate && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Certificate</Text>
                <Text style={styles.configValueMono} numberOfLines={3}>
                  {provider.certificate.substring(0, 80)}...
                </Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Active Sessions */}
        <FadeSlideIn delay={200}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Active Sessions</Text>
              <View style={[styles.countBadge, sessions.length > 0 && { backgroundColor: COLORS.blue + '20' }]}>
                <Text style={[styles.countBadgeText, sessions.length > 0 && { color: COLORS.blue }]}>
                  {sessions.length}
                </Text>
              </View>
            </View>

            {sessions.length === 0 ? (
              <View style={styles.emptySessions}>
                <Ionicons name="people-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptySessionText}>No active sessions</Text>
              </View>
            ) : (
              sessions.slice(0, 20).map((session, index) => (
                <View key={session.id} style={[styles.sessionItem, index < sessions.length - 1 && styles.sessionItemBorder]}>
                  <View style={styles.sessionHeader}>
                    <Ionicons name="person-circle-outline" size={16} color={COLORS.blue} />
                    <Text style={styles.sessionUser} numberOfLines={1}>
                      {session.user_email ?? session.user_name ?? 'Unknown user'}
                    </Text>
                  </View>
                  <View style={styles.sessionDetails}>
                    <Text style={styles.sessionTime}>
                      {formatDateTime(session.created_at)}
                    </Text>
                    {session.ip_address && (
                      <Text style={styles.sessionIp}>{session.ip_address}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={styles.revokeBtn}
                    onPress={() => handleRevokeSession(session.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.revokeText}>Revoke</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        <FadeSlideIn delay={300}>
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.red} />
              <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                {deleting ? 'Deleting...' : 'Delete Provider'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </>
  );
}

export default function SsoDetailScreen() {
  return (
    <FeatureGate feature="sso_saml">
      <SsoDetailContent />
    </FeatureGate>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: SPACING.lg, paddingBottom: 100 },

  /* Header card */
  headerCard: {
    marginBottom: SPACING.md,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  headerTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    flex: 1,
    marginRight: SPACING.md,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
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

  /* Toggle button */
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  toggleBtnActive: {},
  toggleBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },

  /* Section card */
  sectionCard: {
    marginBottom: SPACING.md,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },

  /* Config rows */
  configRow: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  configLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  configValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  configValueMono: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },

  /* Sessions */
  countBadge: {
    backgroundColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  countBadgeText: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptySessions: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptySessionText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  sessionItem: {
    paddingVertical: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
  },
  sessionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
  },
  sessionUser: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  sessionDetails: {
    alignItems: 'flex-end',
    marginRight: SPACING.md,
  },
  sessionTime: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  sessionIp: {
    color: COLORS.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },
  revokeBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.red + '15',
  },
  revokeText: {
    color: COLORS.red,
    fontSize: 11,
    fontWeight: '700',
  },

  /* Action buttons */
  actionRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.xl,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: COLORS.card,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  actionBtnText: {
    color: COLORS.blue,
    fontSize: 14,
    fontWeight: '600',
  },
  deleteBtn: {},

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  /* Error / Center */
  errorCard: {
    marginHorizontal: SPACING.lg,
    marginTop: 60,
  },
  centerContainer: {
    alignItems: 'center',
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
});
