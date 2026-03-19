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
  system: SystemMetrics;
  containers: { total: number; running: number; stopped: number; unhealthy: number };
  stacks: { total: number; allHealthy: boolean };
  timestamp: string;
}

interface DashboardState {
  overview: OverviewData | null;
  containers: ContainerSummary[];
  stacks: StackSummary[];
  alerts: Alert[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: string | null;

  setOverview: (data: OverviewData) => void;
  setContainers: (data: ContainerSummary[]) => void;
  setStacks: (data: StackSummary[]) => void;
  addAlert: (alert: Alert) => void;
  updateFromSSE: (event: string, data: unknown) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearAlerts: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  overview: null,
  containers: [],
  stacks: [],
  alerts: [],
  isLoading: false,
  error: null,
  lastUpdated: null,

  setOverview: (data) => set({ overview: data, lastUpdated: new Date().toISOString() }),
  setContainers: (data) => set({ containers: data }),
  setStacks: (data) => set({ stacks: data }),

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

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  clearAlerts: () => set({ alerts: [] }),
}));
