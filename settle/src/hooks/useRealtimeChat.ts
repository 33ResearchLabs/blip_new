'use client';

/**
 * Real-time Chat Hook
 *
 * Subscribes to chat messages via Pusher with WebSocket fallback
 * Supports: text, image, file messages, typing indicators, presence, compliance
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { usePusherOptional } from '@/context/PusherContext';
import { getOrderChannel } from '@/lib/pusher/channels';
import { CHAT_EVENTS } from '@/lib/pusher/events';

export interface ChatMessage {
  id: string;
  from: 'me' | 'them' | 'system' | 'compliance';
  text: string;
  timestamp: Date;
  messageType?: 'text' | 'image' | 'file' | 'system' | 'receipt' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  receiptData?: Record<string, unknown> | null;
  imageUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  senderType?: 'user' | 'merchant' | 'compliance' | 'system';
  senderName?: string;
  isRead?: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read';
  isHighlighted?: boolean;
}

export interface PresenceMember {
  actorType: 'user' | 'merchant' | 'compliance' | 'system';
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
  sender_type: 'user' | 'merchant' | 'compliance' | 'system';
  sender_id: string;
  sender_name?: string;
  content: string;
  message_type: 'text' | 'image' | 'file' | 'system' | 'receipt' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  receipt_data?: Record<string, unknown> | null;
  image_url?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  created_at: string;
  is_read: boolean;
  is_highlighted?: boolean;
  status?: 'sent' | 'delivered' | 'seen';
}

// Pusher message event
interface PusherMessageEvent {
  messageId: string;
  orderId: string;
  senderType: 'user' | 'merchant' | 'compliance' | 'system';
  senderId: string | null;
  senderName?: string;
  content: string;
  messageType: 'text' | 'image' | 'file' | 'system' | 'dispute' | 'resolution' | 'resolution_proposed' | 'resolution_rejected' | 'resolution_accepted' | 'resolution_finalized';
  imageUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt: string;
}

// Pusher typing event
interface PusherTypingEvent {
  orderId: string;
  actorType: 'user' | 'merchant' | 'compliance';
  actorName?: string;
  timestamp: string;
}

// System message types that should be rendered as 'system' sender
const SYSTEM_MESSAGE_TYPES = new Set([
  'dispute', 'resolution', 'resolution_proposed',
  'resolution_rejected', 'resolution_accepted', 'resolution_finalized', 'system',
]);

interface UseRealtimeChatOptions {
  maxWindows?: number;
  onNewMessage?: (chatId: string, message: ChatMessage) => void;
  actorType?: 'user' | 'merchant' | 'compliance';
  actorId?: string;
}

/**
 * Determine 'from' field based on sender type and current actor
 */
function determineSender(
  senderType: string,
  messageType: string,
  myActorType: string
): 'me' | 'them' | 'system' | 'compliance' {
  // System-generated messages
  if (senderType === 'system' || SYSTEM_MESSAGE_TYPES.has(messageType)) {
    return 'system';
  }
  // My own message
  if (senderType === myActorType) {
    return 'me';
  }
  // Compliance officer message (when I'm not compliance)
  if (senderType === 'compliance') {
    return 'compliance';
  }
  // Other party
  return 'them';
}

