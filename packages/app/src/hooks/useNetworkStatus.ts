import { useState, useEffect } from 'react';
import { Platform, AppState, type AppStateStatus } from 'react-native';

/**
 * Lightweight network status hook.
 * - Web: uses navigator.onLine + online/offline events
 * - Native: pings the active server on app foreground + SSE failures
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      const goOnline = () => setIsOnline(true);
      const goOffline = () => setIsOnline(false);
      window.addEventListener('online', goOnline);
      window.addEventListener('offline', goOffline);
      return () => {
        window.removeEventListener('online', goOnline);
        window.removeEventListener('offline', goOffline);
      };
    }

    // Native: check on app foreground
    const handleAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        fetch('https://clients3.google.com/generate_204', { method: 'HEAD', mode: 'no-cors' })
          .then(() => setIsOnline(true))
          .catch(() => setIsOnline(false));
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, []);

  return isOnline;
}
