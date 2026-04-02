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

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

function isValidPem(value: string): boolean {
  if (!value.trim()) return false;
  return /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(value.trim());
}

/* ---------- Screen ---------- */

function MtlsCreateContent() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [certificate, setCertificate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && certificate.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (!isValidPem(certificate)) {
      Alert.alert('Validation Error', 'Invalid certificate. Must be a valid PEM-encoded certificate.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        name: name.trim(),
        certificate: certificate.trim(),
      };

      await apiFetch(`${ENT_API}/mtls/agents`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to register agent');
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Register Agent',
          headerBackTitle: 'mTLS',
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
            <Text style={styles.fieldLabel}>Agent Name *</Text>
            <Text style={styles.fieldHint}>A unique name to identify this agent</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. production-worker-01"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={200}
              autoFocus
              autoCapitalize="none"
            />
          </GlassCard>

          {/* Certificate */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Client Certificate (PEM) *</Text>
            <Text style={styles.fieldHint}>Paste the agent's X.509 client certificate in PEM format</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
              placeholderTextColor={COLORS.textTertiary}
              value={certificate}
              onChangeText={setCertificate}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              maxLength={10000}
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
              <Text style={styles.submitBtnText}>Registering...</Text>
            ) : (
              <>
                <Ionicons
                  name="add-circle-outline"
                  size={20}
                  color={COLORS.buttonPrimaryText}
                />
                <Text style={styles.submitBtnText}>Register Agent</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function MtlsCreateScreen() {
  return (
    <FeatureGate feature="mtls">
      <MtlsCreateContent />
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
    minHeight: 140,
    paddingTop: SPACING.md,
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
