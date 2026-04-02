import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
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

/* ---------- constants ---------- */
const OPERATORS = ['>', '>=', '<', '<=', '=='] as const;

const ACTION_TYPES = [
  { key: 'restart_container', label: 'Container', icon: 'refresh-circle' as const },
  { key: 'restart_service', label: 'Service', icon: 'cog' as const },
  { key: 'run_script', label: 'Script', icon: 'code-slash' as const },
  { key: 'webhook', label: 'Webhook', icon: 'link' as const },
] as const;

const METRIC_SUGGESTIONS = ['cpu_percent', 'memory_percent', 'disk_percent'];

const TARGET_PLACEHOLDERS: Record<string, string> = {
  restart_container: 'Container name (e.g. nginx)',
  restart_service: 'Service name (e.g. nginx.service)',
  run_script: 'Script path (e.g. /opt/scripts/fix.sh)',
  webhook: 'Webhook URL (https://...)',
};

/* ---------- component ---------- */
function RemediationCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  /* form state */
  const [name, setName] = useState('');
  const [conditionMetric, setConditionMetric] = useState('cpu_percent');
  const [conditionOperator, setConditionOperator] = useState<string>('>');
  const [conditionThreshold, setConditionThreshold] = useState('');
  const [conditionDuration, setConditionDuration] = useState('');
  const [actionType, setActionType] = useState('restart_container');
  const [actionTarget, setActionTarget] = useState('');
  const [actionConfig, setActionConfig] = useState('');
  const [cooldownSeconds, setCooldownSeconds] = useState('300');
  const [enabled, setEnabled] = useState(true);

  /* loading states */
  const [loadingRule, setLoadingRule] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------- load existing rule for edit ---------- */
  const loadRule = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const res = await apiFetch<{ rules: RemediationRule[] }>(`${PRO_API}/remediation/rules`);
      const rule = (res.rules ?? []).find((r) => r.id === id);
      if (!rule) {
        Alert.alert('Error', 'Rule not found');
        router.back();
        return;
      }
      setName(rule.name);
      setConditionMetric(rule.condition_metric);
      setConditionOperator(rule.condition_operator);
      setConditionThreshold(String(rule.condition_threshold));
      setConditionDuration(rule.condition_duration ? String(rule.condition_duration) : '');
      setActionType(rule.action_type);
      setActionTarget(rule.action_target);
      setActionConfig(rule.action_config ? JSON.stringify(rule.action_config, null, 2) : '');
      setCooldownSeconds(String(rule.cooldown_seconds));
      setEnabled(rule.enabled);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingRule(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (isEdit) loadRule();
  }, [isEdit, loadRule]);

  /* ---------- save ---------- */
  const handleSave = async () => {
    /* validation */
    if (!name.trim()) {
      Alert.alert('Validation', 'Rule name is required.');
      return;
    }
    if (!conditionMetric.trim()) {
      Alert.alert('Validation', 'Metric is required.');
      return;
    }
    if (!conditionThreshold.trim() || isNaN(Number(conditionThreshold))) {
      Alert.alert('Validation', 'Threshold must be a valid number.');
      return;
    }
    if (!actionTarget.trim()) {
      Alert.alert('Validation', 'Action target is required.');
      return;
    }
    if (conditionDuration.trim() && isNaN(Number(conditionDuration))) {
      Alert.alert('Validation', 'Duration must be a valid number.');
      return;
    }
    if (cooldownSeconds.trim() && isNaN(Number(cooldownSeconds))) {
      Alert.alert('Validation', 'Cooldown must be a valid number.');
      return;
    }

    let parsedConfig: Record<string, unknown> | undefined;
    if (actionConfig.trim()) {
      try {
        parsedConfig = JSON.parse(actionConfig.trim());
      } catch {
        Alert.alert('Validation', 'Action config must be valid JSON.');
        return;
      }
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        condition_metric: conditionMetric.trim(),
        condition_operator: conditionOperator,
        condition_threshold: parseFloat(conditionThreshold),
        action_type: actionType,
        action_target: actionTarget.trim(),
      };
      if (conditionDuration.trim()) {
        body.condition_duration = parseInt(conditionDuration, 10);
      }
      if (parsedConfig) {
        body.action_config = parsedConfig;
      }
      if (cooldownSeconds.trim()) {
        body.cooldown_seconds = parseInt(cooldownSeconds, 10);
      }
      if (isEdit) {
        body.enabled = enabled;
      }

      if (isEdit) {
        await apiFetch(`${PRO_API}/remediation/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${PRO_API}/remediation/rules`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      router.back();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- render: loading ---------- */
  if (loadingRule) {
    return (
      <>
        <Stack.Screen
          options={{
            title: isEdit ? 'Edit Rule' : 'New Rule',
            headerBackTitle: 'Rules',
          }}
        />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </>
    );
  }

  /* ---------- render: error loading ---------- */
  if (error) {
    return (
      <>
        <Stack.Screen
          options={{
            title: isEdit ? 'Edit Rule' : 'New Rule',
            headerBackTitle: 'Rules',
          }}
        />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadRule}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isEdit ? 'Edit Rule' : 'New Rule',
          headerBackTitle: 'Rules',
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={100}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ======== Name ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>RULE NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. High CPU Auto-Restart"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
            />
          </GlassCard>

          {/* ======== Condition ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>CONDITION</Text>
            <Text style={styles.fieldLabel}>Metric</Text>
            <TextInput
              style={styles.input}
              placeholder="cpu_percent"
              placeholderTextColor={COLORS.textTertiary}
              value={conditionMetric}
              onChangeText={setConditionMetric}
              autoCapitalize="none"
            />
            <View style={styles.metricSuggestions}>
              {METRIC_SUGGESTIONS.map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[
                    styles.suggestionChip,
                    conditionMetric === m && styles.suggestionChipActive,
                  ]}
                  onPress={() => setConditionMetric(m)}
                >
                  <Text
                    style={[
                      styles.suggestionText,
                      conditionMetric === m && styles.suggestionTextActive,
                    ]}
                  >
                    {m}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Operator</Text>
            <View style={styles.operatorRow}>
              {OPERATORS.map((op) => (
                <TouchableOpacity
                  key={op}
                  style={[
                    styles.operatorBtn,
                    conditionOperator === op && styles.operatorBtnActive,
                  ]}
                  onPress={() => setConditionOperator(op)}
                >
                  <Text
                    style={[
                      styles.operatorText,
                      conditionOperator === op && styles.operatorTextActive,
                    ]}
                  >
                    {op}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Threshold</Text>
            <TextInput
              style={styles.input}
              placeholder="90"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="numeric"
              value={conditionThreshold}
              onChangeText={setConditionThreshold}
            />

            <Text style={styles.fieldLabel}>Duration (seconds, optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="300 (trigger after 5 minutes)"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="numeric"
              value={conditionDuration}
              onChangeText={setConditionDuration}
            />
            <Text style={styles.hintText}>
              How long the condition must persist before triggering
            </Text>
          </GlassCard>

          {/* ======== Action ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>ACTION</Text>
            <Text style={styles.fieldLabel}>Action Type</Text>
            <View style={styles.actionTypeRow}>
              {ACTION_TYPES.map((at) => (
                <TouchableOpacity
                  key={at.key}
                  style={[
                    styles.actionTypeBtn,
                    actionType === at.key && styles.actionTypeBtnActive,
                  ]}
                  onPress={() => setActionType(at.key)}
                >
                  <Ionicons
                    name={at.icon}
                    size={20}
                    color={actionType === at.key ? COLORS.blue : COLORS.textTertiary}
                  />
                  <Text
                    style={[
                      styles.actionTypeText,
                      actionType === at.key && styles.actionTypeTextActive,
                    ]}
                  >
                    {at.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Target</Text>
            <TextInput
              style={styles.input}
              placeholder={TARGET_PLACEHOLDERS[actionType] || 'Target'}
              placeholderTextColor={COLORS.textTertiary}
              value={actionTarget}
              onChangeText={setActionTarget}
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Config JSON (optional)</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              placeholder='{"headers": {"Authorization": "Bearer ..."}}'
              placeholderTextColor={COLORS.textTertiary}
              value={actionConfig}
              onChangeText={setActionConfig}
              autoCapitalize="none"
              multiline
              numberOfLines={3}
            />
            <Text style={styles.hintText}>
              Optional JSON config (e.g. webhook headers, script args)
            </Text>
          </GlassCard>

          {/* ======== Settings ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>SETTINGS</Text>

            <Text style={styles.fieldLabel}>Cooldown (seconds)</Text>
            <TextInput
              style={styles.input}
              placeholder="300"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="numeric"
              value={cooldownSeconds}
              onChangeText={setCooldownSeconds}
            />
            <Text style={styles.hintText}>
              Minimum seconds between consecutive triggers
            </Text>

            {isEdit && (
              <View style={styles.enabledRow}>
                <Text style={styles.enabledLabel}>Enabled</Text>
                <Switch
                  value={enabled}
                  onValueChange={setEnabled}
                  trackColor={{ false: COLORS.border, true: COLORS.buttonPrimary }}
                  thumbColor={enabled ? COLORS.blue : COLORS.textTertiary}
                />
              </View>
            )}
          </GlassCard>

          {/* ======== Save Button ======== */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={COLORS.buttonPrimaryText} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={COLORS.buttonPrimaryText} />
                <Text style={styles.saveText}>
                  {isEdit ? 'Update Rule' : 'Save Rule'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

/* ---------- exported screen with gate ---------- */
export default function RemediationCreateScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Remediation Rule', headerBackTitle: 'Back' }} />
      <FeatureGate feature="remediation">
        <RemediationCreateContent />
      </FeatureGate>
    </>
  );
}

/* ---------- styles ---------- */
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scrollContent: {
    padding: SPACING.lg,
  },

  /* sections */
  section: {
    marginBottom: SPACING.lg,
  },
  sectionLabel: {
    ...FONT.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    ...FONT.body,
    color: COLORS.textSecondary,
    fontSize: 13,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },

  /* inputs */
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    padding: SPACING.md,
    color: COLORS.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  multilineInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  hintText: {
    ...FONT.body,
    color: COLORS.textTertiary,
    fontSize: 11,
    marginTop: SPACING.xs,
  },

  /* metric suggestions */
  metricSuggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: SPACING.sm,
  },
  suggestionChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestionChipActive: {
    backgroundColor: COLORS.blueGlow,
    borderColor: COLORS.blue,
  },
  suggestionText: {
    ...FONT.mono,
    color: COLORS.textTertiary,
    fontSize: 12,
  },
  suggestionTextActive: {
    color: COLORS.blue,
  },

  /* operator selector */
  operatorRow: {
    flexDirection: 'row',
    gap: 8,
  },
  operatorBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  operatorBtnActive: {
    backgroundColor: COLORS.blueGlow,
    borderColor: COLORS.blue,
  },
  operatorText: {
    ...FONT.mono,
    color: COLORS.textTertiary,
    fontSize: 16,
  },
  operatorTextActive: {
    color: COLORS.blue,
  },

  /* action type selector */
  actionTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionTypeBtn: {
    flex: 1,
    minWidth: '40%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 6,
  },
  actionTypeBtnActive: {
    backgroundColor: COLORS.blueGlow,
    borderColor: COLORS.blue,
  },
  actionTypeText: {
    ...FONT.body,
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
  },
  actionTypeTextActive: {
    color: COLORS.blue,
  },

  /* enabled toggle */
  enabledRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  enabledLabel: {
    ...FONT.bodyMedium,
    color: COLORS.textPrimary,
  },

  /* save button */
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.buttonPrimary,
    borderRadius: RADIUS.lg,
    paddingVertical: 16,
    marginTop: SPACING.sm,
    ...SHADOW.card,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveText: {
    ...FONT.heading,
    color: COLORS.buttonPrimaryText,
  },

  /* centered states */
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
});
