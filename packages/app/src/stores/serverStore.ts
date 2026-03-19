import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const PROFILES_KEY = 'cockpit_server_profiles';
const credentialKey = (id: string) => `cockpit_cred_${id}`;
const REFRESH_KEY = (id: string) => `cockpit_refresh_${id}`;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface ServerProfile {
  id: string;
  name: string;
  url: string; // Full URL like "https://your-server:3000"
  authMode: 'key' | 'login';
  createdAt: number;
}

interface ServerState {
  profiles: ServerProfile[];
  activeProfileId: string | null;
  accessToken: string | null;
  serverName: string | null;
  userRole: string | null;
  isConnecting: boolean;
  error: string | null;

  loadProfiles: () => Promise<void>;
  addProfile: (profile: Omit<ServerProfile, 'id' | 'createdAt'>) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;
  updateProfile: (id: string, updates: Partial<Omit<ServerProfile, 'id' | 'createdAt'>>) => Promise<void>;
  setActiveProfile: (id: string) => void;
  authenticate: (profileId: string, credential: string, extra?: { email?: string }) => Promise<void>;
  refreshAuth: () => Promise<void>;
  disconnect: () => void;
  getActiveUrl: () => string | null;
}

async function readProfiles(): Promise<ServerProfile[]> {
  const raw = await SecureStore.getItemAsync(PROFILES_KEY);
  if (!raw) return [];
  return JSON.parse(raw) as ServerProfile[];
}

async function writeProfiles(profiles: ServerProfile[]): Promise<void> {
  await SecureStore.setItemAsync(PROFILES_KEY, JSON.stringify(profiles));
}

export const useServerStore = create<ServerState>((set, get) => ({
  profiles: [],
  activeProfileId: null,
  accessToken: null,
  serverName: null,
  userRole: null,
  isConnecting: false,
  error: null,

  loadProfiles: async () => {
    const profiles = await readProfiles();
    set({ profiles });
  },

  addProfile: async ({ name, url, authMode }) => {
    const id = generateId();
    const profile: ServerProfile = { id, name, url, authMode, createdAt: Date.now() };
    const existing = await readProfiles();
    const updated = [...existing, profile];
    await writeProfiles(updated);
    set({ profiles: updated });
  },

  removeProfile: async (id) => {
    await SecureStore.deleteItemAsync(credentialKey(id));
    await SecureStore.deleteItemAsync(REFRESH_KEY(id));
    const existing = await readProfiles();
    const updated = existing.filter((p) => p.id !== id);
    await writeProfiles(updated);
    const state = get();
    set({
      profiles: updated,
      activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
      accessToken: state.activeProfileId === id ? null : state.accessToken,
    });
  },

  updateProfile: async (id, updates) => {
    const existing = await readProfiles();
    const updated = existing.map((p) => (p.id === id ? { ...p, ...updates } : p));
    await writeProfiles(updated);
    set({ profiles: updated });
  },

  setActiveProfile: (id) => {
    set({ activeProfileId: id, accessToken: null, error: null, serverName: null, userRole: null });
  },

  authenticate: async (profileId, credential, extra) => {
    set({ isConnecting: true, error: null });
    try {
      const profile = get().profiles.find((p) => p.id === profileId);
      if (!profile) throw new Error('Profile not found');

      // Store credential for future use
      await SecureStore.setItemAsync(credentialKey(profileId), credential);

      const endpoint = profile.authMode === 'key' ? '/auth/token' : '/auth/login';
      const body =
        profile.authMode === 'key'
          ? { apiKey: credential }
          : { email: extra?.email, password: credential };

      const res = await fetch(`${profile.url}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `Authentication failed: ${res.status}`);
      }

      const data = await res.json();
      if (data.refreshToken) {
        await SecureStore.setItemAsync(REFRESH_KEY(profileId), data.refreshToken);
      }

      set({
        accessToken: data.accessToken,
        activeProfileId: profileId,
        serverName: data.serverName || profile.name,
        userRole: data.role || 'admin',
        isConnecting: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      set({ isConnecting: false, error: message });
      throw err;
    }
  },

  refreshAuth: async () => {
    const { activeProfileId, profiles } = get();
    if (!activeProfileId) throw new Error('No active profile');

    const profile = profiles.find((p) => p.id === activeProfileId);
    if (!profile) throw new Error('Profile not found');

    const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY(activeProfileId));
    if (!refreshToken) throw new Error('No refresh token');

    const res = await fetch(`${profile.url}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      await SecureStore.deleteItemAsync(REFRESH_KEY(activeProfileId));
      set({ accessToken: null });
      throw new Error('Refresh failed');
    }

    const data = await res.json();
    if (data.refreshToken) {
      await SecureStore.setItemAsync(REFRESH_KEY(activeProfileId), data.refreshToken);
    }
    set({ accessToken: data.accessToken });
  },

  disconnect: () => {
    set({ accessToken: null, error: null, serverName: null, userRole: null });
  },

  getActiveUrl: () => {
    const { profiles, activeProfileId } = get();
    if (!activeProfileId) return null;
    return profiles.find((p) => p.id === activeProfileId)?.url || null;
  },
}));
