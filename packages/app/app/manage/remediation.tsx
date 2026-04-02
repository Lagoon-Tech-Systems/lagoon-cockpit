import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';

const PRO_API = '/api/ext/cockpit-pro';

/* ---------- types ---------- */
interface RemediationRule {
  id: string;
  name: string;
  condition_metric: string;
  condition_operator: string;
  condition_threshold: number;
  condition_duration: number | null;
  action_type: string;
  action_target: string;
  action_config: Record<string, unknown> | null;
  cooldown_seconds: number;
  enabled: boolean;
  last_triggered: string | null;
  trigger_count: number;
  created_at: string;
}

interface HistoryEntry {
  id: string;
  rule_id: string;
  rule_name: string;
  condition_value: number;
  action_type: string;
  action_target: string;
  result: 'success' | 'failed' | 'cooldown_skipped';
  error_message: string | null;
  duration_ms: number;
  created_at: string;
}

/* ---------- constants ---------- */
type TabKey = 'rules' | 'history';

const ACTION_TYPE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  restart_container: 'refresh-circle',
  restart_service: 'cog',
  run_script: 'code-slash',
  webhook: 'link',
};

const ACTION_TYPE_LABELS: Record<string, string> = {
  restart_container: 'Restart Container',
  restart_service: 'Restart Service',
  run_script: 'Run Script',
  webhook: 'Webhook',
};

const RESULT_COLORS: Record<string, { bg: string; text: string }> = {
  success: { bg: COLORS.successBg, text: COLORS.successText },
  failed: { bg: COLORS.dangerBg, text: COLORS.dangerText },
  cooldown_skipped: { bg: COLORS.mutedBg, text: COLORS.mutedText },
};

/* ---------- helpers ---------- */
function formatCondition(rule: RemediationRule): string {
  const metric = rule.condition_metric.replace(/_/g, ' ');
  const duration = rule.condition_duration
    ? ` for ${rule.condition_duration >= 60 ? `${Math.round(rule.condition_duration / 60)}m` : `${rule.condition_duration}s`}`
    : '';
  return `${metric} ${rule.condition_operator} ${rule.condition_threshold}%${duration}`;
}

