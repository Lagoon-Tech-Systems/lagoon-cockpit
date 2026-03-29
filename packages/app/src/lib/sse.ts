import { useServerStore } from '../stores/serverStore';

type SSECallback = (event: string, data: unknown) => void;

let controller: AbortController | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

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
        scheduleReconnect(connect, onEvent);
        return;
      }

      reconnectAttempt = 0;
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
    scheduleReconnect(connect, onEvent);
  };

  connect();

  return disconnect;
}

function scheduleReconnect(connectFn: () => void, _onEvent: SSECallback) {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
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
}

export { disconnect as disconnectSSE };
