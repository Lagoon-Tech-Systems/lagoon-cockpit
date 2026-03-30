import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../src/theme/tokens';
import { sanitizeErrorMessage } from '../src/lib/errors';

export default function ServerSelectScreen() {
  const router = useRouter();
  const { profiles, loadProfiles, addProfile, removeProfile, authenticate, setActiveProfile } =
    useServerStore();
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [authMode, setAuthMode] = useState<'key' | 'login'>('key');
  const [credential, setCredential] = useState('');
  const [email, setEmail] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleConnect = async (profile: ServerProfile) => {
    setActiveProfile(profile.id);
    setError(null);
    try {
      setConnecting(true);
      setConnectingId(profile.id);

      // Pre-flight: test raw connectivity
      try {
        const testRes = await fetch(`${profile.url}/health`, { method: 'GET' });
        console.log(`[COCKPIT] Health: ${testRes.status}`);
      } catch (netErr) {
        const msg = netErr instanceof Error ? netErr.message : String(netErr);
        setError(`Cannot reach ${profile.url}/health\n${msg}`);
        return;
      }

      // Try stored credential from SecureStore first
      const storedCred =
        Platform.OS === 'web'
          ? localStorage.getItem(`cockpit_cred_${profile.id}`)
          : await SecureStore.getItemAsync(`cockpit_cred_${profile.id}`);
      if (!storedCred) {
        setError('No credentials stored. Long-press to remove this profile, then add it again.');
        return;
      }
      await authenticate(profile.id, storedCred, { email });
      router.replace('/(tabs)/overview');
    } catch (err) {
      console.error('[COCKPIT] handleConnect failed:', err);
      setError(sanitizeErrorMessage(err, 'Unknown connection error'));
    } finally {
      setConnecting(false);
      setConnectingId(null);
    }
  };

  const handleAdd = async () => {
    setError(null);
    if (!name.trim() || !url.trim() || !credential.trim()) {
      setError('Name, URL, and credential are required.');
      return;
    }
    if (authMode === 'login' && !email.trim()) {
      setError('Email is required for login auth mode.');
      return;
    }

    try {
      setConnecting(true);
      const cleanUrl = url.trim().replace(/\/+$/, '');

      // Pre-flight: test raw connectivity before saving profile
      console.log(`[COCKPIT] Testing connectivity to ${cleanUrl}/health ...`);
      try {
        const testRes = await fetch(`${cleanUrl}/health`, { method: 'GET' });
        const testBody = await testRes.text();
        console.log(`[COCKPIT] Health check: ${testRes.status} ${testBody.substring(0, 100)}`);
      } catch (netErr) {
        const msg = netErr instanceof Error ? netErr.message : String(netErr);
        console.error(`[COCKPIT] Pre-flight failed:`, netErr);
        setError(
          `Cannot reach ${cleanUrl}/health\n${msg}\n\nCheck that the URL is correct and your VPN is connected.`,
        );
        return;
      }

      await addProfile({ name: name.trim(), url: cleanUrl, authMode });
      const updated = useServerStore.getState().profiles;
      const newProfile = updated[updated.length - 1];
      setActiveProfile(newProfile.id);
      await authenticate(newProfile.id, credential.trim(), { email: email.trim() });
      setShowAdd(false);
      setName('');
      setUrl('');
      setCredential('');
      setEmail('');
      router.replace('/(tabs)/overview');
    } catch (err) {
      console.error('[COCKPIT] handleAdd failed:', err);
      setError(sanitizeErrorMessage(err, 'Unknown error'));
    } finally {
      setConnecting(false);
    }
  };

  const handleDelete = (id: string, serverName: string) => {
    Alert.alert('Remove Server', `Remove "${serverName}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removeProfile(id) },
    ]);
  };

  const renderProfile = ({ item }: { item: ServerProfile }) => (
    <TouchableOpacity
      style={styles.profileCard}
      onPress={() => handleConnect(item)}
      onLongPress={() => handleDelete(item.id, item.name)}
      activeOpacity={0.7}
    >
      <View style={styles.cardLeft}>
        <View style={styles.cardHeader}>
          <Ionicons name="ellipse" size={8} color={COLORS.green} style={{ marginRight: 8 }} />
          <Text style={styles.profileName}>{item.name}</Text>
        </View>
        <Text style={styles.profileUrl}>{item.url}</Text>
        <View style={styles.authBadge}>
          <Text style={styles.authBadgeText}>
            {item.authMode === 'key' ? 'API Key' : 'User Login'}
          </Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        {connectingId === item.id ? (
          <ActivityIndicator size="small" color={COLORS.blue} />
        ) : (
          <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.bg }} edges={['top']}>
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.containerContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Lagoon Cockpit</Text>
      <Text style={styles.subtitle}>Your servers</Text>

      {/* Error card */}
      {error ? (
        <View style={styles.errorCard}>
          <Ionicons name="alert-circle" size={18} color={COLORS.red} style={{ marginRight: 10, marginTop: 1 }} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={() => setError(null)} style={styles.errorDismiss}>
            <Ionicons name="close" size={16} color={COLORS.red} />
          </TouchableOpacity>
        </View>
      ) : null}

      {profiles.length > 0 && (
        <FlatList
          data={profiles}
          renderItem={renderProfile}
          keyExtractor={(item) => item.id}
          style={styles.list}
          scrollEnabled={false}
        />
      )}

      {!showAdd ? (
        <TouchableOpacity
          style={styles.addCard}
          onPress={() => {
            setShowAdd(true);
            setError(null);
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.addIcon}>+</Text>
          <Text style={styles.addText}>Add Server</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.form}>
          <Text style={styles.formTitle}>New Server</Text>

          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="Server Name"
              placeholderTextColor={COLORS.textSecondary}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder="URL (e.g. https://your-server:3000)"
              placeholderTextColor={COLORS.textSecondary}
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          {/* Segmented control for auth mode */}
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[styles.segment, authMode === 'key' && styles.segmentActive]}
              onPress={() => setAuthMode('key')}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, authMode === 'key' && styles.segmentTextActive]}>
                API Key
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segment, authMode === 'login' && styles.segmentActive]}
              onPress={() => setAuthMode('login')}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.segmentText, authMode === 'login' && styles.segmentTextActive]}
              >
                User Login
              </Text>
            </TouchableOpacity>
          </View>

          {authMode === 'login' && (
            <View style={styles.inputGroup}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>
          )}

          <View style={styles.inputGroup}>
            <TextInput
              style={styles.input}
              placeholder={authMode === 'key' ? 'API Key' : 'Password'}
              placeholderTextColor={COLORS.textSecondary}
              value={credential}
              onChangeText={setCredential}
              secureTextEntry
            />
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => {
                setShowAdd(false);
                setError(null);
              }}
              disabled={connecting}
              activeOpacity={0.7}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.connectBtnWrapper}
              onPress={handleAdd}
              disabled={connecting}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[COLORS.blue, COLORS.indigo]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.connectBtn}
              >
                {connecting ? (
                  <View style={styles.connectingRow}>
                    <ActivityIndicator size="small" color={COLORS.textPrimary} />
                    <Text style={styles.connectBtnText}>Connecting...</Text>
                  </View>
                ) : (
                  <Text style={styles.connectBtnText}>Connect</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  containerContent: {
    padding: SPACING.xxl,
    paddingTop: SPACING.xxl,
    paddingBottom: 120,
  },
  title: {
    color: COLORS.textPrimary,
    ...FONT.hero,
    fontSize: 36,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    color: COLORS.textSecondary,
    ...FONT.heading,
    marginBottom: SPACING.xxxl,
  },

  // Error card
  errorCard: {
    backgroundColor: COLORS.red + '1A',
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.red + '40',
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  errorIcon: {
    fontSize: 18,
    marginRight: 10,
    marginTop: 1,
  },
  errorText: {
    color: COLORS.red,
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  errorDismiss: {
    marginLeft: 8,
    padding: 10,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorDismissText: {
    color: COLORS.red,
    fontSize: 16,
    fontWeight: '600',
  },

  // Server list
  list: {
    flexGrow: 0,
    marginBottom: 12,
  },

  // Server card
  profileCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    ...SHADOW.card,
  },
  cardLeft: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  statusDot: {
    fontSize: 8,
    marginRight: 8,
  },
  profileName: {
    color: COLORS.textPrimary,
    ...FONT.heading,
  },
  profileUrl: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 8,
    marginLeft: 16,
  },
  authBadge: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.blueGlow,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginLeft: SPACING.lg,
  },
  authBadgeText: {
    color: COLORS.blue,
    fontSize: 12,
    fontWeight: '600',
  },
  cardRight: {
    marginLeft: 12,
    justifyContent: 'center',
    alignItems: 'center',
    width: 24,
  },
  chevron: {
    color: COLORS.textSecondary,
    fontSize: 28,
    fontWeight: '300',
  },

  // Add server card
  addCard: {
    backgroundColor: 'transparent',
    borderRadius: RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: COLORS.glassBorder,
    borderStyle: 'dashed',
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  addIcon: {
    color: COLORS.blue,
    fontSize: 22,
    fontWeight: '500',
  },
  addText: {
    color: COLORS.blue,
    fontSize: 16,
    fontWeight: '600',
  },

  // Form
  form: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.xl,
    gap: SPACING.md,
    ...SHADOW.card,
  },
  formTitle: {
    color: COLORS.textPrimary,
    ...FONT.title,
    fontSize: 18,
    marginBottom: SPACING.xs,
  },
  inputGroup: {},
  input: {
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: SPACING.lg,
    color: COLORS.textPrimary,
    ...FONT.body,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Segmented control
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.md,
    padding: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  segment: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
  },
  segmentActive: {
    backgroundColor: COLORS.blue,
  },
  segmentText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: COLORS.textPrimary,
  },

  // Form actions
  formActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.cardElevated,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelBtnText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  connectBtnWrapper: {
    flex: 1,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  connectBtn: {
    paddingVertical: SPACING.lg,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectBtnText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  connectingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
