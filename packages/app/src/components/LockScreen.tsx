import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useAuthStore } from '../stores/authStore';
import { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/tokens';

export default function LockScreen() {
  const { unlock, isLoading, checkBiometricSupport, bypassUnlock } = useAuthStore();
  const [hasBiometrics, setHasBiometrics] = useState(true);
  const [error, setError] = useState('');
  const pulseAnim = useSharedValue(1);

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
    pulseAnim.value = withRepeat(
      withSequence(
        withTiming(1.15, { duration: 1000 }),
        withTiming(1, { duration: 1000 }),
      ),
      -1,
    );
  }, []);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
  }));

  const handleUnlock = async () => {
    setError('');
    const success = await unlock();
    if (!success) setError('Authentication failed');
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Animated.View style={[styles.iconContainer, pulseStyle]}>
          <View style={styles.iconCircle}>
            <Ionicons name="shield-checkmark-outline" size={48} color={COLORS.blue} />
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
            colors={[COLORS.blue, COLORS.indigo]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.button}
          >
            <Text style={styles.buttonText}>
              {isLoading ? 'Authenticating...' : 'Unlock'}
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
    backgroundColor: COLORS.bg,
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
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 16,
    marginBottom: 32,
  },
  errorContainer: {
    backgroundColor: COLORS.dangerBg,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.red + '40',
  },
  error: {
    color: COLORS.red,
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
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
});
