import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, AppState, type AppStateStatus, ActivityIndicator } from 'react-native';
import { useEffect, useRef, useCallback } from 'react';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../src/stores/authStore';
import LockScreen from '../src/components/LockScreen';
import { EditionProvider } from '../src/edition/EditionProvider';
import { COLORS } from '../src/theme/tokens';

SplashScreen.preventAutoHideAsync();

const BACKGROUND_LOCK_MS = 2 * 60 * 1000; // 2 minutes

export default function RootLayout() {
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const lock = useAuthStore((s) => s.lock);
  const backgroundedAt = useRef<number | null>(null);

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });

  const onLayoutReady = useCallback(async () => {
    if (fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

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

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLORS.blue} />
      </View>
    );
  }

  if (!isUnlocked) return <LockScreen />;

  return (
    <EditionProvider>
      <View style={{ flex: 1, backgroundColor: COLORS.bg }} onLayout={onLayoutReady}>
        <StatusBar style="light" />
        <Slot />
      </View>
    </EditionProvider>
  );
}
