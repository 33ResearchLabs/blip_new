'use client';

/**
 * Real-time Chat Hook
 *
 * Subscribes to chat messages via Pusher instead of polling
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePusherOptional } from '@/context/PusherContext';
import { getOrderChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';

export interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system';
  text: string;
  timestamp: Date;
  messageType?: 'text' | 'image' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  imageUrl?: string | null;
  senderType?: 'user' | 'merchant' | 'compliance' | 'system';
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
  sender_type: 'user' | 'merchant' | 'compliance' | 'system';
  sender_id: string;
  sender_name?: string;
  content: string;
  message_type: 'text' | 'image' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  image_url?: string | null;
  created_at: string;
  is_read: boolean;
}

// Pusher message event
interface PusherMessageEvent {
  messageId: string;
  orderId: string;
  senderType: 'user' | 'merchant' | 'compliance' | 'system';
  senderId: string | null;
  senderName?: string;
  content: string;
  messageType: 'text' | 'image' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  imageUrl?: string | null;
  createdAt: string;
}

// Pusher typing event
interface PusherTypingEvent {
  orderId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  timestamp: string;
}

interface UseRealtimeChatOptions {
  maxWindows?: number;
  onNewMessage?: (chatId: string, message: ChatMessage) => void;
  actorType?: 'user' | 'merchant' | 'compliance';
  actorId?: string;
}

export function useRealtimeChat(options: UseRealtimeChatOptions = {}) {
  const { maxWindows = 3, onNewMessage, actorType = 'user', actorId } = options;
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);

  const pusher = usePusherOptional();
  const subscribedChannelsRef = useRef<Map<string, boolean>>(new Map());

  // Convert DB message to UI message
  const mapDbMessageToUI = useCallback(
    (dbMsg: DbMessage, myActorType: string): ChatMessage => {
      // System messages (dispute, resolution, etc.) are always from 'system'
      const isSystemMessage = dbMsg.message_type === 'dispute' ||
        dbMsg.message_type === 'resolution' ||
        dbMsg.message_type === 'resolution_proposed' ||
        dbMsg.message_type === 'resolution_rejected' ||
        dbMsg.message_type === 'resolution_accepted' ||
        dbMsg.message_type === 'resolution_finalized' ||
        dbMsg.message_type === 'system';
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

  // Convert Pusher event to UI message
  const mapPusherMessageToUI = useCallback(
    (event: PusherMessageEvent, myActorType: string): ChatMessage => {
      // System messages (dispute, resolution, etc.) are always from 'system'
      const isSystemMessage = event.messageType === 'dispute' ||
        event.messageType === 'resolution' ||
        event.messageType === 'resolution_proposed' ||
        event.messageType === 'resolution_rejected' ||
        event.messageType === 'resolution_accepted' ||
        event.messageType === 'resolution_finalized' ||
        event.messageType === 'system';
      return {
        id: event.messageId,
        from: isSystemMessage ? 'system' : (event.senderType === myActorType ? 'me' : 'them'),
        text: event.content,
        timestamp: new Date(event.createdAt),
        messageType: event.messageType,
        imageUrl: event.imageUrl,
        senderType: event.senderType,
        senderName: event.senderName,
      };
    },
    []
  );

  // Fetch initial messages for an order
  const fetchMessages = useCallback(
    async (orderId: string, chatId: string) => {
      try {
        // Include auth params in URL
        const authParam = actorId ? `?user_id=${actorId}` : '';
        const res = await fetch(`/api/orders/${orderId}/messages${authParam}`);
        if (!res.ok) {
          // API not available (demo mode) - use empty messages
          console.log('Messages API not available - using demo mode', res.status);
          return;
        }
        const data = await res.json();

        console.log('[useRealtimeChat] Fetched messages:', { orderId, chatId, count: data.data?.length });

        if (data.success && data.data) {
          console.log('[useRealtimeChat] API returned messages:', { orderId, count: data.data.length, first: data.data[0] });
          const messages: ChatMessage[] = data.data.map((m: DbMessage) =>
            mapDbMessageToUI(m, actorType)
          );

          setChatWindows((prev) => {
            const windowToUpdate = prev.find(w => w.id === chatId);
            console.log('[useRealtimeChat] Looking for window to update:', { chatId, found: !!windowToUpdate, windows: prev.map(w => w.id) });
            const updated = prev.map((w) => {
              if (w.id !== chatId) return w;
              console.log('[useRealtimeChat] Updating chat window with messages:', { chatId, messageCount: messages.length });
              return { ...w, messages };
            });
            return updated;
          });
        }
      } catch (error) {
        // Silently fail in demo mode
        console.log('Messages API error - running in demo mode', error);
      }
    },
    [actorType, actorId, mapDbMessageToUI]
  );

  // Subscribe to real-time messages for an order
  const subscribeToOrder = useCallback(
    (orderId: string, chatId: string) => {
      console.log('[useRealtimeChat] subscribeToOrder called:', { orderId, chatId, alreadySubscribed: subscribedChannelsRef.current.get(orderId) });
      if (!pusher || subscribedChannelsRef.current.get(orderId)) return;

      const channelName = getOrderChannel(orderId);
      const channel = pusher.subscribe(channelName);

      if (!channel) return;

      subscribedChannelsRef.current.set(orderId, true);

      // Handle new messages
      const handleNewMessage = (rawData: unknown) => {
        const data = rawData as PusherMessageEvent;
        if (data.orderId !== orderId) return;

        const message = mapPusherMessageToUI(data, actorType);

        setChatWindows((prev) =>
          prev.map((w) => {
            if (w.orderId !== orderId) return w;

            // Check if message already exists (from optimistic update)
            const exists = w.messages.some(
              (m) => m.id === message.id || m.id.startsWith('temp_')
            );

            // If it's our own message, replace temp message
            if (message.from === 'me') {
              const tempIndex = w.messages.findIndex((m) =>
                m.id.startsWith('temp_')
              );
              if (tempIndex >= 0) {
                const newMessages = [...w.messages];
                newMessages[tempIndex] = message;
                return { ...w, messages: newMessages };
              }
            }

            // If message already exists, skip
            if (exists && message.from === 'me') return w;

            // Add new message from others
            const newUnread =
              message.from === 'them' && w.minimized ? w.unread + 1 : w.unread;

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
      };

      // Handle typing indicators
      const handleTypingStart = (rawData: unknown) => {
        const data = rawData as PusherTypingEvent;
        if (data.orderId !== orderId || data.actorType === actorType) return;

        setChatWindows((prev) =>
          prev.map((w) => {
            if (w.orderId !== orderId) return w;
            return { ...w, isTyping: true };
          })
        );
      };

      const handleTypingStop = (rawData: unknown) => {
        const data = rawData as PusherTypingEvent;
        if (data.orderId !== orderId || data.actorType === actorType) return;

        setChatWindows((prev) =>
          prev.map((w) => {
            if (w.orderId !== orderId) return w;
            return { ...w, isTyping: false };
          })
        );
      };

      channel.bind(CHAT_EVENTS.MESSAGE_NEW, handleNewMessage);
      channel.bind(CHAT_EVENTS.TYPING_START, handleTypingStart);
      channel.bind(CHAT_EVENTS.TYPING_STOP, handleTypingStop);

      // Fetch initial messages
      fetchMessages(orderId, chatId);
    },
    [pusher, actorType, mapPusherMessageToUI, fetchMessages, onNewMessage]
  );

  // Unsubscribe from an order's channel
  const unsubscribeFromOrder = useCallback(
    (orderId: string) => {
      if (!pusher || !subscribedChannelsRef.current.get(orderId)) return;

      const channelName = getOrderChannel(orderId);
      pusher.unsubscribe(channelName);
      subscribedChannelsRef.current.delete(orderId);
    },
    [pusher]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscribedChannelsRef.current.forEach((_, orderId) => {
        unsubscribeFromOrder(orderId);
      });
    };
  }, [unsubscribeFromOrder]);

  const openChat = useCallback(
    (user: string, emoji: string, orderId?: string) => {
      console.log('[useRealtimeChat] openChat called:', { user, orderId });
      setChatWindows((prev) => {
        console.log('[useRealtimeChat] Current chat windows:', prev.map(w => ({ id: w.id, orderId: w.orderId, user: w.user, msgCount: w.messages.length })));
        // Check if chat already exists - prioritize orderId match over user name match
        const existingIndex = prev.findIndex(
          (w) => w.orderId === orderId
        );

        if (existingIndex >= 0) {
          // Exact orderId match - just bring to front and refresh messages
          const existing = prev[existingIndex];
          if (orderId) {
            setTimeout(() => subscribeToOrder(orderId, existing.id), 0);
          }
          return prev.map((w, i) =>
            i === existingIndex ? { ...w, minimized: false, unread: 0 } : w
          );
        }

        // Check if there's a window with same user but different order
        // In this case, we need to update the orderId and clear messages
        const userMatchIndex = prev.findIndex(
          (w) => w.user === user && w.orderId !== orderId
        );

        if (userMatchIndex >= 0 && orderId) {
          // Reuse window but update orderId and clear messages for fresh load
          const existing = prev[userMatchIndex];
          // Unsubscribe from old order if exists
          if (existing.orderId) {
            unsubscribeFromOrder(existing.orderId);
          }
          // Subscribe to new order after state update
          setTimeout(() => subscribeToOrder(orderId, existing.id), 0);
          return prev.map((w, i) =>
            i === userMatchIndex
              ? { ...w, orderId, minimized: false, unread: 0, messages: [] }
              : w
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

        // Schedule subscription after state update so fetchMessages can find the chat window
        if (orderId) {
          setTimeout(() => subscribeToOrder(orderId, chatId), 0);
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
      if (!window?.orderId || !actorId) {
        console.error('Cannot send message: missing orderId or actorId');
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

      try {
        // Send to API (will trigger Pusher event)
        const res = await fetch(`/api/orders/${window.orderId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_type: actorType,
            sender_id: actorId,
            content: text,
            message_type: imageUrl ? 'image' : 'text',
            image_url: imageUrl,
          }),
        });

        if (!res.ok) {
          // Demo mode - keep the temp message as the actual message
          console.log('Messages API not available - demo mode');
          return;
        }

        const data = await res.json();

        if (!data.success) {
          throw new Error(data.error || 'Failed to send message');
        }

        // The real message will come through Pusher and replace the temp one
      } catch (error) {
        // In demo mode, keep the message (don't remove it)
        console.log('Send message error - demo mode, keeping local message');
      }
    },
    [chatWindows, actorType, actorId]
  );

  const markAsRead = useCallback(
    async (chatId: string) => {
      const window = chatWindows.find((w) => w.id === chatId);
      if (!window?.orderId) return;

      setChatWindows((prev) =>
        prev.map((w) => (w.id === chatId ? { ...w, unread: 0 } : w))
      );

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
    },
    [chatWindows, actorType]
  );

  // Send typing indicator
  const sendTypingIndicator = useCallback(
    async (chatId: string, isTyping: boolean) => {
      const window = chatWindows.find((w) => w.id === chatId);
      if (!window?.orderId) return;

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
        // Typing indicators are best-effort, ignore errors
      }
    },
    [chatWindows, actorType]
  );

  return {
    chatWindows,
    isConnected: pusher?.isConnected || false,
    openChat,
    closeChat,
    toggleMinimize,
    sendMessage,
    markAsRead,
    sendTypingIndicator,
  };
}

export default useRealtimeChat;
