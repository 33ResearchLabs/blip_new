'use client';

/**
 * useOrderRealtimeWS — opt-in WebSocket subscription for ORDER_UPDATED events.
 *
 * SHADOW MODE / SAFE BY DEFAULT:
 *   - Disabled unless NEXT_PUBLIC_USE_WS_ORDER === 'true' AND a token is supplied
 *   - When disabled or failing, this hook is a no-op — Pusher (via the existing
 *     useRealtimeOrder hook) keeps working untouched
 *   - Does NOT replace Pusher. Components are expected to keep calling their
 *     existing Pusher-based hook; this one just delivers the SAME order updates
 *     a little faster when the shadow WS path is healthy
 *   - Does NOT touch chat or notifications
 *
 * Removable: delete this file. Nothing else in the app imports it unless a
 * caller explicitly opts in.
 */
import { useEffect, useRef, useState } from 'react';

export interface OrderUpdatePayload {
  orderId: string;
  status: string;
  previousStatus?: string;
  orderVersion?: number;
  updatedAt?: string;
}

export interface UseOrderRealtimeWSOptions {
  /** Called when an ORDER_UPDATED event arrives for this orderId. */
  onUpdate?: (data: OrderUpdatePayload) => void;
  /**
   * Token getter. Hook calls this once per (re)connect. Return null to skip.
   * In production this should be your access token. In dev/smoke a shadow
   * fallback token works too.
   */
  getToken?: () => string | null | Promise<string | null>;
  /** Override the WS URL. Defaults to NEXT_PUBLIC_WS_SHADOW_URL. */
  url?: string;
  /** Force-enable regardless of env flag (used by tests). */
  force?: boolean;
}

export interface UseOrderRealtimeWSReturn {
  isEnabled: boolean;
  isConnected: boolean;
  /** Last error message, if any. Cleared on reconnect. */
  error: string | null;
}

const FLAG_ENABLED =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_WS_ORDER === 'true';

const DEFAULT_URL =
  (typeof process !== 'undefined' &&
    process.env.NEXT_PUBLIC_WS_SHADOW_URL) ||
  'ws://localhost:4001';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

export function useOrderRealtimeWS(
  orderId: string | null,
  options: UseOrderRealtimeWSOptions = {}
): UseOrderRealtimeWSReturn {
  const { onUpdate, getToken, url = DEFAULT_URL, force = false } = options;

  const enabled = (force || FLAG_ENABLED) && !!orderId;

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable refs so reconnect logic isn't re-entered when callbacks change.
  const onUpdateRef = useRef(onUpdate);
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!enabled || !orderId) {
      setIsConnected(false);
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    // Track last seen orderVersion to drop duplicate at-least-once events.
    let lastVersion = -Infinity;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** attempt,
        RECONNECT_MAX_MS
      );
      attempt++;
      reconnectTimer = setTimeout(() => {
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (cancelled) return;
      try {
        const token = (await getTokenRef.current?.()) ?? null;
        if (!token) {
          setError('no token');
          // No token = silently stay disconnected. Pusher still works.
          return;
        }
        // Subprotocol transport: ['bearer', '<token>']. Server selects
        // 'bearer' and reads the token from the same header.
        ws = new WebSocket(url, ['bearer', token]);

        ws.onopen = () => {
          if (cancelled) {
            ws?.close();
            return;
          }
          setIsConnected(true);
          setError(null);
          attempt = 0;
          ws?.send(JSON.stringify({ type: 'JOIN_ORDER', orderId }));
        };

        ws.onmessage = (ev) => {
          let parsed: { type?: string; room?: string; data?: unknown };
          try {
            parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
          } catch {
            return;
          }
          if (!parsed || typeof parsed !== 'object') return;

          if (parsed.type === 'ERROR') {
            const msg =
              (parsed.data as { message?: string } | undefined)?.message ||
              'ws error';
            setError(msg);
            return;
          }
          if (parsed.type !== 'ORDER_UPDATED') return;
          if (parsed.room !== `order:${orderId}`) return;

          const data = parsed.data as OrderUpdatePayload | undefined;
          if (!data || data.orderId !== orderId) return;

          // Dedupe by orderVersion (at-least-once delivery contract).
          if (
            typeof data.orderVersion === 'number' &&
            data.orderVersion <= lastVersion
          ) {
            return;
          }
          if (typeof data.orderVersion === 'number') {
            lastVersion = data.orderVersion;
          }

          try {
            onUpdateRef.current?.(data);
          } catch (err) {
            console.warn('[ws-shadow] onUpdate threw', err);
          }
        };

        ws.onerror = () => {
          // onerror fires before onclose; record but let onclose drive reconnect.
          setError('socket error');
        };

        ws.onclose = () => {
          if (cancelled) return;
          setIsConnected(false);
          ws = null;
          scheduleReconnect();
        };
      } catch (err) {
        setError((err as Error).message);
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      setIsConnected(false);
    };
  }, [enabled, orderId, url]);

  return { isEnabled: enabled, isConnected, error };
}

export default useOrderRealtimeWS;
