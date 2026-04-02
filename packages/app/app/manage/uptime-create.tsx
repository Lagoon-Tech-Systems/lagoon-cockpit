import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
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
import { sanitizeErrorMessage } from '../../src/lib/errors';

/* ---------- Types ---------- */

type MonitorType = 'http' | 'tcp' | 'dns';

interface MonitorDetail {
  id: string;
  name: string;
  type: MonitorType;
  target: string;
  interval_seconds: number;
  config: Record<string, unknown> | null;
  notify_channels: string[] | null;
}

/* ---------- Constants ---------- */

const PRO_API = '/api/ext/cockpit-pro';

const TYPE_OPTIONS: { key: MonitorType; label: string; color: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'http', label: 'HTTP', color: COLORS.blue, icon: 'globe-outline' },
  { key: 'tcp', label: 'TCP', color: COLORS.purple, icon: 'git-network-outline' },
  { key: 'dns', label: 'DNS', color: COLORS.teal, icon: 'server-outline' },
];

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'];

const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA'];

const TARGET_PLACEHOLDERS: Record<MonitorType, string> = {
  http: 'https://example.com/health',
  tcp: 'example.com',
  dns: 'example.com',
};

/* ---------- Screen ---------- */

function UptimeCreateContent() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;

  const [loadingExisting, setLoadingExisting] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<MonitorType>('http');
  const [target, setTarget] = useState('');
  const [intervalSeconds, setIntervalSeconds] = useState('300');

  // HTTP config
  const [httpMethod, setHttpMethod] = useState('GET');
  const [expectedStatus, setExpectedStatus] = useState('200');
  const [httpTimeout, setHttpTimeout] = useState('10000');

  // TCP config
  const [tcpPort, setTcpPort] = useState('');
  const [tcpTimeout, setTcpTimeout] = useState('10000');

  // DNS config
  const [dnsRecordType, setDnsRecordType] = useState('A');
  const [dnsExpectedValue, setDnsExpectedValue] = useState('');
  const [dnsTimeout, setDnsTimeout] = useState('10000');

  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && target.trim().length > 0;

  // Load existing monitor for edit mode
  const loadExisting = useCallback(async () => {
    if (!id) return;
    setLoadingExisting(true);
    try {
      const res = await apiFetch<MonitorDetail>(`${PRO_API}/uptime/monitors/${id}`);
      setName(res.name);
      setType(res.type);
      setTarget(res.target);
      setIntervalSeconds(String(res.interval_seconds));

      const cfg = res.config as Record<string, unknown> | null;
      if (cfg) {
        if (res.type === 'http') {
          if (cfg.method) setHttpMethod(String(cfg.method));
          if (cfg.expected_status) setExpectedStatus(String(cfg.expected_status));
          if (cfg.timeout_ms) setHttpTimeout(String(cfg.timeout_ms));
        } else if (res.type === 'tcp') {
          if (cfg.port) setTcpPort(String(cfg.port));
          if (cfg.timeout_ms) setTcpTimeout(String(cfg.timeout_ms));
        } else if (res.type === 'dns') {
          if (cfg.record_type) setDnsRecordType(String(cfg.record_type));
          if (cfg.expected_value) setDnsExpectedValue(String(cfg.expected_value));
          if (cfg.timeout_ms) setDnsTimeout(String(cfg.timeout_ms));
        }
      }
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to load monitor');
      Alert.alert('Error', message);
      router.back();
    } finally {
      setLoadingExisting(false);
    }
  }, [id, router]);

  useEffect(() => {
    if (isEdit) loadExisting();
  }, [isEdit, loadExisting]);

  const buildConfig = (): Record<string, unknown> | undefined => {
    if (type === 'http') {
      return {
        method: httpMethod,
        expected_status: parseInt(expectedStatus, 10) || 200,
        timeout_ms: parseInt(httpTimeout, 10) || 10000,
      };
    }
    if (type === 'tcp') {
      const port = parseInt(tcpPort, 10);
      if (!port) return undefined;
      return {
        port,
        timeout_ms: parseInt(tcpTimeout, 10) || 10000,
      };
    }
    if (type === 'dns') {
      return {
        record_type: dnsRecordType,
        expected_value: dnsExpectedValue.trim() || undefined,
        timeout_ms: parseInt(dnsTimeout, 10) || 10000,
      };
    }
    return undefined;
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        target: target.trim(),
        interval_seconds: parseInt(intervalSeconds, 10) || 300,
      };

      const config = buildConfig();
      if (config) body.config = config;

      if (isEdit) {
        await apiFetch(`${PRO_API}/uptime/monitors/${id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`${PRO_API}/uptime/monitors`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }
      router.back();
    } catch (err: unknown) {
      const message = sanitizeErrorMessage(err, 'Failed to save monitor');
      Alert.alert('Error', message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingExisting) {
    return (
      <>
        <Stack.Screen
          options={{ title: 'Edit Monitor', headerBackTitle: 'Details' }}
        />
        <View style={[styles.container, styles.loadingContainer]}>
          <ActivityIndicator size="large" color={COLORS.blue} />
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: isEdit ? 'Edit Monitor' : 'New Monitor',
          headerBackTitle: isEdit ? 'Details' : 'Monitors',
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
              placeholder="e.g. Production API"
              placeholderTextColor={COLORS.textTertiary}
              value={name}
              onChangeText={setName}
              maxLength={100}
              autoFocus={!isEdit}
            />
          </GlassCard>

          {/* Type Selector */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Type *</Text>
            <View style={styles.typeRow}>
              {TYPE_OPTIONS.map((opt) => {
                const isSelected = type === opt.key;
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
                    onPress={() => setType(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={opt.icon}
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
                      <Ionicons name="checkmark-circle" size={16} color={opt.color} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassCard>

          {/* Target */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Target *</Text>
            <Text style={styles.fieldHint}>
              {type === 'http' && 'Full URL to monitor'}
              {type === 'tcp' && 'Hostname or IP address'}
              {type === 'dns' && 'Domain name to resolve'}
            </Text>
            <TextInput
              style={[styles.textInput, styles.monoInput]}
              placeholder={TARGET_PLACEHOLDERS[type]}
              placeholderTextColor={COLORS.textTertiary}
              value={target}
              onChangeText={setTarget}
              maxLength={500}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={type === 'http' ? 'url' : 'default'}
            />
          </GlassCard>

          {/* Type-specific config */}
          {type === 'http' && (
            <GlassCard style={styles.section}>
              <Text style={styles.fieldLabel}>HTTP Configuration</Text>

              {/* Method */}
              <Text style={styles.subLabel}>Method</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {HTTP_METHODS.map((m) => {
                  const isSelected = httpMethod === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => setHttpMethod(m)}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {m}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Expected Status */}
              <Text style={[styles.subLabel, { marginTop: SPACING.md }]}>Expected Status Code</Text>
              <TextInput
                style={styles.textInput}
                placeholder="200"
                placeholderTextColor={COLORS.textTertiary}
                value={expectedStatus}
                onChangeText={setExpectedStatus}
                keyboardType="number-pad"
                maxLength={3}
              />

              {/* Timeout */}
              <Text style={[styles.subLabel, { marginTop: SPACING.md }]}>Timeout (ms)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="10000"
                placeholderTextColor={COLORS.textTertiary}
                value={httpTimeout}
                onChangeText={setHttpTimeout}
                keyboardType="number-pad"
                maxLength={6}
              />
            </GlassCard>
          )}

          {type === 'tcp' && (
            <GlassCard style={styles.section}>
              <Text style={styles.fieldLabel}>TCP Configuration</Text>

              {/* Port */}
              <Text style={styles.subLabel}>Port *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="443"
                placeholderTextColor={COLORS.textTertiary}
                value={tcpPort}
                onChangeText={setTcpPort}
                keyboardType="number-pad"
                maxLength={5}
              />

              {/* Timeout */}
              <Text style={[styles.subLabel, { marginTop: SPACING.md }]}>Timeout (ms)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="10000"
                placeholderTextColor={COLORS.textTertiary}
                value={tcpTimeout}
                onChangeText={setTcpTimeout}
                keyboardType="number-pad"
                maxLength={6}
              />
            </GlassCard>
          )}

          {type === 'dns' && (
            <GlassCard style={styles.section}>
              <Text style={styles.fieldLabel}>DNS Configuration</Text>

              {/* Record Type */}
              <Text style={styles.subLabel}>Record Type</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
                {DNS_RECORD_TYPES.map((rt) => {
                  const isSelected = dnsRecordType === rt;
                  return (
                    <TouchableOpacity
                      key={rt}
                      style={[styles.chip, isSelected && styles.chipSelected]}
                      onPress={() => setDnsRecordType(rt)}
                    >
                      <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                        {rt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Expected Value */}
              <Text style={[styles.subLabel, { marginTop: SPACING.md }]}>Expected Value</Text>
              <Text style={styles.fieldHint}>Optional — leave empty to just check resolution</Text>
              <TextInput
                style={[styles.textInput, styles.monoInput]}
                placeholder="e.g. 93.184.216.34"
                placeholderTextColor={COLORS.textTertiary}
                value={dnsExpectedValue}
                onChangeText={setDnsExpectedValue}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={500}
              />

              {/* Timeout */}
              <Text style={[styles.subLabel, { marginTop: SPACING.md }]}>Timeout (ms)</Text>
              <TextInput
                style={styles.textInput}
                placeholder="10000"
                placeholderTextColor={COLORS.textTertiary}
                value={dnsTimeout}
                onChangeText={setDnsTimeout}
                keyboardType="number-pad"
                maxLength={6}
              />
            </GlassCard>
          )}

          {/* Interval */}
          <GlassCard style={styles.section}>
            <Text style={styles.fieldLabel}>Check Interval (seconds)</Text>
            <Text style={styles.fieldHint}>How often the monitor runs (default: 300 = 5 min)</Text>
            <TextInput
              style={styles.textInput}
              placeholder="300"
              placeholderTextColor={COLORS.textTertiary}
              value={intervalSeconds}
              onChangeText={setIntervalSeconds}
              keyboardType="number-pad"
              maxLength={5}
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
              <ActivityIndicator size="small" color={COLORS.buttonPrimaryText} />
            ) : (
              <>
                <Ionicons
                  name={isEdit ? 'checkmark-circle' : 'add-circle'}
                  size={20}
                  color={COLORS.buttonPrimaryText}
                />
                <Text style={styles.submitBtnText}>
                  {isEdit ? 'Save Changes' : 'Create Monitor'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

export default function UptimeCreateScreen() {
  return (
    <FeatureGate feature="uptime_monitoring">
      <UptimeCreateContent />
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
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
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
  subLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
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
  monoInput: {
    ...FONT.mono,
    fontSize: 14,
  },

  /* Type selector */
  typeRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  typeBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg,
  },
  typeBtnLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },

  /* Chips (method / record type) */
  chipRow: {
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.bg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.blue + '20',
    borderColor: COLORS.blue,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: COLORS.blue,
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