export function useRealtimeChat(options: UseRealtimeChatOptions = {}) {
  const { maxWindows = 3, onNewMessage, actorType = 'user', actorId } = options;
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);

  const pusher = usePusherOptional();
  const subscribedChannelsRef = useRef<Map<string, boolean>>(new Map());
  const typingTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const chatWindowsRef = useRef(chatWindows);
  chatWindowsRef.current = chatWindows;

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
        receiptData: dbMsg.receipt_data ?? null,
        imageUrl: dbMsg.image_url,
        fileUrl: dbMsg.file_url,
        fileName: dbMsg.file_name,
        fileSize: dbMsg.file_size,
        mimeType: dbMsg.mime_type,
        senderType: dbMsg.sender_type,
        senderName: dbMsg.sender_name,
        isRead: dbMsg.is_read,
        isHighlighted: dbMsg.is_highlighted,
        status: from === 'me' ? (dbMsg.is_read ? 'read' : (dbMsg.status as 'sent' | 'delivered' | undefined) || 'sent') : undefined,
      };
    },
    []
  );

  // Convert Pusher event to UI message
  const mapPusherMessageToUI = useCallback(
    (event: PusherMessageEvent, myActorType: string): ChatMessage => {
      const from = determineSender(event.senderType, event.messageType, myActorType);
      return {
        id: event.messageId,
        from,
        text: event.content,
        timestamp: new Date(event.createdAt),
        messageType: event.messageType,
        imageUrl: event.imageUrl,
        fileUrl: event.fileUrl,
        fileName: event.fileName,
        fileSize: event.fileSize,
        mimeType: event.mimeType,
        senderType: event.senderType,
        senderName: event.senderName,
        isRead: false,
        status: from === 'me' ? 'sent' : undefined,
      };
    },
    []
  );

  // Fetch initial messages for an order
  const fetchMessages = useCallback(
    async (orderId: string, chatId: string) => {
      try {
        const authParam = actorId ? `?user_id=${actorId}` : '';
        const res = await fetchWithAuth(`/api/orders/${orderId}/messages${authParam}`);
        if (!res.ok) {
          console.log('Messages API not available - using demo mode', res.status);
          return;
        }
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
        console.log('Messages API error - running in demo mode', error);
      }
    },
    [actorType, actorId, mapDbMessageToUI]
  );

  // Stable ref for fetchMessages so polling interval doesn't recreate
  const fetchMessagesRef = useRef(fetchMessages);
  fetchMessagesRef.current = fetchMessages;

  // Fetch presence for an order
  const fetchPresence = useCallback(
    async (orderId: string, chatId: string) => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}/presence`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.data?.members) {
          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== chatId) return w;
              return { ...w, presence: data.data.members };
            })
          );
        }
      } catch {
        // Presence is best-effort
      }
    },
    []
  );

  // Subscribe to real-time messages for an order
  const subscribeToOrder = useCallback(
    (orderId: string, chatId: string) => {
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
              // Check if already exists
              if (w.messages.some(m => m.id === message.id)) return w;
            }

            // Add new message
            const newUnread =
              message.from !== 'me' && w.minimized ? w.unread + 1 : w.unread;

            if (message.from !== 'me') {
              onNewMessage?.(w.id, message);
            }

            return {
              ...w,
              messages: [...w.messages.filter((m) => !m.id.startsWith('temp_')), message],
              unread: newUnread,
              isTyping: false, // Clear typing on new message
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
            return { ...w, isTyping: true, typingActorType: data.actorType, typingActorName: data.actorName };
          })
        );

        // Auto-clear typing after 5 seconds
        const key = `${orderId}:${data.actorType}`;
        const existingTimeout = typingTimeoutsRef.current.get(key);
        if (existingTimeout) clearTimeout(existingTimeout);
        typingTimeoutsRef.current.set(key, setTimeout(() => {
          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.orderId !== orderId) return w;
              return { ...w, isTyping: false, typingActorType: undefined, typingActorName: undefined };
            })
          );
        }, 5000));
      };

      const handleTypingStop = (rawData: unknown) => {
        const data = rawData as PusherTypingEvent;
        if (data.orderId !== orderId || data.actorType === actorType) return;

        setChatWindows((prev) =>
          prev.map((w) => {
            if (w.orderId !== orderId) return w;
            return { ...w, isTyping: false, typingActorType: undefined, typingActorName: undefined };
          })
        );
      };

      // Handle messages read
      const handleMessagesRead = (rawData: unknown) => {
        const data = rawData as { orderId: string; readerType: string; readAt: string };
        if (data.orderId !== orderId || data.readerType === actorType) return;

        setChatWindows((prev) =>
          prev.map((w) => {
            if (w.orderId !== orderId) return w;
            return {
              ...w,
              messages: w.messages.map((m) =>
                m.from === 'me' ? { ...m, isRead: true, status: 'read' as const } : m
              ),
            };
          })
        );
      };

      channel.bind(CHAT_EVENTS.MESSAGE_NEW, handleNewMessage);
      channel.bind(CHAT_EVENTS.TYPING_START, handleTypingStart);
      channel.bind(CHAT_EVENTS.TYPING_STOP, handleTypingStop);
      channel.bind(CHAT_EVENTS.MESSAGES_READ, handleMessagesRead);

      // Fetch initial messages and presence
      fetchMessages(orderId, chatId);
      fetchPresence(orderId, chatId);
    },
    [pusher, actorType, mapPusherMessageToUI, fetchMessages, fetchPresence, onNewMessage]
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

  // Retry subscriptions when Pusher connects (only on pusher change)
  useEffect(() => {
    if (!pusher) return;
    chatWindowsRef.current.forEach((w) => {
      if (w.orderId && !subscribedChannelsRef.current.get(w.orderId)) {
        subscribeToOrder(w.orderId, w.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pusher]);

  // Polling fallback: refresh messages every 5s ONLY when Pusher is disconnected
  const isPusherConnected = pusher?.isConnected ?? false;
  useEffect(() => {
    // Skip polling when Pusher is delivering messages in real-time
    if (isPusherConnected) return;

    const interval = setInterval(() => {
      const windows = chatWindowsRef.current;
      if (windows.length === 0) return;
      windows.forEach((w) => {
        if (w.orderId) {
          fetchMessagesRef.current(w.orderId, w.id);
        }
      });
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPusherConnected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscribedChannelsRef.current.forEach((_, orderId) => {
        unsubscribeFromOrder(orderId);
      });
      typingTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    };
  }, [unsubscribeFromOrder]);

  const openChat = useCallback(
    (user: string, emoji: string, orderId?: string) => {
      setChatWindows((prev) => {
        const existingIndex = prev.findIndex(
          (w) => w.orderId === orderId
        );

        if (existingIndex >= 0) {
          const existing = prev[existingIndex];
          if (orderId) {
            setTimeout(() => subscribeToOrder(orderId, existing.id), 0);
          }
          return prev.map((w, i) =>
            i === existingIndex ? { ...w, minimized: false, unread: 0 } : w
          );
        }

        // Check if there's a window with same user but different order
        const userMatchIndex = prev.findIndex(
          (w) => w.user === user && w.orderId !== orderId
        );

        if (userMatchIndex >= 0 && orderId) {
          const existing = prev[userMatchIndex];
          if (existing.orderId) {
            unsubscribeFromOrder(existing.orderId);
          }
          setTimeout(() => subscribeToOrder(orderId, existing.id), 0);
          return prev.map((w, i) =>
            i === userMatchIndex
              ? { ...w, orderId, minimized: false, unread: 0, messages: [], presence: [], isFrozen: false }
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
          presence: [],
          isFrozen: false,
        };

        if (orderId) {
          setTimeout(() => subscribeToOrder(orderId, chatId), 0);
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

      const window = chatWindows.find((w) => w.id === chatId);
      if (!window?.orderId || !actorId) {
        console.error('Cannot send message: missing orderId or actorId');
        return;
      }

      // Determine message type
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
        messageType: messageType as ChatMessage['messageType'],
        imageUrl,
        fileUrl: fileData?.fileUrl,
        fileName: fileData?.fileName,
        fileSize: fileData?.fileSize,
        mimeType: fileData?.mimeType,
        isRead: false,
        status: 'sending',
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
        const res = await fetchWithAuth(`/api/orders/${window.orderId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender_type: actorType,
            sender_id: actorId,
            content: text || undefined,
            message_type: messageType,
            image_url: imageUrl,
            file_url: fileData?.fileUrl,
            file_name: fileData?.fileName,
            file_size: fileData?.fileSize,
            mime_type: fileData?.mimeType,
          }),
        });

        if (!res.ok) {
          console.log('Messages API not available - demo mode');
          // Update status to sent even in demo mode
          setChatWindows((prev) =>
            prev.map((w) => {
              if (w.id !== chatId) return w;
              return {
                ...w,
                messages: w.messages.map(m => m.id === tempId ? { ...m, status: 'sent' as const } : m),
              };
            })
          );
          return;
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to send message');
        }

        // The real message will come through Pusher and replace the temp one
      } catch (error) {
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
        await fetchWithAuth(`/api/orders/${window.orderId}/messages`, {
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
        await fetchWithAuth(`/api/orders/${window.orderId}/typing`, {
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
