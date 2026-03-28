/**
 * useBackendOrder - Fetch and subscribe to a single order.
 *
 * Returns the order EXACTLY as the backend sends it.
 * NO role computation. NO action derivation. NO state transitions.
 * The backend is the single source of truth.
 *
 * Features:
 * - Fetches order from GET /api/orders/{id}
 * - Subscribes to Pusher real-time updates
 * - Re-fetches on update events (gets fresh enriched response)
 * - Version-aware: only accepts newer versions
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { shouldAcceptUpdate } from '@/lib/orders/statusResolver';
import type { BackendOrder } from '@/types/backendOrder';

interface UseBackendOrderOptions {
  orderId: string | null;
  /** Pusher instance (from PusherContext) */
  pusher?: any;
  /** Polling interval in ms (fallback when Pusher unavailable). Default: 5000 */
  pollingInterval?: number;
  /** Whether to enable polling fallback. Default: true */
  enablePolling?: boolean;
}

interface UseBackendOrderResult {
  order: BackendOrder | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBackendOrder(options: UseBackendOrderOptions): UseBackendOrderResult {
  const { orderId, pusher, pollingInterval = 5000, enablePolling = true } = options;
  const [order, setOrder] = useState<BackendOrder | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentVersionRef = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`);
      const data = await res.json();

      if (!mountedRef.current) return;

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to fetch order');
        return;
      }

      const incoming = data.data as BackendOrder;

      // Version check: only accept newer data
      const versionCheck = shouldAcceptUpdate(incoming.order_version, currentVersionRef.current);
      if (!versionCheck.accept) {
        return; // Stale data, ignore
      }

      currentVersionRef.current = incoming.order_version;
      setOrder(incoming);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [orderId]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchOrder();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchOrder]);

  // Pusher subscription: debounced re-fetch on any order event
  // Multiple events (e.g. status_changed + updated) may fire within milliseconds
  // for a single state transition — debounce to collapse into one API call
  useEffect(() => {
    if (!pusher || !orderId) return;

    const channelName = `private-order-${orderId}`;
    let channel: any;

    try {
      channel = pusher.subscribe(channelName);

      const debouncedFetch = () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(fetchOrder, 200);
      };

      const events = [
        'order:updated', 'order:status_changed', 'order:cancelled',
        'order:completed', 'order:disputed', 'order:escrowed', 'order:payment_sent',
      ];
      events.forEach(e => channel.bind(e, debouncedFetch));

      return () => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        channel.unbind_all();
        pusher.unsubscribe(channelName);
      };
    } catch {
      // Pusher not available, polling will handle it
    }
  }, [pusher, orderId, fetchOrder]);

  // Polling fallback (when Pusher is unavailable)
  useEffect(() => {
    if (!enablePolling || !orderId || pusher?.connection?.state === 'connected') return;

    const interval = setInterval(fetchOrder, pollingInterval);
    return () => clearInterval(interval);
  }, [enablePolling, orderId, pusher, pollingInterval, fetchOrder]);

  return {
    order,
    isLoading,
    error,
    refetch: fetchOrder,
  };
}
