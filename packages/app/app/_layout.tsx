import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, AppState, type AppStateStatus, ActivityIndicator } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef, useCallback } from 'react';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { useAuthStore } from '../src/stores/authStore';
import LockScreen from '../src/components/LockScreen';
import ErrorBoundary from '../src/components/ErrorBoundary';
import { EditionProvider } from '../src/edition/EditionProvider';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { COLORS } from '../src/theme/tokens';
import ConnectionBanner from '../src/components/ConnectionBanner';

SplashScreen.preventAutoHideAsync();

const BACKGROUND_LOCK_MS = 2 * 60 * 1000; // 2 minutes

function AppContent() {
  const isUnlocked = useAuthStore((s) => s.isUnlocked);
  const lock = useAuthStore((s) => s.lock);
  const backgroundedAt = useRef<number | null>(null);
  const { colors, isDark } = useTheme();

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
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.blue} />
      </View>
    );
  }

  if (!isUnlocked) return <LockScreen />;

  return (
    <EditionProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} onLayout={onLayoutReady}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ConnectionBanner />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.textPrimary, headerTitleStyle: { fontFamily: 'Inter_700Bold' } }} />
          <Stack.Screen name="servers" options={{ headerShown: true, title: 'All Servers', headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.textPrimary, headerTitleStyle: { fontFamily: 'Inter_700Bold' } }} />
        </Stack>
      </SafeAreaView>
    </EditionProvider>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppContent />
        </ThemeProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
