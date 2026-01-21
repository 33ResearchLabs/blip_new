'use client';

/**
 * Real-time Orders List Hook
 *
 * Subscribes to order list updates for users or merchants via Pusher
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';
import { getUserChannel, getMerchantChannel } from '@/lib/pusher/channels';
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

  const [orders, setOrders] = useState<OrderData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const pusher = usePusherOptional();
  const subscribedRef = useRef(false);

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

  // Fetch on mount
  useEffect(() => {
    if (actorId) {
      fetchOrders();
    }
  }, [actorId, fetchOrders]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!actorId || !pusher || subscribedRef.current) return;

    const channelName =
      actorType === 'merchant'
        ? getMerchantChannel(actorId)
        : getUserChannel(actorId);

    const channel = pusher.subscribe(channelName);

    if (!channel) return;

    subscribedRef.current = true;

    // Handle new order created (for merchants)
    const handleOrderCreated = (rawData: unknown) => {
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
        onOrderCreated?.(data.data);
      } else {
        // Refetch if we don't have full order data
        fetchOrders();
      }
    };

    // Handle order status update
    const handleStatusUpdated = (rawData: unknown) => {
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

      onOrderStatusUpdated?.(data.orderId, data.status, data.previousStatus);
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
      onExtensionRequested?.(data);
    };

    // Handle extension response
    const handleExtensionResponse = (rawData: unknown) => {
      const data = rawData as ExtensionResponseData;
      onExtensionResponse?.(data);
      // Refetch orders to get updated expires_at
      if (data.accepted) {
        fetchOrders();
      }
    };

    channel.bind(ORDER_EVENTS.CREATED, handleOrderCreated);
    channel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
    channel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
    channel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
    channel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);

    return () => {
      channel.unbind(ORDER_EVENTS.CREATED, handleOrderCreated);
      channel.unbind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdated);
      channel.unbind(ORDER_EVENTS.CANCELLED, handleCancelled);
      channel.unbind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
      channel.unbind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
      pusher.unsubscribe(channelName);
      subscribedRef.current = false;
    };
  }, [actorId, actorType, pusher, onOrderCreated, onOrderStatusUpdated, onExtensionRequested, onExtensionResponse, fetchOrders]);

  return {
    orders,
    isLoading,
    error,
    isConnected: pusher?.isConnected || false,
    refetch: fetchOrders,
  };
}

export default useRealtimeOrders;
