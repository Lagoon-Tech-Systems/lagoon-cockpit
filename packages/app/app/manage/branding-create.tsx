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

interface BrandingTheme {
  id: string;
  name: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  logo_url?: string;
  favicon_url?: string;
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/* ---------- Helpers ---------- */

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

function isValidHexColor(value: string): boolean {
  if (!value) return true; // optional fields
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(value);
}

/* ---------- Screen ---------- */

function BrandingCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [name, setName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('');
  const [secondaryColor, setSecondaryColor] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing theme for edit mode
  useEffect(() => {
    if (!id) return;
    setLoadingExisting(true);
    apiFetch<BrandingTheme>(`${ENT_API}/branding/${id}`)
      .then((t) => {
        setName(t.name);
        setPrimaryColor(t.primary_color ?? '');
        setSecondaryColor(t.secondary_color ?? '');
        setAccentColor(t.accent_color ?? '');
        setLogoUrl(t.logo_url ?? '');
        setFaviconUrl(t.favicon_url ?? '');
      })
      .catch((err: unknown) => {
        const message = sanitizeErrorMessage(err, 'Failed to load theme');
        Alert.alert('Error', message);
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  const colorsValid =
    isValidHexColor(primaryColor) &&
    isValidHexColor(secondaryColor) &&
    isValidHexColor(accentColor);

  const canSubmit = name.trim().length > 0 && colorsValid;

  const logoUrlError = logoUrl.trim() && !isValidPublicUrl(logoUrl.trim()) ? 'Invalid URL. Only public HTTP(S) URLs are allowed.' : '';
  const faviconUrlError = faviconUrl.trim() && !isValidPublicUrl(faviconUrl.trim()) ? 'Invalid URL. Only public HTTP(S) URLs are allowed.' : '';

  const handleSubmit = async () => {
    if (!canSubmit) return;

    if (logoUrl.trim() && !isValidPublicUrl(logoUrl.trim())) {
      Alert.alert('Validation Error', 'Invalid logo URL. Only public HTTP(S) URLs are allowed.');
      return;
    }
    if (faviconUrl.trim() && !isValidPublicUrl(faviconUrl.trim())) {
      Alert.alert('Validation Error', 'Invalid favicon URL. Only public HTTP(S) URLs are allowed.');
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
      };
      if (primaryColor.trim()) body.primary_color = primaryColor.trim();
      if (secondaryColor.trim()) body.secondary_color = secondaryColor.trim();
      if (accentColor.trim()) body.accent_color = accentColor.trim();
      if (logoUrl.trim()) body.logo_url = logoUrl.trim();
      if (faviconUrl.trim()) body.favicon_url = faviconUrl.trim();

      if (isEditing) {
        await apiFetch(`${ENT_API}/branding/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${ENT_API}/branding`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, `Failed to ${isEditing ? 'update' : 'create'} theme`);
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
            title: 'Edit Theme',
            headerBackTitle: 'Theme',
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
          title: isEditing ? 'Edit Theme' : 'Create Theme',
          headerBackTitle: isEditing ? 'Theme' : 'Branding',
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
            <Text style={styles.fieldLabel}>Theme Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Corporate Blue, Dark Mode"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={200}
              autoFocus={!isEditing}
            />
          </GlassCard>

          {/* Colors */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Brand Colors</Text>
            <Text style={styles.fieldHint}>Hex format (e.g. #3B82F6)</Text>

            {/* Primary */}
            <View style={styles.colorInputRow}>
              {primaryColor && isValidHexColor(primaryColor) ? (
                <View style={[styles.colorPreview, { backgroundColor: primaryColor }]} />
              ) : (
                <View style={[styles.colorPreview, { backgroundColor: COLORS.border }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.colorLabel}>Primary</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="#3B82F6"
                  placeholderTextColor={COLORS.textTertiary}
                  value={primaryColor}
                  onChangeText={setPrimaryColor}
                  maxLength={7}
                  autoCapitalize="none"
                />
              </View>
            </View>
            {primaryColor && !isValidHexColor(primaryColor) && (
              <Text style={styles.validationError}>Invalid hex color</Text>
            )}

            {/* Secondary */}
            <View style={styles.colorInputRow}>
              {secondaryColor && isValidHexColor(secondaryColor) ? (
                <View style={[styles.colorPreview, { backgroundColor: secondaryColor }]} />
              ) : (
                <View style={[styles.colorPreview, { backgroundColor: COLORS.border }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.colorLabel}>Secondary</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="#6366F1"
                  placeholderTextColor={COLORS.textTertiary}
                  value={secondaryColor}
                  onChangeText={setSecondaryColor}
                  maxLength={7}
                  autoCapitalize="none"
                />
              </View>
            </View>
            {secondaryColor && !isValidHexColor(secondaryColor) && (
              <Text style={styles.validationError}>Invalid hex color</Text>
            )}

            {/* Accent */}
            <View style={styles.colorInputRow}>
              {accentColor && isValidHexColor(accentColor) ? (
                <View style={[styles.colorPreview, { backgroundColor: accentColor }]} />
              ) : (
                <View style={[styles.colorPreview, { backgroundColor: COLORS.border }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.colorLabel}>Accent</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="#F59E0B"
                  placeholderTextColor={COLORS.textTertiary}
                  value={accentColor}
                  onChangeText={setAccentColor}
                  maxLength={7}
                  autoCapitalize="none"
                />
              </View>
            </View>
            {accentColor && !isValidHexColor(accentColor) && (
              <Text style={styles.validationError}>Invalid hex color</Text>
            )}
          </GlassCard>

          {/* Logo URL */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Logo URL</Text>
            <Text style={styles.fieldHint}>Full URL to the brand logo image</Text>
            <TextInput
              style={styles.textInput}
              placeholder="https://example.com/logo.png"
              placeholderTextColor={COLORS.textTertiary}
              value={logoUrl}
              onChangeText={setLogoUrl}
              maxLength={500}
              autoCapitalize="none"
              keyboardType="url"
            />
            {logoUrlError ? <Text style={styles.validationError}>{logoUrlError}</Text> : null}
          </GlassCard>

          {/* Favicon URL */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Favicon URL</Text>
            <Text style={styles.fieldHint}>Full URL to the favicon image</Text>
            <TextInput
              style={styles.textInput}
              placeholder="https://example.com/favicon.ico"
              placeholderTextColor={COLORS.textTertiary}
              value={faviconUrl}
              onChangeText={setFaviconUrl}
              maxLength={500}
              autoCapitalize="none"
              keyboardType="url"
            />
            {faviconUrlError ? <Text style={styles.validationError}>{faviconUrlError}</Text> : null}
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
                  {isEditing ? 'Save Changes' : 'Create Theme'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function BrandingCreateScreen() {
  return (
    <FeatureGate feature="white_label">
      <BrandingCreateContent />
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

  /* Color inputs */
  colorInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  colorPreview: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: COLORS.border,
    marginTop: 18, // offset for label
  },
  colorLabel: {
    color: COLORS.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  validationError: {
    color: COLORS.red,
    fontSize: 12,
    marginTop: -SPACING.sm,
    marginBottom: SPACING.sm,
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
