import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  Switch,
  ActivityIndicator,
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

interface StatusPage {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  custom_domain: string | null;
  is_public: boolean;
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

/* ---------- Helpers ---------- */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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

function StatusPageCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [customDomain, setCustomDomain] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const [loadingPage, setLoadingPage] = useState(isEditing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* Load existing page for edit mode */
  const fetchPage = useCallback(async () => {
    if (!id) return;
    setLoadingPage(true);
    setLoadError(null);
    try {
      const res = await apiFetch<StatusPage>(`${PRO_API}/status-pages/${id}`);
      setName(res.name);
      setSlug(res.slug);
      setSlugManuallyEdited(true); // don't auto-generate slug in edit mode
      setDescription(res.description ?? '');
      setCustomDomain(res.custom_domain ?? '');
      setIsPublic(res.is_public);
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load status page');
      setLoadError(message);
    } finally {
      setLoadingPage(false);
    }
  }, [id]);

  useEffect(() => {
    if (isEditing) fetchPage();
  }, [isEditing, fetchPage]);

  /* Auto-generate slug from name */
  const handleNameChange = (text: string) => {
    setName(text);
    if (!slugManuallyEdited) {
      setSlug(slugify(text));
    }
  };

  const handleSlugChange = (text: string) => {
    setSlugManuallyEdited(true);
    setSlug(text.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  /* Save */
  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Validation', 'Name is required.');
      return;
    }
    if (!slug.trim()) {
      Alert.alert('Validation', 'Slug is required.');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        slug: slug.trim(),
      };
      if (description.trim()) body.description = description.trim();
      if (customDomain.trim()) body.custom_domain = customDomain.trim();
      body.is_public = isPublic;

      if (isEditing) {
        await apiFetch(`${PRO_API}/status-pages/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${PRO_API}/status-pages`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to save status page');
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  };

  /* Loading state for edit mode */
  if (loadingPage) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </View>
    );
  }

  /* Load error */
  if (loadError) {
    return (
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
            <Text style={styles.errorText}>{loadError}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={fetchPage}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {/* Name */}
      <FadeSlideIn delay={0}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Name *</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Production Services"
            placeholderTextColor={COLORS.textTertiary}
            value={name}
            onChangeText={handleNameChange}
            autoFocus={!isEditing}
          />
        </View>
      </FadeSlideIn>

      {/* Slug */}
      <FadeSlideIn delay={50}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Slug *</Text>
          <TextInput
            style={styles.input}
            placeholder="production-services"
            placeholderTextColor={COLORS.textTertiary}
            value={slug}
            onChangeText={handleSlugChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.fieldHint}>
            URL path for the status page
          </Text>
        </View>
      </FadeSlideIn>

      {/* Description */}
      <FadeSlideIn delay={100}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Optional description for this status page"
            placeholderTextColor={COLORS.textTertiary}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
        </View>
      </FadeSlideIn>

      {/* Custom Domain */}
      <FadeSlideIn delay={150}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Custom Domain</Text>
          <TextInput
            style={styles.input}
            placeholder="status.example.com"
            placeholderTextColor={COLORS.textTertiary}
            value={customDomain}
            onChangeText={setCustomDomain}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.fieldHint}>
            Optional custom domain for public access
          </Text>
        </View>
      </FadeSlideIn>

      {/* Public toggle */}
      <FadeSlideIn delay={200}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons
              name={isPublic ? 'globe-outline' : 'lock-closed-outline'}
              size={20}
              color={isPublic ? COLORS.green : COLORS.textTertiary}
            />
            <View>
              <Text style={styles.toggleLabel}>Public Page</Text>
              <Text style={styles.toggleHint}>
                {isPublic
                  ? 'Anyone with the link can view this page'
                  : 'Only authenticated users can view this page'}
              </Text>
            </View>
          </View>
          <Switch
            value={isPublic}
            onValueChange={setIsPublic}
            trackColor={{ false: COLORS.border, true: COLORS.green + '60' }}
            thumbColor={isPublic ? COLORS.green : COLORS.textTertiary}
          />
        </View>
      </FadeSlideIn>

      {/* Save button */}
      <FadeSlideIn delay={250}>
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator size="small" color={COLORS.buttonPrimaryText} />
          ) : (
            <Text style={styles.saveBtnText}>
              {isEditing ? 'Save Changes' : 'Create Status Page'}
            </Text>
          )}
        </TouchableOpacity>
      </FadeSlideIn>
    </ScrollView>
  );
}

export default function StatusPageCreateScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: id ? 'Edit Status Page' : 'New Status Page',
          headerBackTitle: 'Back',
        }}
      />
      <FeatureGate feature="status_pages">
        <StatusPageCreateContent />
      </FeatureGate>
    </>
  );
}

/* ---------- Styles ---------- */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scrollContent: { padding: SPACING.lg, paddingBottom: 100 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },

  /* Fields */
  fieldGroup: {
    marginBottom: SPACING.xl,
  },
  fieldLabel: {
    ...FONT.label,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  input: {
    ...FONT.body,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  textArea: {
    minHeight: 80,
    paddingTop: 14,
  },
  fieldHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: SPACING.xs,
    marginLeft: SPACING.xs,
  },

  /* Toggle */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    marginBottom: SPACING.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  toggleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    flex: 1,
  },
  toggleLabel: {
    ...FONT.heading,
    color: COLORS.textPrimary,
    fontSize: 15,
  },
  toggleHint: {
    fontSize: 12,
    color: COLORS.textTertiary,
    marginTop: 2,
    maxWidth: 220,
  },

  /* Save button */
  saveBtn: {
    backgroundColor: COLORS.blue,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOW.elevated,
  },
  saveBtnText: {
    color: COLORS.buttonPrimaryText,
    fontWeight: '700',
    fontSize: 16,
  },

  /* Error */
  errorCard: {
    marginHorizontal: SPACING.lg,
    marginTop: 60,
  },
  centerContainer: {
    alignItems: 'center',
    paddingVertical: 60,
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
