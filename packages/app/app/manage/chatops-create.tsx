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

/* ---------- types ---------- */

interface Channel {
  id: string;
  name: string;
  platform: 'telegram' | 'slack';
  config: Record<string, unknown>;
  subscribed_events: string[];
  enabled: boolean;
  created_at: string;
}

/* ---------- constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

type PlatformKey = 'telegram' | 'slack';

const PLATFORMS: { key: PlatformKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'telegram', label: 'Telegram', icon: 'paper-plane' },
  { key: 'slack', label: 'Slack', icon: 'chatbubbles' },
];

const ALL_EVENTS = [
  'alert.fired',
  'alert.resolved',
  'incident.created',
  'incident.updated',
  'incident.resolved',
  'uptime.down',
  'uptime.up',
  'status_page.update',
  'test',
] as const;

type EventType = (typeof ALL_EVENTS)[number];

function formatEventLabel(event: string): string {
  return event
    .split('.')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/* ---------- component ---------- */

function ChatOpsCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  /* form state */
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState<PlatformKey>('telegram');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [subscribedEvents, setSubscribedEvents] = useState<Set<EventType>>(new Set());
  const [enabled, setEnabled] = useState(true);

  /* loading states */
  const [loadingChannel, setLoadingChannel] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------- load existing channel for edit ---------- */
  const loadChannel = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const res = await apiFetch<Channel>(`${PRO_API}/chatops/channels/${id}`);
      const channel = res;
      if (!channel) {
        Alert.alert('Error', 'Channel not found');
        router.back();
        return;
      }
      setName(channel.name);
      setPlatform(channel.platform);
      if (channel.platform === 'telegram' && channel.config) {
        setBotToken(String(channel.config.bot_token || ''));
        setChatId(String(channel.config.chat_id || ''));
      } else if (channel.platform === 'slack' && channel.config) {
        setWebhookUrl(String(channel.config.webhook_url || ''));
      }
      setSubscribedEvents(new Set((channel.subscribed_events ?? []) as EventType[]));
      setEnabled(channel.enabled);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingChannel(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (isEdit) loadChannel();
  }, [isEdit, loadChannel]);

  /* ---------- event chip toggle ---------- */
  const toggleEvent = (event: EventType) => {
    setSubscribedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) {
        next.delete(event);
      } else {
        next.add(event);
      }
      return next;
    });
  };

  /* ---------- save ---------- */
  const handleSave = async () => {
    /* validation */
    if (!name.trim()) {
      Alert.alert('Validation', 'Channel name is required.');
      return;
    }
    if (platform === 'telegram') {
      if (!botToken.trim()) {
        Alert.alert('Validation', 'Bot token is required for Telegram.');
        return;
      }
      if (!chatId.trim()) {
        Alert.alert('Validation', 'Chat ID is required for Telegram.');
        return;
      }
    }
    if (platform === 'slack') {
      if (!webhookUrl.trim()) {
        Alert.alert('Validation', 'Webhook URL is required for Slack.');
        return;
      }
    }

    setSaving(true);
    try {
      const config: Record<string, unknown> =
        platform === 'telegram'
          ? { bot_token: botToken.trim(), chat_id: chatId.trim() }
          : { webhook_url: webhookUrl.trim() };

      const body: Record<string, unknown> = {
        name: name.trim(),
        platform,
        config,
        subscribed_events: Array.from(subscribedEvents),
        enabled,
      };

      if (isEdit) {
        await apiFetch(`${PRO_API}/chatops/channels/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${PRO_API}/chatops/channels`, {
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
  if (loadingChannel) {
    return (
      <>
        <Stack.Screen
          options={{
            title: isEdit ? 'Edit Channel' : 'New Channel',
            headerBackTitle: 'ChatOps',
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
            title: isEdit ? 'Edit Channel' : 'New Channel',
            headerBackTitle: 'ChatOps',
          }}
        />
        <View style={styles.centered}>
          <Ionicons name="alert-circle-outline" size={48} color={COLORS.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={loadChannel}>
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
          title: isEdit ? 'Edit Channel' : 'New Channel',
          headerBackTitle: 'ChatOps',
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
          {/* ======== Channel Name ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>CHANNEL NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Alerts - Production"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
            />
          </GlassCard>

          {/* ======== Platform ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>PLATFORM</Text>
            <View style={styles.platformRow}>
              {PLATFORMS.map((p) => (
                <TouchableOpacity
                  key={p.key}
                  style={[
                    styles.platformBtn,
                    platform === p.key && styles.platformBtnActive,
                  ]}
                  onPress={() => setPlatform(p.key)}
                >
                  <Ionicons
                    name={p.icon}
                    size={24}
                    color={platform === p.key ? COLORS.blue : COLORS.textTertiary}
                  />
                  <Text
                    style={[
                      styles.platformText,
                      platform === p.key && styles.platformTextActive,
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </GlassCard>

          {/* ======== Config (conditional) ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>
              {platform === 'telegram' ? 'TELEGRAM CONFIG' : 'SLACK CONFIG'}
            </Text>

            {platform === 'telegram' ? (
              <>
                <Text style={styles.fieldLabel}>Bot Token</Text>
                <TextInput
                  style={styles.input}
                  placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v"
                  placeholderTextColor={COLORS.textTertiary}
                  value={botToken}
                  onChangeText={setBotToken}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                />
                <Text style={styles.hintText}>
                  Get this from @BotFather on Telegram
                </Text>

                <Text style={styles.fieldLabel}>Chat ID</Text>
                <TextInput
                  style={styles.input}
                  placeholder="-1001234567890"
                  placeholderTextColor={COLORS.textTertiary}
                  value={chatId}
                  onChangeText={setChatId}
                  autoCapitalize="none"
                  keyboardType="numbers-and-punctuation"
                />
                <Text style={styles.hintText}>
                  Group/channel ID (use @userinfobot to find it)
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.fieldLabel}>Webhook URL</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://hooks.slack.com/services/..."
                  placeholderTextColor={COLORS.textTertiary}
                  value={webhookUrl}
                  onChangeText={setWebhookUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                <Text style={styles.hintText}>
                  Create an incoming webhook in your Slack workspace settings
                </Text>
              </>
            )}
          </GlassCard>

          {/* ======== Event Subscriptions ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>EVENT SUBSCRIPTIONS</Text>
            <Text style={styles.hintText}>
              Select which events should be sent to this channel
            </Text>
            <View style={styles.eventGrid}>
              {ALL_EVENTS.map((event) => {
                const isSelected = subscribedEvents.has(event);
                return (
                  <TouchableOpacity
                    key={event}
                    style={[
                      styles.eventChip,
                      isSelected && styles.eventChipActive,
                    ]}
                    onPress={() => toggleEvent(event)}
                  >
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                      size={14}
                      color={isSelected ? COLORS.blue : COLORS.textTertiary}
                    />
                    <Text
                      style={[
                        styles.eventChipText,
                        isSelected && styles.eventChipTextActive,
                      ]}
                    >
                      {formatEventLabel(event)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassCard>

          {/* ======== Settings ======== */}
          <GlassCard style={styles.section}>
            <Text style={styles.sectionLabel}>SETTINGS</Text>
            <View style={styles.enabledRow}>
              <Text style={styles.enabledLabel}>Enabled</Text>
              <Switch
                value={enabled}
                onValueChange={setEnabled}
                trackColor={{ false: COLORS.border, true: COLORS.buttonPrimary }}
                thumbColor={enabled ? COLORS.blue : COLORS.textTertiary}
              />
            </View>
            <Text style={styles.hintText}>
              Disabled channels will not receive any notifications
            </Text>
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
                  {isEdit ? 'Update Channel' : 'Create Channel'}
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

export default function ChatOpsCreateScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'ChatOps Channel', headerBackTitle: 'Back' }} />
      <FeatureGate feature="chatops">
        <ChatOpsCreateContent />
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
  hintText: {
    ...FONT.body,
    color: COLORS.textTertiary,
    fontSize: 11,
    marginTop: SPACING.xs,
  },

  /* platform selector */
  platformRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  platformBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 8,
  },
  platformBtnActive: {
    backgroundColor: COLORS.blueGlow,
    borderColor: COLORS.blue,
  },
  platformText: {
    ...FONT.bodyMedium,
    color: COLORS.textTertiary,
    fontSize: 13,
  },
  platformTextActive: {
    color: COLORS.blue,
  },

  /* event chips */
  eventGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: SPACING.md,
  },
  eventChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventChipActive: {
    backgroundColor: COLORS.blueGlow,
    borderColor: COLORS.blue,
  },
  eventChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.textTertiary,
  },
  eventChipTextActive: {
    color: COLORS.blue,
  },

  /* enabled toggle */
  enabledRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
