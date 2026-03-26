/**
 * useBackendOrders - Fetch and subscribe to order lists.
 *
 * Returns orders EXACTLY as the backend sends them, with all UI fields pre-computed.
 * NO role computation. NO action derivation.
 *
 * Supports both user orders (GET /api/orders) and merchant orders (GET /api/merchant/orders).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import type { BackendOrder } from '@/types/backendOrder';

interface UseBackendOrdersOptions {
  /** 'user' fetches from /api/orders, 'merchant' from /api/merchant/orders */
  mode: 'user' | 'merchant';
  /** User ID (required for mode='user') */
  userId?: string;
  /** Merchant ID (required for mode='merchant') */
  merchantId?: string;
  /** Include all pending orders in broadcast mode (merchant only) */
  includeAllPending?: boolean;
  /** Pusher instance */
  pusher?: any;
  /** Polling interval in ms. Default: 5000 */
  pollingInterval?: number;
  /** Whether to enable auto-refresh. Default: true */
  enabled?: boolean;
}

interface UseBackendOrdersResult {
  orders: BackendOrder[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useBackendOrders(options: UseBackendOrdersOptions): UseBackendOrdersResult {
  const {
    mode,
    userId,
    merchantId,
    includeAllPending = false,
    pusher,
    pollingInterval = 5000,
    enabled = true,
  } = options;

  const [orders, setOrders] = useState<BackendOrder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchOrders = useCallback(async () => {
    if (!enabled) return;

    const id = mode === 'user' ? userId : merchantId;
    if (!id) return;

    setIsLoading(true);
    setError(null);

    try {
      let url: string;
      if (mode === 'user') {
        url = `/api/orders?user_id=${id}`;
      } else {
        url = `/api/merchant/orders?merchant_id=${id}${includeAllPending ? '&include_all_pending=true' : ''}`;
      }

      const res = await fetchWithAuth(url);
      const data = await res.json();

      if (!mountedRef.current) return;

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to fetch orders');
        return;
      }

      const incoming = (data.data || []) as BackendOrder[];

      // Version-aware merge: keep newer versions
      setOrders(prev => {
        const prevMap = new Map(prev.map(o => [o.id, o]));

        return incoming.map(inc => {
          const existing = prevMap.get(inc.id);
          if (
            existing &&
            existing.order_version !== undefined &&
            inc.order_version !== undefined &&
            inc.order_version < existing.order_version
          ) {
            return existing; // Keep newer local version
          }
          return inc;
        });
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [mode, userId, merchantId, includeAllPending, enabled]);

  // Initial fetch
  useEffect(() => {
    mountedRef.current = true;
    fetchOrders();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchOrders]);

  // Pusher subscription for real-time updates
  useEffect(() => {
    if (!pusher || !enabled) return;

    const actorId = mode === 'user' ? userId : merchantId;
    if (!actorId) return;

    const channelName = mode === 'user'
      ? `private-user-${actorId}`
      : `private-merchant-${actorId}`;

    let channel: any;
    try {
      channel = pusher.subscribe(channelName);

      const handleUpdate = () => {
        // Re-fetch all orders (gets fresh enriched responses)
        fetchOrders();
      };

      channel.bind('order:updated', handleUpdate);
      channel.bind('order:new', handleUpdate);
      channel.bind('order:status_changed', handleUpdate);

      // Also subscribe to global broadcast for merchants
      let globalChannel: any;
      if (mode === 'merchant' && includeAllPending) {
        globalChannel = pusher.subscribe('private-merchants-global');
        globalChannel.bind('order:new', handleUpdate);
        globalChannel.bind('order:updated', handleUpdate);
      }

      return () => {
        channel.unbind_all();
        pusher.unsubscribe(channelName);
        if (globalChannel) {
          globalChannel.unbind_all();
          pusher.unsubscribe('private-merchants-global');
        }
      };
    } catch {
      // Pusher not available
    }
  }, [pusher, mode, userId, merchantId, includeAllPending, enabled, fetchOrders]);

  // Polling fallback
  useEffect(() => {
    if (!enabled || pusher?.connection?.state === 'connected') return;

    const interval = setInterval(fetchOrders, pollingInterval);
    return () => clearInterval(interval);
  }, [enabled, pusher, pollingInterval, fetchOrders]);

  return {
    orders,
    isLoading,
    error,
    refetch: fetchOrders,
  };
}
