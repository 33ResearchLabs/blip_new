'use client';

/**
 * Real-time Orders List Hook
 *
 * Subscribes to order list updates for users or merchants via Pusher + WS.
 * Events are BATCHED into 100ms windows to prevent render storms at high TPS.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';
import { getUserChannel, getMerchantChannel, getAllMerchantsChannel } from '@/lib/pusher/channels';
import { ORDER_EVENTS } from '@/lib/pusher/events';
import { shouldAcceptUpdate } from '@/lib/orders/statusResolver';

interface OrderData {
  id: string;
  status: string;
  minimal_status?: string;
  order_version?: number;
  user_id: string;
  merchant_id: string;
  crypto_amount: number;
  fiat_amount: number;
  rate: number;
  type: 'buy' | 'sell';
  payment_method: 'bank' | 'cash';
  created_at: string;
  [key: string]: unknown;
}

interface ExtensionRequestData {
  orderId: string;
  requestedBy: 'user' | 'merchant';
  extensionMinutes: number;
  extensionCount: number;
  maxExtensions: number;
  extensionsRemaining: number;
}

interface ExtensionResponseData {
  orderId: string;
  accepted: boolean;
  respondedBy: 'user' | 'merchant';
  newExpiresAt?: string;
  newStatus?: string;
}

export interface CorridorPriceData {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  confidence: string;
  updated_at: string;
}

interface UseRealtimeOrdersOptions {
  actorType: 'user' | 'merchant';
  actorId: string | null;
  onOrderCreated?: (order: OrderData) => void;
  onOrderStatusUpdated?: (orderId: string, newStatus: string, previousStatus: string, extra?: { buyerMerchantId?: string; merchantId?: string }) => void;
  onExtensionRequested?: (data: ExtensionRequestData) => void;
  onExtensionResponse?: (data: ExtensionResponseData) => void;
  onPriceUpdate?: (data: CorridorPriceData) => void;
}

interface UseRealtimeOrdersReturn {
  orders: OrderData[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => Promise<void>;
}

// ─── Event batch types ──────────────────────────────────────────────
type BatchedEvent =
  | { type: 'created'; orderId: string; data?: OrderData; order_version?: number }
  | { type: 'status'; orderId: string; status: string; minimal_status?: string; order_version?: number; previousStatus: string; data?: OrderData; buyer_merchant_id?: string; merchant_id?: string }
  | { type: 'cancelled'; orderId: string; order_version?: number; minimal_status?: string };

const BATCH_WINDOW_MS = 100; // Coalesce events within 100ms

export function useRealtimeOrders(
  options: UseRealtimeOrdersOptions
): UseRealtimeOrdersReturn {
  const { actorType, actorId, onOrderCreated, onOrderStatusUpdated, onExtensionRequested, onExtensionResponse, onPriceUpdate } = options;

  const [orders, setOrders] = useState<OrderData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pusher = usePusherOptional();
  const isConnected = pusher?.isConnected ?? false;
  const subscribedRef = useRef(false);

  // Callback refs (stable references)
  const onOrderCreatedRef = useRef(onOrderCreated);
  const onOrderStatusUpdatedRef = useRef(onOrderStatusUpdated);
  const onExtensionRequestedRef = useRef(onExtensionRequested);
  const onExtensionResponseRef = useRef(onExtensionResponse);
  const onPriceUpdateRef = useRef(onPriceUpdate);

  useEffect(() => {
    onOrderCreatedRef.current = onOrderCreated;
    onOrderStatusUpdatedRef.current = onOrderStatusUpdated;
    onExtensionRequestedRef.current = onExtensionRequested;
    onExtensionResponseRef.current = onExtensionResponse;
    onPriceUpdateRef.current = onPriceUpdate;
  }, [onOrderCreated, onOrderStatusUpdated, onExtensionRequested, onExtensionResponse, onPriceUpdate]);

  // ─── Cross-source dedup (shared between Pusher + WS) ───────────
  const recentEventsRef = useRef(new Map<string, number>());
  const isDuplicate = useCallback((key: string) => {
    const now = Date.now();
    const lastSeen = recentEventsRef.current.get(key);
    if (lastSeen && now - lastSeen < 3000) return true;
    recentEventsRef.current.set(key, now);
    // Evict expired entries every 50 insertions
    if (recentEventsRef.current.size > 50) {
      for (const [k, t] of recentEventsRef.current) {
        if (now - t > 5000) recentEventsRef.current.delete(k);
      }
      if (recentEventsRef.current.size > 100) {
        const iter = recentEventsRef.current.keys();
        while (recentEventsRef.current.size > 50) {
          const oldest = iter.next().value;
          if (oldest) recentEventsRef.current.delete(oldest); else break;
        }
      }
    }
    return false;
  }, []);

  // ─── Event batch queue ──────────────────────────────────────────
  const batchQueueRef = useRef<BatchedEvent[]>([]);
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const needsRefetchRef = useRef(false);

  const flushBatch = useCallback(() => {
    const events = batchQueueRef.current;
    batchQueueRef.current = [];
    batchTimerRef.current = null;

    if (events.length === 0 && !needsRefetchRef.current) return;

    // Deduplicate: keep only the latest event per orderId
    const latestByOrder = new Map<string, BatchedEvent>();
    const createdOrders: OrderData[] = [];

    for (const evt of events) {
      latestByOrder.set(evt.orderId, evt);
      if (evt.type === 'created' && evt.data) {
        createdOrders.push(evt.data);
      }
    }

    // Apply all state updates in ONE setOrders call
    if (latestByOrder.size > 0) {
      setOrders((prev) => {
        let updated = [...prev];

        for (const [, evt] of latestByOrder) {
          if (evt.type === 'created') {
            if (evt.data) {
              const existIdx = updated.findIndex(o => o.id === evt.orderId);
              if (existIdx >= 0) {
                const versionCheck = shouldAcceptUpdate(evt.data.order_version, updated[existIdx].order_version);
                if (versionCheck.accept) {
                  updated[existIdx] = evt.data;
                }
              } else {
                updated = [evt.data, ...updated];
              }
            }
          } else if (evt.type === 'status') {
            updated = updated.map(order => {
              if (order.id !== evt.orderId) return order;
              const versionCheck = shouldAcceptUpdate(
                evt.data?.order_version || evt.order_version,
                order.order_version
              );
              if (!versionCheck.accept) return order;
              if (evt.data) return evt.data;
              return {
                ...order,
                status: evt.status,
                minimal_status: evt.minimal_status || order.minimal_status,
                order_version: evt.order_version || order.order_version,
              };
            });
          } else if (evt.type === 'cancelled') {
            updated = updated.map(order => {
              if (order.id !== evt.orderId) return order;
              const versionCheck = shouldAcceptUpdate(evt.order_version, order.order_version);
              if (!versionCheck.accept) return order;
              return {
                ...order,
                status: 'cancelled',
                minimal_status: evt.minimal_status || 'cancelled',
                order_version: evt.order_version || order.order_version,
              };
            });
          }
        }

        return updated;
      });
    }

    // Fire callbacks AFTER state update (outside setOrders)
    for (const order of createdOrders) {
      onOrderCreatedRef.current?.(order);
    }
    for (const [, evt] of latestByOrder) {
      if (evt.type === 'status') {
        onOrderStatusUpdatedRef.current?.(evt.orderId, evt.status, evt.previousStatus, {
          buyerMerchantId: evt.buyer_merchant_id,
          merchantId: evt.merchant_id,
        });
      }
    }

    // If any event required a full refetch (e.g. ORDER_CREATED without data), do it once
    if (needsRefetchRef.current) {
      needsRefetchRef.current = false;
      fetchOrders();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps — fetchOrders is stable via ref

  const enqueueEvent = useCallback((event: BatchedEvent) => {
    batchQueueRef.current.push(event);
    if (!batchTimerRef.current) {
      batchTimerRef.current = setTimeout(flushBatch, BATCH_WINDOW_MS);
    }
  }, [flushBatch]);

  // ─── Fetch orders from API ──────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    if (!actorId) return;

    setIsLoading(true);
    setError(null);

    try {
      const endpoint =
        actorType === 'merchant'
          ? `/api/merchants/${actorId}/orders?merchant_id=${actorId}`
          : `/api/users/${actorId}/orders?user_id=${actorId}`;

      const res = await fetch(endpoint);

      if (!res.ok) {
        setIsLoading(false);
        return;
      }

      const data = await res.json();

      if (data.success && data.data) {
        setOrders(data.data);
      } else {
        setError(data.error || 'Failed to fetch orders');
      }
    } catch {
      // Silently handle in demo mode
    } finally {
      setIsLoading(false);
    }
  }, [actorType, actorId]);

  // Fetch on mount and when actorId changes
  useEffect(() => {
    if (actorId) {
      fetchOrders();
    }
  }, [actorId, fetchOrders]);

  // ─── Subscribe to real-time updates (Pusher) ───────────────────
  useEffect(() => {
    if (!actorId || !pusher || !isConnected) return;
    if (subscribedRef.current) return;

    const primaryChannelName =
      actorType === 'merchant'
        ? getAllMerchantsChannel()
        : getUserChannel(actorId);

    const personalChannelName =
      actorType === 'merchant'
        ? getMerchantChannel(actorId)
        : null;

    const primaryChannel = pusher.subscribe(primaryChannelName);
    if (!primaryChannel) return;

    let personalChannel: ReturnType<typeof pusher.subscribe> | null = null;
    if (personalChannelName) {
      personalChannel = pusher.subscribe(personalChannelName);
    }

    subscribedRef.current = true;

    // ── Event handlers (queue into batch, don't touch state directly) ──

    const handleOrderCreated = (rawData: unknown) => {
      const data = rawData as {
        orderId: string;
        status: string;
        minimal_status?: string;
        order_version?: number;
        createdAt: string;
        data?: OrderData;
      };

      if (isDuplicate(`created:${data.orderId}`)) return;

      if (data.data) {
        enqueueEvent({ type: 'created', orderId: data.orderId, data: data.data, order_version: data.order_version });
      } else {
        // No full data — schedule a refetch (coalesced in flush)
        needsRefetchRef.current = true;
        if (!batchTimerRef.current) {
          batchTimerRef.current = setTimeout(flushBatch, BATCH_WINDOW_MS);
        }
      }
    };

    const handleStatusUpdated = (rawData: unknown) => {
      const data = rawData as {
        orderId: string;
        status: string;
        minimal_status?: string;
        order_version?: number;
        previousStatus: string;
        updatedAt: string;
        data?: OrderData;
      };

      if (isDuplicate(`status:${data.orderId}:${data.status}`)) return;

      enqueueEvent({
        type: 'status',
        orderId: data.orderId,
        status: data.status,
        minimal_status: data.minimal_status,
        order_version: data.order_version,
        previousStatus: data.previousStatus,
        data: data.data,
      });
    };

    const handleCancelled = (rawData: unknown) => {
      const data = rawData as {
        orderId: string;
        order_version?: number;
        minimal_status?: string;
      };

      enqueueEvent({
        type: 'cancelled',
        orderId: data.orderId,
        order_version: data.order_version,
        minimal_status: data.minimal_status,
      });
    };

    const handleExtensionRequested = (rawData: unknown) => {
      const data = rawData as ExtensionRequestData;
      onExtensionRequestedRef.current?.(data);
    };

    const handleExtensionResponse = (rawData: unknown) => {
      const data = rawData as ExtensionResponseData;
      onExtensionResponseRef.current?.(data);
      if (data.accepted) {
        fetchOrders();
      }
    };

    // Bind events
    primaryChannel.bind(ORDER_EVENTS.CREATED, handleOrderCreated);
    primaryChannel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
    primaryChannel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
    primaryChannel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
    primaryChannel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);

    if (personalChannel) {
      personalChannel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
      personalChannel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
      personalChannel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
      personalChannel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
    }

    return () => {
      primaryChannel.unbind(ORDER_EVENTS.CREATED, handleOrderCreated);
      primaryChannel.unbind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
      primaryChannel.unbind(ORDER_EVENTS.CANCELLED, handleCancelled);
      primaryChannel.unbind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
      primaryChannel.unbind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
      pusher.unsubscribe(primaryChannelName);

      if (personalChannel && personalChannelName) {
        personalChannel.unbind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
        personalChannel.unbind(ORDER_EVENTS.CANCELLED, handleCancelled);
        personalChannel.unbind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
        personalChannel.unbind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
        pusher.unsubscribe(personalChannelName);
      }

      subscribedRef.current = false;
      // Flush any remaining events
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
        batchTimerRef.current = null;
      }
    };
  }, [actorId, actorType, pusher, isConnected, fetchOrders, enqueueEvent, flushBatch, isDuplicate]);

  // ── Core-API WebSocket (batched, version gating picks newest) ──
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectRef = useRef(0);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_CORE_WS_URL;
    if (!wsUrl || !actorId) return;

    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (destroyed) return;
      const ws = new WebSocket(wsUrl!);
      wsRef.current = ws;

      ws.onopen = () => {
        wsReconnectRef.current = 0;
        ws.send(JSON.stringify({ type: 'subscribe', actorType, actorId }));
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          // Handle corridor price updates from price feed worker
          if (msg.type === 'price_update') {
            onPriceUpdateRef.current?.(msg as CorridorPriceData);
            return;
          }

          if (msg.type !== 'order_event') return;

          const { event_type, order_id, status, minimal_status, order_version, previousStatus, buyer_merchant_id, merchant_id } = msg;

          if (event_type === 'ORDER_CREATED') {
            if (isDuplicate(`created:${order_id}`)) return;
            needsRefetchRef.current = true;
            if (!batchTimerRef.current) {
              batchTimerRef.current = setTimeout(flushBatch, BATCH_WINDOW_MS);
            }
            return;
          }

          if (isDuplicate(`status:${order_id}:${status}`)) return;

          enqueueEvent({
            type: 'status',
            orderId: order_id,
            status,
            minimal_status,
            order_version,
            previousStatus,
            buyer_merchant_id,
            merchant_id,
          });
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (destroyed) return;
        const attempt = wsReconnectRef.current;
        if (attempt >= 5) return;
        wsReconnectRef.current = attempt + 1;
        const delay = Math.min(1000 * 2 ** attempt, 16000);
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [actorId, actorType, fetchOrders, enqueueEvent, flushBatch, isDuplicate]);

  return {
    orders,
    isLoading,
    error,
    isConnected: pusher?.isConnected || !!wsRef.current,
    refetch: fetchOrders,
  };
}

export default useRealtimeOrders;
