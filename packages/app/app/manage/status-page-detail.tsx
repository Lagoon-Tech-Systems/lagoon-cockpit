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
  TextInput,
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

type ComponentStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

interface StatusComponent {
  id: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
}

interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  custom_domain: string | null;
  is_public: boolean;
  components?: StatusComponent[];
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

const STATUS_COLORS: Record<ComponentStatus, string> = {
  operational: COLORS.green,
  degraded: COLORS.yellow,
  partial_outage: COLORS.orange,
  major_outage: COLORS.red,
  maintenance: COLORS.blue,
};

const STATUS_LABELS: Record<ComponentStatus, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  partial_outage: 'Partial Outage',
  major_outage: 'Major Outage',
  maintenance: 'Maintenance',
};

const ALL_STATUSES: ComponentStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
];

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

function StatusPageDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [page, setPage] = useState<StatusPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingComponent, setAddingComponent] = useState(false);
  const [newComponentName, setNewComponentName] = useState('');
  const [savingComponent, setSavingComponent] = useState(false);
  const [deletingPage, setDeletingPage] = useState(false);

  const fetchPage = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<StatusPage>(`${PRO_API}/status-pages/${id}`);
      setPage(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load status page');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchPage();
  }, [fetchPage]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPage(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchPage();
  };

  const handleChangeStatus = (comp: StatusComponent) => {
    const options = ALL_STATUSES.filter((s) => s !== comp.status);
    Alert.alert(
      `Update ${comp.name}`,
      'Select new status:',
      [
        ...options.map((status) => ({
          text: STATUS_LABELS[status],
          onPress: async () => {
            try {
              await apiFetch(`${PRO_API}/status-pages/${id}/components/${comp.id}`, {
                method: 'PUT',
                body: JSON.stringify({ status }),
              });
              fetchPage(false);
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to update component');
              Alert.alert('Error', message);
            }
          },
        })),
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleAddComponent = async () => {
    if (!newComponentName.trim()) return;
    setSavingComponent(true);
    try {
      await apiFetch(`${PRO_API}/status-pages/${id}/components`, {
        method: 'POST',
        body: JSON.stringify({ name: newComponentName.trim() }),
      });
      setNewComponentName('');
      setAddingComponent(false);
      fetchPage(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to add component');
      Alert.alert('Error', message);
    } finally {
      setSavingComponent(false);
    }
  };

  const handleDeleteComponent = (comp: StatusComponent) => {
    Alert.alert(
      'Delete Component',
      `Are you sure you want to delete "${comp.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiFetch(`${PRO_API}/status-pages/${id}/components/${comp.id}`, {
                method: 'DELETE',
              });
              fetchPage(false);
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete component');
              Alert.alert('Error', message);
            }
          },
        },
      ],
    );
  };

  const handleDeletePage = () => {
    if (!page) return;
    Alert.alert(
      'Delete Status Page',
      `Are you sure you want to delete "${page.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingPage(true);
            try {
              await apiFetch(`${PRO_API}/status-pages/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete status page');
              Alert.alert('Error', message);
              setDeletingPage(false);
            }
          },
        },
      ],
    );
  };

  /* Loading state */
  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </View>
    );
  }

  /* Error state */
  if (!loading && error) {
    return (
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
            <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </View>
    );
  }

  if (!page) return null;

  const components = page.components ?? [];

  return (
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
        <View style={styles.headerCard}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>{page.name}</Text>
            <TouchableOpacity
              onPress={() => router.push(`/manage/status-page-create?id=${id}` as any)}
              hitSlop={8}
            >
              <Ionicons name="pencil-outline" size={20} color={COLORS.blue} />
            </TouchableOpacity>
          </View>

          <Text style={styles.slugLabel}>/{page.slug}</Text>

          {page.description ? (
            <Text style={styles.description}>{page.description}</Text>
          ) : null}

          <View style={styles.headerMeta}>
            {/* Visibility */}
            <View style={styles.metaChip}>
              <Ionicons
                name={page.is_public ? 'globe-outline' : 'lock-closed-outline'}
                size={14}
                color={page.is_public ? COLORS.green : COLORS.textTertiary}
              />
              <Text
                style={[
                  styles.metaChipText,
                  { color: page.is_public ? COLORS.green : COLORS.textTertiary },
                ]}
              >
                {page.is_public ? 'Public' : 'Private'}
              </Text>
            </View>

            {/* Custom domain */}
            {page.custom_domain ? (
              <View style={styles.metaChip}>
                <Ionicons name="link-outline" size={14} color={COLORS.teal} />
                <Text style={[styles.metaChipText, { color: COLORS.teal }]}>
                  {page.custom_domain}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </FadeSlideIn>

      {/* Components Section */}
      <FadeSlideIn delay={100}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Components</Text>
          <TouchableOpacity onPress={() => setAddingComponent(true)} hitSlop={8}>
            <Ionicons name="add-circle-outline" size={22} color={COLORS.blue} />
          </TouchableOpacity>
        </View>
      </FadeSlideIn>

      {/* Add component inline form */}
      {addingComponent && (
        <FadeSlideIn delay={0}>
          <View style={styles.addComponentCard}>
            <TextInput
              style={styles.addInput}
              placeholder="Component name"
              placeholderTextColor={COLORS.textTertiary}
              value={newComponentName}
              onChangeText={setNewComponentName}
              autoFocus
            />
            <View style={styles.addActions}>
              <TouchableOpacity
                style={styles.addCancelBtn}
                onPress={() => {
                  setAddingComponent(false);
                  setNewComponentName('');
                }}
              >
                <Text style={styles.addCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.addSaveBtn,
                  !newComponentName.trim() && { opacity: 0.5 },
                ]}
                onPress={handleAddComponent}
                disabled={!newComponentName.trim() || savingComponent}
              >
                {savingComponent ? (
                  <ActivityIndicator size="small" color={COLORS.buttonPrimaryText} />
                ) : (
                  <Text style={styles.addSaveText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </FadeSlideIn>
      )}

      {/* Component list */}
      {components.length === 0 && !addingComponent ? (
        <FadeSlideIn delay={150}>
          <View style={styles.emptyComponents}>
            <Ionicons
              name="layers-outline"
              size={36}
              color={COLORS.textTertiary}
              style={{ marginBottom: SPACING.sm }}
            />
            <Text style={styles.emptyText}>No components yet</Text>
            <Text style={styles.emptySubtext}>
              Add components to track the status of your services
            </Text>
          </View>
        </FadeSlideIn>
      ) : (
        components.map((comp, index) => {
          const statusColor = STATUS_COLORS[comp.status];
          return (
            <FadeSlideIn key={comp.id} delay={150 + index * 50}>
              <View style={styles.componentCard}>
                <TouchableOpacity
                  style={styles.componentMain}
                  activeOpacity={0.7}
                  onPress={() => handleChangeStatus(comp)}
                >
                  <View style={[styles.componentDot, { backgroundColor: statusColor }]} />
                  <View style={styles.componentInfo}>
                    <Text style={styles.componentName} numberOfLines={1}>
                      {comp.name}
                    </Text>
                    {comp.description ? (
                      <Text style={styles.componentDesc} numberOfLines={1}>
                        {comp.description}
                      </Text>
                    ) : null}
                  </View>
                  <View
                    style={[
                      styles.statusBadge,
                      { backgroundColor: statusColor + '20', borderColor: statusColor },
                    ]}
                  >
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                      {STATUS_LABELS[comp.status]}
                    </Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteComponentBtn}
                  onPress={() => handleDeleteComponent(comp)}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                </TouchableOpacity>
              </View>
            </FadeSlideIn>
          );
        })
      )}

      {/* Danger Zone */}
      <FadeSlideIn delay={300}>
        <View style={styles.dangerSection}>
          <Text style={styles.dangerTitle}>Danger Zone</Text>
          <TouchableOpacity
            style={styles.deletePageBtn}
            onPress={handleDeletePage}
            disabled={deletingPage}
          >
            {deletingPage ? (
              <ActivityIndicator size="small" color={COLORS.red} />
            ) : (
              <>
                <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                <Text style={styles.deletePageText}>Delete Status Page</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </FadeSlideIn>
    </ScrollView>
  );
}

export default function StatusPageDetailScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Status Page', headerBackTitle: 'Back' }} />
      <FeatureGate feature="status_pages">
        <StatusPageDetailContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: SPACING.lg, paddingBottom: 100 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },

  /* Header card */
  headerCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOW.card,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  headerTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    flex: 1,
  },
  slugLabel: {
    fontSize: 13,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  description: {
    ...FONT.body,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  headerMeta: {
    flexDirection: 'row',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.bg,
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: '600',
  },

  /* Section */
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...FONT.label,
    color: COLORS.textSecondary,
  },

  /* Component card */
  componentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  componentMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  componentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  componentInfo: {
    flex: 1,
  },
  componentName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  componentDesc: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  deleteComponentBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },

  /* Add component */
  addComponentCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.blue,
  },
  addInput: {
    ...FONT.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
  },
  addCancelBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.bg,
  },
  addCancelText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
  addSaveBtn: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.blue,
  },
  addSaveText: {
    color: COLORS.buttonPrimaryText,
    fontWeight: '600',
    fontSize: 14,
  },

  /* Empty components */
  emptyComponents: {
    alignItems: 'center',
    paddingVertical: 40,
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

  /* Danger zone */
  dangerSection: {
    marginTop: SPACING.xxxl,
    paddingTop: SPACING.lg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  dangerTitle: {
    ...FONT.label,
    color: COLORS.red,
    marginBottom: SPACING.md,
  },
  deletePageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: 12,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.red + '40',
    backgroundColor: COLORS.red + '10',
  },
  deletePageText: {
    color: COLORS.red,
    fontWeight: '600',
    fontSize: 14,
  },

  /* Error */
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
});
