import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

type PeriodType = 'monthly' | 'quarterly' | 'yearly';

interface SlaDefinition {
  id: string;
  name: string;
  target_uptime: number;
  period_type: PeriodType;
  monitor_id: string | null;
  description: string | null;
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

interface PeriodOption {
  key: PeriodType;
  label: string;
  description: string;
  color: string;
}

const PERIOD_OPTIONS: PeriodOption[] = [
  {
    key: 'monthly',
    label: 'Monthly',
    description: 'Resets every calendar month',
    color: COLORS.blue,
  },
  {
    key: 'quarterly',
    label: 'Quarterly',
    description: 'Resets every 3 months',
    color: COLORS.purple,
  },
  {
    key: 'yearly',
    label: 'Yearly',
    description: 'Resets every calendar year',
    color: COLORS.orange,
  },
];

/* ---------- Screen ---------- */

function SlaCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetUptime, setTargetUptime] = useState('');
  const [periodType, setPeriodType] = useState<PeriodType | null>(null);
  const [monitorId, setMonitorId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing definition for edit mode
  useEffect(() => {
    if (!id) return;
    setLoadingExisting(true);
    apiFetch<SlaDefinition>(`${PRO_API}/sla/definitions/${id}`)
      .then((def) => {
        setName(def.name);
        setDescription(def.description ?? '');
        setTargetUptime(String(def.target_uptime));
        setPeriodType(def.period_type);
        setMonitorId(def.monitor_id ?? '');
      })
      .catch((err: unknown) => {
        const message = sanitizeErrorMessage(err, 'Failed to load SLA definition');
        Alert.alert('Error', message);
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  const parsedUptime = parseFloat(targetUptime);
  const isValidUptime = !isNaN(parsedUptime) && parsedUptime >= 0 && parsedUptime <= 99.9999;
  const canSubmit = name.trim().length > 0 && isValidUptime && periodType !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        target_uptime: parsedUptime,
        period_type: periodType,
      };
      if (description.trim()) body.description = description.trim();
      if (monitorId.trim()) body.monitor_id = monitorId.trim();

      if (isEditing) {
        await apiFetch(`${PRO_API}/sla/definitions/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${PRO_API}/sla/definitions`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, `Failed to ${isEditing ? 'update' : 'create'} SLA`);
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingExisting) {
    return (
      <>
        <Stack.Screen
          options={{
            title: 'Edit SLA',
            headerBackTitle: 'SLA',
          }}
        />
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isEditing ? 'Edit SLA' : 'Create SLA',
          headerBackTitle: isEditing ? 'SLA' : 'SLAs',
        }}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Production API Uptime"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={200}
              autoFocus={!isEditing}
            />
          </GlassCard>

          {/* Description */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Description</Text>
            <Text style={styles.fieldHint}>Optional context about this SLA</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Describe the service level agreement..."
              placeholderTextColor={COLORS.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={500}
            />
          </GlassCard>

          {/* Target Uptime */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Target Uptime *</Text>
            <Text style={styles.fieldHint}>Value between 0 and 99.9999 (e.g. 99.9 = three nines)</Text>
            <View style={styles.uptimeInputRow}>
              <TextInput
                style={[styles.textInput, styles.uptimeInput]}
                placeholder="99.9"
                placeholderTextColor={COLORS.textTertiary}
                value={targetUptime}
                onChangeText={setTargetUptime}
                keyboardType="decimal-pad"
                maxLength={8}
              />
              <Text style={styles.uptimeSuffix}>%</Text>
            </View>
            {targetUptime.length > 0 && !isValidUptime && (
              <Text style={styles.validationError}>
                Must be between 0 and 99.9999
              </Text>
            )}
          </GlassCard>

          {/* Period Type Selector */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Period Type *</Text>
            <Text style={styles.fieldHint}>How often the SLA period resets</Text>
            <View style={styles.periodGrid}>
              {PERIOD_OPTIONS.map((opt) => {
                const isSelected = periodType === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.periodBtn,
                      isSelected && {
                        backgroundColor: opt.color + '20',
                        borderColor: opt.color,
                      },
                    ]}
                    onPress={() => setPeriodType(opt.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.periodBtnHeader}>
                      <Ionicons
                        name="calendar-outline"
                        size={20}
                        color={isSelected ? opt.color : COLORS.textTertiary}
                      />
                      <Text
                        style={[
                          styles.periodBtnLabel,
                          isSelected && { color: opt.color },
                        ]}
                      >
                        {opt.label}
                      </Text>
                      {isSelected && (
                        <Ionicons
                          name="checkmark-circle"
                          size={16}
                          color={opt.color}
                          style={{ marginLeft: 'auto' }}
                        />
                      )}
                    </View>
                    <Text style={styles.periodBtnDesc}>{opt.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassCard>

          {/* Monitor ID (optional) */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Monitor ID</Text>
            <Text style={styles.fieldHint}>Link to a specific monitor (optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. monitor UUID"
              placeholderTextColor={COLORS.textTertiary}
              value={monitorId}
              onChangeText={setMonitorId}
              maxLength={100}
              autoCapitalize="none"
            />
          </GlassCard>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitBtn,
              !canSubmit && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <Text style={styles.submitBtnText}>
                {isEditing ? 'Saving...' : 'Creating...'}
              </Text>
            ) : (
              <>
                <Ionicons
                  name={isEditing ? 'save-outline' : 'add-circle-outline'}
                  size={20}
                  color={COLORS.buttonPrimaryText}
                />
                <Text style={styles.submitBtnText}>
                  {isEditing ? 'Save Changes' : 'Create SLA'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function SlaCreateScreen() {
  return (
    <FeatureGate feature="sla">
      <SlaCreateContent />
    </FeatureGate>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flex: 1 },
  scrollContent: {
    padding: SPACING.lg,
    paddingBottom: 60,
  },

  /* Sections */
  section: {
    marginBottom: SPACING.lg,
  },
  fieldLabel: {
    ...FONT.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  fieldHint: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginBottom: SPACING.sm,
  },

  /* Text inputs */
  textInput: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    color: COLORS.textPrimary,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  multilineInput: {
    minHeight: 80,
    paddingTop: SPACING.md,
  },

  /* Uptime input */
  uptimeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  uptimeInput: {
    flex: 1,
  },
  uptimeSuffix: {
    ...FONT.heading,
    color: COLORS.textSecondary,
  },
  validationError: {
    color: COLORS.red,
    fontSize: 12,
    marginTop: SPACING.xs,
  },

  /* Period selector */
  periodGrid: {
    gap: SPACING.sm,
  },
  periodBtn: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  periodBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  periodBtnLabel: {
    ...FONT.bodyMedium,
    color: COLORS.textSecondary,
  },
  periodBtnDesc: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginLeft: 28,
  },

  /* Submit button */
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.blue,
    paddingVertical: 16,
    borderRadius: RADIUS.lg,
    marginTop: SPACING.md,
    ...SHADOW.card,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: COLORS.buttonPrimaryText,
    fontSize: 17,
    fontWeight: '700',
  },
});
