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
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import Skeleton from '../../src/components/Skeleton';
import { COLORS, RADIUS, SPACING } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

type EventSource = 'System' | 'Application' | 'Security';
type EventLevel = 'error' | 'warning' | 'info' | 'audit_success' | 'audit_failure';

interface EventEntry {
  source: string;
  level: EventLevel;
  eventId: number;
  timestamp: string;
  message: string;
}

interface EventLogResponse {
  entries: EventEntry[];
  source: string;
}

/* ---------- Constants ---------- */

const SOURCES: EventSource[] = ['System', 'Application', 'Security'];

interface LevelFilter {
  key: 'all' | EventLevel;
  label: string;
  color: string;
}

const LEVEL_FILTERS: LevelFilter[] = [
  { key: 'all', label: 'All', color: COLORS.textSecondary },
  { key: 'error', label: 'Error', color: COLORS.red },
  { key: 'warning', label: 'Warning', color: COLORS.yellow },
  { key: 'info', label: 'Info', color: COLORS.blue },
];

/* ---------- Helpers ---------- */

function getLevelIcon(level: EventLevel): { name: keyof typeof Ionicons.glyphMap; color: string } {
  switch (level) {
    case 'error':
      return { name: 'alert-circle', color: COLORS.red };
    case 'warning':
      return { name: 'warning', color: COLORS.yellow };
    case 'info':
      return { name: 'information-circle', color: COLORS.blue };
    case 'audit_success':
      return { name: 'checkmark-circle', color: COLORS.green };
    case 'audit_failure':
      return { name: 'close-circle', color: COLORS.red };
    default:
      return { name: 'ellipse', color: COLORS.textSecondary };
  }
}

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

/* ---------- Skeleton ---------- */

function SkeletonEntries() {
  return (
    <View style={styles.list}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={styles.skeletonCard}>
          <View style={{ flexDirection: 'row', gap: SPACING.md }}>
            <Skeleton width={20} height={20} borderRadius={10} />
            <View style={{ flex: 1 }}>
              <Skeleton width={180} height={14} borderRadius={4} />
              <Skeleton width={120} height={11} borderRadius={4} style={{ marginTop: 6 }} />
              <Skeleton width="100%" height={12} borderRadius={4} style={{ marginTop: 6 }} />
              <Skeleton width={200} height={12} borderRadius={4} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
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

export default function EventLogScreen() {
  const [source, setSource] = useState<EventSource>('System');
  const [levelFilter, setLevelFilter] = useState<'all' | EventLevel>('all');
  const [entries, setEntries] = useState<EventEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const fetchEntries = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ source, limit: '100' });
      if (levelFilter !== 'all') params.set('level', levelFilter);
      const res = await apiFetch<EventLogResponse>(`/api/eventlog?${params.toString()}`);
      setEntries(res.entries ?? []);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load event log');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [source, levelFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchEntries(false);
    setRefreshing(false);
  };

  const handleRetry = () => {
    fetchEntries();
  };

  const toggleExpand = (index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  };

  const renderEntry = ({ item, index }: { item: EventEntry; index: number }) => {
    const icon = getLevelIcon(item.level);
    const isExpanded = expandedIndex === index;

    return (
      <FadeSlideIn delay={index * 50}>
        <TouchableOpacity
          style={styles.entryCard}
          onPress={() => toggleExpand(index)}
          activeOpacity={0.7}
        >
          <View style={styles.entryHeader}>
            <Ionicons name={icon.name} size={20} color={icon.color} style={{ marginTop: 1 }} />
            <View style={styles.entryMeta}>
              <Text style={styles.entryTimestamp}>{formatRelativeTime(item.timestamp)}</Text>
              <Text style={styles.entrySourceId}>
                {item.source} #{item.eventId}
              </Text>
            </View>
          </View>
          <Text
            style={styles.entryMessage}
            numberOfLines={isExpanded ? undefined : 2}
          >
            {item.message}
          </Text>
          {isExpanded && (
            <GlassCard elevated style={styles.expandedDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Level</Text>
                <Text style={[styles.detailValue, { color: icon.color }]}>
                  {item.level.replace('_', ' ')}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Source</Text>
                <Text style={styles.detailValue}>{item.source}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Event ID</Text>
                <Text style={styles.detailValue}>{item.eventId}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Time</Text>
                <Text style={styles.detailValue}>
                  {new Date(item.timestamp).toLocaleString()}
                </Text>
              </View>
            </GlassCard>
          )}
          <View style={styles.expandHint}>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={COLORS.textTertiary}
            />
          </View>
        </TouchableOpacity>
      </FadeSlideIn>
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Event Log', headerBackTitle: 'Manage' }} />
      <View style={styles.container}>
        {/* Source Selector (pill buttons) */}
        <View style={styles.selectorRow}>
          {SOURCES.map((s) => {
            const isActive = source === s;
            return (
              <TouchableOpacity
                key={s}
                style={[styles.selectorBtn, isActive && styles.selectorBtnActive]}
                onPress={() => {
                  setSource(s);
                  setExpandedIndex(null);
                }}
              >
                <Text
                  style={[
                    styles.selectorBtnText,
                    isActive && styles.selectorBtnTextActive,
                  ]}
                >
                  {s}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Level Filter Chips */}
        <View style={styles.chipRow}>
          {LEVEL_FILTERS.map((lf) => {
            const isActive = levelFilter === lf.key;
            return (
              <TouchableOpacity
                key={lf.key}
                style={[
                  styles.chip,
                  isActive && { backgroundColor: lf.color + '30', borderColor: lf.color },
                ]}
                onPress={() => {
                  setLevelFilter(lf.key);
                  setExpandedIndex(null);
                }}
              >
                {lf.key !== 'all' && (
                  <View style={[styles.chipDot, { backgroundColor: lf.color }]} />
                )}
                <Text
                  style={[
                    styles.chipText,
                    isActive && { color: lf.color },
                  ]}
                >
                  {lf.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Loading skeleton */}
        {loading && !refreshing && <SkeletonEntries />}

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

        {/* Event list */}
        {!loading && !error && (
          <FlatList
            data={entries}
            renderItem={renderEntry}
            keyExtractor={(item, i) => `${item.eventId}-${item.timestamp}-${i}`}
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
                  name="document-text"
                  size={48}
                  color={COLORS.textTertiary}
                  style={{ marginBottom: SPACING.lg }}
                />
                <Text style={styles.emptyText}>No events found</Text>
                <Text style={styles.emptySubtext}>
                  No {source} events match the current filter
                </Text>
              </View>
            }
          />
        )}
      </View>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  list: { padding: SPACING.lg, paddingBottom: 40 },

  /* Source selector (pill buttons) */
  selectorRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  selectorBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.border,
    alignItems: 'center',
  },
  selectorBtnActive: {
    backgroundColor: COLORS.blue,
  },
  selectorBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  selectorBtnTextActive: {
    color: COLORS.bg,
  },

  /* Level filter chips */
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  /* Entry card */
  entryCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  entryHeader: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: 6,
  },
  entryMeta: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  entryTimestamp: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  entrySourceId: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  entryMessage: {
    color: COLORS.textPrimary,
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 28,
  },

  /* Expanded details */
  expandedDetails: {
    marginTop: SPACING.md,
    marginLeft: 28,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: {
    color: COLORS.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  detailValue: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: 'monospace',
  },

  /* Expand hint */
  expandHint: {
    alignItems: 'center',
    marginTop: 4,
  },

  /* Skeleton */
  skeletonCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 14,
    marginBottom: SPACING.sm,
    marginHorizontal: SPACING.lg,
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
});
