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
    avatar_url?: string | null;
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

  // Monotonic request id. Every fetch tags itself; only the response from the
  // most-recently-started fetch is allowed to write state. This replaces the
  // old abort-on-every-call approach, which cancelled in-flight requests and
  // let whichever stale/empty response resolved last win — blanking the inbox
  // even after a full payload had already arrived. We no longer abort, so the
  // overlapping calls (mount + retry + poll + Pusher) all complete and only
  // the newest one's result renders.
  const reqSeqRef = useRef(0);

  const fetchOrderConversations = useCallback(async () => {
    if (!merchantId) return;
    const seq = ++reqSeqRef.current;

    setIsLoadingConversations(true);
    try {
      const res = await fetchWithAuth(
        `/api/merchant/messages?merchant_id=${merchantId}&limit=50`
      );
      // Superseded by a newer fetch — discard this stale response.
      if (seq !== reqSeqRef.current) return;
      // Real failure (not supersession): leave the list untouched so the
      // safety-net retry / poll re-fires instead of swallowing it silently.
      if (!res.ok) return;
      const data = await res.json();
      if (seq !== reqSeqRef.current) return;
      if (data.success) {
        const next: OrderConversation[] = data.data.conversations || [];
        // Never let an empty response wipe an already-populated inbox: during
        // the load burst, slower/filtered responses can come back empty. Only
        // accept an empty list when we genuinely have none yet (first load).
        setOrderConversations(prev =>
          next.length === 0 && prev.length > 0 ? prev : next
        );
        setTotalUnread(data.data.totalUnread || 0);
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      console.error('Failed to fetch order conversations:', error);
    } finally {
      if (seq === reqSeqRef.current) setIsLoadingConversations(false);
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

  // Safety-net retry: the initial mount fetch commonly fires BEFORE the
  // session token has been restored on prod, so the request goes without an
  // Authorization header and the server returns empty. The inbox then stays
  // at [] until a route change remounts the hook (by which time the token
  // has arrived). On dev, React strict mode's double-invoke masks the race.
  //
  // Re-fire the fetch the moment the session token becomes present AND the
  // inbox is still empty. Falls back to a 2s timer for edge cases where
  // sessionToken doesn't observably transition. Now that overlapping fetches
  // no longer cancel each other (see reqSeqRef above), these retries are cheap
  // and safe, so the cap is raised to cover slow prod cold-starts where the
  // first few attempts can land before data/auth is fully ready.
  const sessionTokenPresent = useMerchantStore((s) => !!s.sessionToken);
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
    if (retryCountRef.current >= 5) return;
    const delay = sessionTokenPresent ? 50 : 2000;
    const timer = setTimeout(() => {
      retryCountRef.current += 1;
      fetchOrderConversations();
    }, delay);
    return () => clearTimeout(timer);
  }, [merchantId, orderConversations.length, sessionTokenPresent, fetchOrderConversations]);

  // Polling fallback when Pusher is not connected (~15s interval, jittered).
  // The jitter is per-tab — without it, every tab opened at the same second
  // hits the server in lockstep and collectively trips the per-IP rate limit.
  // fetchWithAuth itself short-circuits same-path calls during a 429 backoff
  // window, so we don't need additional in-hook backoff logic here.
  const isPusherConnected = !!(pusher as any)?.isConnected;
  useEffect(() => {
    if (!merchantId || isPusherConnected) return;
    const intervalMs = 15_000 + Math.floor(Math.random() * 5_000);
    const interval = setInterval(fetchOrderConversations, intervalMs);
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

  // "Mark all read" — persist to server in one shot so the badge doesn't
  // snap back on the next poll. Optimistically zero the UI first so the
  // click feels instant, then reconcile from the server response.
  const clearAllUnread = useCallback(async () => {
    setOrderConversations(prev => prev.map(c => ({ ...c, unread_count: 0 })));
    setTotalUnread(0);
    try {
      const res = await fetchWithAuth('/api/merchant/messages/mark-all-read', {
        method: 'POST',
      });
      if (!res.ok) {
        // Server rejected — pull the real state back so the UI doesn't
        // sit on a fiction. The next fetch re-populates unread counts
        // from the DB, which is authoritative.
        scheduleFetch();
      }
    } catch {
      scheduleFetch();
    }
  }, [scheduleFetch]);

  return {
    orderConversations,
    totalUnread,
    isLoadingConversations,
    fetchOrderConversations,
    scheduleFetch,
    clearUnreadForOrder,
    clearAllUnread,
  };
}
