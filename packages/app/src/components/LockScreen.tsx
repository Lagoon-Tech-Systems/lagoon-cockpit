import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useEffect, useState, useRef } from 'react';
import { LinearGradient } from 'expo-linear-gradient';

export default function LockScreen() {
  const { unlock, isLoading, checkBiometricSupport, bypassUnlock } = useAuthStore();
  const [hasBiometrics, setHasBiometrics] = useState(true);
  const [error, setError] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    checkBiometricSupport().then((supported) => {
      setHasBiometrics(supported);
      if (supported) {
        handleUnlock();
      } else {
        bypassUnlock();
      }
    });
  }, []);

  // Pulse animation on the icon while waiting
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const handleUnlock = async () => {
    setError('');
    const success = await unlock();
    if (!success) setError('Authentication failed');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.iconCircle}>
            <Text style={styles.icon}>{'\u{1F512}'}</Text>
          </View>
        </Animated.View>

        <Text style={styles.title}>Lagoon Cockpit</Text>
        <Text style={styles.subtitle}>
          {hasBiometrics ? 'Authenticate to unlock' : 'Biometrics not available'}
        </Text>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.buttonWrapper}
          onPress={handleUnlock}
          disabled={isLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={isLoading ? 'Authenticating' : 'Unlock Cockpit'}
        >
          <LinearGradient
            colors={['#4A90FF', '#6366F1']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {isLoading ? 'Authenticating...' : '\u{1F513}  Unlock'}
            </Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1C1C1E',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
  },
  iconContainer: {
    marginBottom: 24,
  },
  iconCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2C2C2E',
    borderWidth: 1,
    borderColor: '#3A3A3C',
    justifyContent: 'center',
    alignItems: 'center',
  },
  icon: {
    fontSize: 48,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: '#8E8E93',
    fontSize: 16,
    marginBottom: 32,
  },
  errorContainer: {
    backgroundColor: 'rgba(255, 107, 107, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 107, 0.25)',
  },
  error: {
    color: '#FF6B6B',
    fontSize: 14,
    textAlign: 'center',
  },
  buttonWrapper: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
  },
  button: {
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
});
