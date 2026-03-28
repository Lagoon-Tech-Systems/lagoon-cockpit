import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { COLORS, RADIUS, SPACING } from '../src/theme/tokens';

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
      <Stack.Screen
        options={{
          title: 'Settings',
          headerLeft: () => (
            <TouchableOpacity
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/(tabs)/manage');
                }
              }}
              style={{ marginRight: Platform.OS === 'android' ? 16 : 0 }}
            >
              <Ionicons
                name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
                size={24}
                color={COLORS.blue}
              />
            </TouchableOpacity>
          ),
        }}
      />
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
  container: { flex: 1, backgroundColor: COLORS.bg, padding: SPACING.xl },
  sectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: SPACING.md,
    marginTop: SPACING.xl,
  },
  list: { gap: SPACING.sm },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardActive: { borderColor: '#2563EB' },
  cardContent: { flex: 1 },
  cardName: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '600' },
  cardUrl: { color: COLORS.textTertiary, fontSize: 13, marginTop: 2 },
  cardAuth: { color: COLORS.blue, fontSize: 12, marginTop: 2 },
  deleteText: { color: COLORS.red, fontSize: 13, fontWeight: '500' },
  addBtn: {
    marginTop: SPACING.lg,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.border,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  addText: { color: COLORS.blue, fontSize: 15, fontWeight: '600' },
  disconnectBtn: {
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: RADIUS.lg,
    backgroundColor: '#7F1D1D',
    alignItems: 'center',
  },
  disconnectText: { color: '#FCA5A5', fontSize: 15, fontWeight: '600' },
});
