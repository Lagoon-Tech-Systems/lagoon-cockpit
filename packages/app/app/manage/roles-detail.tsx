import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Alert,
  TextInput,
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

interface CustomRole {
  id: string;
  name: string;
  description?: string;
  is_system?: boolean;
  permissions?: string[];
}

interface RoleUser {
  id: string;
  email?: string;
  name?: string;
  assigned_at?: string;
}

interface RoleUsersResponse {
  users: RoleUser[];
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/* ---------- Helpers ---------- */

function formatPermission(perm: string): string {
  return perm
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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

function RolesDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [role, setRole] = useState<CustomRole | null>(null);
  const [users, setUsers] = useState<RoleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [assignEmail, setAssignEmail] = useState('');
  const [assigning, setAssigning] = useState(false);

  const fetchAll = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [roleRes, usersRes] = await Promise.all([
        apiFetch<CustomRole>(`${ENT_API}/roles/${id}`),
        apiFetch<RoleUsersResponse>(`${ENT_API}/roles/${id}/users`),
      ]);
      setRole(roleRes);
      setUsers(usersRes.users ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load role details');
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

  const handleAssignUser = async () => {
    if (!id || !assignEmail.trim()) return;
    setAssigning(true);
    try {
      await apiFetch(`${ENT_API}/roles/${id}/users`, {
        method: 'POST',
        body: JSON.stringify({ email: assignEmail.trim() }),
      });
      setAssignEmail('');
      await fetchAll(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to assign user');
      Alert.alert('Error', message);
    } finally {
      setAssigning(false);
    }
  };

  const handleUnassignUser = (userId: string, userName: string) => {
    Alert.alert(
      'Remove User',
      `Remove ${userName} from this role?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`${ENT_API}/roles/${id}/users/${userId}`, { method: 'DELETE' });
              await fetchAll(false);
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to remove user');
              Alert.alert('Error', message);
            }
          },
        },
      ]
    );
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Role',
      'Are you sure you want to delete this role? All user assignments will be removed. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${ENT_API}/roles/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete role');
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
        <Stack.Screen options={{ title: 'Role', headerBackTitle: 'Roles' }} />
        <View style={styles.container}>
          <View style={{ padding: SPACING.lg }}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={styles.skeletonCard}>
                <View style={{ backgroundColor: COLORS.border, width: 180, height: 16, borderRadius: 4 }} />
                <View style={{ backgroundColor: COLORS.border, width: 100, height: 28, borderRadius: 4, marginTop: SPACING.md }} />
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
        <Stack.Screen options={{ title: 'Role', headerBackTitle: 'Roles' }} />
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

  if (!role) return null;

  const permissions = role.permissions ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: role.name,
          headerBackTitle: 'Roles',
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
              <Text style={styles.headerTitle}>{role.name}</Text>
              {!role.is_system && (
                <TouchableOpacity
                  onPress={() => router.push(`/manage/roles-create?id=${id}` as any)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="create-outline" size={20} color={COLORS.blue} />
                </TouchableOpacity>
              )}
            </View>

            {role.description && (
              <Text style={styles.headerDescription}>{role.description}</Text>
            )}

            <View style={styles.headerBadges}>
              {role.is_system && (
                <View style={[styles.badge, { backgroundColor: COLORS.orange + '20', borderColor: COLORS.orange }]}>
                  <Ionicons name="lock-closed" size={12} color={COLORS.orange} />
                  <Text style={[styles.badgeText, { color: COLORS.orange }]}>System Role</Text>
                </View>
              )}
              <View style={[styles.badge, { backgroundColor: COLORS.blue + '20', borderColor: COLORS.blue }]}>
                <Ionicons name="people-outline" size={12} color={COLORS.blue} />
                <Text style={[styles.badgeText, { color: COLORS.blue }]}>
                  {users.length} user{users.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Permissions Card */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Permissions</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{permissions.length}</Text>
              </View>
            </View>

            {permissions.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="shield-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptySectionText}>No permissions assigned</Text>
              </View>
            ) : (
              <View style={styles.permissionsList}>
                {permissions.map((perm, index) => (
                  <View key={perm} style={[styles.permissionItem, index < permissions.length - 1 && styles.permissionItemBorder]}>
                    <Ionicons name="shield-checkmark-outline" size={14} color={COLORS.green} />
                    <Text style={styles.permissionText}>{formatPermission(perm)}</Text>
                  </View>
                ))}
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Assigned Users Card */}
        <FadeSlideIn delay={200}>
          <GlassCard style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Assigned Users</Text>
              <View style={[styles.countBadge, users.length > 0 && { backgroundColor: COLORS.blue + '20' }]}>
                <Text style={[styles.countBadgeText, users.length > 0 && { color: COLORS.blue }]}>
                  {users.length}
                </Text>
              </View>
            </View>

            {/* Assign user input */}
            <View style={styles.assignRow}>
              <TextInput
                style={styles.assignInput}
                placeholder="User email to assign..."
                placeholderTextColor={COLORS.textTertiary}
                value={assignEmail}
                onChangeText={setAssignEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <TouchableOpacity
                style={[styles.assignBtn, (!assignEmail.trim() || assigning) && styles.assignBtnDisabled]}
                onPress={handleAssignUser}
                disabled={!assignEmail.trim() || assigning}
              >
                <Ionicons name="person-add-outline" size={16} color={COLORS.buttonPrimaryText} />
              </TouchableOpacity>
            </View>

            {users.length === 0 ? (
              <View style={styles.emptySection}>
                <Ionicons name="people-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptySectionText}>No users assigned</Text>
              </View>
            ) : (
              users.map((user, index) => (
                <View key={user.id} style={[styles.userItem, index < users.length - 1 && styles.userItemBorder]}>
                  <View style={styles.userInfo}>
                    <Ionicons name="person-circle-outline" size={16} color={COLORS.blue} />
                    <Text style={styles.userName} numberOfLines={1}>
                      {user.email ?? user.name ?? 'Unknown user'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.unassignBtn}
                    onPress={() => handleUnassignUser(user.id, user.email ?? user.name ?? 'this user')}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.unassignText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        {!role.is_system && (
          <FadeSlideIn delay={300}>
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.deleteBtn]}
                onPress={handleDelete}
                disabled={deleting}
              >
                <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                  {deleting ? 'Deleting...' : 'Delete Role'}
                </Text>
              </TouchableOpacity>
            </View>
          </FadeSlideIn>
        )}
      </ScrollView>
    </>
  );
}

export default function RolesDetailScreen() {
  return (
    <FeatureGate feature="custom_roles">
      <RolesDetailContent />
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
  headerDescription: {
    ...FONT.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: SPACING.sm,
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

  /* Permissions list */
  permissionsList: {},
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  permissionItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  permissionText: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '500',
  },

  /* Assign user */
  assignRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  assignInput: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  assignBtn: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assignBtnDisabled: {
    opacity: 0.5,
  },

  /* User items */
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  userItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  userInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  userName: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  unassignBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.red + '15',
  },
  unassignText: {
    color: COLORS.red,
    fontSize: 11,
    fontWeight: '700',
  },

  /* Empty section */
  emptySection: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptySectionText: {
    color: COLORS.textTertiary,
    fontSize: 13,
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
