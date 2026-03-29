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
  Switch,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../../src/lib/api';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../../src/theme/tokens';
import { GlassCard } from '../../src/components/ui/GlassCard';
import { FeatureGate } from '../../src/edition/FeatureGate';

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

function isValidCidr(value: string): boolean {
  if (!value.trim()) return false;
  const v = value.trim();
  if (/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(v)) {
    const [ip, prefix] = v.split('/');
    const parts = ip.split('.').map(Number);
    if (parts.some(p => p > 255)) return false;
    if (Number(prefix) > 32) return false;
    return true;
  }
  if (/^[0-9a-fA-F:]+\/\d{1,3}$/.test(v)) {
    return Number(v.split('/')[1]) <= 128;
  }
  return false;
}

/* ---------- Screen ---------- */

function IpAllowlistCreateContent() {
  const router = useRouter();

  const [cidr, setCidr] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = cidr.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (!isValidCidr(cidr)) {
      Alert.alert('Validation Error', 'Invalid CIDR range. Use IPv4 (e.g. 10.0.0.0/8) or IPv6 notation.');
      return;
    }

    if (cidr.trim().endsWith('/0')) {
      Alert.alert(
        'Warning',
        'This rule allows ALL addresses. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Continue', onPress: () => doSubmit() },
        ],
      );
      return;
    }

    doSubmit();
  };

  const doSubmit = async () => {
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        cidr: cidr.trim(),
        enabled,
      };
      if (label.trim()) body.label = label.trim();
      if (description.trim()) body.description = description.trim();

      await apiFetch(`${ENT_API}/ip-allowlist/rules`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      router.back();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create rule';
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Add IP Rule',
          headerBackTitle: 'IP Allowlist',
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
          {/* CIDR */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>CIDR Range *</Text>
            <Text style={styles.fieldHint}>IPv4 or IPv6 CIDR notation (e.g. 10.0.0.0/8)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. 192.168.1.0/24"
              placeholderTextColor={COLORS.textTertiary}
              value={cidr}
              onChangeText={setCidr}
              maxLength={50}
              autoFocus
              autoCapitalize="none"
              keyboardType="default"
            />
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
                <Text style={styles.fieldHint}>Rule is active immediately after creation</Text>
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
            style={[
              styles.submitBtn,
              !canSubmit && styles.submitBtnDisabled,
            ]}
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <Text style={styles.submitBtnText}>Creating...</Text>
            ) : (
              <>
                <Ionicons
                  name="add-circle-outline"
                  size={20}
                  color={COLORS.buttonPrimaryText}
                />
                <Text style={styles.submitBtnText}>Add Rule</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function IpAllowlistCreateScreen() {
  return (
    <FeatureGate feature="ip_allowlist">
      <IpAllowlistCreateContent />
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
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: COLORS.buttonPrimaryText,
    fontSize: 17,
    fontWeight: '700',
  },
});