function formatAction(rule: RemediationRule): string {
  const label = ACTION_TYPE_LABELS[rule.action_type] || rule.action_type;
  return `${label}: ${rule.action_target}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
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

/* ---------- component ---------- */
function RemediationContent() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('rules');
  const [rules, setRules] = useState<RemediationRule[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [rulesRes, historyRes] = await Promise.all([
        apiFetch<{ rules: RemediationRule[] }>(`${PRO_API}/remediation/rules`),
        apiFetch<{ history: HistoryEntry[] }>(`${PRO_API}/remediation/history?limit=50`),
      ]);
      setRules(rulesRes.rules ?? []);
      setHistory(historyRes.history ?? []);
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

  /* toggle rule enabled/disabled */
  const toggleRule = async (rule: RemediationRule) => {
    try {
      await apiFetch(`${PRO_API}/remediation/rules/${rule.id}/toggle`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r))
      );
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  /* delete rule */
  const deleteRule = (rule: RemediationRule) => {
    Alert.alert('Delete Rule', `Remove "${rule.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiFetch(`${PRO_API}/remediation/rules/${rule.id}`, { method: 'DELETE' });
            setRules((prev) => prev.filter((r) => r.id !== rule.id));
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  /* navigate to create/edit */
  const openCreate = () => {
    router.push('/manage/remediation-create' as any);
  };

  const openEdit = (rule: RemediationRule) => {
    router.push(`/manage/remediation-create?id=${rule.id}` as any);
  };

  /* ---------- render: error ---------- */
  if (error && !loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Remediation', headerBackTitle: 'Manage' }} />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchData}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  /* ---------- render: loading ---------- */
  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Remediation', headerBackTitle: 'Manage' }} />
        <View style={styles.container}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Remediation', headerBackTitle: 'Manage' }} />
      <View style={styles.container}>
        {/* -------- Segmented Control -------- */}
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[styles.segment, activeTab === 'rules' && styles.segmentActive]}
            onPress={() => setActiveTab('rules')}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={16}
              color={activeTab === 'rules' ? COLORS.textPrimary : COLORS.textTertiary}
            />
            <Text
              style={[styles.segmentText, activeTab === 'rules' && styles.segmentTextActive]}
            >
              Rules
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segment, activeTab === 'history' && styles.segmentActive]}
            onPress={() => setActiveTab('history')}
          >
            <Ionicons
              name="time-outline"
              size={16}
              color={activeTab === 'history' ? COLORS.textPrimary : COLORS.textTertiary}
            />
            <Text
              style={[styles.segmentText, activeTab === 'history' && styles.segmentTextActive]}
            >
              History
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
          {activeTab === 'rules' ? (
            /* ========== RULES TAB ========== */
            <>
              {rules.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="shield-outline" size={48} color={COLORS.textTertiary} />
                  <Text style={styles.emptyText}>No remediation rules</Text>
                  <Text style={styles.emptySubtext}>
                    Create rules to auto-heal your infrastructure
                  </Text>
                </View>
              ) : (
                rules.map((rule) => {
                  const actionIcon = ACTION_TYPE_ICONS[rule.action_type] || 'help-circle';
                  return (
                    <TouchableOpacity key={rule.id} onPress={() => openEdit(rule)} activeOpacity={0.7}>
                      <GlassCard style={styles.ruleCard}>
                        <View style={styles.ruleHeader}>
                          <View style={styles.ruleIconWrap}>
                            <Ionicons name={actionIcon} size={20} color={COLORS.blue} />
                          </View>
                          <View style={styles.ruleInfo}>
                            <Text style={styles.ruleName} numberOfLines={1}>{rule.name}</Text>
                            <Text style={styles.ruleCondition}>{formatCondition(rule)}</Text>
                            <Text style={styles.ruleAction} numberOfLines={1}>
                              {formatAction(rule)}
                            </Text>
                          </View>
                          <Switch
                            value={rule.enabled}
                            onValueChange={() => toggleRule(rule)}
                            trackColor={{ false: COLORS.border, true: COLORS.buttonPrimary }}
                            thumbColor={rule.enabled ? COLORS.blue : COLORS.textTertiary}
                          />
                        </View>

                        <View style={styles.ruleFooter}>
                          <View style={styles.ruleMetaRow}>
                            <Ionicons name="time-outline" size={12} color={COLORS.textTertiary} />
                            <Text style={styles.ruleMetaText}>
                              {formatTime(rule.last_triggered)}
                            </Text>
                          </View>
                          {rule.trigger_count > 0 && (
                            <View style={styles.triggerBadge}>
                              <Text style={styles.triggerBadgeText}>
                                {rule.trigger_count}x
                              </Text>
                            </View>
                          )}
                          <TouchableOpacity
                            style={styles.deleteBtn}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              deleteRule(rule);
                            }}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                          </TouchableOpacity>
                        </View>
                      </GlassCard>
                    </TouchableOpacity>
                  );
                })
              )}
            </>
          ) : (
            /* ========== HISTORY TAB ========== */
            <>
              {history.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="timer-outline" size={48} color={COLORS.textTertiary} />
                  <Text style={styles.emptyText}>No execution history</Text>
                  <Text style={styles.emptySubtext}>
                    Remediation actions will appear here
                  </Text>
                </View>
              ) : (
                history.map((entry) => {
                  const resultColor = RESULT_COLORS[entry.result] || RESULT_COLORS.failed;
                  const actionIcon = ACTION_TYPE_ICONS[entry.action_type] || 'help-circle';
                  return (
                    <GlassCard key={entry.id} style={styles.historyCard}>
                      <View style={styles.historyHeader}>
                        <View style={styles.historyLeft}>
                          <Ionicons name={actionIcon} size={18} color={COLORS.textSecondary} />
                          <Text style={styles.historyName} numberOfLines={1}>
                            {entry.rule_name}
                          </Text>
                        </View>
                        <View style={[styles.resultBadge, { backgroundColor: resultColor.bg }]}>
                          <Text style={[styles.resultBadgeText, { color: resultColor.text }]}>
                            {entry.result === 'cooldown_skipped' ? 'COOLDOWN' : entry.result.toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.historyDetails}>
                        <Text style={styles.historyDetail}>
                          Condition value: {entry.condition_value}
                        </Text>
                        <Text style={styles.historyDetail}>
                          Target: {entry.action_target}
                        </Text>
                        <View style={styles.historyMetaRow}>
                          <Text style={styles.historyDuration}>
                            {formatDuration(entry.duration_ms)}
                          </Text>
                          <Text style={styles.historyTime}>
                            {formatTime(entry.created_at)}
                          </Text>
                        </View>
                      </View>

                      {entry.error_message && (
                        <View style={styles.errorBox}>
                          <Ionicons name="warning-outline" size={14} color={COLORS.dangerText} />
                          <Text style={styles.errorMessage}>{entry.error_message}</Text>
                        </View>
                      )}
                    </GlassCard>
                  );
                })
              )}
            </>
          )}

          <View style={{ height: 80 }} />
        </ScrollView>

        {/* -------- FAB -------- */}
        {activeTab === 'rules' && (
          <TouchableOpacity style={styles.fab} onPress={openCreate} activeOpacity={0.8}>
            <Ionicons name="add" size={28} color={COLORS.buttonPrimaryText} />
          </TouchableOpacity>
        )}
      </View>
    </>
  );
}

/* ---------- exported screen with gate ---------- */
export default function RemediationScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Remediation', headerBackTitle: 'Manage' }} />
      <FeatureGate feature="remediation">
        <RemediationContent />
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

  /* rule cards */
  ruleCard: {
    marginBottom: SPACING.md,
  },
  ruleHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  ruleIconWrap: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.blueGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  ruleInfo: {
    flex: 1,
    marginRight: SPACING.sm,
  },
  ruleName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
  },
  ruleCondition: {
    ...FONT.mono,
    color: COLORS.blue,
    marginTop: 4,
  },
  ruleAction: {
    ...FONT.body,
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  ruleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  ruleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  ruleMetaText: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  triggerBadge: {
    backgroundColor: COLORS.blueGlow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: SPACING.md,
  },
  triggerBadgeText: {
    ...FONT.label,
    fontSize: 10,
    color: COLORS.blue,
    letterSpacing: 0.5,
  },
  deleteBtn: {
    padding: 4,
  },

  /* history cards */
  historyCard: {
    marginBottom: SPACING.md,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: SPACING.sm,
  },
  historyName: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    flex: 1,
  },
  resultBadge: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderRadius: 6,
  },
  resultBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  historyDetails: {
    marginTop: SPACING.sm,
  },
  historyDetail: {
    ...FONT.body,
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  historyMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  historyDuration: {
    ...FONT.mono,
    color: COLORS.textTertiary,
  },
  historyTime: {
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
  retryText: {
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
