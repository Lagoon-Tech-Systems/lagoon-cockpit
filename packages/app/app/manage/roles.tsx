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

interface CustomRole {
  id: string;
  name: string;
  description?: string;
  is_system?: boolean;
  user_count?: number;
  permissions?: string[];
}

interface RolesListResponse {
  roles: CustomRole[];
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

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

function RolesListContent() {
  const router = useRouter();
  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRoles = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<RolesListResponse>(`${ENT_API}/roles`);
      setRoles(res.roles ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load roles');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRoles(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchRoles();
  };

  const renderRole = ({ item, index }: { item: CustomRole; index: number }) => {
    const userCount = item.user_count ?? 0;

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.7}
          onPress={() => router.push(`/manage/roles-detail?id=${item.id}` as any)}
        >
          <View style={styles.cardBody}>
            {/* Name + system badge */}
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardName} numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_system && (
                <View style={[styles.badge, { backgroundColor: COLORS.orange + '20', borderColor: COLORS.orange }]}>
                  <Ionicons name="lock-closed" size={10} color={COLORS.orange} />
                  <Text style={[styles.badgeText, { color: COLORS.orange }]}>System</Text>
                </View>
              )}
            </View>

            {/* Description */}
            {item.description ? (
              <Text style={styles.cardDescription} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}

            {/* User count */}
            <View style={styles.metaRow}>
              <View style={styles.userCountBadge}>
                <Ionicons name="people-outline" size={12} color={COLORS.textTertiary} />
                <Text style={styles.userCountText}>
                  {userCount} user{userCount !== 1 ? 's' : ''}
                </Text>
              </View>

              {item.permissions && item.permissions.length > 0 && (
                <View style={styles.permCountBadge}>
                  <Ionicons name="shield-checkmark-outline" size={12} color={COLORS.textTertiary} />
                  <Text style={styles.permCountText}>
                    {item.permissions.length} permission{item.permissions.length !== 1 ? 's' : ''}
                  </Text>
                </View>
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
      {/* Loading */}
      {loading && !refreshing && (
        <View style={styles.list}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={styles.skeletonCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SPACING.md }}>
                <View style={{ backgroundColor: COLORS.border, width: 140, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 60, height: 20, borderRadius: 10 }} />
              </View>
              <View style={{ backgroundColor: COLORS.border, width: '80%', height: 12, borderRadius: 4, marginBottom: SPACING.md }} />
              <View style={{ flexDirection: 'row', gap: SPACING.lg }}>
                <View style={{ backgroundColor: COLORS.border, width: 70, height: 14, borderRadius: 4 }} />
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

      {/* Roles list */}
      {!loading && !error && (
        <FlatList
          data={roles}
          renderItem={renderRole}
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
                name="people-outline"
                size={48}
                color={COLORS.textTertiary}
                style={{ marginBottom: SPACING.lg }}
              />
              <Text style={styles.emptyText}>No custom roles</Text>
              <Text style={styles.emptySubtext}>
                Create roles to define granular access control for your team
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — Create Role */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.8}
        onPress={() => router.push('/manage/roles-create' as any)}
      >
        <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
      </TouchableOpacity>
    </View>
  );
}

export default function RolesScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Custom Roles', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="custom_roles">
        <RolesListContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 100 },

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
    marginBottom: SPACING.xs,
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

  /* Description */
  cardDescription: {
    color: COLORS.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: SPACING.md,
  },

  /* Meta row */
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  userCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userCountText: {
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  permCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  permCountText: {
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
