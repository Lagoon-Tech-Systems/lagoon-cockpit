import { View, Text, TouchableOpacity, FlatList, StyleSheet, Alert, Platform } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useServerStore, type ServerProfile } from '../src/stores/serverStore';
import { useEdition } from '../src/edition/useEdition';
import { EDITION_LABELS } from '../src/edition/features';
import { COLORS, RADIUS, SPACING, FONT, SHADOW } from '../src/theme/tokens';
import { GlassCard } from '../src/components/ui/GlassCard';
import { TactileCard } from '../src/components/ui/TactileCard';

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
    <TactileCard style={StyleSheet.flatten([styles.card, item.id === activeProfileId ? styles.cardActive : undefined])} haptic="none">
      <View style={styles.cardInner}>
        <View style={styles.cardContent}>
          <Text style={styles.cardName}>{item.name}</Text>
          <Text style={styles.cardUrl}>{item.url}</Text>
          <Text style={styles.cardAuth}>{item.authMode === 'key' ? 'API Key' : 'User Login'}</Text>
        </View>
        <TouchableOpacity onPress={() => handleDelete(item.id, item.name)}>
          <Text style={styles.deleteText}>Remove</Text>
        </TouchableOpacity>
      </View>
    </TactileCard>
  );

  return (
    <>
      {/* Header managed by root Stack in _layout.tsx */}
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
            <GlassCard>
              <View style={styles.cardInner}>
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
            </GlassCard>
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
  card: {},
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
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
    backgroundColor: COLORS.red + '15',
    alignItems: 'center',
  },
  disconnectText: { color: COLORS.red, fontSize: 15, fontWeight: '600' },
});
