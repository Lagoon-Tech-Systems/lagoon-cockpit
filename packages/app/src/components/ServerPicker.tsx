import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useServerStore } from '../stores/serverStore';

interface ServerPickerProps {
  onAddServer: () => void;
}

export default function ServerPicker({ onAddServer }: ServerPickerProps) {
  const { profiles, activeProfileId, serverName } = useServerStore();
  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  if (!activeProfile) {
    return (
      <TouchableOpacity style={styles.container} onPress={onAddServer}>
        <Text style={styles.noServer}>Tap to add a server</Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.dot} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {serverName || activeProfile.name}
        </Text>
        <Text style={styles.url} numberOfLines={1}>
          {activeProfile.url}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  info: { flex: 1 },
  name: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  url: { color: '#6B7280', fontSize: 11 },
  noServer: { color: '#9CA3AF', fontSize: 14 },
});
