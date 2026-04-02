import { useState, useEffect, useCallback } from 'react';
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
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { sanitizeErrorMessage } from '../../src/lib/errors';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';

/* ---------- Types ---------- */

interface IpRule {
  id: string;
  cidr: string;
  label: string;
  description?: string;
  enabled: boolean;
  created_at: string;
  updated_at?: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/* ---------- Screen ---------- */

function IpAllowlistEditContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [cidr, setCidr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchRule = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiFetch<IpRule>(`${ENT_API}/ip-allowlist/rules/${id}`);
      setCidr(res.cidr);
      setLabel(res.label ?? '');
      setDescription(res.description ?? '');
      setEnabled(res.enabled);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load rule');
      Alert.alert('Error', message, [{ text: 'OK', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchRule();
  }, [fetchRule]);

  const handleSubmit = async () => {
    if (!id) return;
    setSubmitting(true);
    try {
      await apiFetch(`${ENT_API}/ip-allowlist/rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          label: label.trim() || undefined,
          description: description.trim() || undefined,
          enabled,
        }),
      });
      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to update rule');
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Edit IP Rule', headerBackTitle: 'Back' }} />
        <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Edit IP Rule', headerBackTitle: 'Back' }} />

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
          {/* CIDR (read-only) */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>CIDR Range</Text>
            <Text style={styles.fieldHint}>CIDR cannot be changed — delete and recreate for a new range</Text>
            <View style={styles.readOnlyField}>
              <Text style={styles.readOnlyText}>{cidr}</Text>
            </View>
          </GlassCard>

          {/* Label */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Label</Text>
            <Text style={styles.fieldHint}>A friendly name for this rule</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Office VPN, Production cluster"
              placeholderTextColor={COLORS.textTertiary}
              value={label}
              onChangeText={setLabel}
              maxLength={200}
            />
          </GlassCard>

          {/* Description */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Description</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Optional description for this rule"
              placeholderTextColor={COLORS.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={500}
            />
          </GlassCard>

          {/* Enabled Toggle */}
          <GlassCard style={styles.section}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Enabled</Text>
                <Text style={styles.fieldHint}>Toggle this rule on or off</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: COLORS.border, true: COLORS.green + '60' }}
                thumbColor={enabled ? COLORS.green : COLORS.textTertiary}
              />
            </View>
          </GlassCard>

          {/* Submit Button */}
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <Text style={styles.submitBtnText}>Saving...</Text>
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color={COLORS.buttonPrimaryText} />
                <Text style={styles.submitBtnText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function IpAllowlistEditScreen() {
  return (
    <FeatureGate feature="ip_allowlist">
      <IpAllowlistEditContent />
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

  /* Read-only field */
  readOnlyField: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    opacity: 0.6,
  },
  readOnlyText: {
    color: COLORS.textSecondary,
    fontSize: 15,
  },

  /* Switch row */
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
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
  submitBtnText: {
    color: COLORS.buttonPrimaryText,
    fontSize: 17,
    fontWeight: '700',
  },
});
