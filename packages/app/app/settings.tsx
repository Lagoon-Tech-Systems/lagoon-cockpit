import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';

export default function SettingsScreen() {
  const router = useRouter();
  const { profiles, activeProfileId, removeProfile, disconnect } = useServerStore();

  const handleDisconnect = () => {
    disconnect();
    router.replace('/');
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert('Remove Server', `Remove "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await removeProfile(id);
          if (id === activeProfileId) router.replace('/');
        },
      },
    ]);
  };

  const renderProfile = ({ item }: { item: ServerProfile }) => (
    <View style={[styles.card, item.id === activeProfileId && styles.cardActive]}>
      <View style={styles.cardContent}>
        <Text style={styles.cardName}>{item.name}</Text>
        <Text style={styles.cardUrl}>{item.url}</Text>
        <Text style={styles.cardAuth}>{item.authMode === 'key' ? 'API Key' : 'User Login'}</Text>
      </View>
      <TouchableOpacity onPress={() => handleDelete(item.id, item.name)}>
        <Text style={styles.deleteText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Settings', headerBackTitle: 'Back' }} />
      <View style={styles.container}>
        <Text style={styles.sectionTitle}>Server Profiles</Text>
        <FlatList
          data={profiles}
          renderItem={renderProfile}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
        />

        <TouchableOpacity style={styles.addBtn} onPress={() => router.push('/')}>
          <Text style={styles.addText}>+ Add Server</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.disconnectBtn} onPress={handleDisconnect}>
          <Text style={styles.disconnectText}>Disconnect</Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D', padding: 20 },
  sectionTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginTop: 20,
  },
  list: { gap: 8 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardActive: { borderColor: '#2563EB' },
  cardContent: { flex: 1 },
  cardName: { color: '#F9FAFB', fontSize: 16, fontWeight: '600' },
  cardUrl: { color: '#6B7280', fontSize: 13, marginTop: 2 },
  cardAuth: { color: '#60A5FA', fontSize: 12, marginTop: 2 },
  deleteText: { color: '#EF4444', fontSize: 13, fontWeight: '500' },
  addBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#1F2937',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
    borderStyle: 'dashed',
  },
  addText: { color: '#60A5FA', fontSize: 15, fontWeight: '600' },
  disconnectBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#7F1D1D',
    alignItems: 'center',
  },
  disconnectText: { color: '#FCA5A5', fontSize: 15, fontWeight: '600' },
});
