import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import Skeleton from '../../src/components/Skeleton';

const PRO_API = '/api/ext/cockpit-pro';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

type Severity = 'critical' | 'high' | 'medium' | 'low';
type IncidentStatus = 'open' | 'investigating' | 'identified' | 'monitoring' | 'resolved';

interface TimelineEntry {
  id: string;
  type: string;
  message: string;
  author: string;
  created_at: string;
}

interface IncidentDetail {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  commander: string | null;
  description: string | null;
  created_at: string;
  resolved_at: string | null;
  timeline: TimelineEntry[];
}

/* ---------- Constants ---------- */

const ALL_STATUSES: IncidentStatus[] = ['open', 'investigating', 'identified', 'monitoring', 'resolved'];

const STATUS_LABELS: Record<IncidentStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

const STATUS_ICONS: Record<IncidentStatus, keyof typeof Ionicons.glyphMap> = {
  open: 'radio-button-on',
  investigating: 'search',
  identified: 'eye',
  monitoring: 'pulse',
  resolved: 'checkmark-circle',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: COLORS.red,
  high: COLORS.orange,
  medium: COLORS.yellow,
  low: COLORS.blue,
};

const SEVERITY_ICONS: Record<Severity, keyof typeof Ionicons.glyphMap> = {
  critical: 'flame',
  high: 'alert-circle',
  medium: 'warning',
  low: 'information-circle',
};

/* ---------- Helpers ---------- */

