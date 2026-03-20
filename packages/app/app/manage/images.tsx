import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { Stack } from 'expo-router';
import { apiFetch } from '../../src/lib/api';
import { useServerStore } from '../../src/stores/serverStore';

interface DockerImage {
  id: string;
  repoTags: string[];
  size: number;
  created: number;
  containers: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getImageName(repoTags: string[]): string {
  if (!repoTags || repoTags.length === 0 || repoTags[0] === '<none>:<none>') return '<none>';
  return repoTags[0];
}

export default function ImagesScreen() {
  const userRole = useServerStore((s) => s.userRole);
  const isAdmin = userRole === 'admin';

  const [images, setImages] = useState<DockerImage[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pruneLoading, setPruneLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  const fetchImages = useCallback(async () => {
    try {
      const data = await apiFetch<{ images: DockerImage[] }>('/api/images');
      setImages(data.images);
    } catch (err) {
      console.error('Failed to fetch images:', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to fetch images');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchImages();
    setRefreshing(false);
  }, [fetchImages]);

  const totalSize = images.reduce((acc, img) => acc + img.size, 0);

  const handlePrune = () => {
    const unusedCount = images.filter((img) => img.containers === 0).length;
    Alert.alert(
      'Prune Unused Images',
      `This will remove ${unusedCount} unused image${unusedCount !== 1 ? 's' : ''}. This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Prune',
          style: 'destructive',
          onPress: async () => {
            setPruneLoading(true);
            try {
              const result = await apiFetch<{ SpaceReclaimed: number }>('/api/images/prune', { method: 'POST' });
              Alert.alert('Prune Complete', `Reclaimed ${formatBytes(result.SpaceReclaimed)}`);
              await fetchImages();
            } catch (err) {
              Alert.alert('Prune Failed', err instanceof Error ? err.message : 'Failed to prune images');
            } finally {
              setPruneLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDelete = (image: DockerImage) => {
    const name = getImageName(image.repoTags);
    Alert.alert(
      'Delete Image',
      `Remove "${name}"?\n\nSize: ${formatBytes(image.size)}\nContainers using it: ${image.containers}\n\nThis action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleteLoading(image.id);
            try {
              await apiFetch(`/api/images/${image.id}`, { method: 'DELETE' });
              await fetchImages();
            } catch (err) {
              Alert.alert('Delete Failed', err instanceof Error ? err.message : 'Failed to delete image');
            } finally {
              setDeleteLoading(null);
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: DockerImage }) => {
    const name = getImageName(item.repoTags);
    const isDeleting = deleteLoading === item.id;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => isAdmin ? handleDelete(item) : undefined}
        activeOpacity={isAdmin ? 0.7 : 1}
        disabled={isDeleting}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.imageName} numberOfLines={1}>{name}</Text>
          {isAdmin && (
            isDeleting ? (
              <ActivityIndicator size="small" color="#EF4444" />
            ) : (
              <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={styles.deleteBtn}>{'\u2715'}</Text>
              </TouchableOpacity>
            )
          )}
        </View>
        <View style={styles.cardMeta}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Size</Text>
            <Text style={styles.metaValue}>{formatBytes(item.size)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Created</Text>
            <Text style={styles.metaValue}>{formatDate(item.created)}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Containers</Text>
            <Text style={[styles.metaValue, item.containers > 0 ? styles.activeCount : styles.inactiveCount]}>
              {item.containers}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <>
        <Stack.Screen options={{ title: 'Images', headerBackTitle: 'Back' }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#60A5FA" />
          <Text style={styles.loadingText}>Loading images...</Text>
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Images', headerBackTitle: 'Back' }} />
      <View style={styles.container}>
        {/* Prune Button (admin only) */}
        {isAdmin && (
          <TouchableOpacity
            style={[styles.pruneBtn, pruneLoading && styles.pruneBtnDisabled]}
            onPress={handlePrune}
            disabled={pruneLoading}
          >
            {pruneLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.pruneBtnText}>Prune Unused Images</Text>
            )}
          </TouchableOpacity>
        )}

        <FlatList
          data={images}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No images found</Text>}
        />

        {/* Total size footer */}
        <View style={styles.footer}>
          <Text style={styles.footerLabel}>Total Image Size</Text>
          <Text style={styles.footerValue}>{formatBytes(totalSize)}</Text>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  centered: { flex: 1, backgroundColor: '#0D0D0D', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#9CA3AF', fontSize: 14, marginTop: 12 },
  pruneBtn: {
    backgroundColor: '#F59E0B', marginHorizontal: 16, marginTop: 16, marginBottom: 8,
    paddingVertical: 12, borderRadius: 10, alignItems: 'center',
  },
  pruneBtnDisabled: { opacity: 0.6 },
  pruneBtnText: { color: '#0D0D0D', fontSize: 15, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 8 },
  card: {
    backgroundColor: '#111827', borderRadius: 12, padding: 16, marginBottom: 10,
    borderWidth: 1, borderColor: '#1F2937',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  imageName: { color: '#F9FAFB', fontSize: 14, fontWeight: '600', flex: 1, marginRight: 8 },
  deleteBtn: { color: '#EF4444', fontSize: 16, fontWeight: '700' },
  cardMeta: { flexDirection: 'row', gap: 12 },
  metaItem: { flex: 1 },
  metaLabel: { color: '#9CA3AF', fontSize: 11, marginBottom: 2 },
  metaValue: { color: '#F9FAFB', fontSize: 13, fontWeight: '500' },
  activeCount: { color: '#60A5FA' },
  inactiveCount: { color: '#9CA3AF' },
  footer: {
    backgroundColor: '#111827', borderTopWidth: 1, borderTopColor: '#1F2937',
    paddingVertical: 14, paddingHorizontal: 20, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
  },
  footerLabel: { color: '#9CA3AF', fontSize: 14 },
  footerValue: { color: '#F9FAFB', fontSize: 18, fontWeight: '700' },
  empty: { color: '#6B7280', fontSize: 14, textAlign: 'center', marginTop: 40 },
});
