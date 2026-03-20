import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useEffect, useState } from 'react';

export default function LockScreen() {
  const { unlock, isLoading, checkBiometricSupport, bypassUnlock } = useAuthStore();
  const [hasBiometrics, setHasBiometrics] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    checkBiometricSupport().then((supported) => {
      setHasBiometrics(supported);
      if (supported) {
        handleUnlock();
      } else {
        // No biometrics available — auto-unlock so the user is not stuck
        bypassUnlock();
      }
    });
  }, []);

  const handleUnlock = async () => {
    setError('');
    const success = await unlock();
    if (!success) setError('Authentication failed');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>&#x1F6E1;</Text>
      <Text style={styles.title}>Lagoon Cockpit</Text>
      <Text style={styles.subtitle}>
        {hasBiometrics ? 'Authenticate to unlock' : 'Biometrics not available'}
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={handleUnlock} disabled={isLoading}>
        <Text style={styles.buttonText}>{isLoading ? 'Authenticating...' : 'Unlock'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { color: '#fff', fontSize: 28, fontWeight: '700', marginBottom: 8 },
  subtitle: { color: '#888', fontSize: 16, marginBottom: 32 },
  error: { color: '#E54D4D', fontSize: 14, marginBottom: 16 },
  button: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 10,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
