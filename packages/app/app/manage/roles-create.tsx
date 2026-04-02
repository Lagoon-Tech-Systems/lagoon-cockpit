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

interface CustomRole {
  id: string;
  name: string;
  description?: string;
  permissions?: string[];
}

/* ---------- Constants ---------- */

const ENT_API = '/api/ext/cockpit-enterprise';

/** Available permissions — grouped for UI */
const PERMISSION_GROUPS: { group: string; permissions: { key: string; label: string }[] }[] = [
  {
    group: 'Containers',
    permissions: [
      { key: 'containers_view', label: 'View containers' },
      { key: 'containers_manage', label: 'Start/stop/restart containers' },
      { key: 'containers_delete', label: 'Delete containers' },
    ],
  },
  {
    group: 'Monitoring',
    permissions: [
      { key: 'metrics_view', label: 'View metrics and dashboards' },
      { key: 'alerts_manage', label: 'Create and manage alert rules' },
      { key: 'incidents_manage', label: 'Declare and resolve incidents' },
    ],
  },
  {
    group: 'Administration',
    permissions: [
      { key: 'users_view', label: 'View user list' },
      { key: 'users_manage', label: 'Invite and manage users' },
      { key: 'roles_manage', label: 'Create and assign roles' },
      { key: 'settings_manage', label: 'Modify server settings' },
    ],
  },
  {
    group: 'Integrations',
    permissions: [
      { key: 'webhooks_manage', label: 'Manage webhooks' },
      { key: 'integrations_manage', label: 'Configure integrations' },
      { key: 'sso_manage', label: 'Manage SSO providers' },
    ],
  },
];

/* ---------- Screen ---------- */

function RolesCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEditing = !!id;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);

  // Load existing role for edit mode
  useEffect(() => {
    if (!id) return;
    setLoadingExisting(true);
    apiFetch<CustomRole>(`${ENT_API}/roles/${id}`)
      .then((r) => {
        setName(r.name);
        setDescription(r.description ?? '');
        setSelectedPermissions(new Set(r.permissions ?? []));
      })
      .catch((err: unknown) => {
        const message = sanitizeErrorMessage(err, 'Failed to load role');
        Alert.alert('Error', message);
      })
      .finally(() => setLoadingExisting(false));
  }, [id]);

  const togglePermission = (key: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const canSubmit = name.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        permissions: Array.from(selectedPermissions),
      };
      if (description.trim()) body.description = description.trim();

      if (isEditing) {
        await apiFetch(`${ENT_API}/roles/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${ENT_API}/roles`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, `Failed to ${isEditing ? 'update' : 'create'} role`);
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
            title: 'Edit Role',
            headerBackTitle: 'Role',
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
          title: isEditing ? 'Edit Role' : 'Create Role',
          headerBackTitle: isEditing ? 'Role' : 'Roles',
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
            <Text style={styles.fieldLabel}>Role Name *</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Viewer, Operator, DevOps Lead"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={100}
              autoFocus={!isEditing}
            />
          </GlassCard>

          {/* Description */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Description</Text>
            <Text style={styles.fieldHint}>Optional description of what this role can do</Text>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Describe the purpose and scope of this role..."
              placeholderTextColor={COLORS.textTertiary}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              maxLength={500}
            />
          </GlassCard>

          {/* Permissions */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Permissions</Text>
            <Text style={styles.fieldHint}>
              {selectedPermissions.size} selected
            </Text>

            {PERMISSION_GROUPS.map((group) => (
              <View key={group.group} style={styles.permGroup}>
                <Text style={styles.permGroupTitle}>{group.group}</Text>
                {group.permissions.map((perm) => {
                  const isChecked = selectedPermissions.has(perm.key);
                  return (
                    <TouchableOpacity
                      key={perm.key}
                      style={styles.permCheckRow}
                      onPress={() => togglePermission(perm.key)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isChecked ? 'checkbox' : 'square-outline'}
                        size={22}
                        color={isChecked ? COLORS.blue : COLORS.textTertiary}
                      />
                      <Text style={[
                        styles.permCheckLabel,
                        isChecked && { color: COLORS.textPrimary },
                      ]}>
                        {perm.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
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
                  {isEditing ? 'Save Changes' : 'Create Role'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function RolesCreateScreen() {
  return (
    <FeatureGate feature="custom_roles">
      <RolesCreateContent />
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

  /* Permission groups */
  permGroup: {
    marginBottom: SPACING.lg,
  },
  permGroupTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  permCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  permCheckLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    flex: 1,
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
