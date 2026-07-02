import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { useServerStore } from '../stores/serverStore';
import { useNotificationStore } from '../stores/notificationStore';

/**
 * Hook that handles the full push notification lifecycle:
 * - Requests permissions on a physical device
 * - Gets the Expo push token and registers it with the server
 * - Listens for incoming notifications and tap responses
 * - Re-registers when the active server profile changes
 */
// Module-level guard: ensures the cold-start deep link is only consumed once,
// even if this hook re-mounts (e.g. Fast Refresh) or the live listener also fires.
let handledColdStart = false;

export function useNotifications() {
  const router = useRouter();
  const accessToken = useServerStore((s) => s.accessToken);
  const activeProfileId = useServerStore((s) => s.activeProfileId);
  const registerForPush = useNotificationStore((s) => s.registerForPush);
  const responseListenerRef = useRef<Notifications.Subscription | null>(null);
  const receivedListenerRef = useRef<Notifications.Subscription | null>(null);

  // Register push token when authenticated and profile changes
  useEffect(() => {
    if (!accessToken || !activeProfileId) return;

    // Only register on physical devices — simulators don't support push
    if (!Device.isDevice) {
      console.log('[PUSH] Skipping registration — not a physical device');
      return;
    }

    registerForPush();
  }, [accessToken, activeProfileId, registerForPush]);

  // Set up notification listeners
  useEffect(() => {
    // Fired when a notification arrives while the app is in the foreground
    receivedListenerRef.current = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[PUSH] Notification received:', notification.request.content.title);
      }
    );

    // Fired when the user taps on a notification
    responseListenerRef.current = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data;
        if (!data) return;

        try {
          if (data.type === 'container' && data.containerId) {
            router.push(`/(tabs)/containers`);
          } else if (data.type === 'alert_rule') {
            handledColdStart = true;
            if (data.eventId) {
              router.push(`/events/${data.eventId}`);
            } else {
              router.push(`/(tabs)/alerts`);
            }
          } else if (data.type === 'ssl') {
            router.push(`/(tabs)/monitoring`);
          } else {
            // Default: go to alerts tab
            router.push(`/(tabs)/alerts`);
          }
        } catch (err) {
          console.error('[PUSH] Navigation error:', err);
        }
      }
    );

    return () => {
      if (receivedListenerRef.current) {
        receivedListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, [router]);

  // Cold-start handler: if the app was launched (from killed state) by tapping
  // a notification, the live response listener above never fires for that tap —
  // it's only delivered via getLastNotificationResponseAsync(). Runs once on
  // mount; guarded so it can't double-navigate if the live listener also fires
  // for the same tap (observed on some Android OEMs).
  useEffect(() => {
    if (handledColdStart) return;

    (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (handledColdStart) return;
        const data: any = last?.notification?.request?.content?.data;
        if (data?.type === 'alert_rule' && data?.eventId) {
          handledColdStart = true;
          router.push(`/events/${data.eventId}`);
        }
      } catch (err) {
        console.error('[PUSH] Cold-start navigation error:', err);
      }
    })();
  }, [router]);
}
