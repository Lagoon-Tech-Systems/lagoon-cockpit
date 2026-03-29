import { create } from 'zustand';

export interface SystemMetrics {
  hostname: string;
  cpuPercent: number;
  cpuCount: number;
  memory: { total: number; used: number; free: number; percent: number };
  disk: { total: number; used: number; free: number; percent: number };
  load: { load1: number; load5: number; load15: number };
  uptimeSeconds: number;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  health: string | null;
  composeProject: string | null;
  composeService: string | null;
  ports: Array<{ private: number; public?: number; type: string }>;
  networkMode: string[];
}

export interface StackSummary {
  name: string;
  containerCount: number;
  running: number;
  stopped: number;
  unhealthy: number;
  status: string;
  containers: ContainerSummary[];
}

export interface WindowsService {
  name: string;
  displayName: string;
  status: string;
  pid: number;
  startType: string;
  protected: boolean;
}

export interface WindowsProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryMB: number;
  status: string;
  user: string;
}

export interface Alert {
  type: string;
  containerId?: string;
  containerName?: string;
  previousState?: string;
  currentState?: string;
  timestamp: string;
  message?: string;
}

interface OverviewData {
  serverName: string;
  platform?: 'linux' | 'windows';
  system: SystemMetrics;
  containers: { total: number; running: number; stopped: number; unhealthy: number };
  stacks: { total: number; allHealthy: boolean };
  services?: { total: number; running: number; stopped: number };
  timestamp: string;
}

type SSEStatus = 'connected' | 'reconnecting' | 'disconnected';

interface DashboardState {
  overview: OverviewData | null;
  platform: 'linux' | 'windows';
  containers: ContainerSummary[];
  stacks: StackSummary[];
  services: WindowsService[];
  processes: WindowsProcess[];
  alerts: Alert[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;
  sseStatus: SSEStatus;

  setOverview: (data: OverviewData) => void;
  setPlatform: (platform: 'linux' | 'windows') => void;
  setContainers: (data: ContainerSummary[]) => void;
  setStacks: (data: StackSummary[]) => void;
  setServices: (data: WindowsService[]) => void;
  setProcesses: (data: WindowsProcess[]) => void;
  addAlert: (alert: Alert) => void;
  updateFromSSE: (event: string, data: unknown) => void;
  setSSEStatus: (status: SSEStatus) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearAlerts: () => void;
  reset: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  overview: null,
  platform: 'linux',
  containers: [],
  stacks: [],
  services: [],
  processes: [],
  alerts: [],
  isLoading: false,
  error: null,
  lastUpdated: null,
  sseStatus: 'disconnected' as SSEStatus,

  setOverview: (data) => {
    const platform = data.platform === 'windows' ? 'windows' : 'linux';
    set({ overview: data, platform, lastUpdated: new Date().toISOString() });
  },
  setPlatform: (platform) => set({ platform }),
  setContainers: (data) => set({ containers: data }),
  setStacks: (data) => set({ stacks: data }),
  setServices: (data) => set({ services: data }),
  setProcesses: (data) => set({ processes: data }),

  addAlert: (alert) =>
    set((state) => ({
      alerts: [alert, ...state.alerts].slice(0, 200), // Keep last 200
    })),

  updateFromSSE: (event, data) => {
    switch (event) {
      case 'metrics':
        set((state) => {
          if (!state.overview) return {};
          return {
            overview: { ...state.overview, system: data as SystemMetrics },
            lastUpdated: new Date().toISOString(),
          };
        });
        break;
      case 'containers':
        set({
          containers: data as ContainerSummary[],
          lastUpdated: new Date().toISOString(),
        });
        break;
      case 'alert':
        get().addAlert(data as Alert);
        break;
    }
  },

  setSSEStatus: (status) => set({ sseStatus: status }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearAlerts: () => set({ alerts: [] }),
  reset: () =>
    set({
      overview: null,
      platform: 'linux',
      containers: [],
      stacks: [],
      services: [],
      processes: [],
      alerts: [],
      isLoading: false,
      error: null,
      lastUpdated: null,
      sseStatus: 'disconnected' as SSEStatus,
    }),
}));
