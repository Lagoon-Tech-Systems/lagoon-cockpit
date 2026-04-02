import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ScrollView,
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

interface ComplianceLogDetail {
  id: string;
  event_type: string;
  actor: string;
  severity: 'info' | 'warning' | 'critical' | 'error';
  timestamp: string;
  message?: string;
  metadata?: Record<string, unknown>;
  source_ip?: string;
  user_agent?: string;
  resource_type?: string;
  resource_id?: string;
  chain_hash?: string;
  chain_valid?: boolean;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

const SEVERITY_COLORS: Record<string, string> = {
  info: COLORS.blue,
  warning: COLORS.yellow,
  critical: COLORS.red,
  error: COLORS.orange,
};

/* ---------- Helpers ---------- */

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

function ComplianceDetailContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [log, setLog] = useState<ComplianceLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = useCallback(async (showLoading = true) => {
    if (!id) return;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<ComplianceLogDetail>(`${ENT_API}/compliance/logs/${id}`);
      setLog(res);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load log entry');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchLog(false);
    setRefreshing(false);
  };

  /* ---------- Render ---------- */

  if (loading && !refreshing) {
    return (
      <>
        <Stack.Screen options={{ title: 'Log Entry', headerBackTitle: 'Compliance' }} />
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
        <Stack.Screen options={{ title: 'Log Entry', headerBackTitle: 'Compliance' }} />
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
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchLog()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          </GlassCard>
        </View>
      </>
    );
  }

  if (!log) return null;

  const severityColor = SEVERITY_COLORS[log.severity] ?? COLORS.blue;

  return (
    <>
      <Stack.Screen
        options={{
          title: log.event_type,
          headerBackTitle: 'Compliance',
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
              <Text style={styles.headerTitle}>{log.event_type}</Text>
            </View>

            <View style={styles.headerBadges}>
              <View style={[styles.badge, { backgroundColor: severityColor + '20', borderColor: severityColor }]}>
                <Text style={[styles.badgeText, { color: severityColor }]}>
                  {log.severity.toUpperCase()}
                </Text>
              </View>
              {log.chain_valid !== undefined && (
                <View style={[
                  styles.badge,
                  {
                    backgroundColor: (log.chain_valid ? COLORS.green : COLORS.red) + '20',
                    borderColor: log.chain_valid ? COLORS.green : COLORS.red,
                  },
                ]}>
                  <Ionicons
                    name={log.chain_valid ? 'checkmark-circle' : 'close-circle'}
                    size={12}
                    color={log.chain_valid ? COLORS.green : COLORS.red}
                  />
                  <Text style={[styles.badgeText, { color: log.chain_valid ? COLORS.green : COLORS.red }]}>
                    {log.chain_valid ? 'Chain Valid' : 'Chain Invalid'}
                  </Text>
                </View>
              )}
            </View>

            {log.message && (
              <Text style={styles.messageText}>{log.message}</Text>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Event Details */}
        <FadeSlideIn delay={100}>
          <GlassCard style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Event Details</Text>

            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Event Type</Text>
              <Text style={styles.configValue}>{log.event_type}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Actor</Text>
              <Text style={styles.configValue}>{log.actor}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Timestamp</Text>
              <Text style={styles.configValue}>{formatDateTime(log.timestamp)}</Text>
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Severity</Text>
              <Text style={[styles.configValue, { color: severityColor }]}>{log.severity}</Text>
            </View>
            {log.source_ip && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Source IP</Text>
                <Text style={styles.configValue}>{log.source_ip}</Text>
              </View>
            )}
            {log.user_agent && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>User Agent</Text>
                <Text style={styles.configValue} numberOfLines={3}>{log.user_agent}</Text>
              </View>
            )}
            {log.resource_type && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Resource Type</Text>
                <Text style={styles.configValue}>{log.resource_type}</Text>
              </View>
            )}
            {log.resource_id && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Resource ID</Text>
                <Text style={styles.configValue}>{log.resource_id}</Text>
              </View>
            )}
            {log.chain_hash && (
              <View style={styles.configRow}>
                <Text style={styles.configLabel}>Chain Hash</Text>
                <Text style={styles.configValueMono} numberOfLines={2}>{log.chain_hash}</Text>
              </View>
            )}
          </GlassCard>
        </FadeSlideIn>

        {/* Metadata Card */}
        {log.metadata && Object.keys(log.metadata).length > 0 && (
          <FadeSlideIn delay={200}>
            <GlassCard style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Metadata</Text>
              <View style={styles.metadataBlock}>
                <Text style={styles.metadataText}>
                  {JSON.stringify(log.metadata, null, 2)}
                </Text>
              </View>
            </GlassCard>
          </FadeSlideIn>
        )}
      </ScrollView>
    </>
  );
}

export default function ComplianceDetailScreen() {
  return (
    <FeatureGate feature="compliance_logging">
      <ComplianceDetailContent />
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
    flexWrap: 'wrap',
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
  messageText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 20,
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

  /* Metadata */
  metadataBlock: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  metadataText: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
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
