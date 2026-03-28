import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { useEdition } from '../src/edition/useEdition';
import { EDITION_LABELS } from '../src/edition/features';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../src/theme/tokens';

export default function SettingsScreen() {
  const router = useRouter();
  const { profiles, activeProfileId, removeProfile, disconnect } = useServerStore();
  const { edition, org, graceMode, isLoaded: editionLoaded } = useEdition();

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

        {editionLoaded && (
          <>
            <Text style={styles.sectionTitle}>License</Text>
            <View style={styles.card}>
              <View style={styles.cardContent}>
                <Text style={styles.cardName}>
                  {EDITION_LABELS[edition] || edition} Edition
                </Text>
                {org && <Text style={styles.cardUrl}>{org}</Text>}
                {graceMode && (
                  <Text style={[styles.cardAuth, { color: COLORS.yellow }]}>
                    License expired — grace period active
                  </Text>
                )}
                {!graceMode && edition !== 'ce' && (
                  <Text style={styles.cardAuth}>License active</Text>
                )}
                {edition === 'ce' && (
                  <Text style={styles.cardAuth}>Free — upgrade for more features</Text>
                )}
              </View>
              <Ionicons
                name={edition === 'ce' ? 'shield-outline' : 'shield-checkmark'}
                size={24}
                color={edition === 'ce' ? COLORS.textTertiary : COLORS.green}
              />
            </View>
          </>
        )}

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
    ...FONT.label,
    fontSize: 13,
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
    ...SHADOW.card,
  },
  cardActive: { borderColor: COLORS.borderActive },
  cardContent: { flex: 1 },
  cardName: { color: COLORS.textPrimary, ...FONT.heading, fontSize: 16 },
  cardUrl: { color: COLORS.textTertiary, fontSize: 13, marginTop: 2 },
  cardAuth: { color: COLORS.blue, fontSize: 12, marginTop: 2 },
  deleteText: { color: COLORS.red, fontSize: 13, fontWeight: '500' },
  addBtn: {
    marginTop: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: 'transparent',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.glassBorder,
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
