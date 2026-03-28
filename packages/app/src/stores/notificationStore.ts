import { create } from 'zustand';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from '../lib/api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

interface NotificationState {
  pushToken: string | null;
  isRegistered: boolean;
  registerForPush: () => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  pushToken: null,
  isRegistered: false,

  registerForPush: async () => {
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
        });
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') return;

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: '4254fbcc-5b16-4aab-b308-6c45db806390',
      });
      const token = tokenData.data;

      // Register with server
      await apiFetch('/api/push/register', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });

      set({ pushToken: token, isRegistered: true });
    } catch (err) {
      console.error('Push registration failed:', err);
    }
  },
}));
