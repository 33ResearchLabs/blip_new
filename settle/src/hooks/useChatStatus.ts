'use client';

/**
 * useChatStatus — Frontend chat availability hook
 *
 * The backend is the ONLY source of truth for chat availability.
 * This hook:
 *  1. Fetches GET /api/orders/{id}/chat-status on mount
 *  2. Listens to Pusher `chat:status-update` events for real-time sync
 *  3. Exposes { chatEnabled, chatReason, chatState } for UI rendering
 *
 * The frontend NEVER decides chat availability on its own.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { usePusherOptional } from '@/context/PusherContext';
import { getOrderChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';

export type ChatState = 'loading' | 'waiting' | 'active' | 'closed' | 'frozen' | 'dispute';

export interface ChatStatusResult {
  /** Whether the user can send messages right now */
  chatEnabled: boolean;
  /** Human-readable reason when disabled (shown in UI) */
  chatReason: string | null;
  /** High-level state for UI rendering decisions */
  chatState: ChatState;
  /** Whether both buyer and seller are connected to the order */
  bothPartiesJoined: boolean;
  /** True during the initial API fetch */
  isLoading: boolean;
  /** Force re-fetch (e.g., after the user triggers an action that changes order status) */
  refetch: () => void;
}

function deriveChatState(
  enabled: boolean,
  reason: string | null,
  bothParties: boolean,
): ChatState {
  if (enabled) return 'active';
  if (!bothParties) return 'waiting';
  if (reason?.includes('frozen')) return 'frozen';
  if (reason?.includes('closed') || reason?.includes('completed') || reason?.includes('cancelled') || reason?.includes('expired')) return 'closed';
  return 'closed';
}

export function useChatStatus(orderId: string | undefined): ChatStatusResult {
  const [chatEnabled, setChatEnabled] = useState(false);
  const [chatReason, setChatReason] = useState<string | null>(null);
  const [bothPartiesJoined, setBothPartiesJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const pusher = usePusherOptional();
  const mountedRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/chat-status`);
      if (!res.ok) {
        // If API fails, fail closed (chat disabled)
        setChatEnabled(false);
        setChatReason('Unable to determine chat status');
        return;
      }
      const data = await res.json();
      if (!mountedRef.current) return;
      if (data.success && data.data) {
        setChatEnabled(data.data.chat.enabled);
        setChatReason(data.data.chat.reason);
        setBothPartiesJoined(data.data.bothPartiesJoined);
      }
    } catch {
      if (!mountedRef.current) return;
      setChatEnabled(false);
      setChatReason('Unable to determine chat status');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, [orderId]);

  // Initial fetch on mount / orderId change
  useEffect(() => {
    mountedRef.current = true;
    setIsLoading(true);
    fetchStatus();
    return () => { mountedRef.current = false; };
  }, [fetchStatus]);

  // Real-time: listen to chat:status-update on the order channel.
  // We subscribe here (subscribe is idempotent in Pusher — if already
  // subscribed by useRealtimeChat, this returns the existing channel).
  useEffect(() => {
    if (!pusher || !orderId) return;

    const channelName = getOrderChannel(orderId);
    const channel = pusher.subscribe(channelName);
    if (!channel) return;

    const handleStatusUpdate = (data: unknown) => {
      const event = data as { orderId?: string; enabled?: boolean; reason?: string | null };
      if (event.orderId === orderId && typeof event.enabled === 'boolean') {
        setChatEnabled(event.enabled);
        setChatReason(event.reason ?? null);
      }
    };

    channel.bind(CHAT_EVENTS.STATUS_UPDATE, handleStatusUpdate);

    return () => {
      channel.unbind(CHAT_EVENTS.STATUS_UPDATE, handleStatusUpdate);
    };
  }, [pusher, orderId]);

  const chatState = deriveChatState(chatEnabled, chatReason, bothPartiesJoined);

  return {
    chatEnabled,
    chatReason,
    chatState,
    bothPartiesJoined,
    isLoading,
    refetch: fetchStatus,
  };
}
