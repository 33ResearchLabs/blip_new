"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { usePusherOptional } from '@/context/PusherContext';
import { getMerchantChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';

export interface OrderConversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
  order_created_at: string;
  has_manual_message: boolean;
  user: {
    id: string;
    username: string;
    rating: number;
    total_trades: number;
  };
  message_count: number;
  unread_count: number;
  last_message: {
    id: string;
    content: string;
    sender_type: string;
    message_type: string;
    created_at: string;
    is_read: boolean;
  } | null;
  last_activity: string;
}

export function useMerchantConversations() {
  const merchantId = useMerchantStore(s => s.merchantId);
  const pusher = usePusherOptional();

  const [orderConversations, setOrderConversations] = useState<OrderConversation[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  const convAbortRef = useRef<AbortController | null>(null);

  const fetchOrderConversations = useCallback(async () => {
    if (!merchantId) return;
    convAbortRef.current?.abort();
    const controller = new AbortController();
    convAbortRef.current = controller;

    setIsLoadingConversations(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/messages?merchant_id=${merchantId}&limit=50`,
        { signal: controller.signal }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOrderConversations(data.data.conversations || []);
        setTotalUnread(data.data.totalUnread || 0);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch order conversations:', error);
    } finally {
      if (!controller.signal.aborted) setIsLoadingConversations(false);
    }
  }, [merchantId]);

  // Debounced refresh — multiple callers within 500ms share one fetch
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const scheduleFetch = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchOrderConversations();
    }, 500);
  }, [fetchOrderConversations]);

  // Initial fetch on mount
  useEffect(() => {
    if (!merchantId) return;
    fetchOrderConversations();
  }, [merchantId, fetchOrderConversations]);

  // Safety-net retry: after the initial mount fetches, if we're still showing
  // zero conversations AND have a merchantId, the initial fetch likely got
  // aborted (session race) or silently failed (fetch cancelled by the
  // browser). Fire ONE additional fetch after 2s to recover. Bailout: once we
  // get any data, or after 2 retries, stop — avoids hammering the API on
  // accounts that genuinely have no chats.
  const retryCountRef = useRef(0);
  useEffect(() => {
    if (!merchantId) {
      retryCountRef.current = 0;
      return;
    }
    if (orderConversations.length > 0) {
      retryCountRef.current = 0;
      return;
    }
    if (retryCountRef.current >= 2) return;
    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      fetchOrderConversations();
    }, 2000);
    return () => clearTimeout(timer);
  }, [merchantId, orderConversations.length, fetchOrderConversations]);

  // Polling fallback when Pusher is not connected (15s interval)
  const isPusherConnected = !!(pusher as any)?.isConnected;
  useEffect(() => {
    if (!merchantId || isPusherConnected) return;
    const interval = setInterval(fetchOrderConversations, 15000);
    return () => clearInterval(interval);
  }, [merchantId, isPusherConnected, fetchOrderConversations]);

  // Pusher-driven refresh: listen for new messages on merchant channel
  useEffect(() => {
    if (!pusher || !merchantId) return;

    const channelName = getMerchantChannel(merchantId);
    const channel = pusher.subscribe(channelName);
    if (!channel) return;

    // Any new message → refresh inbox
    const handleNewMessage = () => scheduleFetch();
    // Message preview update → refresh inbox
    const handlePreview = () => scheduleFetch();

    channel.bind(CHAT_EVENTS.MESSAGE_NEW, handleNewMessage);
    if (CHAT_EVENTS.MESSAGE_PREVIEW) {
      channel.bind(CHAT_EVENTS.MESSAGE_PREVIEW, handlePreview);
    }

    return () => {
      channel.unbind(CHAT_EVENTS.MESSAGE_NEW, handleNewMessage);
      if (CHAT_EVENTS.MESSAGE_PREVIEW) {
        channel.unbind(CHAT_EVENTS.MESSAGE_PREVIEW, handlePreview);
      }
    };
  }, [pusher, merchantId, scheduleFetch]);

  // Optimistically clear unread for an order (instant badge update)
  const clearUnreadForOrder = useCallback((orderId: string) => {
    setOrderConversations(prev => {
      let removed = 0;
      const next = prev.map(c => {
        if (c.order_id === orderId) {
          removed += c.unread_count || 0;
          return { ...c, unread_count: 0 };
        }
        return c;
      });
      if (removed > 0) setTotalUnread(t => Math.max(0, t - removed));
      return next;
    });
    // Refetch shortly to sync with server
    setTimeout(scheduleFetch, 1500);
  }, [scheduleFetch]);

  return {
    orderConversations,
    totalUnread,
    isLoadingConversations,
    fetchOrderConversations,
    scheduleFetch,
    clearUnreadForOrder,
  };
}
