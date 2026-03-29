import { useEffect, useRef } from 'react';
import { useServerStore } from '../stores/serverStore';
import { useDashboardStore } from '../stores/dashboardStore';
import { connectSSE, disconnectSSE, onSSEStatus } from '../lib/sse';

/**
 * Hook that manages SSE connection lifecycle.
 * Connects when authenticated, disconnects on unmount or disconnect.
 */
export function useSSE() {
  const accessToken = useServerStore((s) => s.accessToken);
  const activeProfileId = useServerStore((s) => s.activeProfileId);
  const updateFromSSE = useDashboardStore((s) => s.updateFromSSE);
  const setSSEStatus = useDashboardStore((s) => s.setSSEStatus);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onSSEStatus(setSSEStatus);
  }, [setSSEStatus]);

  useEffect(() => {
    if (!accessToken || !activeProfileId) {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    cleanupRef.current = connectSSE((event, data) => {
      updateFromSSE(event, data);
    });

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [accessToken, activeProfileId, updateFromSSE]);

  return { disconnect: disconnectSSE };
}
