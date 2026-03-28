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
}

interface UseWebSocketChatOptions {
  maxWindows?: number;
  onNewMessage?: (chatId: string, message: ChatMessage) => void;
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
  const subscribedOrdersRef = useRef<Set<string>>(new Set());
  const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Stable ref for chatWindows — removes it from callback deps
  const chatWindowsRef = useRef(chatWindows);
  chatWindowsRef.current = chatWindows;

  // Use ref to always have access to latest actorId
  const actorIdRef = useRef(actorId);
  actorIdRef.current = actorId;

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
      };
    },
    []
  );

  // Convert WebSocket event to UI message
  const mapWSMessageToUI = useCallback(
    (event: WSNewMessageEvent, myActorType: string): ChatMessage => {
      const { data } = event;
      const from = determineSender(data.senderType, data.messageType, myActorType);
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

  // Handle new messages from WebSocket
  useEffect(() => {
    if (!wsContext) return;

    const unsubscribe = wsContext.onMessage((event: WSNewMessageEvent) => {
      const { orderId } = event.data;

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;

          const message = mapWSMessageToUI(event, actorType);

          // If it's our own message, replace temp message
          if (message.from === 'me') {
            const tempIndex = w.messages.findIndex((m) => m.id.startsWith('temp_'));
            if (tempIndex >= 0) {
              const newMessages = [...w.messages];
              newMessages[tempIndex] = message;
              return { ...w, messages: newMessages };
            }
            if (w.messages.some(m => m.id === message.id)) return w;
          }

          // Add new message
          const newUnread = message.from !== 'me' && w.minimized ? w.unread + 1 : w.unread;

          if (message.from !== 'me') {
            onNewMessage?.(w.id, message);
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

      // Optimistically add message
      const tempId = `temp_${Date.now()}`;
      const tempMessage: ChatMessage = {
        id: tempId,
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

      // Send via WebSocket if available
      if (wsContext?.isConnected) {
        wsContext.sendMessage(
          window.orderId,
          text,
          messageType as MessageType,
          imageUrl
        );
        // For file messages, we also send via API since WS sendMessage doesn't support file metadata yet
        if (fileData) {
          try {
            await fetchWithAuth(`/api/orders/${window.orderId}/messages`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sender_type: actorType,
                sender_id: currentActorId,
                content: text || undefined,
                message_type: messageType,
                image_url: imageUrl,
                file_url: fileData.fileUrl,
                file_name: fileData.fileName,
                file_size: fileData.fileSize,
                mime_type: fileData.mimeType,
              }),
            });
          } catch {
            // Best-effort
          }
        }
      } else {
        // Fallback to HTTP API
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
            }),
          });

          if (!res.ok) return;
          const data = await res.json();
          if (!data.success) throw new Error(data.error);
        } catch {
          // Keep local message in demo mode
        }
      }
    },
    [actorType, wsContext]
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
