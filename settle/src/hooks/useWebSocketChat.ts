'use client';

/**
 * WebSocket Chat Hook
 *
 * Real-time chat messaging using native WebSocket
 * API-compatible with useRealtimeChat for easy migration
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocketChatContextOptional } from '@/context/WebSocketChatContext';
import type { WSNewMessageEvent, WSTypingEvent, ActorType, MessageType } from '@/lib/websocket/types';

export interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system';
  text: string;
  timestamp: Date;
  messageType?: MessageType;
  imageUrl?: string | null;
  senderType?: ActorType;
  senderName?: string;
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
  created_at: string;
  is_read: boolean;
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

export function useWebSocketChat(options: UseWebSocketChatOptions = {}) {
  const { maxWindows = 3, onNewMessage, actorType = 'user', actorId } = options;
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);

  const wsContext = useWebSocketChatContextOptional();
  const subscribedOrdersRef = useRef<Set<string>>(new Set());

  // Use ref to always have access to latest actorId (prevents stale closure issues)
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
      const isSystemMessage = SYSTEM_MESSAGE_TYPES.includes(dbMsg.message_type);
      return {
        id: dbMsg.id,
        from: isSystemMessage ? 'system' : (dbMsg.sender_type === myActorType ? 'me' : 'them'),
        text: dbMsg.content,
        timestamp: new Date(dbMsg.created_at),
        messageType: dbMsg.message_type,
        imageUrl: dbMsg.image_url,
        senderType: dbMsg.sender_type,
        senderName: dbMsg.sender_name,
      };
    },
    []
  );

  // Convert WebSocket event to UI message
  const mapWSMessageToUI = useCallback(
    (event: WSNewMessageEvent, myActorType: string): ChatMessage => {
      const { data } = event;
      const isSystemMessage = SYSTEM_MESSAGE_TYPES.includes(data.messageType);
      return {
        id: data.messageId,
        from: isSystemMessage ? 'system' : (data.senderType === myActorType ? 'me' : 'them'),
        text: data.content,
        timestamp: new Date(data.createdAt),
        messageType: data.messageType,
        imageUrl: data.imageUrl,
        senderType: data.senderType,
        senderName: data.senderName,
      };
    },
    []
  );

  // Fetch initial messages for an order
  const fetchMessages = useCallback(
    async (orderId: string, chatId: string) => {
      try {
        console.log('[Chat] Fetching messages for order:', orderId);
        const res = await fetch(`/api/orders/${orderId}/messages`);
        if (!res.ok) {
          console.log('[Chat] Messages API not available - using demo mode');
          return;
        }
        const data = await res.json();

        if (data.success && data.data) {
          console.log('[Chat] Raw messages from API:', data.data);
          const messages: ChatMessage[] = data.data.map((m: DbMessage) =>
            mapDbMessageToUI(m, actorType)
          );
          console.log('[Chat] Mapped messages:', messages);
          console.log('[Chat] System messages:', messages.filter(m => m.from === 'system'));

          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== chatId) return w;
              return { ...w, messages };
            })
          );
        }
      } catch (error) {
        console.log('[Chat] Messages API error - running in demo mode', error);
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

          // Check if message already exists (from optimistic update)
          const existingIndex = w.messages.findIndex(
            (m) => m.id === message.id || m.id.startsWith('temp_')
          );

          // If it's our own message, replace temp message
          if (message.from === 'me' && existingIndex >= 0) {
            const newMessages = [...w.messages];
            newMessages[existingIndex] = message;
            return { ...w, messages: newMessages };
          }

          // Skip if our message already exists
          if (message.from === 'me' && existingIndex >= 0) return w;

          // Add new message from others
          const newUnread = message.from === 'them' && w.minimized ? w.unread + 1 : w.unread;

          // Trigger callback for new messages from others
          if (message.from === 'them') {
            onNewMessage?.(w.id, message);
          }

          return {
            ...w,
            messages: [...w.messages.filter((m) => !m.id.startsWith('temp_')), message],
            unread: newUnread,
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

      // Ignore our own typing
      if (typingActorType === actorType) return;

      const isTyping = event.type === 'chat:typing-start';

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.orderId !== orderId) return w;
          return { ...w, isTyping };
        })
      );
    });

    return unsubscribe;
  }, [wsContext, actorType]);

  // Subscribe to order via WebSocket
  const subscribeToOrder = useCallback(
    (orderId: string, chatId: string) => {
      // Always fetch initial messages, even without WebSocket
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
    };
  }, [unsubscribeFromOrder]);

  const openChat = useCallback(
    (user: string, emoji: string, orderId?: string) => {
      setChatWindows((prev) => {
        // Check if chat already exists
        const existingIndex = prev.findIndex(
          (w) => w.orderId === orderId || w.user === user
        );
        if (existingIndex >= 0) {
          // Bring to front and unminimize
          const existing = prev[existingIndex];
          if (orderId && existing.orderId) {
            subscribeToOrder(orderId, existing.id);
          }
          return prev.map((w, i) =>
            i === existingIndex ? { ...w, minimized: false, unread: 0 } : w
          );
        }

        // Create new window
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
        };

        // Subscribe to real-time updates if we have an orderId
        if (orderId) {
          subscribeToOrder(orderId, chatId);
        }

        const updated = [...prev, newWindow];
        if (updated.length > maxWindows) {
          // Unsubscribe from removed windows
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
    async (chatId: string, text: string, imageUrl?: string) => {
      if (!text.trim() && !imageUrl) return;

      const window = chatWindows.find((w) => w.id === chatId);
      const currentActorId = actorIdRef.current;
      if (!window?.orderId || !currentActorId) {
        console.error('Cannot send message: missing orderId or actorId', { orderId: window?.orderId, actorId: currentActorId });
        return;
      }

      // Optimistically add message
      const tempId = `temp_${Date.now()}`;
      const tempMessage: ChatMessage = {
        id: tempId,
        from: 'me',
        text,
        timestamp: new Date(),
        messageType: imageUrl ? 'image' : 'text',
        imageUrl,
      };

      setChatWindows((prev) =>
        prev.map((w) => {
          if (w.id !== chatId) return w;
          return {
            ...w,
            messages: [...w.messages, tempMessage],
          };
        })
      );

      // Send via WebSocket if available
      if (wsContext?.isConnected) {
        wsContext.sendMessage(
          window.orderId,
          text,
          imageUrl ? 'image' : 'text',
          imageUrl
        );
      } else {
        // Fallback to HTTP API
        try {
          const res = await fetch(`/api/orders/${window.orderId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender_type: actorType,
              sender_id: currentActorId,
              content: text,
              message_type: imageUrl ? 'image' : 'text',
              image_url: imageUrl,
            }),
          });

          if (!res.ok) {
            console.log('Messages API not available - demo mode');
            return;
          }

          const data = await res.json();
          if (!data.success) {
            throw new Error(data.error || 'Failed to send message');
          }
        } catch (error) {
          console.log('Send message error - demo mode, keeping local message');
        }
      }
    },
    [chatWindows, actorType, wsContext]
  );

  const markAsRead = useCallback(
    async (chatId: string) => {
      const window = chatWindows.find((w) => w.id === chatId);
      if (!window?.orderId) return;

      setChatWindows((prev) =>
        prev.map((w) => (w.id === chatId ? { ...w, unread: 0 } : w))
      );

      // Send via WebSocket if available
      if (wsContext?.isConnected) {
        wsContext.markRead(window.orderId);
      } else {
        // Fallback to HTTP API
        try {
          await fetch(`/api/orders/${window.orderId}/messages`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reader_type: actorType,
            }),
          });
        } catch (error) {
          console.error('Error marking messages as read:', error);
        }
      }
    },
    [chatWindows, actorType, wsContext]
  );

  const sendTypingIndicator = useCallback(
    async (chatId: string, isTyping: boolean) => {
      const window = chatWindows.find((w) => w.id === chatId);
      if (!window?.orderId) return;

      // Send via WebSocket if available
      if (wsContext?.isConnected) {
        wsContext.sendTyping(window.orderId, isTyping);
      } else {
        // Fallback to HTTP API
        try {
          await fetch(`/api/orders/${window.orderId}/typing`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              actor_type: actorType,
              is_typing: isTyping,
            }),
          });
        } catch {
          // Typing indicators are best-effort
        }
      }
    },
    [chatWindows, actorType, wsContext]
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
  };
}

export default useWebSocketChat;
