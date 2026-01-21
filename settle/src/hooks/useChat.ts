"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface ChatMessage {
  id: string;
  from: "me" | "them";
  text: string;
  timestamp: Date;
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
  sender_type: "user" | "merchant" | "system";
  sender_id: string;
  content: string;
  message_type: "text" | "image" | "system";
  created_at: string;
  is_read: boolean;
}

interface UseChatOptions {
  maxWindows?: number;
  onNewMessage?: (chatId: string, message: ChatMessage) => void;
  actorType?: "user" | "merchant";
  actorId?: string;
}

export function useChat(options: UseChatOptions = {}) {
  const { maxWindows = 3, onNewMessage, actorType = "user", actorId } = options;
  const [chatWindows, setChatWindows] = useState<ChatWindow[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const pollingRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const lastMessageIdRef = useRef<Map<string, string>>(new Map());

  // Convert DB message to UI message
  const mapDbMessageToUI = useCallback((dbMsg: DbMessage, myActorType: string): ChatMessage => {
    return {
      id: dbMsg.id,
      from: dbMsg.sender_type === myActorType ? "me" : "them",
      text: dbMsg.content,
      timestamp: new Date(dbMsg.created_at),
    };
  }, []);

  // Fetch messages for an order
  const fetchMessages = useCallback(async (orderId: string, chatId: string) => {
    try {
      const res = await fetch(`/api/orders/${orderId}/messages`);
      if (!res.ok) {
        // API not available (demo mode)
        console.log('Messages API not available - running in demo mode');
        return;
      }
      const data = await res.json();

      if (data.success && data.data) {
        const messages: ChatMessage[] = data.data.map((m: DbMessage) => mapDbMessageToUI(m, actorType));

        // Check for new messages
        const lastMsgId = lastMessageIdRef.current.get(orderId);
        const newMessages = lastMsgId
          ? messages.filter(m => m.id > lastMsgId)
          : [];

        if (data.data.length > 0) {
          lastMessageIdRef.current.set(orderId, data.data[data.data.length - 1].id);
        }

        setChatWindows(prev => prev.map(w => {
          if (w.id !== chatId) return w;

          // Count new messages from others
          const newFromOthers = newMessages.filter(m => m.from === "them").length;

          return {
            ...w,
            messages,
            unread: w.minimized ? w.unread + newFromOthers : 0,
          };
        }));

        // Trigger callback for new messages
        newMessages.forEach(msg => {
          if (msg.from === "them") {
            onNewMessage?.(chatId, msg);
          }
        });
      }
    } catch (error) {
      console.error("Error fetching messages:", error);
    }
  }, [actorType, mapDbMessageToUI, onNewMessage]);

  // Start polling for a chat window
  const startPolling = useCallback((orderId: string, chatId: string) => {
    // Clear existing polling for this order
    const existingInterval = pollingRef.current.get(orderId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Initial fetch
    fetchMessages(orderId, chatId);

    // Poll every 2 seconds
    const interval = setInterval(() => {
      fetchMessages(orderId, chatId);
    }, 2000);

    pollingRef.current.set(orderId, interval);
  }, [fetchMessages]);

  // Stop polling for an order
  const stopPolling = useCallback((orderId: string) => {
    const interval = pollingRef.current.get(orderId);
    if (interval) {
      clearInterval(interval);
      pollingRef.current.delete(orderId);
    }
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.forEach((interval) => clearInterval(interval));
      pollingRef.current.clear();
    };
  }, []);

  const openChat = useCallback((user: string, emoji: string, orderId?: string) => {
    setChatWindows(prev => {
      // Check if chat already exists
      const existingIndex = prev.findIndex(w => w.orderId === orderId || w.user === user);
      if (existingIndex >= 0) {
        // Bring to front and unminimize
        const existing = prev[existingIndex];
        if (orderId && existing.orderId) {
          startPolling(orderId, existing.id);
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

      // Start polling if we have an orderId
      if (orderId) {
        startPolling(orderId, chatId);
      }

      const updated = [...prev, newWindow];
      if (updated.length > maxWindows) {
        // Stop polling for removed windows
        const removed = updated[0];
        if (removed.orderId) {
          stopPolling(removed.orderId);
        }
        return updated.slice(-maxWindows);
      }
      return updated;
    });
  }, [maxWindows, startPolling, stopPolling]);

  const closeChat = useCallback((chatId: string) => {
    setChatWindows(prev => {
      const window = prev.find(w => w.id === chatId);
      if (window?.orderId) {
        stopPolling(window.orderId);
      }
      return prev.filter(w => w.id !== chatId);
    });
  }, [stopPolling]);

  const toggleMinimize = useCallback((chatId: string) => {
    setChatWindows(prev => prev.map(w =>
      w.id === chatId ? { ...w, minimized: !w.minimized, unread: w.minimized ? 0 : w.unread } : w
    ));
  }, []);

  const sendMessage = useCallback(async (chatId: string, text: string) => {
    if (!text.trim()) return;

    const window = chatWindows.find(w => w.id === chatId);
    if (!window?.orderId || !actorId) {
      console.error("Cannot send message: missing orderId or actorId");
      return;
    }

    // Optimistically add message
    const tempId = `temp_${Date.now()}`;
    const tempMessage: ChatMessage = {
      id: tempId,
      from: "me",
      text,
      timestamp: new Date(),
    };

    setChatWindows(prev => prev.map(w => {
      if (w.id !== chatId) return w;
      return {
        ...w,
        messages: [...w.messages, tempMessage],
      };
    }));

    try {
      // Send to API
      const res = await fetch(`/api/orders/${window.orderId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender_type: actorType,
          sender_id: actorId,
          content: text,
          message_type: "text",
        }),
      });

      if (!res.ok) {
        // API not available (demo mode) - keep temp message
        console.log('Messages API not available - demo mode');
        return;
      }

      const data = await res.json();

      if (data.success && data.data) {
        // Replace temp message with real one
        setChatWindows(prev => prev.map(w => {
          if (w.id !== chatId) return w;
          return {
            ...w,
            messages: w.messages.map(m =>
              m.id === tempId ? mapDbMessageToUI(data.data, actorType) : m
            ),
          };
        }));
      }
    } catch (error) {
      // In demo mode, keep the temp message
      console.log("Send message error - demo mode");
    }
  }, [chatWindows, actorType, actorId, mapDbMessageToUI]);

  const markAsRead = useCallback(async (chatId: string) => {
    const window = chatWindows.find(w => w.id === chatId);
    if (!window?.orderId) return;

    setChatWindows(prev => prev.map(w =>
      w.id === chatId ? { ...w, unread: 0 } : w
    ));

    try {
      await fetch(`/api/orders/${window.orderId}/messages`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reader_type: actorType,
        }),
      });
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  }, [chatWindows, actorType]);

  return {
    chatWindows,
    isConnected,
    openChat,
    closeChat,
    toggleMinimize,
    sendMessage,
    markAsRead,
  };
}
