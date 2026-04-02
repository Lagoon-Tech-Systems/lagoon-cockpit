import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
  Alert,
  ActivityIndicator,
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

interface BrandingTheme {
  id: string;
  name: string;
  active: boolean;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  logo_url?: string;
  favicon_url?: string;
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

/* ---------- Helpers ---------- */

function ColorSwatch({ label, color }: { label: string; color?: string }) {
  if (!color) return null;
  return (
    <View style={styles.swatchItem}>
      <View style={[styles.swatchCircle, { backgroundColor: color }]} />
      <View>
        <Text style={styles.swatchLabel}>{label}</Text>
        <Text style={styles.swatchValue}>{color}</Text>
      </View>
    </View>
  );
}

/* ---------- Screen ---------- */

function BrandingDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [theme, setTheme] = useState<BrandingTheme | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchTheme = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<BrandingTheme>(`${ENT_API}/branding/${id}`);
      setTheme(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load theme');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTheme();
  }, [fetchTheme]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTheme(false);
    setRefreshing(false);
  };

  const handleActivate = async () => {
    if (!id) return;
    setActivating(true);
    try {
      await apiFetch(`${ENT_API}/branding/${id}/activate`, { method: 'PUT' });
      await fetchTheme(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to activate theme');
      Alert.alert('Error', message);
    } finally {
      setActivating(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Theme',
      'Are you sure you want to delete this branding theme? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${ENT_API}/branding/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete theme');
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
        <Stack.Screen options={{ title: 'Theme', headerBackTitle: 'Branding' }} />
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
        <Stack.Screen options={{ title: 'Theme', headerBackTitle: 'Branding' }} />
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchTheme()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!theme) return null;

  const hasColors = theme.primary_color || theme.secondary_color || theme.accent_color;

  return (
    <>
      <Stack.Screen
        options={{
          title: theme.name,
          headerBackTitle: 'Branding',
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
              <Text style={styles.headerTitle}>{theme.name}</Text>
              <TouchableOpacity
                onPress={() => router.push(`/manage/branding-create?id=${id}` as any)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="create-outline" size={20} color={COLORS.blue} />
              </TouchableOpacity>
            </View>

            <View style={styles.headerBadges}>
              {theme.active ? (
                <View style={[styles.badge, { backgroundColor: COLORS.green + '20', borderColor: COLORS.green }]}>
                  <Ionicons name="checkmark-circle" size={12} color={COLORS.green} />
                  <Text style={[styles.badgeText, { color: COLORS.green }]}>Active</Text>
                </View>
              ) : (
                <View style={[styles.badge, { backgroundColor: COLORS.textTertiary + '20', borderColor: COLORS.textTertiary }]}>
                  <Text style={[styles.badgeText, { color: COLORS.textTertiary }]}>Inactive</Text>
                </View>
              )}
            </View>

            {/* Activate button */}
            {!theme.active && (
              <TouchableOpacity
                style={styles.activateBtn}
                onPress={handleActivate}
                disabled={activating}
              >
                {activating ? (
                  <ActivityIndicator size="small" color={COLORS.green} />
                ) : (
                  <Ionicons name="flash-outline" size={18} color={COLORS.green} />
                )}
                <Text style={styles.activateBtnText}>
                  {activating ? 'Activating...' : 'Set as Active Theme'}
                </Text>
              </TouchableOpacity>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Colors Card */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Colors</Text>

            {hasColors ? (
              <View style={styles.swatchGrid}>
                <ColorSwatch label="Primary" color={theme.primary_color} />
                <ColorSwatch label="Secondary" color={theme.secondary_color} />
                <ColorSwatch label="Accent" color={theme.accent_color} />
              </View>
            ) : (
              <View style={styles.emptySection}>
                <Ionicons name="color-palette-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptySectionText}>No colors configured</Text>
              </View>
            )}

            {/* Color preview bar */}
            {hasColors && (
              <View style={styles.previewBar}>
                {theme.primary_color && (
                  <View style={[styles.previewSegment, { backgroundColor: theme.primary_color, flex: 3 }]} />
                )}
                {theme.secondary_color && (
                  <View style={[styles.previewSegment, { backgroundColor: theme.secondary_color, flex: 2 }]} />
                )}
                {theme.accent_color && (
                  <View style={[styles.previewSegment, { backgroundColor: theme.accent_color, flex: 1 }]} />
                )}
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Assets Card */}
        <FadeSlideIn delay={200}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Assets</Text>

            {theme.logo_url ? (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Logo URL</Text>
                <Text style={styles.configValue} numberOfLines={2}>{theme.logo_url}</Text>
              </View>
            ) : null}

            {theme.favicon_url ? (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Favicon URL</Text>
                <Text style={styles.configValue} numberOfLines={2}>{theme.favicon_url}</Text>
              </View>
            ) : null}

            {!theme.logo_url && !theme.favicon_url && (
              <View style={styles.emptySection}>
                <Ionicons name="image-outline" size={32} color={COLORS.textTertiary} />
                <Text style={styles.emptySectionText}>No assets configured</Text>
              </View>
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
                {deleting ? 'Deleting...' : 'Delete Theme'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>
      </ScrollView>
    </>
  );
}

export default function BrandingDetailScreen() {
  return (
    <FeatureGate feature="white_label">
      <BrandingDetailContent />
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

  /* Activate button */
  activateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.green + '40',
    backgroundColor: COLORS.green + '10',
  },
  activateBtnText: {
    color: COLORS.green,
    fontSize: 14,
    fontWeight: '600',
  },

  /* Section card */
  sectionCard: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },

  /* Color swatches */
  swatchGrid: {
    gap: SPACING.md,
    marginBottom: SPACING.lg,
  },
  swatchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  swatchCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  swatchLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  swatchValue: {
    color: COLORS.textTertiary,
    fontSize: 11,
    marginTop: 1,
  },

  /* Preview bar */
  previewBar: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  previewSegment: {
    height: 8,
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
