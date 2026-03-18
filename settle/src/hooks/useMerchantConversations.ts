"use client";

import { useState, useRef, useCallback } from "react";
import { useMerchantStore } from "@/stores/merchantStore";
import type { DbOrder } from "@/types/merchant";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface OrderConversation {
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

  const [orderConversations, setOrderConversations] = useState<OrderConversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [activeChatOrderDetails, setActiveChatOrderDetails] = useState<DbOrder | null>(null);

  const fetchOrderDetailsForChat = useCallback(async (orderId: string) => {
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data) {
        setActiveChatOrderDetails(data.data);
      }
    } catch (error) {
      console.error('[Chat] Failed to fetch order details:', error);
    }
  }, []);

  const convAbortRef = useRef<AbortController | null>(null);
  const fetchOrderConversations = useCallback(async () => {
    if (!merchantId) return;
    convAbortRef.current?.abort();
    const controller = new AbortController();
    convAbortRef.current = controller;

    setIsLoadingConversations(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/messages?merchant_id=${merchantId}&limit=50`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setOrderConversations(data.data.conversations || []);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch order conversations:', error);
    } finally {
      if (!controller.signal.aborted) setIsLoadingConversations(false);
    }
  }, [merchantId]);

  return {
    orderConversations,
    isLoadingConversations,
    activeChatOrderDetails,
    setActiveChatOrderDetails,
    fetchOrderDetailsForChat,
    fetchOrderConversations,
  };
}
