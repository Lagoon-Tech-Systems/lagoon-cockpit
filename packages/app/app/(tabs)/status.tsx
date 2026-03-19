import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect } from 'react';
import { apiFetch } from '../../src/lib/api';

interface Endpoint {
  name: string;
  url: string;
  status: number | null;
  expected: number;
  healthy: boolean;
  responseTime: number;
  error?: string;
}

interface SSLCert {
  domain: string;
  valid: boolean;
  daysRemaining: number;
  expiresAt: string;
  issuer: string;
  error?: string;
}

function getDaysColor(days: number): string {
  if (days <= 7) return '#EF4444';
  if (days <= 14) return '#F59E0B';
  return '#22C55E';
}

export default function StatusScreen() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [certs, setCerts] = useState<SSLCert[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [epData, sslData] = await Promise.all([
        apiFetch<{ endpoints: Endpoint[] }>('/api/endpoints'),
        apiFetch<{ certificates: SSLCert[] }>('/api/ssl'),
      ]);
      setEndpoints(epData.endpoints);
      setCerts(sslData.certificates);
    } catch (err) {
      console.error('Failed to fetch status:', err);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#60A5FA" />}
    >
      {/* Endpoints */}
      <Text style={styles.sectionTitle}>HTTP Endpoints</Text>
      {endpoints.length === 0 ? (
        <Text style={styles.empty}>No endpoints configured</Text>
      ) : (
        endpoints.map((ep, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{ep.name}</Text>
              <View style={[styles.statusDot, { backgroundColor: ep.healthy ? '#22C55E' : '#EF4444' }]} />
            </View>
            <Text style={styles.cardUrl}>{ep.url}</Text>
            <View style={styles.cardStats}>
              <Text style={[styles.cardStat, { color: ep.healthy ? '#22C55E' : '#EF4444' }]}>
                {ep.status || 'ERR'}
              </Text>
              <Text style={styles.cardStat}>{ep.responseTime}ms</Text>
            </View>
            {ep.error && <Text style={styles.cardError}>{ep.error}</Text>}
          </View>
        ))
      )}

      {/* SSL Certificates */}
      <Text style={[styles.sectionTitle, { marginTop: 24 }]}>SSL Certificates</Text>
      {certs.length === 0 ? (
        <Text style={styles.empty}>No SSL domains configured</Text>
      ) : (
        certs.map((cert, i) => (
          <View key={i} style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardName}>{cert.domain}</Text>
              <Text style={[styles.days, { color: getDaysColor(cert.daysRemaining) }]}>
                {cert.valid ? `${cert.daysRemaining}d` : 'EXPIRED'}
              </Text>
            </View>
            {cert.issuer && <Text style={styles.cardUrl}>Issuer: {cert.issuer}</Text>}
            {cert.expiresAt && (
              <Text style={styles.cardUrl}>
                Expires: {new Date(cert.expiresAt).toLocaleDateString()}
              </Text>
            )}
            {cert.error && <Text style={styles.cardError}>{cert.error}</Text>}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  empty: { color: '#6B7280', fontSize: 14, fontStyle: 'italic', marginBottom: 16 },
  card: {
    backgroundColor: '#111827',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardName: { color: '#F9FAFB', fontSize: 15, fontWeight: '600' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  cardUrl: { color: '#6B7280', fontSize: 12, marginBottom: 4 },
  cardStats: { flexDirection: 'row', gap: 16, marginTop: 4 },
  cardStat: { color: '#9CA3AF', fontSize: 13, fontWeight: '500' },
  cardError: { color: '#EF4444', fontSize: 12, marginTop: 4 },
  days: { fontSize: 14, fontWeight: '700' },
});
