'use client';

/**
 * WebSocket Chat Hook
 *
 * Real-time chat messaging using native WebSocket
 * API-compatible with useRealtimeChat for easy migration
 * Supports: text, image, file messages, typing, presence, compliance controls
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { useWebSocketChatContextOptional } from '@/context/WebSocketChatContext';
// Phase 3: parallel Pusher receive path. After the B1 fix, all chat sends
// go through REST → Pusher fanout. The custom WS server is no longer the
// chat transport, only typing/presence/freeze/highlight. We add a Pusher
// subscription here so this hook can hear the same MESSAGE_NEW events
// useRealtimeChat hears, dedup-by-id, and stay in sync in real time.
import { usePusherOptional } from '@/context/PusherContext';
import { getOrderChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';
import type {
  WSNewMessageEvent,
  WSTypingEvent,
  WSPresenceStateEvent,
  WSPresenceUpdateEvent,
  WSMessageHighlightedEvent,
  WSChatFrozenEvent,
  ActorType,
  MessageType,
} from '@/lib/websocket/types';

// Pusher event payload (matches the shape notifyNewMessage publishes)
interface PusherChatMessageEvent {
  messageId: string;
  orderId: string;
  senderType: ActorType;
  senderId: string | null;
  senderName?: string;
  content: string;
  messageType: MessageType;
  imageUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
  clientId?: string | null;
  seq?: number | null;
}

export interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system' | 'compliance';
  text: string;
  timestamp: Date;
  messageType?: MessageType;
  imageUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  senderType?: ActorType;
  senderName?: string;
  isHighlighted?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  // Phase 3: idempotency + ordering, optional for backward compat.
  clientId?: string;
  seq?: number;
}

export interface PresenceMember {
  actorType: ActorType;
  actorId: string;
  isOnline: boolean;
  lastSeen?: string;
}

export interface ChatWindow {
  id: string;
  user: string;
  emoji: string;
  orderId?: string;
  messages: ChatMessage[];
  minimized: boolean;
  unread: number;
  isTyping: boolean;
  typingActorType?: string;
  typingActorName?: string;
  presence: PresenceMember[];
  isFrozen: boolean;
}

// Database message type
interface DbMessage {
  id: string;
  order_id: string;
  sender_type: ActorType;
  sender_id: string;
  sender_name?: string;
  content: string;
  message_type: MessageType;
  image_url?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at: string;
  is_read: boolean;
  is_highlighted?: boolean;
  status?: string;
  // Phase 3 — present on rows after migration 076
  client_id?: string | null;
  seq?: number | null;
}

interface UseWebSocketChatOptions {
  maxWindows?: number;
  // First param is the ORDER id (UUID), not the synthetic chat-window id.
  // See useRealtimeChat.ts for the same contract.
  onNewMessage?: (orderId: string, message: ChatMessage) => void;
  actorType?: ActorType;
  actorId?: string;
}

// System message types
const SYSTEM_MESSAGE_TYPES: MessageType[] = [
  'dispute',
  'resolution',
  'resolution_proposed',
  'resolution_rejected',
  'resolution_accepted',
  'resolution_finalized',
  'system',
];

function determineSender(
  senderType: string,
  messageType: string,
  myActorType: string
): 'me' | 'them' | 'system' | 'compliance' {
  if (senderType === 'system' || SYSTEM_MESSAGE_TYPES.includes(messageType as MessageType)) {
    return 'system';
  }
  if (senderType === myActorType) {
    return 'me';
  }
  if (senderType === 'compliance') {
    return 'compliance';
  }
  return 'them';
}

export function useWebSocketChat(options: UseWebSocketChatOptions = {}) {
  const { maxWindows = 3, onNewMessage, actorType = 'user', actorId } = options;
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);

  const wsContext = useWebSocketChatContextOptional();
  const pusher = usePusherOptional();

  // ── DIAGNOSTIC: verify this hook is loaded and running ──
  useEffect(() => {
    console.log('[useWebSocketChat] HOOK MOUNTED', { actorType, actorId, hasPusher: !!pusher, pusherConnected: pusher?.isConnected });
  }, [actorType, actorId, pusher]);
  const subscribedOrdersRef = useRef<Set<string>>(new Set());
  const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Phase 3: parallel Pusher subscription state.
  //   pusherSubscribedRef — orderId → true once we've subscribed to private-order-X
  //   lastSeqRef          — orderId → highest seq seen, drives reconnect catch-up
  // Both maps are independent of the WS context state — Pusher receive
  // works even when the custom WS server is down.
  const pusherSubscribedRef = useRef<Map<string, boolean>>(new Map());
  const lastSeqRef = useRef<Map<string, number>>(new Map());

  // Stable ref for chatWindows — removes it from callback deps
  const chatWindowsRef = useRef(chatWindows);
  chatWindowsRef.current = chatWindows;

  // Use ref to always have access to latest actorId
  const actorIdRef = useRef(actorId);
  actorIdRef.current = actorId;

  // ── Delivery ACK: 300ms debounce batch ──────────────────────────────
  // When merchant receives messages, batch-acknowledge them as "delivered"
  // so the sender sees ✓✓ grey. Multiple messages in a burst are batched.
  const deliveryAckBufferRef = useRef<Map<string, Set<string>>>(new Map());
  const deliveryAckTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const flushDeliveryAck = useCallback(
    (orderId: string) => {
      const ids = deliveryAckBufferRef.current.get(orderId);
      if (!ids || ids.size === 0) return;
      const messageIds = Array.from(ids);
      deliveryAckBufferRef.current.delete(orderId);
      deliveryAckTimerRef.current.delete(orderId);

      fetchWithAuth(`/api/orders/${orderId}/messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delivered',
          message_ids: messageIds,
          reader_type: actorType,
        }),
      }).catch(() => {
        // Retry once after 2s
        setTimeout(() => {
          fetchWithAuth(`/api/orders/${orderId}/messages`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'delivered',
              message_ids: messageIds,
              reader_type: actorType,
            }),
          }).catch(() => {});
        }, 2000);
      });
    },
    [actorType],
  );

  const queueDeliveryAck = useCallback(
    (orderId: string, messageId: string) => {
      if (!deliveryAckBufferRef.current.has(orderId)) {
        deliveryAckBufferRef.current.set(orderId, new Set());
      }
      deliveryAckBufferRef.current.get(orderId)!.add(messageId);

      // Reset the debounce timer — flush after 300ms of quiet
      const existing = deliveryAckTimerRef.current.get(orderId);
      if (existing) clearTimeout(existing);
      deliveryAckTimerRef.current.set(
        orderId,
        setTimeout(() => flushDeliveryAck(orderId), 300),
      );
    },
    [flushDeliveryAck],
  );

  // Set actor in WebSocket context
  useEffect(() => {
    if (wsContext && actorType && actorId) {
      wsContext.setActor(actorType, actorId);
    }
  }, [wsContext, actorType, actorId]);

  // Convert DB message to UI message
  const mapDbMessageToUI = useCallback(
    (dbMsg: DbMessage, myActorType: string): ChatMessage => {
      const from = determineSender(dbMsg.sender_type, dbMsg.message_type, myActorType);
      return {
        id: dbMsg.id,
        from,
        text: dbMsg.content,
        timestamp: new Date(dbMsg.created_at),
        messageType: dbMsg.message_type,
        imageUrl: dbMsg.image_url,
        fileUrl: dbMsg.file_url,
        fileName: dbMsg.file_name,
        fileSize: dbMsg.file_size,
        mimeType: dbMsg.mime_type,
        senderType: dbMsg.sender_type,
        senderName: dbMsg.sender_name,
        isHighlighted: dbMsg.is_highlighted,
        status: from === 'me' ? ((dbMsg.status === 'seen' ? 'read' : dbMsg.status as 'sent' | 'delivered') || 'sent') : undefined,
        clientId: dbMsg.client_id ?? undefined,  // Phase 3
        seq: dbMsg.seq ?? undefined,             // Phase 3
      };
    },
    []
  );

  // Convert WebSocket event to UI message
  const mapWSMessageToUI = useCallback(
    (event: WSNewMessageEvent, myActorType: string): ChatMessage => {
      const { data } = event;
      const from = determineSender(data.senderType, data.messageType, myActorType);
      // Phase 3: WS event may also carry clientId/seq if the WS server is updated
      // to forward them. Until then these fields are undefined and the dedup
      // path falls back to id-based dedup (which still works).
      const eventWithPhase3 = data as typeof data & { clientId?: string; seq?: number };
      return {
        id: data.messageId,
        from,
        text: data.content || '',
        timestamp: new Date(data.createdAt),
        messageType: data.messageType,
        imageUrl: data.imageUrl,
        fileUrl: data.fileUrl,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        senderType: data.senderType,
        senderName: data.senderName,
        status: from === 'me' ? 'sent' : undefined,
        clientId: eventWithPhase3.clientId ?? undefined,  // Phase 3
        seq: eventWithPhase3.seq ?? undefined,            // Phase 3
      };
    },
    []
  );

  // Fetch initial messages for an order
  const fetchMessages = useCallback(
    async (orderId: string, chatId: string) => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}/messages`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.success && data.data) {
          const messages: ChatMessage[] = data.data.map((m: DbMessage) =>
            mapDbMessageToUI(m, actorType)
          );

          // Phase 3: seed lastSeq from initial fetch so the first reconnect
          // catch-up only pulls messages newer than what we already loaded.
          // Pre-migration messages have seq=undefined and this is a no-op.
          let maxSeq = 0;
          for (const m of messages) {
            if (typeof m.seq === 'number' && m.seq > maxSeq) maxSeq = m.seq;
          }
          if (maxSeq > 0) {
            const current = lastSeqRef.current.get(orderId) || 0;
            if (maxSeq > current) lastSeqRef.current.set(orderId, maxSeq);
          }

          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== chatId) return w;
              return { ...w, messages };
            })
          );
        }
      } catch (error) {
        console.log('[Chat] Messages API error', error);
      }
    },
    [actorType, mapDbMessageToUI]
  );

  // Phase 3: shared handler for incoming Pusher chat events. Mirrors the
  // existing WS handleNewMessage logic exactly so dedup-by-id and
  // replace-by-clientId behave identically regardless of which transport
  // delivered the message.
  const handlePusherMessage = useCallback(
    (rawData: unknown) => {
      const event = rawData as PusherChatMessageEvent;
      console.log('[useWebSocketChat] ORDER CHANNEL MESSAGE:', {
        messageId: event?.messageId,
        orderId: event?.orderId,
        senderType: event?.senderType,
        content: event?.content?.substring(0, 30),
      });
      if (!event?.messageId || !event?.orderId) return;

      // Track lastSeq for reconnect catch-up
      if (typeof event.seq === 'number') {
        const current = lastSeqRef.current.get(event.orderId) || 0;
        if (event.seq > current) lastSeqRef.current.set(event.orderId, event.seq);
      }

      const from = determineSender(event.senderType, event.messageType, actorType);
      const message: ChatMessage = {
        id: event.messageId,
        from,
        text: event.content || '',
        timestamp: new Date(event.createdAt),
        messageType: event.messageType,
        imageUrl: event.imageUrl,
        fileUrl: event.fileUrl,
        fileName: event.fileName,
        fileSize: event.fileSize,
        mimeType: event.mimeType,
        senderType: event.senderType,
        senderName: event.senderName,
        status: from === 'me' ? 'sent' : undefined,
        clientId: event.clientId ?? undefined,
        seq: event.seq ?? undefined,
      };

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== event.orderId) return w;

          // Dedup by id FIRST — message may also arrive via WS context
          if (w.messages.some((m) => m.id === message.id)) return w;

          // Replace optimistic temp by clientId (post-migration server echo)
          if (message.from === 'me' && message.clientId) {
            const idx = w.messages.findIndex((m) => m.clientId === message.clientId);
            if (idx >= 0) {
              const newMessages = [...w.messages];
              newMessages[idx] = message;
              return { ...w, messages: newMessages };
            }
          }

          // Backward-compat fallback: server didn't echo clientId (legacy)
          if (message.from === 'me' && !message.clientId) {
            const tempIndex = w.messages.findIndex((m) => m.id.startsWith('temp_'));
            if (tempIndex >= 0) {
              const newMessages = [...w.messages];
              newMessages[tempIndex] = message;
              return { ...w, messages: newMessages };
            }
          }

          // Append new message
          const newUnread = message.from !== 'me' && w.minimized ? w.unread + 1 : w.unread;
          if (message.from !== 'me') {
            onNewMessage?.(w.orderId!, message);
            // Auto-delivery ACK: tell the sender we received it (→ ✓✓ grey)
            queueDeliveryAck(event.orderId, message.id);
          }
          return {
            ...w,
            messages: [...w.messages.filter((m) => !m.id.startsWith('temp_')), message],
            unread: newUnread,
            isTyping: false,
          };
        })
      );
    },
    [actorType, onNewMessage, queueDeliveryAck]
  );

  // Phase 3: subscribe to Pusher private-order-X for every chat window's order.
  // This is the receive path for messages that came in through REST → Pusher
  // (which is now ALL chat sends after the B1 fix).
  useEffect(() => {
    if (!pusher) return;
    const orderIds = chatWindows
      .map((w) => w.orderId)
      .filter((id): id is string => !!id);

    // ── Delivery + Read handlers (same pattern as useRealtimeChat) ──
    const handleDelivered = (rawData: unknown) => {
      const data = rawData as { orderId: string; messageIds: string[]; deliveredBy: string };
      if (data.deliveredBy === actorType) return;
      const deliveredSet = new Set(data.messageIds);
      setChatWindows(prev => prev.map(w => {
        if (w.orderId !== data.orderId) return w;
        return {
          ...w,
          messages: w.messages.map(m =>
            m.from === 'me' && deliveredSet.has(m.id) && m.status !== 'read'
              ? { ...m, status: 'delivered' as const }
              : m
          ),
        };
      }));
    };

    const handleRead = (rawData: unknown) => {
      const data = rawData as { orderId: string; readerType: string };
      if (data.readerType === actorType) return;
      setChatWindows(prev => prev.map(w => {
        if (w.orderId !== data.orderId) return w;
        return {
          ...w,
          messages: w.messages.map(m =>
            m.from === 'me' ? { ...m, isRead: true, status: 'read' as const } : m
          ),
        };
      }));
    };

    // Subscribe to any orderId we haven't subscribed to yet
    console.log('[useWebSocketChat] ORDER CHANNEL CHECK:', { orderIds, alreadySubscribed: Array.from(pusherSubscribedRef.current.keys()) });
    for (const orderId of orderIds) {
      if (pusherSubscribedRef.current.get(orderId)) continue;
      const channelName = getOrderChannel(orderId);
      console.log('[useWebSocketChat] SUBSCRIBING order channel:', channelName);
      const channel = pusher.subscribe(channelName);
      if (!channel) { console.log('[useWebSocketChat] FAILED order subscribe:', channelName); continue; }
      channel.bind(CHAT_EVENTS.MESSAGE_NEW, handlePusherMessage);
      channel.bind(CHAT_EVENTS.MESSAGES_DELIVERED, handleDelivered);
      channel.bind(CHAT_EVENTS.MESSAGES_READ, handleRead);
      pusherSubscribedRef.current.set(orderId, true);
    }

    // Unsubscribe from any orderId no longer in the windows list
    const activeIds = new Set(orderIds);
    for (const [orderId] of pusherSubscribedRef.current) {
      if (!activeIds.has(orderId)) {
        const channel = pusher.subscribe(getOrderChannel(orderId));
        channel?.unbind(CHAT_EVENTS.MESSAGE_NEW, handlePusherMessage);
        channel?.unbind(CHAT_EVENTS.MESSAGES_DELIVERED, handleDelivered);
        channel?.unbind(CHAT_EVENTS.MESSAGES_READ, handleRead);
        pusher.unsubscribe(getOrderChannel(orderId));
        pusherSubscribedRef.current.delete(orderId);
        lastSeqRef.current.delete(orderId);
      }
    }
  }, [pusher, chatWindows, handlePusherMessage]);

  // ── Merchant private channel listener ────────────────────────────────
  // The order-channel subscription (above) only fires when a chat window exists.
  // But messages can arrive for orders the merchant hasn't opened yet.
  // Subscribe to the merchant's private channel for MESSAGE_NEW so the
  // inbox can update (unread badges, last message preview) even when
  // no chat window is open for that order.
  useEffect(() => {
    if (!pusher || actorType !== 'merchant' || !actorId) {
      console.log('[useWebSocketChat] MERCHANT CHANNEL SKIP', { hasPusher: !!pusher, actorType, actorId });
      return;
    }

    const { getMerchantChannel } = require('@/lib/pusher/channels');
    const channelName = getMerchantChannel(actorId);
    console.log('[useWebSocketChat] SUBSCRIBING merchant channel:', channelName);
    const channel = pusher.subscribe(channelName);
    if (!channel) {
      console.log('[useWebSocketChat] FAILED to subscribe merchant channel');
      return;
    }
    console.log('[useWebSocketChat] SUBSCRIBED merchant channel:', channelName);

    const handlePrivateMessage = (rawData: unknown) => {
      const data = rawData as PusherChatMessageEvent;
      console.log('[useWebSocketChat] MERCHANT CHANNEL EVENT RECEIVED:', {
        orderId: data?.orderId,
        messageId: data?.messageId,
        senderType: data?.senderType,
      });

      if (!data?.orderId || !data?.messageId) return;

      const existingWindow = chatWindowsRef.current.find(w => w.orderId === data.orderId);
      if (existingWindow) {
        console.log('[useWebSocketChat] skipping (window exists, order channel will handle)');
        return;
      }

      if (data.senderType !== actorType) {
        console.log('[useWebSocketChat] FIRING onNewMessage for inbox update');
        const message: ChatMessage = {
          id: data.messageId,
          from: 'them',
          text: data.content || '',
          timestamp: new Date(data.createdAt),
          messageType: data.messageType,
          imageUrl: data.imageUrl,
          senderName: data.senderName,
        };
        onNewMessage?.(data.orderId, message);
      }
    };

    channel.bind(CHAT_EVENTS.MESSAGE_NEW, handlePrivateMessage);

    return () => {
      console.log('[useWebSocketChat] UNSUBSCRIBING merchant channel:', channelName);
      channel.unbind(CHAT_EVENTS.MESSAGE_NEW, handlePrivateMessage);
    };
  }, [pusher, actorType, actorId, onNewMessage]);

  // Phase 3: reconnect catch-up. When Pusher reconnects, fetch any messages
  // we missed during the gap via /api/orders/:id/messages?after_seq=<lastSeq>.
  // The dedup-by-id path in handlePusherMessage prevents double-renders if a
  // message arrives both via Pusher and via this catch-up fetch.
  // Pre-migration: getOrderMessagesAfterSeq returns [] (self-healing), so this
  // is a no-op and nothing breaks.
  useEffect(() => {
    if (!pusher) return;
    if (!pusher.isConnected) return;
    if (lastSeqRef.current.size === 0) return;

    let cancelled = false;
    (async () => {
      for (const [orderId, lastSeq] of lastSeqRef.current.entries()) {
        if (cancelled) return;
        if (!pusherSubscribedRef.current.get(orderId)) continue;
        try {
          const res = await fetchWithAuth(
            `/api/orders/${orderId}/messages?after_seq=${lastSeq}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const fresh: DbMessage[] = data?.success ? (data.data || []) : [];
          if (!fresh.length) continue;

          const targetWindow = chatWindowsRef.current.find((w) => w.orderId === orderId);
          if (!targetWindow) continue;

          let newMaxSeq = lastSeq;
          const mapped: ChatMessage[] = fresh.map((m) => {
            const ui = mapDbMessageToUI(m, actorType);
            if (typeof ui.seq === 'number' && ui.seq > newMaxSeq) newMaxSeq = ui.seq;
            return ui;
          });

          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== targetWindow.id) return w;
              const seen = new Set(w.messages.map((m) => m.id));
              const append = mapped.filter((m) => !seen.has(m.id));
              if (append.length === 0) return w;
              return { ...w, messages: [...w.messages, ...append] };
            })
          );

          if (newMaxSeq > lastSeq) {
            lastSeqRef.current.set(orderId, newMaxSeq);
          }
        } catch (err) {
          console.warn('[useWebSocketChat] reconnect catch-up failed', { orderId, err });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pusher, pusher?.isConnected, actorType, mapDbMessageToUI]);

  // Handle new messages from WebSocket
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onMessage((event: WSNewMessageEvent) => {
      const { orderId } = event.data;

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;

          const message = mapWSMessageToUI(event, actorType);

          // Phase 3: dedup by id FIRST. The same message may arrive via WS
          // and via the Pusher path on the same client.
          if (w.messages.some(m => m.id === message.id)) return w;

          // Phase 3: replace optimistic temp by clientId (NOT by index).
          if (message.from === 'me' && message.clientId) {
            const idx = w.messages.findIndex(m => m.clientId === message.clientId);
            if (idx >= 0) {
              const newMessages = [...w.messages];
              newMessages[idx] = message;
              return { ...w, messages: newMessages };
            }
          }

          // Backward-compat fallback when the server didn't echo a clientId.
          if (message.from === 'me' && !message.clientId) {
            const tempIndex = w.messages.findIndex((m) => m.id.startsWith('temp_'));
            if (tempIndex >= 0) {
              const newMessages = [...w.messages];
              newMessages[tempIndex] = message;
              return { ...w, messages: newMessages };
            }
          }

          // Add new message
          const newUnread = message.from !== 'me' && w.minimized ? w.unread + 1 : w.unread;

          if (message.from !== 'me') {
            // Pass the real order id, not the synthetic chat-window id.
            onNewMessage?.(w.orderId, message);
          }

          return {
            ...w,
            messages: [...w.messages.filter((m) => !m.id.startsWith('temp_')), message],
            unread: newUnread,
            isTyping: false,
          };
        })
      );
    });

    return unsubscribe;
  }, [wsContext, actorType, mapWSMessageToUI, onNewMessage]);

  // Handle typing indicators
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onTyping((event: WSTypingEvent) => {
      const { orderId, actorType: typingActorType } = event.data;
      const actorName = (event.data as WSTypingEvent['data'] & { actorName?: string }).actorName;

      if (typingActorType === actorType) return;

      const isTyping = event.type === 'chat:typing-start';

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;
          return {
            ...w,
            isTyping,
            typingActorType: isTyping ? typingActorType : undefined,
            typingActorName: isTyping ? actorName : undefined,
          };
        })
      );

      // Auto-clear typing after 5s
      if (isTyping) {
        const key = `${orderId}:${typingActorType}`;
        const existing = typingTimeoutsRef.current.get(key);
        if (existing) clearTimeout(existing);
        typingTimeoutsRef.current.set(key, setTimeout(() => {
          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.orderId !== orderId) return w;
              return { ...w, isTyping: false, typingActorType: undefined, typingActorName: undefined };
            })
          );
        }, 5000));
      }
    });

    return unsubscribe;
  }, [wsContext, actorType]);

  // Handle read receipts
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onRead((event) => {
      const { orderId, readerType } = event.data;
      if (readerType === actorType) return;

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;
          return {
            ...w,
            messages: w.messages.map((m) =>
              m.from === 'me' ? { ...m, status: 'read' as const } : m
            ),
          };
        })
      );
    });

    return unsubscribe;
  }, [wsContext, actorType]);

  // Subscribe to order via WebSocket
  const subscribeToOrder = useCallback(
    (orderId: string, chatId: string) => {
      fetchMessages(orderId, chatId);

      if (!wsContext || subscribedOrdersRef.current.has(orderId)) return;

      wsContext.subscribe(orderId);
      subscribedOrdersRef.current.add(orderId);
    },
    [wsContext, fetchMessages]
  );

  // Unsubscribe from order
  const unsubscribeFromOrder = useCallback(
    (orderId: string) => {
      if (!wsContext || !subscribedOrdersRef.current.has(orderId)) return;

      wsContext.unsubscribe(orderId);
      subscribedOrdersRef.current.delete(orderId);
    },
    [wsContext]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscribedOrdersRef.current.forEach((orderId) => {
        unsubscribeFromOrder(orderId);
      });
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, [unsubscribeFromOrder]);

  const openChat = useCallback(
    (user: string, emoji: string, orderId?: string) => {
      setChatWindows((prev) => {
        const existingIndex = prev.findIndex(
          (w) => w.orderId === orderId || w.user === user
        );
        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          if (orderId && existing.orderId) {
            subscribeToOrder(orderId, existing.id);
          }
          return prev.map((w, i) =>
            i === existingIndex ? { ...w, minimized: false, unread: 0 } : w
          );
        }

        const chatId = `chat_${Date.now()}`;
        const newWindow: ChatWindow = {
          id: chatId,
          user,
          emoji,
          orderId,
          messages: [],
          minimized: false,
          unread: 0,
          isTyping: false,
          presence: [],
          isFrozen: false,
        };

        if (orderId) {
          subscribeToOrder(orderId, chatId);
        }

        const updated = [...prev, newWindow];
        if (updated.length > maxWindows) {
          const removed = updated[0];
          if (removed.orderId) {
            unsubscribeFromOrder(removed.orderId);
          }
          return updated.slice(-maxWindows);
        }
        return updated;
      });
    },
    [maxWindows, subscribeToOrder, unsubscribeFromOrder]
  );

  const closeChat = useCallback(
    (chatId: string) => {
      setChatWindows((prev) => {
        const window = prev.find((w) => w.id === chatId);
        if (window?.orderId) {
          unsubscribeFromOrder(window.orderId);
        }
        return prev.filter((w) => w.id !== chatId);
      });
    },
    [unsubscribeFromOrder]
  );

  const toggleMinimize = useCallback((chatId: string) => {
    setChatWindows((prev) =>
      prev.map((w) =>
        w.id === chatId
          ? { ...w, minimized: !w.minimized, unread: w.minimized ? 0 : w.unread }
          : w
      )
    );
  }, []);

  const sendMessage = useCallback(
    async (chatId: string, text: string, imageUrl?: string, fileData?: { fileUrl: string; fileName: string; fileSize: number; mimeType: string }) => {
      if (!text.trim() && !imageUrl && !fileData) return;

      const window = chatWindowsRef.current.find((w) => w.id === chatId);
      const currentActorId = actorIdRef.current;
      if (!window?.orderId || !currentActorId) return;

      let messageType: string = 'text';
      if (fileData) messageType = 'file';
      else if (imageUrl) messageType = 'image';

      // Phase 3: client-generated UUID for idempotent sends + temp replacement
      const clientId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;

      // Optimistically add message
      const tempId = `temp_${clientId}`;
      const tempMessage: ChatMessage = {
        id: tempId,
        clientId,  // ◄ Phase 3: replace-by-clientId on server echo
        from: 'me',
        text,
        timestamp: new Date(),
        messageType: messageType as MessageType,
        imageUrl,
        fileUrl: fileData?.fileUrl,
        fileName: fileData?.fileName,
        fileSize: fileData?.fileSize,
        mimeType: fileData?.mimeType,
        status: 'sending',
      };

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.id !== chatId) return w;
          return { ...w, messages: [...w.messages, tempMessage] };
        })
      );

      // ─── B1 fix: REST-only chat send ──────────────────────────────────
      //
      // Why this changed:
      //   The merchant page uses useWebSocketChat which historically sent
      //   text messages via wsContext.sendMessage. The custom WS server
      //   (websocket-server.js) inserts the row and broadcasts it to other
      //   WS subscribers — but it does NOT publish to Pusher.
      //
      //   The user app uses useRealtimeChat which subscribes ONLY to
      //   Pusher. Result: merchant text messages never reached users in
      //   real time. Users had to refresh to see them.
      //
      //   Routing all sends through POST /api/orders/:id/messages fixes
      //   this because the REST handler calls notifyNewMessage() which
      //   publishes to all relevant Pusher channels. This is the same
      //   path useRealtimeChat already uses, so user→merchant and
      //   merchant→user are now symmetrical and both go through Pusher.
      //
      //   The custom WS server is still alive (typing indicators, presence,
      //   freeze, highlight) — only the chat:send code path is bypassed.
      //   Phase 5 will eventually delete the WS server entirely.
      //
      // Idempotency:
      //   client_id is included in the body. With migration 076 applied,
      //   the server dedupes on (sender_id, client_id) so a network retry
      //   doesn't create a duplicate row. Pre-migration, the server falls
      //   back to legacy INSERT and the client_id field is ignored.
      try {
        const res = await fetchWithAuth(`/api/orders/${window.orderId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_type: actorType,
            sender_id: currentActorId,
            content: text || undefined,
            message_type: messageType,
            image_url: imageUrl,
            file_url: fileData?.fileUrl,
            file_name: fileData?.fileName,
            file_size: fileData?.fileSize,
            mime_type: fileData?.mimeType,
            client_id: clientId,
          }),
        });

        if (!res.ok) {
          // Mark the optimistic message as failed so the user can see + retry
          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== chatId) return w;
              return {
                ...w,
                messages: w.messages.map((m) =>
                  m.id === tempId ? { ...m, status: 'sending' as const } : m
                ),
              };
            })
          );
          return;
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to send message');
        }
        // The Pusher MESSAGE_NEW event will replace the temp message via
        // the handleNewMessage path (replace-by-clientId post-migration,
        // or first-temp fallback pre-migration).
      } catch {
        // Network failure — keep the optimistic message visible so the
        // user knows it exists locally; the next reload will resync.
      }
    },
    [actorType]
  );

  const markAsRead = useCallback(
    async (chatId: string) => {
      const window = chatWindowsRef.current.find((w) => w.id === chatId);
      if (!window?.orderId) return;

      setChatWindows((prev) =>
        prev.map((w) => (w.id === chatId ? { ...w, unread: 0 } : w))
      );

      if (wsContext?.isConnected) {
        wsContext.markRead(window.orderId);
      } else {
        try {
          await fetchWithAuth(`/api/orders/${window.orderId}/messages`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reader_type: actorType }),
          });
        } catch {}
      }
    },
    [actorType, wsContext]
  );

  // Throttled typing indicator — only send start once per session, stop after 2s idle
  const isTypingSentRef = useRef<Map<string, boolean>>(new Map());
  const typingIdleTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const sendTypingIndicator = useCallback(
    async (chatId: string, isTyping: boolean) => {
      const window = chatWindowsRef.current.find((w) => w.id === chatId);
      if (!window?.orderId) return;

      const orderId = window.orderId;

      if (isTyping) {
        // Only send typing:start once per session
        if (isTypingSentRef.current.get(orderId)) {
          // Reset idle timer
          const existing = typingIdleTimerRef.current.get(orderId);
          if (existing) clearTimeout(existing);
          typingIdleTimerRef.current.set(orderId, setTimeout(() => {
            isTypingSentRef.current.delete(orderId);
            // Send stop after 2s idle
            if (wsContext?.isConnected) {
              wsContext.sendTyping(orderId, false);
            } else {
              fetchWithAuth(`/api/orders/${orderId}/typing`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ actor_type: actorType, is_typing: false }),
              }).catch(() => {});
            }
          }, 2000));
          return;
        }

        isTypingSentRef.current.set(orderId, true);

        // Schedule auto-stop after 2s idle
        typingIdleTimerRef.current.set(orderId, setTimeout(() => {
          isTypingSentRef.current.delete(orderId);
          if (wsContext?.isConnected) {
            wsContext.sendTyping(orderId, false);
          } else {
            fetchWithAuth(`/api/orders/${orderId}/typing`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ actor_type: actorType, is_typing: false }),
            }).catch(() => {});
          }
        }, 2000));
      } else {
        // Explicit stop — clear state
        isTypingSentRef.current.delete(orderId);
        const existing = typingIdleTimerRef.current.get(orderId);
        if (existing) clearTimeout(existing);
        typingIdleTimerRef.current.delete(orderId);
      }

      if (wsContext?.isConnected) {
        wsContext.sendTyping(orderId, isTyping);
      } else {
        try {
          await fetchWithAuth(`/api/orders/${orderId}/typing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ actor_type: actorType, is_typing: isTyping }),
          });
        } catch {}
      }
    },
    [actorType, wsContext]
  );

  // Compliance: highlight message
  const highlightMessage = useCallback(
    (orderId: string, messageId: string, highlighted: boolean) => {
      if (actorType !== 'compliance') return;

      // Update local state
      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;
          return {
            ...w,
            messages: w.messages.map((m) =>
              m.id === messageId ? { ...m, isHighlighted: highlighted } : m
            ),
          };
        })
      );

      // Send via WebSocket
      if (wsContext?.isConnected) {
        (wsContext as unknown as { send: (msg: object) => void }).send?.({
          type: 'chat:highlight',
          orderId,
          messageId,
          highlighted,
        });
      }
    },
    [actorType, wsContext]
  );

  // Compliance: freeze/unfreeze chat
  const freezeChat = useCallback(
    (orderId: string, frozen: boolean) => {
      if (actorType !== 'compliance') return;

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;
          return { ...w, isFrozen: frozen };
        })
      );

      if (wsContext?.isConnected) {
        (wsContext as unknown as { send: (msg: object) => void }).send?.({
          type: 'chat:freeze',
          orderId,
          frozen,
        });
      }
    },
    [actorType, wsContext]
  );

  return {
    chatWindows,
    isConnected: wsContext?.isConnected || false,
    openChat,
    closeChat,
    toggleMinimize,
    sendMessage,
    markAsRead,
    sendTypingIndicator,
    highlightMessage,
    freezeChat,
  };
}

export default useWebSocketChat;
