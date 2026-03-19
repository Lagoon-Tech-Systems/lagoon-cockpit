import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, AppState, type AppStateStatus } from 'react-native';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../src/stores/authStore';
import LockScreen from '../src/components/LockScreen';

const BACKGROUND_LOCK_MS = 2 * 60 * 1000; // 2 minutes

export default function RootLayout() {
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const lock = useAuthStore((s) => s.lock);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (nextState === 'active' && backgroundedAt.current) {
        const elapsed = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (elapsed > BACKGROUND_LOCK_MS) {
          lock();
        }
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [lock]);

  if (!isUnlocked) return <LockScreen />;

  return (
    <View style={{ flex: 1, backgroundColor: '#0D0D0D' }}>
      <StatusBar style="light" />
      <Slot />
    </View>
  );
}
