import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';

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

  useEffect(() => {
    loadProfiles();
  }, []);

  const handleConnect = async (profile: ServerProfile) => {
    setActiveProfile(profile.id);
    try {
      setConnecting(true);
      // Try stored credential from SecureStore first
      const storedCred = Platform.OS === 'web'
        ? localStorage.getItem(`cockpit_cred_${profile.id}`)
        : await SecureStore.getItemAsync(`cockpit_cred_${profile.id}`);
      if (!storedCred) {
        Alert.alert('No Credentials', 'Long-press to remove this profile, then add it again with your API key.');
        return;
      }
      await authenticate(profile.id, storedCred, { email });
      router.replace('/(tabs)/overview');
    } catch (err) {
      console.error('[COCKPIT] handleConnect failed:', err);
      Alert.alert('Connection Failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setConnecting(false);
    }
  };

  const handleAdd = async () => {
    if (!name.trim() || !url.trim() || !credential.trim()) {
      Alert.alert('Missing Fields', 'Name, URL, and credential are required.');
      return;
    }
    if (authMode === 'login' && !email.trim()) {
      Alert.alert('Missing Fields', 'Email is required for login auth mode.');
      return;
    }

    try {
      setConnecting(true);
      await addProfile({ name: name.trim(), url: url.trim(), authMode });
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
      Alert.alert('Failed', err instanceof Error ? err.message : 'Unknown error');
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
    >
      <Text style={styles.profileName}>{item.name}</Text>
      <Text style={styles.profileUrl}>{item.url}</Text>
      <Text style={styles.profileAuth}>{item.authMode === 'key' ? 'API Key' : 'User Login'}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lagoon Cockpit</Text>
      <Text style={styles.subtitle}>Select or add a server</Text>

      {profiles.length > 0 && (
        <FlatList
          data={profiles}
          renderItem={renderProfile}
          keyExtractor={(item) => item.id}
          style={styles.list}
        />
      )}

      {!showAdd ? (
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
          <Text style={styles.addBtnText}>+ Add Server</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Server Name"
            placeholderTextColor="#6B7280"
            value={name}
            onChangeText={setName}
          />
          <TextInput
            style={styles.input}
            placeholder="URL (e.g. https://your-server:3000)"
            placeholderTextColor="#6B7280"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            keyboardType="url"
          />

          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, authMode === 'key' && styles.modeBtnActive]}
              onPress={() => setAuthMode('key')}
            >
              <Text style={[styles.modeBtnText, authMode === 'key' && styles.modeBtnTextActive]}>
                API Key
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, authMode === 'login' && styles.modeBtnActive]}
              onPress={() => setAuthMode('login')}
            >
              <Text style={[styles.modeBtnText, authMode === 'login' && styles.modeBtnTextActive]}>
                User Login
              </Text>
            </TouchableOpacity>
          </View>

          {authMode === 'login' && (
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#6B7280"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
          )}

          <TextInput
            style={styles.input}
            placeholder={authMode === 'key' ? 'API Key' : 'Password'}
            placeholderTextColor="#6B7280"
            value={credential}
            onChangeText={setCredential}
            secureTextEntry
          />

          <View style={styles.formActions}>
            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setShowAdd(false)}
              disabled={connecting}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.connectBtn} onPress={handleAdd} disabled={connecting}>
              <Text style={styles.connectBtnText}>
                {connecting ? 'Connecting...' : 'Connect'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D', padding: 24, paddingTop: 80 },
  title: { color: '#F9FAFB', fontSize: 32, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: '#6B7280', fontSize: 16, marginBottom: 32 },
  list: { flexGrow: 0, marginBottom: 16 },
  profileCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  profileName: { color: '#F9FAFB', fontSize: 17, fontWeight: '600', marginBottom: 4 },
  profileUrl: { color: '#6B7280', fontSize: 13, marginBottom: 4 },
  profileAuth: { color: '#60A5FA', fontSize: 12 },
  addBtn: {
    backgroundColor: '#1F2937',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    borderStyle: 'dashed',
  },
  addBtnText: { color: '#60A5FA', fontSize: 15, fontWeight: '600' },
  form: { gap: 12 },
  input: {
    backgroundColor: '#111827',
    borderRadius: 10,
    padding: 14,
    color: '#F9FAFB',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  modeRow: { flexDirection: 'row', gap: 10 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1F2937',
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#2563EB' },
  modeBtnText: { color: '#9CA3AF', fontSize: 14, fontWeight: '500' },
  modeBtnTextActive: { color: '#fff' },
  formActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#374151',
    alignItems: 'center',
  },
  cancelBtnText: { color: '#D1D5DB', fontSize: 15, fontWeight: '600' },
  connectBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2563EB',
    alignItems: 'center',
  },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
