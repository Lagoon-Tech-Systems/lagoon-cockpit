const mockStorage = new Map<string, string>();

const mockGetItemAsync = jest.fn(async (key: string) => mockStorage.get(key) ?? null);
const mockSetItemAsync = jest.fn(async (key: string, value: string) => {
  mockStorage.set(key, value);
});
const mockDeleteItemAsync = jest.fn(async (key: string) => {
  mockStorage.delete(key);
});

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: mockGetItemAsync,
  setItemAsync: mockSetItemAsync,
  deleteItemAsync: mockDeleteItemAsync,
}));

const TEST_URL = 'https://server.example.test';
const TEST_EMAIL = 'operator@example.test';
const TEST_PASSWORD = 'test-only-password';

function response(ok: boolean, status: number, body: Record<string, unknown>): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

function loadFreshServerStore() {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../serverStore').useServerStore as typeof import('../serverStore').useServerStore;
}

function persistedProfile(authMode: 'key' | 'login' = 'login') {
  return {
    id: `${authMode}-profile`,
    name: 'Test Server',
    url: TEST_URL,
    authMode,
    createdAt: 1,
  };
}

function seedProfile(authMode: 'key' | 'login' = 'login') {
  const profile = persistedProfile(authMode);
  mockStorage.set('cockpit_server_profiles', JSON.stringify([profile]));
  return profile;
}

beforeEach(() => {
  mockStorage.clear();
  mockGetItemAsync.mockClear();
  mockSetItemAsync.mockClear();
  mockDeleteItemAsync.mockClear();
  jest.restoreAllMocks();
});

describe('login profile reconnect', () => {
  it('reconnects after restart through refresh and stores the rotated token', async () => {
    let loginCalls = 0;
    let refreshCalls = 0;
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const requestUrl = String(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;

      if (requestUrl.endsWith('/auth/login')) {
        loginCalls += 1;
        expect(body).toEqual({ email: TEST_EMAIL, password: TEST_PASSWORD });
        return response(true, 200, {
          accessToken: 'initial-access-token',
          refreshToken: 'initial-refresh-token',
          role: 'operator',
          serverName: 'Test Server',
        });
      }

      if (requestUrl.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        expect(body).toEqual({ refreshToken: 'initial-refresh-token' });
        return response(true, 200, {
          accessToken: 'restarted-access-token',
          refreshToken: 'rotated-refresh-token',
        });
      }

      throw new Error(`Unexpected request: ${requestUrl}`);
    }) as jest.Mock;

    const firstStore = loadFreshServerStore();
    await firstStore.getState().addProfile({
      name: 'Test Server',
      url: TEST_URL,
      authMode: 'login',
    });
    const profile = firstStore.getState().profiles[0];
    await firstStore.getState().authenticate(profile.id, TEST_PASSWORD, { email: TEST_EMAIL });

    expect(mockStorage.get(`cockpit_cred_${profile.id}`)).toBeUndefined();
    expect(mockStorage.get(`cockpit_refresh_${profile.id}`)).toBe('initial-refresh-token');
    expect(mockStorage.get('cockpit_server_profiles')).not.toContain(TEST_EMAIL);

    const restartedStore = loadFreshServerStore();
    expect(restartedStore.getState().profiles).toEqual([]);
    expect(restartedStore.getState().accessToken).toBeNull();

    await restartedStore.getState().loadProfiles();
    await expect(restartedStore.getState().reconnect(profile.id)).resolves.toBe('connected');

    expect(restartedStore.getState().activeProfileId).toBe(profile.id);
    expect(restartedStore.getState().accessToken).toBe('restarted-access-token');
    expect(mockStorage.get(`cockpit_refresh_${profile.id}`)).toBe('rotated-refresh-token');
    expect(loginCalls).toBe(1);
    expect(refreshCalls).toBe(1);
  });

  it('returns needs-login without calling login when the refresh token is missing', async () => {
    const profile = seedProfile();
    global.fetch = jest.fn() as jest.Mock;
    const store = loadFreshServerStore();
    await store.getState().loadProfiles();

    await expect(store.getState().reconnect(profile.id)).resolves.toBe('needs-login');

    expect(store.getState().activeProfileId).toBe(profile.id);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns needs-login without calling login when the refresh token is rejected', async () => {
    const profile = seedProfile();
    mockStorage.set(`cockpit_refresh_${profile.id}`, 'rejected-refresh-token');
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`${TEST_URL}/auth/refresh`);
      return response(false, 401, { error: 'Invalid or expired refresh token' });
    }) as jest.Mock;
    const store = loadFreshServerStore();
    await store.getState().loadProfiles();

    await expect(store.getState().reconnect(profile.id)).resolves.toBe('needs-login');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).not.toContain('/auth/login');
  });

  it('never stores the password after a successful login', async () => {
    global.fetch = jest.fn(async () =>
      response(true, 200, {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        role: 'operator',
        serverName: 'Test Server',
      }),
    ) as jest.Mock;
    const store = loadFreshServerStore();
    await store.getState().addProfile({
      name: 'Test Server',
      url: TEST_URL,
      authMode: 'login',
    });
    const profile = store.getState().profiles[0];

    await store.getState().authenticate(profile.id, TEST_PASSWORD, { email: TEST_EMAIL });

    expect(mockStorage.has(`cockpit_cred_${profile.id}`)).toBe(false);
    expect(mockSetItemAsync).not.toHaveBeenCalledWith(
      `cockpit_cred_${profile.id}`,
      TEST_PASSWORD,
    );
    expect([...mockStorage.values()].join('\n')).not.toContain(TEST_PASSWORD);
    expect(mockStorage.get(`cockpit_refresh_${profile.id}`)).toBe('refresh-token');
  });

  it('deletes a legacy stored login password when profiles load', async () => {
    const profile = seedProfile();
    mockStorage.set(`cockpit_cred_${profile.id}`, TEST_PASSWORD);
    const store = loadFreshServerStore();

    await store.getState().loadProfiles();

    expect(mockStorage.has(`cockpit_cred_${profile.id}`)).toBe(false);
    expect(mockDeleteItemAsync).toHaveBeenCalledWith(`cockpit_cred_${profile.id}`);
  });

  it('keeps key-mode reconnect using the stored API key', async () => {
    const profile = seedProfile('key');
    mockStorage.set(`cockpit_cred_${profile.id}`, 'test-api-key');
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${TEST_URL}/auth/token`);
      expect(JSON.parse(String(init?.body))).toEqual({ apiKey: 'test-api-key' });
      return response(true, 200, {
        accessToken: 'key-access-token',
        refreshToken: 'key-refresh-token',
        role: 'admin',
        serverName: 'Test Server',
      });
    }) as jest.Mock;
    const store = loadFreshServerStore();
    await store.getState().loadProfiles();

    await expect(store.getState().reconnect(profile.id)).resolves.toBe('connected');

    expect(mockStorage.get(`cockpit_cred_${profile.id}`)).toBe('test-api-key');
    expect(store.getState().accessToken).toBe('key-access-token');
  });
});
