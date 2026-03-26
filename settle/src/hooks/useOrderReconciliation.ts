'use client';

/**
 * Order Reconciliation Hook
 *
 * On WebSocket reconnect or visibility change (tab focus), fetches the latest
 * order state from the API to reconcile any events missed during disconnection.
 *
 * This ensures the UI never shows stale data after:
 * - Network drops / reconnections
 * - Device sleep / wake
 * - Tab switching (Page Visibility API)
 *
 * Usage:
 *   useOrderReconciliation(orderId, {
 *     onReconciled: (order) => setOrder(order),
 *   });
 */

import { useEffect, useRef, useCallback } from 'react';
import { useWebSocketChatContextOptional } from '@/context/WebSocketChatContext';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface ReconciliationOptions {
  /** Called with the fresh order data after a successful reconciliation fetch */
  onReconciled?: (order: Record<string, unknown>) => void;
  /** Called when reconciliation fetch fails */
  onError?: (error: string) => void;
  /** Minimum ms between reconciliation attempts (debounce). Default: 2000 */
  debounceMs?: number;
  /** Enable visibility-change reconciliation (tab focus). Default: true */
  reconcileOnVisibilityChange?: boolean;
}

export function useOrderReconciliation(
  orderId: string | null,
  options: ReconciliationOptions = {}
) {
  const {
    onReconciled,
    onError,
    debounceMs = 2000,
    reconcileOnVisibilityChange = true,
  } = options;

  const ws = useWebSocketChatContextOptional();
  const lastReconcileRef = useRef<number>(0);
  const onReconciledRef = useRef(onReconciled);
  const onErrorRef = useRef(onError);

  // Keep refs in sync
  useEffect(() => {
    onReconciledRef.current = onReconciled;
  }, [onReconciled]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const reconcile = useCallback(async () => {
    if (!orderId) return;

    // Debounce: skip if reconciled recently
    const now = Date.now();
    if (now - lastReconcileRef.current < debounceMs) return;
    lastReconcileRef.current = now;

    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`);
      if (!res.ok) {
        onErrorRef.current?.(`Failed to reconcile order: HTTP ${res.status}`);
        return;
      }

      const data = await res.json();
      if (data.success && data.data) {
        onReconciledRef.current?.(data.data);
      }
    } catch (err) {
      console.warn('[Reconciliation] Fetch failed', err);
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    }
  }, [orderId, debounceMs]);

  // Reconcile on WebSocket reconnect (state: reconnecting/connecting → connected)
  const prevConnectionState = useRef(ws?.connectionState);
  useEffect(() => {
    const prev = prevConnectionState.current;
    const curr = ws?.connectionState;
    prevConnectionState.current = curr;

    // Trigger reconciliation when transitioning to 'connected' from a disconnected state
    if (
      curr === 'connected' &&
      prev &&
      prev !== 'connected' &&
      prev !== 'disconnected' // Don't reconcile on initial connect
    ) {
      console.log('[Reconciliation] WebSocket reconnected, fetching latest order state');
      reconcile();
    }
  }, [ws?.connectionState, reconcile]);

  // Reconcile on page visibility change (tab becomes visible after being hidden)
  useEffect(() => {
    if (!reconcileOnVisibilityChange || !orderId) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Reconciliation] Tab became visible, fetching latest order state');
        reconcile();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [orderId, reconcileOnVisibilityChange, reconcile]);

  // Reconcile on navigator online event (network restored)
  useEffect(() => {
    if (!orderId) return;

    const handleOnline = () => {
      console.log('[Reconciliation] Network restored, fetching latest order state');
      reconcile();
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [orderId, reconcile]);

  return { reconcile };
}

export default useOrderReconciliation;
