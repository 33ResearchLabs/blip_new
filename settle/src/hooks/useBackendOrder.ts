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
      const incomingVersion = incoming.order_version;

      // Version check: only accept newer data
      if (
        currentVersionRef.current !== undefined &&
        incomingVersion !== undefined &&
        incomingVersion < currentVersionRef.current
      ) {
        return; // Stale data, ignore
      }

      currentVersionRef.current = incomingVersion;
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

  // Pusher subscription: re-fetch on any order event
  useEffect(() => {
    if (!pusher || !orderId) return;

    const channelName = `private-order-${orderId}`;
    let channel: any;

    try {
      channel = pusher.subscribe(channelName);

      const handleUpdate = () => {
        // Re-fetch the full order from backend (gets fresh enriched response)
        fetchOrder();
      };

      channel.bind('order:updated', handleUpdate);
      channel.bind('order:status_changed', handleUpdate);
      channel.bind('order:cancelled', handleUpdate);
      channel.bind('order:completed', handleUpdate);
      channel.bind('order:disputed', handleUpdate);
      channel.bind('order:escrowed', handleUpdate);
      channel.bind('order:payment_sent', handleUpdate);

      return () => {
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
