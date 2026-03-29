import { useServerStore } from '../stores/serverStore';

type SSECallback = (event: string, data: unknown) => void;
type StatusCallback = (status: 'connected' | 'reconnecting' | 'disconnected') => void;

let controller: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let statusListener: StatusCallback | null = null;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/** Register a listener for SSE connection status changes */
export function onSSEStatus(cb: StatusCallback) {
  statusListener = cb;
}

function emitStatus(status: 'connected' | 'reconnecting' | 'disconnected') {
  statusListener?.(status);
}

/**
 * Connect to the SSE stream.
 * Automatically reconnects on disconnect.
 */
export function connectSSE(onEvent: SSECallback): () => void {
  disconnect();

  const connect = async () => {
    const { accessToken, getActiveUrl } = useServerStore.getState();
    const baseUrl = getActiveUrl();
    if (!baseUrl || !accessToken) return;

    controller = new AbortController();

    try {
      const res = await fetch(`${baseUrl}/api/stream`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        scheduleReconnect(connect);
        return;
      }

      reconnectAttempt = 0;
      emitStatus('connected');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = 'message';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              onEvent(currentEvent, data);
            } catch {
              // Skip malformed JSON
            }
            currentEvent = 'message';
          }
          // Skip comments (lines starting with :)
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }

    // Connection closed — reconnect
    scheduleReconnect(connect);
  };

  connect();

  return disconnect;
}

function scheduleReconnect(connectFn: () => void) {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  emitStatus('reconnecting');
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt++;
  reconnectTimeout = setTimeout(connectFn, delay);
}

function disconnect() {
  if (controller) {
    controller.abort();
    controller = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  emitStatus('disconnected');
}

export { disconnect as disconnectSSE };
