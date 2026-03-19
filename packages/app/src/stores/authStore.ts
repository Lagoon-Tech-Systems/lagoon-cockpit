import { create } from 'zustand';
import * as LocalAuthentication from 'expo-local-authentication';

interface AuthState {
  isUnlocked: boolean;
  isLoading: boolean;
  unlock: () => Promise<boolean>;
  lock: () => void;
  checkBiometricSupport: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isUnlocked: false,
  isLoading: false,

  unlock: async () => {
    set({ isLoading: true });
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Lagoon Cockpit',
      });
      set({ isUnlocked: result.success, isLoading: false });
      return result.success;
    } catch {
      set({ isLoading: false });
      return false;
    }
  },

  lock: () => {
    set({ isUnlocked: false });
  },

  checkBiometricSupport: async () => {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    return hasHardware && isEnrolled;
  },
}));
