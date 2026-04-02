import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withDelay, withTiming, Easing } from 'react-native-reanimated';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';

/* ---------- types ---------- */

interface Channel {
  id: string;
  name: string;
  platform: 'telegram' | 'slack';
  config: Record<string, unknown>;
  subscribed_events: string[];
  enabled: boolean;
  created_at: string;
}

interface Message {
  id: string;
  channel_id: string;
  channel_name?: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  status: 'sent' | 'failed';
  error: string | null;
  created_at: string;
}

/* ---------- constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

type TabKey = 'channels' | 'messages';

const PLATFORM_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  telegram: 'paper-plane',
  slack: 'chatbubbles',
};

const EVENT_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  sent: { bg: COLORS.successBg, text: COLORS.successText },
  failed: { bg: COLORS.dangerBg, text: COLORS.dangerText },
};

/* ---------- helpers ---------- */

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
  });
}

function formatEventType(event: string): string {
  return event
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/* ---------- skeleton ---------- */

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, { width: '60%', height: 14 }]} />
      <View style={[styles.skeletonLine, { width: '80%', height: 12, marginTop: 8 }]} />
      <View style={[styles.skeletonLine, { width: '40%', height: 12, marginTop: 6 }]} />
    </View>
  );
}

/* ---------- staggered animation ---------- */

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

/* ---------- component ---------- */

function ChatOpsContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('channels');
  const [channels, setChannels] = useState<Channel[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  /* build a channel name lookup for messages */
  const channelNameMap = useCallback(() => {
    const map: Record<string, string> = {};
    channels.forEach((c) => {
      map[c.id] = c.name;
    });
    return map;
  }, [channels]);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [channelsRes, messagesRes] = await Promise.all([
        apiFetch<{ channels: Channel[] }>(`${PRO_API}/chatops/channels`),
        /* Fetch recent messages across all channels — grab the first channel's messages
           or use a general endpoint. We'll fetch per-channel and merge. */
        apiFetch<{ channels: Channel[] }>(`${PRO_API}/chatops/channels`).then(async (res) => {
          const allMessages: Message[] = [];
          const chans = res.channels ?? [];
          /* Fetch last 10 messages per channel (max 5 channels to limit requests) */
          const toFetch = chans.slice(0, 5);
          const results = await Promise.allSettled(
            toFetch.map((ch) =>
              apiFetch<{ messages: Message[] }>(
                `${PRO_API}/chatops/channels/${ch.id}/messages?limit=10`
              ).then((r) =>
                (r.messages ?? []).map((m) => ({ ...m, channel_name: ch.name }))
              )
            )
          );
          results.forEach((r) => {
            if (r.status === 'fulfilled') allMessages.push(...r.value);
          });
          allMessages.sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          return allMessages;
        }),
      ]);
      setChannels(channelsRes.channels ?? []);
      setMessages(messagesRes);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  /* send test message */
  const handleTest = async (channel: Channel) => {
    setTestingId(channel.id);
    try {
      await apiFetch(`${PRO_API}/chatops/channels/${channel.id}/test`, {
        method: 'POST',
      });
      Alert.alert('Success', `Test message sent to "${channel.name}".`);
    } catch (e: any) {
      Alert.alert('Test Failed', e.message);
    } finally {
      setTestingId(null);
    }
  };

  /* delete channel */
  const handleDelete = (channel: Channel) => {
    Alert.alert('Delete Channel', `Remove "${channel.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`${PRO_API}/chatops/channels/${channel.id}`, {
              method: 'DELETE',
            });
            setChannels((prev) => prev.filter((c) => c.id !== channel.id));
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  /* status dot color */
  const getStatusDotColor = (channel: Channel): string => {
    if (!channel.enabled) return COLORS.textTertiary;
    /* Check if channel has any messages — simple heuristic: if messages list includes this channel */
    const hasMessages = messages.some((m) => m.channel_id === channel.id);
    return hasMessages ? COLORS.green : COLORS.yellow;
  };

  /* ---------- render: error ---------- */
  if (error && !loading) {
    return (
      <View style={styles.centered}>
        <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
          <Text style={styles.retryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  /* ---------- render: loading ---------- */
  if (loading) {
    return (
      <View style={styles.container}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* -------- Segmented Control -------- */}
      <View style={styles.segmentedControl}>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'channels' && styles.segmentActive]}
          onPress={() => setActiveTab('channels')}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={16}
            color={activeTab === 'channels' ? COLORS.textPrimary : COLORS.textTertiary}
          />
          <Text
            style={[styles.segmentText, activeTab === 'channels' && styles.segmentTextActive]}
          >
            Channels
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.segment, activeTab === 'messages' && styles.segmentActive]}
          onPress={() => setActiveTab('messages')}
        >
          <Ionicons
            name="mail-outline"
            size={16}
            color={activeTab === 'messages' ? COLORS.textPrimary : COLORS.textTertiary}
          />
          <Text
            style={[styles.segmentText, activeTab === 'messages' && styles.segmentTextActive]}
          >
            Messages
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollArea}
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
        {activeTab === 'channels' ? (
          /* ========== CHANNELS TAB ========== */
          <>
            {channels.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="chatbubble-ellipses-outline" size={48} color={COLORS.textTertiary} />
                <Text style={styles.emptyText}>No channels configured</Text>
                <Text style={styles.emptySubtext}>
                  Add a Telegram or Slack channel to receive alerts
                </Text>
              </View>
            ) : (
              channels.map((channel, index) => {
                const platformIcon = PLATFORM_ICONS[channel.platform] || 'chatbubbles';
                const dotColor = getStatusDotColor(channel);
                const isTesting = testingId === channel.id;

                return (
                  <FadeSlideIn key={channel.id} delay={index * 50}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() =>
                        router.push(`/manage/chatops-create?id=${channel.id}` as any)
                      }
                    >
                      <GlassCard style={styles.channelCard}>
                        <View style={styles.channelHeader}>
                          {/* Platform icon + status dot */}
                          <View style={styles.channelIconWrap}>
                            <Ionicons name={platformIcon} size={20} color={COLORS.blue} />
                            <View
                              style={[styles.statusDotAbsolute, { backgroundColor: dotColor }]}
                            />
                          </View>

                          {/* Info */}
                          <View style={styles.channelInfo}>
                            <Text style={styles.channelName} numberOfLines={1}>
                              {channel.name}
                            </Text>
                            <View style={styles.channelMeta}>
                              {/* Platform badge */}
                              <View style={styles.platformBadge}>
                                <Text style={styles.platformBadgeText}>
                                  {channel.platform.toUpperCase()}
                                </Text>
                              </View>

                              {/* Enabled/disabled badge */}
                              <View
                                style={[
                                  styles.enabledBadge,
                                  {
                                    backgroundColor: channel.enabled
                                      ? COLORS.green + '20'
                                      : COLORS.textTertiary + '20',
                                    borderColor: channel.enabled
                                      ? COLORS.green
                                      : COLORS.textTertiary,
                                  },
                                ]}
                              >
                                <View
                                  style={[
                                    styles.enabledDot,
                                    {
                                      backgroundColor: channel.enabled
                                        ? COLORS.green
                                        : COLORS.textTertiary,
                                    },
                                  ]}
                                />
                                <Text
                                  style={[
                                    styles.enabledBadgeText,
                                    {
                                      color: channel.enabled
                                        ? COLORS.green
                                        : COLORS.textTertiary,
                                    },
                                  ]}
                                >
                                  {channel.enabled ? 'Active' : 'Disabled'}
                                </Text>
                              </View>

                              {/* Event count */}
                              {channel.subscribed_events?.length > 0 && (
                                <View style={styles.eventCountBadge}>
                                  <Text style={styles.eventCountText}>
                                    {channel.subscribed_events.length} event
                                    {channel.subscribed_events.length !== 1 ? 's' : ''}
                                  </Text>
                                </View>
                              )}
                            </View>
                          </View>

                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={COLORS.textTertiary}
                            style={{ alignSelf: 'center' }}
                          />
                        </View>

                        {/* Actions row */}
                        <View style={styles.channelActions}>
                          <TouchableOpacity
                            style={styles.actionBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              handleTest(channel);
                            }}
                            disabled={isTesting}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            {isTesting ? (
                              <ActivityIndicator size="small" color={COLORS.blue} />
                            ) : (
                              <>
                                <Ionicons name="send-outline" size={14} color={COLORS.blue} />
                                <Text style={styles.actionBtnText}>Test</Text>
                              </>
                            )}
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.actionBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              handleDelete(channel);
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={14} color={COLORS.red} />
                            <Text style={[styles.actionBtnText, { color: COLORS.red }]}>
                              Delete
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </GlassCard>
                    </TouchableOpacity>
                  </FadeSlideIn>
                );
              })
            )}
          </>
        ) : (
          /* ========== MESSAGES TAB ========== */
          <>
            {messages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="mail-outline" size={48} color={COLORS.textTertiary} />
                <Text style={styles.emptyText}>No messages yet</Text>
                <Text style={styles.emptySubtext}>
                  Messages will appear here when events are dispatched
                </Text>
              </View>
            ) : (
              messages.map((msg, index) => {
                const statusColor =
                  EVENT_STATUS_COLORS[msg.status] || EVENT_STATUS_COLORS.failed;
                const nameMap = channelNameMap();
                const chanName = msg.channel_name || nameMap[msg.channel_id] || 'Unknown';

                return (
                  <FadeSlideIn key={msg.id} delay={index * 30}>
                    <GlassCard style={styles.messageCard}>
                      <View style={styles.messageHeader}>
                        <View style={styles.messageLeft}>
                          <Ionicons
                            name="chatbubble-outline"
                            size={16}
                            color={COLORS.textSecondary}
                          />
                          <Text style={styles.messageChanName} numberOfLines={1}>
                            {chanName}
                          </Text>
                        </View>
                        <View
                          style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}
                        >
                          <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
                            {msg.status.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.messageBody}>
                        <View style={styles.eventTypeBadge}>
                          <Text style={styles.eventTypeText}>
                            {formatEventType(msg.event_type)}
                          </Text>
                        </View>
                        <View style={styles.messageMetaRow}>
                          <Ionicons
                            name="time-outline"
                            size={12}
                            color={COLORS.textTertiary}
                          />
                          <Text style={styles.messageTime}>
                            {formatRelativeTime(msg.created_at)}
                          </Text>
                        </View>
                      </View>

                      {msg.error && (
                        <View style={styles.errorBox}>
                          <Ionicons
                            name="warning-outline"
                            size={14}
                            color={COLORS.dangerText}
                          />
                          <Text style={styles.errorMessage}>{msg.error}</Text>
                        </View>
                      )}
                    </GlassCard>
                  </FadeSlideIn>
                );
              })
            )}
          </>
        )}

        <View style={{ height: 80 }} />
      </ScrollView>

      {/* -------- FAB (channels tab only) -------- */}
      {activeTab === 'channels' && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push('/manage/chatops-create' as any)}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/* ---------- exported screen with gate ---------- */

export default function ChatOpsScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'ChatOps', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="chatops">
        <ChatOpsContent />
      </FeatureGate>
    </>
  );
}

/* ---------- styles ---------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    padding: SPACING.lg,
  },

  /* segmented control */
  segmentedControl: {
    flexDirection: 'row',
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
  },
  segmentActive: {
    backgroundColor: COLORS.cardElevated,
    ...SHADOW.card,
  },
  segmentText: {
    ...FONT.bodyMedium,
    color: COLORS.textTertiary,
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
  },

  /* channel cards */
  channelCard: {
    marginBottom: SPACING.md,
  },
  channelHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  channelIconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.blueGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
    position: 'relative',
  },
  statusDotAbsolute: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.card,
  },
  channelInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  channelName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  channelMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    alignItems: 'center',
  },
  platformBadge: {
    backgroundColor: COLORS.blueGlow,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 6,
  },
  platformBadgeText: {
    ...FONT.label,
    fontSize: 9,
    color: COLORS.blue,
    letterSpacing: 0.8,
  },
  enabledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  enabledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  enabledBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  eventCountBadge: {
    backgroundColor: COLORS.card,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventCountText: {
    fontSize: 10,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },

  /* channel actions */
  channelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.blue,
  },

  /* message cards */
  messageCard: {
    marginBottom: SPACING.md,
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  messageLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: SPACING.sm,
  },
  messageChanName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  messageBody: {
    marginTop: SPACING.sm,
  },
  eventTypeBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.blueGlow,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: SPACING.sm,
  },
  eventTypeText: {
    ...FONT.mono,
    fontSize: 11,
    color: COLORS.blue,
  },
  messageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  messageTime: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: SPACING.sm,
    backgroundColor: COLORS.red + '14',
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
  },
  errorMessage: {
    flex: 1,
    fontSize: 12,
    color: COLORS.dangerText,
  },

  /* FAB */
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.elevated,
  },

  /* empty state */
  emptyContainer: {
    alignItems: 'center',
    marginVertical: 48,
  },
  emptyText: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    ...FONT.body,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },

  /* error & retry */
  centered: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  errorText: {
    ...FONT.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.md,
    marginBottom: SPACING.lg,
  },
  retryBtn: {
    backgroundColor: COLORS.buttonPrimary,
    borderRadius: RADIUS.md,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  retryBtnText: {
    ...FONT.bodyMedium,
    color: COLORS.textPrimary,
  },

  /* skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  skeletonLine: {
    backgroundColor: COLORS.border,
    borderRadius: 4,
  },
});
