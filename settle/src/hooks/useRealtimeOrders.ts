'use client';

/**
 * Real-time Orders List Hook
 *
 * Subscribes to order list updates for users or merchants via Pusher
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';
import { getUserChannel, getMerchantChannel, getAllMerchantsChannel } from '@/lib/pusher/channels';
import { ORDER_EVENTS } from '@/lib/pusher/events';

interface OrderData {
  id: string;
  status: string;
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

interface UseRealtimeOrdersOptions {
  actorType: 'user' | 'merchant';
  actorId: string | null;
  // Callback when a new order is created
  onOrderCreated?: (order: OrderData) => void;
  // Callback when an order status changes
  onOrderStatusUpdated?: (orderId: string, newStatus: string, previousStatus: string) => void;
  // Callback when an extension is requested
  onExtensionRequested?: (data: ExtensionRequestData) => void;
  // Callback when an extension request is responded to
  onExtensionResponse?: (data: ExtensionResponseData) => void;
}

interface UseRealtimeOrdersReturn {
  orders: OrderData[];
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => Promise<void>;
}

export function useRealtimeOrders(
  options: UseRealtimeOrdersOptions
): UseRealtimeOrdersReturn {
  const { actorType, actorId, onOrderCreated, onOrderStatusUpdated, onExtensionRequested, onExtensionResponse } = options;

  console.log('[useRealtimeOrders] Hook called with:', { actorType, actorId });

  const [orders, setOrders] = useState<OrderData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pusher = usePusherOptional();
  const isConnected = pusher?.isConnected ?? false;
  const subscribedRef = useRef(false);

  console.log('[useRealtimeOrders] Pusher state:', { hasPusher: !!pusher, isConnected });

  // Use refs for callbacks to avoid re-subscribing when callbacks change
  const onOrderCreatedRef = useRef(onOrderCreated);
  const onOrderStatusUpdatedRef = useRef(onOrderStatusUpdated);
  const onExtensionRequestedRef = useRef(onExtensionRequested);
  const onExtensionResponseRef = useRef(onExtensionResponse);

  // Keep refs updated with latest callbacks
  useEffect(() => {
    onOrderCreatedRef.current = onOrderCreated;
    onOrderStatusUpdatedRef.current = onOrderStatusUpdated;
    onExtensionRequestedRef.current = onExtensionRequested;
    onExtensionResponseRef.current = onExtensionResponse;
  }, [onOrderCreated, onOrderStatusUpdated, onExtensionRequested, onExtensionResponse]);

  // Fetch orders from API
  const fetchOrders = useCallback(async () => {
    if (!actorId) return;

    setIsLoading(true);
    setError(null);

    try {
      const endpoint =
        actorType === 'merchant'
          ? `/api/merchants/${actorId}/orders`
          : `/api/users/${actorId}/orders`;

      const res = await fetch(endpoint);

      if (!res.ok) {
        // API not available (demo mode) - just stop loading
        console.log('Orders API not available - running in demo mode');
        setIsLoading(false);
        return;
      }

      const data = await res.json();

      if (data.success && data.data) {
        setOrders(data.data);
      } else {
        setError(data.error || 'Failed to fetch orders');
      }
    } catch (err) {
      // Silently handle in demo mode
      console.log('Orders fetch error - running in demo mode');
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

  // Subscribe to real-time updates
  useEffect(() => {
    // Wait for Pusher to be connected before subscribing
    if (!actorId || !pusher || !isConnected) {
      console.log('[useRealtimeOrders] Not ready to subscribe:', { actorId: !!actorId, pusher: !!pusher, isConnected });
      return;
    }

    if (subscribedRef.current) {
      console.log('[useRealtimeOrders] Already subscribed, skipping');
      return;
    }

    // For merchants:
    // - Subscribe to GLOBAL channel for new orders (all merchants see all new orders)
    // - Subscribe to PERSONAL channel for status updates (only their orders)
    // For users:
    // - Subscribe to their personal channel only
    const primaryChannelName =
      actorType === 'merchant'
        ? getAllMerchantsChannel() // All merchants receive all new orders
        : getUserChannel(actorId);

    // Merchants also need their personal channel for order status updates
    const personalChannelName =
      actorType === 'merchant'
        ? getMerchantChannel(actorId)
        : null;

    console.log('[useRealtimeOrders] Subscribing to channel:', primaryChannelName);
    const primaryChannel = pusher.subscribe(primaryChannelName);

    if (!primaryChannel) {
      console.log('[useRealtimeOrders] Failed to subscribe - channel is null');
      return;
    }

    // Subscribe to personal channel for merchants (status updates go here)
    let personalChannel: ReturnType<typeof pusher.subscribe> | null = null;
    if (personalChannelName) {
      console.log('[useRealtimeOrders] Also subscribing to personal channel:', personalChannelName);
      personalChannel = pusher.subscribe(personalChannelName);
    }

    subscribedRef.current = true;
    console.log('[useRealtimeOrders] Successfully subscribed to', primaryChannelName, personalChannelName ? `and ${personalChannelName}` : '');

    // Handle new order created (for merchants)
    const handleOrderCreated = (rawData: unknown) => {
      console.log('[useRealtimeOrders] Received ORDER_CREATED event:', rawData);
      const data = rawData as {
        orderId: string;
        status: string;
        createdAt: string;
        data?: OrderData;
      };
      if (data.data) {
        setOrders((prev) => {
          // Check if order already exists
          if (prev.some((o) => o.id === data.orderId)) return prev;
          return [data.data!, ...prev];
        });
        onOrderCreatedRef.current?.(data.data);
      } else {
        // Refetch if we don't have full order data
        fetchOrders();
      }
    };

    // Handle order status update
    const handleStatusUpdated = (rawData: unknown) => {
      console.log('[useRealtimeOrders] Received STATUS_UPDATED event:', rawData);
      const data = rawData as {
        orderId: string;
        status: string;
        previousStatus: string;
        updatedAt: string;
        data?: OrderData;
      };
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== data.orderId) return order;
          if (data.data) {
            return data.data;
          }
          return { ...order, status: data.status };
        })
      );

      onOrderStatusUpdatedRef.current?.(data.orderId, data.status, data.previousStatus);
    };

    // Handle order cancelled
    const handleCancelled = (rawData: unknown) => {
      const data = rawData as { orderId: string };
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== data.orderId) return order;
          return { ...order, status: 'cancelled' };
        })
      );
    };

    // Handle extension requested
    const handleExtensionRequested = (rawData: unknown) => {
      const data = rawData as ExtensionRequestData;
      onExtensionRequestedRef.current?.(data);
    };

    // Handle extension response
    const handleExtensionResponse = (rawData: unknown) => {
      const data = rawData as ExtensionResponseData;
      onExtensionResponseRef.current?.(data);
      // Refetch orders to get updated expires_at
      if (data.accepted) {
        fetchOrders();
      }
    };

    // Bind events to primary channel
    primaryChannel.bind(ORDER_EVENTS.CREATED, handleOrderCreated);
    primaryChannel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
    primaryChannel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
    primaryChannel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
    primaryChannel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);

    // Also bind status events to personal channel for merchants
    if (personalChannel) {
      personalChannel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
      personalChannel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
      personalChannel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
      personalChannel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
    }

    return () => {
      console.log('[useRealtimeOrders] Cleaning up subscriptions');
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
    };
  }, [actorId, actorType, pusher, isConnected, fetchOrders]);

  return {
    orders,
    isLoading,
    error,
    isConnected: pusher?.isConnected || false,
    refetch: fetchOrders,
  };
}

export default useRealtimeOrders;
