import { useState } from 'react';
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
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';
import { sanitizeErrorMessage } from '../../src/lib/errors';

const PRO_API = '/api/ext/cockpit-pro';

/* ---------- Types ---------- */

type Severity = 'critical' | 'high' | 'medium' | 'low';

/* ---------- Constants ---------- */

interface SeverityOption {
  key: Severity;
  label: string;
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
}

const SEVERITY_OPTIONS: SeverityOption[] = [
  {
    key: 'critical',
    label: 'Critical',
    color: COLORS.red,
    icon: 'flame',
    description: 'Major outage, all users affected',
  },
  {
    key: 'high',
    label: 'High',
    color: COLORS.orange,
    icon: 'alert-circle',
    description: 'Significant impact, many users affected',
  },
  {
    key: 'medium',
    label: 'Medium',
    color: COLORS.yellow,
    icon: 'warning',
    description: 'Partial impact, some users affected',
  },
  {
    key: 'low',
    label: 'Low',
    color: COLORS.blue,
    icon: 'information-circle',
    description: 'Minor issue, minimal impact',
  },
];

/* ---------- Screen ---------- */

function IncidentCreateContent() {
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [commander, setCommander] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = title.trim().length > 0 && severity !== null;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      await apiFetch(`${PRO_API}/incidents`, {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          severity,
          commander: commander.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to create incident');
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Declare Incident',
          headerBackTitle: 'Incidents',
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
          {/* Title */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Title *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. API gateway returning 502 errors"
              placeholderTextColor={COLORS.textTertiary}
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              autoFocus
            />
          </GlassCard>

          {/* Severity Selector */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Severity *</Text>
            <View style={styles.severityGrid}>
              {SEVERITY_OPTIONS.map((opt) => {
                const isSelected = severity === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.severityBtn,
                      isSelected && {
                        backgroundColor: opt.color + '20',
                        borderColor: opt.color,
                      },
                    ]}
                    onPress={() => setSeverity(opt.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.severityBtnHeader}>
                      <Ionicons
                        name={opt.icon}
                        size={20}
                        color={isSelected ? opt.color : COLORS.textTertiary}
                      />
                      <Text
                        style={[
                          styles.severityBtnLabel,
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
                    <Text style={styles.severityBtnDesc}>{opt.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassCard>

          {/* Commander */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Incident Commander</Text>
            <Text style={styles.fieldHint}>Who is leading the response? (optional)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. John Doe"
              placeholderTextColor={COLORS.textTertiary}
              value={commander}
              onChangeText={setCommander}
              maxLength={100}
            />
          </GlassCard>

          {/* Description */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Description</Text>
            <Text style={styles.fieldHint}>Additional context about the incident (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Describe what is happening, the impact, and any initial observations..."
              placeholderTextColor={COLORS.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={1000}
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
              <Text style={styles.submitBtnText}>Declaring...</Text>
            ) : (
              <>
                <Ionicons name="megaphone" size={20} color={COLORS.buttonPrimaryText} />
                <Text style={styles.submitBtnText}>Declare Incident</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function IncidentCreateScreen() {
  return (
    <FeatureGate feature="incidents">
      <IncidentCreateContent />
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
    minHeight: 100,
    paddingTop: SPACING.md,
  },

  /* Severity selector */
  severityGrid: {
    gap: SPACING.sm,
  },
  severityBtn: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  severityBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  severityBtnLabel: {
    ...FONT.bodyMedium,
    color: COLORS.textSecondary,
  },
  severityBtnDesc: {
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
    backgroundColor: COLORS.red,
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
