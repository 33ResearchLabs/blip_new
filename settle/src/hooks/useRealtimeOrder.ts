'use client';

/**
 * Real-time Order Hook
 *
 * Subscribes to order updates via Pusher and keeps state in sync.
 * Falls back to polling when Pusher is unavailable.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';
import { getOrderChannel } from '@/lib/pusher/channels';
import { ORDER_EVENTS } from '@/lib/pusher/events';

// Polling interval when Pusher is unavailable (3 seconds)
const POLLING_INTERVAL = 3000;

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
  merchant?: {
    id: string;
    display_name?: string;
    business_name?: string;
    rating?: number;
    wallet_address?: string;
  };
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

interface UseRealtimeOrderOptions {
  // Initial order data (optional, will fetch if not provided)
  initialData?: OrderData | null;
  // Callback when order status changes (includes order data for popup display)
  onStatusChange?: (newStatus: string, previousStatus: string, orderData?: OrderData | null) => void;
  // Callback when an extension is requested
  onExtensionRequested?: (data: ExtensionRequestData) => void;
  // Callback when an extension request is responded to
  onExtensionResponse?: (data: ExtensionResponseData) => void;
  // Enable polling fallback when Pusher is unavailable (default: true)
  enablePolling?: boolean;
}

interface UseRealtimeOrderReturn {
  order: OrderData | null;
  isLoading: boolean;
  error: string | null;
  isConnected: boolean;
  refetch: () => Promise<void>;
}

export function useRealtimeOrder(
  orderId: string | null,
  options: UseRealtimeOrderOptions = {}
): UseRealtimeOrderReturn {
  const { initialData, onStatusChange, onExtensionRequested, onExtensionResponse, enablePolling = true } = options;

  const [order, setOrder] = useState<OrderData | null>(initialData || null);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);

  const pusher = usePusherOptional();
  const previousStatusRef = useRef<string | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);

  // Keep ref in sync with prop
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Fetch order data from API
  const fetchOrder = useCallback(async (silent = false) => {
    if (!orderId) return;

    if (!silent) {
      setIsLoading(true);
      setError(null);
    }

    try {
      const res = await fetch(`/api/orders/${orderId}`);

      if (!res.ok) {
        // API not available (demo mode)
        console.log('Order API not available - running in demo mode');
        if (!silent) setIsLoading(false);
        return;
      }

      const data = await res.json();

      if (data.success && data.data) {
        const newOrder = data.data;
        const previousStatus = previousStatusRef.current;
        const newStatus = newOrder.status;

        // Check for status change and trigger callback (pass order data for popup)
        if (previousStatus && previousStatus !== newStatus && onStatusChangeRef.current) {
          onStatusChangeRef.current(newStatus, previousStatus, newOrder);
        }

        setOrder(newOrder);
        previousStatusRef.current = newStatus;
      } else {
        if (!silent) setError(data.error || 'Failed to fetch order');
      }
    } catch (err) {
      // Silently handle in demo mode
      console.log('Order fetch error - running in demo mode');
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [orderId]);

  // Fetch on mount if no initial data
  useEffect(() => {
    if (!initialData && orderId) {
      fetchOrder();
    }
  }, [orderId, initialData, fetchOrder]);

  // Polling fallback when Pusher is unavailable
  useEffect(() => {
    if (!orderId || !enablePolling) return;

    // Only poll if Pusher is not connected
    const pusherConnected = pusher?.isConnected;
    if (pusherConnected) return;

    // Start polling
    const intervalId = setInterval(() => {
      fetchOrder(true); // silent fetch
    }, POLLING_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [orderId, enablePolling, pusher?.isConnected, fetchOrder]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!orderId || !pusher) return;

    const channelName = getOrderChannel(orderId);
    const channel = pusher.subscribe(channelName);

    if (!channel) return;

    // Handle order status updates
    const handleStatusUpdate = (rawData: unknown) => {
      const data = rawData as {
        orderId: string;
        status: string;
        previousStatus: string;
        data?: OrderData;
      };
      if (data.orderId !== orderId) return;

      // Call callback if status changed (pass order data for popup display)
      if (onStatusChangeRef.current && data.previousStatus !== data.status) {
        onStatusChangeRef.current(data.status, data.previousStatus, data.data || null);
      }

      previousStatusRef.current = data.status;

      // Refetch full order data from API to get complete data including merchant
      fetchOrder(true);
    };

    // Handle order cancellation
    const handleCancelled = (rawData: unknown) => {
      const data = rawData as { orderId: string };
      if (data.orderId !== orderId) return;
      setOrder(prev => prev ? { ...prev, status: 'cancelled' } : null);
    };

    // Handle extension request
    const handleExtensionRequested = (rawData: unknown) => {
      const data = rawData as ExtensionRequestData;
      if (data.orderId !== orderId) return;
      onExtensionRequested?.(data);
    };

    // Handle extension response
    const handleExtensionResponse = (rawData: unknown) => {
      const data = rawData as ExtensionResponseData;
      if (data.orderId !== orderId) return;
      onExtensionResponse?.(data);
      // Refetch order to get updated expires_at
      if (data.accepted) {
        fetchOrder(true);
      }
    };

    channel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdate);
    channel.bind(ORDER_EVENTS.CANCELLED, handleCancelled);
    channel.bind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
    channel.bind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);

    return () => {
      channel.unbind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdate);
      channel.unbind(ORDER_EVENTS.CANCELLED, handleCancelled);
      channel.unbind(ORDER_EVENTS.EXTENSION_REQUESTED, handleExtensionRequested);
      channel.unbind(ORDER_EVENTS.EXTENSION_RESPONSE, handleExtensionResponse);
      pusher.unsubscribe(channelName);
    };
  }, [orderId, pusher]);

  return {
    order,
    isLoading,
    error,
    isConnected: pusher?.isConnected || false,
    refetch: () => fetchOrder(false),
  };
}

export default useRealtimeOrder;