function formatRelativeTime(timestamp: string): string {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusColor(status: IncidentStatus): string {
  switch (status) {
    case 'open':
      return COLORS.red;
    case 'investigating':
      return COLORS.orange;
    case 'identified':
      return COLORS.yellow;
    case 'monitoring':
      return COLORS.blue;
    case 'resolved':
      return COLORS.green;
    default:
      return COLORS.textSecondary;
  }
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

/* ---------- Status Progression Bar ---------- */

function StatusProgressBar({ currentStatus }: { currentStatus: IncidentStatus }) {
  const currentIndex = ALL_STATUSES.indexOf(currentStatus);

  return (
    <View>
      {/* Dots row */}
      <View style={styles.progressDotsRow}>
        {ALL_STATUSES.map((status, index) => {
          const isCompleted = index <= currentIndex;
          const isCurrent = index === currentIndex;
          const color = getStatusColor(status);

          return (
            <View key={status} style={styles.progressStep}>
              {/* Connector before dot */}
              {index > 0 && (
                <View
                  style={[
                    styles.progressLine,
                    { backgroundColor: isCompleted ? getStatusColor(ALL_STATUSES[index]) : COLORS.border },
                  ]}
                />
              )}

              {/* Step dot */}
              <View
                style={[
                  styles.progressDot,
                  isCompleted && { backgroundColor: color, borderColor: color },
                  isCurrent && SHADOW.glow(color),
                  !isCompleted && { backgroundColor: 'transparent', borderColor: COLORS.border },
                ]}
              >
                {isCurrent && (
                  <Ionicons name={STATUS_ICONS[status]} size={10} color={COLORS.buttonPrimaryText} />
                )}
                {isCompleted && !isCurrent && (
                  <Ionicons name="checkmark" size={10} color={COLORS.buttonPrimaryText} />
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Labels row */}
      <View style={styles.progressLabelsRow}>
        {ALL_STATUSES.map((status, index) => {
          const isCurrent = index === currentIndex;
          const color = getStatusColor(status);
          return (
            <Text
              key={status}
              style={[
                styles.progressLabel,
                isCurrent && { color: color, fontWeight: '700' },
              ]}
              numberOfLines={1}
            >
              {STATUS_LABELS[status]}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

/* ---------- Skeleton ---------- */

function SkeletonDetail() {
  return (
    <View style={{ padding: SPACING.lg }}>
      <View style={styles.skeletonCard}>
        <Skeleton width={200} height={20} borderRadius={4} />
        <View style={{ flexDirection: 'row', gap: SPACING.sm, marginTop: 12 }}>
          <Skeleton width={70} height={24} borderRadius={12} />
          <Skeleton width={90} height={24} borderRadius={12} />
        </View>
        <Skeleton width="100%" height={14} borderRadius={4} style={{ marginTop: 12 }} />
        <Skeleton width={150} height={14} borderRadius={4} style={{ marginTop: 6 }} />
      </View>
      <View style={{ marginTop: SPACING.lg }}>
        <Skeleton width={100} height={16} borderRadius={4} />
        {[0, 1, 2].map((i) => (
          <View key={i} style={[styles.skeletonCard, { marginTop: SPACING.sm }]}>
            <Skeleton width={120} height={12} borderRadius={4} />
            <Skeleton width="100%" height={14} borderRadius={4} style={{ marginTop: 8 }} />
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------- Screen ---------- */

function IncidentDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status update modal
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<IncidentStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Add note
  const [noteText, setNoteText] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState(false);

  const fetchIncident = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<IncidentDetail>(`${PRO_API}/incidents/${id}`);
      setIncident(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load incident');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchIncident();
  }, [fetchIncident]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchIncident(false);
    setRefreshing(false);
  };

  const handleUpdateStatus = async () => {
    if (!selectedStatus || !id) return;
    setUpdatingStatus(true);
    try {
      await apiFetch(`${PRO_API}/incidents/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: selectedStatus,
          message: statusMessage.trim() || undefined,
        }),
      });
      setStatusModalVisible(false);
      setSelectedStatus(null);
      setStatusMessage('');
      await fetchIncident(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to update status');
      Alert.alert('Error', message);
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteText.trim() || !id) return;
    setAddingNote(true);
    try {
      await apiFetch(`${PRO_API}/incidents/${id}/timeline`, {
        method: 'POST',
        body: JSON.stringify({ message: noteText.trim() }),
      });
      setNoteText('');
      await fetchIncident(false);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to add note');
      Alert.alert('Error', message);
    } finally {
      setAddingNote(false);
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Incident',
      'Are you sure you want to delete this incident? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await apiFetch(`${PRO_API}/incidents/${id}`, { method: 'DELETE' });
              router.back();
            } catch (err: unknown) {
              const message = sanitizeErrorMessage(err, 'Failed to delete incident');
              Alert.alert('Error', message);
              setDeleting(false);
            }
          },
        },
      ]
    );
  };

  const getNextStatuses = (): IncidentStatus[] => {
    if (!incident) return [];
    const currentIndex = ALL_STATUSES.indexOf(incident.status);
    // Allow advancing forward or going back one step
    const options: IncidentStatus[] = [];
    if (currentIndex > 0) options.push(ALL_STATUSES[currentIndex - 1]);
    if (currentIndex < ALL_STATUSES.length - 1) options.push(ALL_STATUSES[currentIndex + 1]);
    return options;
  };

  const getTimelineIcon = (type: string): keyof typeof Ionicons.glyphMap => {
    switch (type) {
      case 'status_change':
        return 'swap-horizontal';
      case 'note':
        return 'chatbubble-outline';
      case 'created':
        return 'add-circle-outline';
      default:
        return 'ellipse-outline';
    }
  };

  const getTimelineColor = (type: string): string => {
    switch (type) {
      case 'status_change':
        return COLORS.orange;
      case 'note':
        return COLORS.blue;
      case 'created':
        return COLORS.green;
      default:
        return COLORS.textTertiary;
    }
  };

  /* ---------- Render ---------- */

  const renderHeader = () => {
    if (!incident) return null;
    const sevColor = SEVERITY_COLORS[incident.severity];
    const sevIcon = SEVERITY_ICONS[incident.severity];
    const statColor = getStatusColor(incident.status);

    return (
      <View>
        {/* Header Card */}
        <FadeSlideIn delay={0}>
          <GlassCard style={styles.headerCard} elevated>
            <Text style={styles.headerTitle}>{incident.title}</Text>

            {/* Badges */}
            <View style={styles.headerBadges}>
              <View style={[styles.badge, { backgroundColor: sevColor + '20', borderColor: sevColor }]}>
                <Ionicons name={sevIcon} size={12} color={sevColor} />
                <Text style={[styles.badgeText, { color: sevColor }]}>
                  {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
                </Text>
              </View>

              <View style={[styles.badge, { backgroundColor: statColor + '20', borderColor: statColor }]}>
                <View style={[styles.statusDot, { backgroundColor: statColor }]} />
                <Text style={[styles.badgeText, { color: statColor }]}>
                  {STATUS_LABELS[incident.status]}
                </Text>
              </View>
            </View>

            {/* Description */}
            {incident.description && (
              <Text style={styles.headerDescription}>{incident.description}</Text>
            )}

            {/* Meta */}
            <View style={styles.headerMeta}>
              {incident.commander && (
                <View style={styles.metaItem}>
                  <Ionicons name="person-outline" size={14} color={COLORS.textTertiary} />
                  <Text style={styles.metaText}>
                    Commander: <Text style={{ color: COLORS.textSecondary }}>{incident.commander}</Text>
                  </Text>
                </View>
              )}
              <View style={styles.metaItem}>
                <Ionicons name="time-outline" size={14} color={COLORS.textTertiary} />
                <Text style={styles.metaText}>
                  Created {formatRelativeTime(incident.created_at)}
                </Text>
              </View>
              {incident.resolved_at && (
                <View style={styles.metaItem}>
                  <Ionicons name="checkmark-circle-outline" size={14} color={COLORS.green} />
                  <Text style={[styles.metaText, { color: COLORS.green }]}>
                    Resolved {formatRelativeTime(incident.resolved_at)}
                  </Text>
                </View>
              )}
            </View>
          </GlassCard>
        </FadeSlideIn>

        {/* Status Progression Bar */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.progressCard}>
            <StatusProgressBar currentStatus={incident.status} />
          </GlassCard>
        </FadeSlideIn>

        {/* Action Buttons */}
        <FadeSlideIn delay={200}>
          <View style={styles.actionRow}>
            {incident.status !== 'resolved' && (
              <TouchableOpacity
                style={styles.actionBtn}
                onPress={() => {
                  const next = getNextStatuses();
                  if (next.length > 0) {
                    setSelectedStatus(next[next.length - 1]); // default to forward
                  }
                  setStatusModalVisible(true);
                }}
              >
                <Ionicons name="arrow-forward-circle" size={18} color={COLORS.blue} />
                <Text style={styles.actionBtnText}>Update Status</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionBtn, styles.deleteBtn]}
              onPress={handleDelete}
              disabled={deleting}
            >
              <Ionicons name="trash-outline" size={18} color={COLORS.red} />
              <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                {deleting ? 'Deleting...' : 'Delete'}
              </Text>
            </TouchableOpacity>
          </View>
        </FadeSlideIn>

        {/* Timeline header */}
        <FadeSlideIn delay={300}>
          <Text style={styles.sectionTitle}>Timeline</Text>
        </FadeSlideIn>
      </View>
    );
  };

  const renderTimelineItem = ({ item, index }: { item: TimelineEntry; index: number }) => {
    const icon = getTimelineIcon(item.type);
    const color = getTimelineColor(item.type);

    return (
      <FadeSlideIn delay={350 + index * 50}>
        <View style={styles.timelineItem}>
          {/* Vertical line + dot */}
          <View style={styles.timelineTrack}>
            <View style={[styles.timelineDot, { backgroundColor: color }]}>
              <Ionicons name={icon} size={12} color={COLORS.buttonPrimaryText} />
            </View>
            {index < (incident?.timeline?.length ?? 0) - 1 && (
              <View style={styles.timelineLine} />
            )}
          </View>

          {/* Content */}
          <View style={styles.timelineContent}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineAuthor}>{item.author}</Text>
              <Text style={styles.timelineTime}>{formatRelativeTime(item.created_at)}</Text>
            </View>
            <Text style={styles.timelineMessage}>{item.message}</Text>
          </View>
        </View>
      </FadeSlideIn>
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: incident ? `INC-${incident.id.slice(0, 6).toUpperCase()}` : 'Incident',
          headerBackTitle: 'Incidents',
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        {/* Loading */}
        {loading && !refreshing && <SkeletonDetail />}

        {/* Error */}
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchIncident()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        )}

        {/* Content */}
        {!loading && !error && incident && (
          <>
            <FlatList
              data={incident.timeline ?? []}
              renderItem={renderTimelineItem}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.contentList}
              ListHeaderComponent={renderHeader}
              ListEmptyComponent={
                <View style={styles.emptyTimeline}>
                  <Ionicons name="time-outline" size={32} color={COLORS.textTertiary} />
                  <Text style={styles.emptyTimelineText}>No timeline entries yet</Text>
                </View>
              }
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor={COLORS.blue}
                  colors={[COLORS.blue]}
                  progressBackgroundColor={COLORS.card}
                />
              }
            />

            {/* Add Note Input */}
            <View style={styles.noteInputRow}>
              <TextInput
                style={styles.noteInput}
                placeholder="Add a note..."
                placeholderTextColor={COLORS.textTertiary}
                value={noteText}
                onChangeText={setNoteText}
                multiline
                maxLength={500}
              />
              <TouchableOpacity
                style={[styles.sendBtn, !noteText.trim() && styles.sendBtnDisabled]}
                onPress={handleAddNote}
                disabled={!noteText.trim() || addingNote}
              >
                {addingNote ? (
                  <Ionicons name="hourglass-outline" size={20} color={COLORS.textTertiary} />
                ) : (
                  <Ionicons
                    name="send"
                    size={20}
                    color={noteText.trim() ? COLORS.blue : COLORS.textTertiary}
                  />
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* Status Update Modal */}
        <Modal
          visible={statusModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setStatusModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Update Status</Text>

              {/* Status options */}
              <View style={styles.modalStatusList}>
                {getNextStatuses().map((status) => {
                  const isSelected = selectedStatus === status;
                  const color = getStatusColor(status);
                  return (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.modalStatusOption,
                        isSelected && { backgroundColor: color + '20', borderColor: color },
                      ]}
                      onPress={() => setSelectedStatus(status)}
                    >
                      <Ionicons name={STATUS_ICONS[status]} size={18} color={isSelected ? color : COLORS.textSecondary} />
                      <Text style={[styles.modalStatusText, isSelected && { color }]}>
                        {STATUS_LABELS[status]}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color={color} style={{ marginLeft: 'auto' }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Optional message */}
              <TextInput
                style={styles.modalInput}
                placeholder="Optional message..."
                placeholderTextColor={COLORS.textTertiary}
                value={statusMessage}
                onChangeText={setStatusMessage}
                multiline
                maxLength={300}
              />

              {/* Actions */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => {
                    setStatusModalVisible(false);
                    setSelectedStatus(null);
                    setStatusMessage('');
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalConfirmBtn,
                    !selectedStatus && { opacity: 0.5 },
                  ]}
                  onPress={handleUpdateStatus}
                  disabled={!selectedStatus || updatingStatus}
                >
                  <Text style={styles.modalConfirmText}>
                    {updatingStatus ? 'Updating...' : 'Confirm'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </>
  );
}

export default function IncidentDetailScreen() {
  return (
    <FeatureGate feature="incidents">
      <IncidentDetailContent />
    </FeatureGate>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  contentList: { padding: SPACING.lg, paddingBottom: 100 },

  /* Header card */
  headerCard: {
    marginBottom: SPACING.md,
  },
  headerTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  headerBadges: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
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
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerDescription: {
    ...FONT.body,
    color: COLORS.textSecondary,
    lineHeight: 22,
    marginBottom: SPACING.md,
  },
  headerMeta: {
    gap: SPACING.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },

  /* Status progression */
  progressCard: {
    marginBottom: SPACING.md,
  },
  progressDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressStep: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressLine: {
    flex: 1,
    height: 2,
  },
  progressDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressLabelsRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  progressLabel: {
    flex: 1,
    fontSize: 9,
    color: COLORS.textTertiary,
    textAlign: 'center',
    fontWeight: '600',
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
  deleteBtn: {
    flex: 0,
    paddingHorizontal: SPACING.lg,
  },

  /* Section title */
  sectionTitle: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },

  /* Timeline */
  timelineItem: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  timelineTrack: {
    width: 32,
    alignItems: 'center',
  },
  timelineDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.border,
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    paddingLeft: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  timelineAuthor: {
    ...FONT.bodyMedium,
    color: COLORS.textSecondary,
    fontSize: 13,
  },
  timelineTime: {
    color: COLORS.textTertiary,
    fontSize: 11,
  },
  timelineMessage: {
    ...FONT.body,
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 20,
  },
  emptyTimeline: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    gap: SPACING.sm,
  },
  emptyTimelineText: {
    color: COLORS.textTertiary,
    fontSize: 13,
  },

  /* Note input */
  noteInputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? SPACING.xxl : SPACING.md,
    backgroundColor: COLORS.card,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    gap: SPACING.sm,
  },
  noteInput: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    color: COLORS.textPrimary,
    fontSize: 14,
    maxHeight: 80,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendBtnDisabled: {
    opacity: 0.5,
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
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

  /* Modal */
  modalOverlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.card,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: SPACING.lg,
  },
  modalTitle: {
    ...FONT.title,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
  },
  modalStatusList: {
    gap: SPACING.sm,
    marginBottom: SPACING.lg,
  },
  modalStatusOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  modalStatusText: {
    ...FONT.bodyMedium,
    color: COLORS.textSecondary,
  },
  modalInput: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    color: COLORS.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 80,
    marginBottom: SPACING.lg,
  },
  modalActions: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalCancelText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 15,
  },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.blue,
    alignItems: 'center',
  },
  modalConfirmText: {
    color: COLORS.buttonPrimaryText,
    fontWeight: '700',
    fontSize: 15,
  },
});
