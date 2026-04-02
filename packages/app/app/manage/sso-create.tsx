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

type ProviderType = 'saml' | 'oidc';

interface SsoProvider {
  id: string;
  name: string;
  type: ProviderType;
  entity_id?: string;
  sso_url?: string;
  certificate?: string;
  redirect_uri?: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

function isValidPublicUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
    if (host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.')) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function isValidPem(value: string): boolean {
  if (!value.trim()) return false;
  return /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(value.trim());
}

interface TypeOption {
  key: ProviderType;
  label: string;
  description: string;
  color: string;
}

const TYPE_OPTIONS: TypeOption[] = [
  {
    key: 'saml',
    label: 'SAML',
    description: 'Security Assertion Markup Language',
    color: COLORS.purple,
  },
  {
    key: 'oidc',
    label: 'OIDC',
    description: 'OpenID Connect',
    color: COLORS.blue,
  },
];

/* ---------- Screen ---------- */

function SsoCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [name, setName] = useState('');
  const [providerType, setProviderType] = useState<ProviderType | null>(null);
  const [entityId, setEntityId] = useState('');
  const [ssoUrl, setSsoUrl] = useState('');
  const [certificate, setCertificate] = useState('');
  const [redirectUri, setRedirectUri] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing provider for edit mode
  useEffect(() => {
    if (!id) return;
    setLoadingExisting(true);
    apiFetch<SsoProvider>(`${ENT_API}/sso/providers/${id}`)
      .then((prov) => {
        setName(prov.name);
        setProviderType(prov.type);
        setEntityId(prov.entity_id ?? '');
        setSsoUrl(prov.sso_url ?? '');
        setCertificate(prov.certificate ?? '');
        setRedirectUri(prov.redirect_uri ?? '');
      })
      .catch((err: unknown) => {
        const message = sanitizeErrorMessage(err, 'Failed to load provider');
        Alert.alert('Error', message);
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  const canSubmit = name.trim().length > 0 && providerType !== null;

  const ssoUrlError = ssoUrl.trim() && !isValidPublicUrl(ssoUrl.trim()) ? 'Invalid URL. Only public HTTP(S) URLs are allowed.' : '';
  const entityIdError = entityId.trim().startsWith('http') && !isValidPublicUrl(entityId.trim()) ? 'Invalid URL. Only public HTTP(S) URLs are allowed.' : '';
  const certificateError = certificate.trim() && !isValidPem(certificate) ? 'Invalid certificate. Must be a valid PEM-encoded certificate.' : '';

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (ssoUrl.trim() && !isValidPublicUrl(ssoUrl.trim())) {
      Alert.alert('Validation Error', 'Invalid URL. Only public HTTP(S) URLs are allowed.');
      return;
    }
    if (entityId.trim().startsWith('http') && !isValidPublicUrl(entityId.trim())) {
      Alert.alert('Validation Error', 'Invalid Entity ID URL. Only public HTTP(S) URLs are allowed.');
      return;
    }
    if (certificate.trim() && !isValidPem(certificate)) {
      Alert.alert('Validation Error', 'Invalid certificate. Must be a valid PEM-encoded certificate.');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type: providerType,
      };
      if (entityId.trim()) body.entity_id = entityId.trim();
      if (ssoUrl.trim()) body.sso_url = ssoUrl.trim();
      if (certificate.trim()) body.certificate = certificate.trim();
      if (redirectUri.trim()) body.redirect_uri = redirectUri.trim();

      if (isEditing) {
        await apiFetch(`${ENT_API}/sso/providers/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${ENT_API}/sso/providers`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, `Failed to ${isEditing ? 'update' : 'create'} provider`);
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
            title: 'Edit SSO Provider',
            headerBackTitle: 'SSO',
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
          title: isEditing ? 'Edit SSO Provider' : 'Add SSO Provider',
          headerBackTitle: isEditing ? 'SSO' : 'SSO',
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
            <Text style={styles.fieldLabel}>Provider Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Okta, Azure AD, Google Workspace"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={200}
              autoFocus={!isEditing}
            />
          </GlassCard>

          {/* Type Selector */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Provider Type *</Text>
            <Text style={styles.fieldHint}>Choose the authentication protocol</Text>
            <View style={styles.typeGrid}>
              {TYPE_OPTIONS.map((opt) => {
                const isSelected = providerType === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.typeBtn,
                      isSelected && {
                        backgroundColor: opt.color + '20',
                        borderColor: opt.color,
                      },
                    ]}
                    onPress={() => setProviderType(opt.key)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.typeBtnHeader}>
                      <Ionicons
                        name="key-outline"
                        size={20}
                        color={isSelected ? opt.color : COLORS.textTertiary}
                      />
                      <Text
                        style={[
                          styles.typeBtnLabel,
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
                    <Text style={styles.typeBtnDesc}>{opt.description}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassCard>

          {/* Entity ID */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Entity ID</Text>
            <Text style={styles.fieldHint}>The unique identifier for the identity provider</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. https://idp.example.com/metadata"
              placeholderTextColor={COLORS.textTertiary}
              value={entityId}
              onChangeText={setEntityId}
              maxLength={500}
              autoCapitalize="none"
              keyboardType="url"
            />
            {entityIdError ? <Text style={styles.validationError}>{entityIdError}</Text> : null}
          </GlassCard>

          {/* SSO URL */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>SSO URL</Text>
            <Text style={styles.fieldHint}>The sign-on endpoint URL</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. https://idp.example.com/sso"
              placeholderTextColor={COLORS.textTertiary}
              value={ssoUrl}
              onChangeText={setSsoUrl}
              maxLength={500}
              autoCapitalize="none"
              keyboardType="url"
            />
            {ssoUrlError ? <Text style={styles.validationError}>{ssoUrlError}</Text> : null}
          </GlassCard>

          {/* Certificate */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Certificate</Text>
            <Text style={styles.fieldHint}>X.509 signing certificate (PEM format)</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              placeholderTextColor={COLORS.textTertiary}
              value={certificate}
              onChangeText={setCertificate}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={5000}
              autoCapitalize="none"
            />
            {certificateError ? <Text style={styles.validationError}>{certificateError}</Text> : null}
          </GlassCard>

          {/* Redirect URI */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Redirect URI</Text>
            <Text style={styles.fieldHint}>Where the IdP sends the authentication response</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. https://app.example.com/auth/callback"
              placeholderTextColor={COLORS.textTertiary}
              value={redirectUri}
              onChangeText={setRedirectUri}
              maxLength={500}
              autoCapitalize="none"
              keyboardType="url"
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
                  {isEditing ? 'Save Changes' : 'Add Provider'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function SsoCreateScreen() {
  return (
    <FeatureGate feature="sso_saml">
      <SsoCreateContent />
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

  /* Type selector */
  typeGrid: {
    gap: SPACING.sm,
  },
  typeBtn: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  typeBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: 4,
  },
  typeBtnLabel: {
    ...FONT.bodyMedium,
    color: COLORS.textSecondary,
  },
  typeBtnDesc: {
    color: COLORS.textTertiary,
    fontSize: 12,
    marginLeft: 28,
  },

  /* Validation */
  validationError: {
    color: COLORS.red,
    fontSize: 12,
    marginTop: SPACING.sm,
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
