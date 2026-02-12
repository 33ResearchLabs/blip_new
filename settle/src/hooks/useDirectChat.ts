'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface DirectChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  timestamp: Date;
  messageType: 'text' | 'image';
  imageUrl?: string | null;
  isRead: boolean;
}

export interface DirectConversation {
  contact_id: string;
  contact_type: 'user' | 'merchant';
  contact_target_id: string;
  username: string;
  nickname: string | null;
  is_favorite: boolean;
  trades_count: number;
  last_message: {
    content: string;
    sender_type: string;
    created_at: string;
    is_read: boolean;
  } | null;
  unread_count: number;
  last_activity: string | null;
}

interface UseDirectChatOptions {
  merchantId?: string;
}

export function useDirectChat({ merchantId }: UseDirectChatOptions) {
  const [conversations, setConversations] = useState<DirectConversation[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Active chat state
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [activeContactType, setActiveContactType] = useState<'user' | 'merchant'>('user');
  const [activeContactName, setActiveContactName] = useState('');
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const pollConvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollMsgRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const merchantIdRef = useRef(merchantId);
  merchantIdRef.current = merchantId;

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    const mid = merchantIdRef.current;
    if (!mid) return;
    try {
      const res = await fetch(`/api/merchant/direct-messages?merchant_id=${mid}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success) {
        setConversations(data.data.conversations || []);
        setTotalUnread(data.data.totalUnread || 0);
      }
    } catch (error) {
      console.error('[useDirectChat] Error fetching conversations:', error);
    }
  }, []);

  // Fetch messages for active contact
  const fetchMessages = useCallback(async (targetId: string) => {
    const mid = merchantIdRef.current;
    if (!mid) return;
    try {
      const res = await fetch(`/api/merchant/direct-messages?merchant_id=${mid}&target_id=${targetId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data.messages) {
        const mapped: DirectChatMessage[] = data.data.messages.map((m: {
          id: string;
          sender_id: string;
          content: string;
          created_at: string;
          message_type: 'text' | 'image';
          image_url?: string | null;
          is_read: boolean;
        }) => ({
          id: m.id,
          from: m.sender_id === mid ? 'me' : 'them',
          text: m.content,
          timestamp: new Date(m.created_at),
          messageType: m.message_type || 'text',
          imageUrl: m.image_url,
          isRead: m.is_read,
        }));
        setMessages(mapped);
      }
    } catch (error) {
      console.error('[useDirectChat] Error fetching messages:', error);
    }
  }, []);

  // Initial load + conversation polling (15s)
  useEffect(() => {
    if (!merchantId) return;
    setIsLoadingConversations(true);
    fetchConversations().finally(() => setIsLoadingConversations(false));

    pollConvRef.current = setInterval(fetchConversations, 15000);
    return () => {
      if (pollConvRef.current) clearInterval(pollConvRef.current);
    };
  }, [merchantId, fetchConversations]);

  // Message polling (5s) when chat is open
  useEffect(() => {
    if (!activeContactId) {
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
      return;
    }

    // Initial fetch
    setIsLoadingMessages(true);
    fetchMessages(activeContactId).finally(() => setIsLoadingMessages(false));

    // Poll every 5s
    pollMsgRef.current = setInterval(() => {
      fetchMessages(activeContactId);
    }, 5000);

    return () => {
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
    };
  }, [activeContactId, fetchMessages]);

  const openChat = useCallback((targetId: string, targetType: 'user' | 'merchant', name: string) => {
    setActiveContactId(targetId);
    setActiveContactType(targetType);
    setActiveContactName(name);
    setMessages([]);
  }, []);

  const closeChat = useCallback(() => {
    setActiveContactId(null);
    setActiveContactName('');
    setMessages([]);
  }, []);

  const sendMessage = useCallback(async (text: string, imageUrl?: string) => {
    if (!merchantId || !activeContactId || (!text.trim() && !imageUrl)) return;

    // Optimistic add
    const tempId = `temp_${Date.now()}`;
    const tempMsg: DirectChatMessage = {
      id: tempId,
      from: 'me',
      text,
      timestamp: new Date(),
      messageType: imageUrl ? 'image' : 'text',
      imageUrl,
      isRead: false,
    };
    setMessages(prev => [...prev, tempMsg]);

    try {
      const res = await fetch('/api/merchant/direct-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          recipient_id: activeContactId,
          recipient_type: activeContactType,
          content: text,
          message_type: imageUrl ? 'image' : 'text',
          image_url: imageUrl,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // Replace temp message with real one
          setMessages(prev => prev.map(m =>
            m.id === tempId
              ? { ...tempMsg, id: data.data.id, timestamp: new Date(data.data.created_at) }
              : m
          ));
        }
      }
    } catch (error) {
      console.error('[useDirectChat] Error sending message:', error);
    }

    // Refresh conversations to update last message
    fetchConversations();
  }, [merchantId, activeContactId, activeContactType, fetchConversations]);

  const addContact = useCallback(async (targetId: string, targetType: 'user' | 'merchant') => {
    if (!merchantId) return;
    try {
      const res = await fetch('/api/merchant/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          target_id: targetId,
          target_type: targetType,
        }),
      });
      if (res.ok) {
        await fetchConversations();
      }
    } catch (error) {
      console.error('[useDirectChat] Error adding contact:', error);
    }
  }, [merchantId, fetchConversations]);

  const removeContactById = useCallback(async (contactId: string) => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/merchant/contacts?merchant_id=${merchantId}&contact_id=${contactId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await fetchConversations();
      }
    } catch (error) {
      console.error('[useDirectChat] Error removing contact:', error);
    }
  }, [merchantId, fetchConversations]);

  const toggleFavorite = useCallback(async (contactId: string, currentFav: boolean) => {
    if (!merchantId) return;
    try {
      await fetch('/api/merchant/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          contact_id: contactId,
          is_favorite: !currentFav,
        }),
      });
      await fetchConversations();
    } catch (error) {
      console.error('[useDirectChat] Error toggling favorite:', error);
    }
  }, [merchantId, fetchConversations]);

  return {
    // Conversations
    conversations,
    totalUnread,
    isLoadingConversations,
    fetchConversations,

    // Active chat
    activeContactId,
    activeContactType,
    activeContactName,
    messages,
    isLoadingMessages,

    // Actions
    openChat,
    closeChat,
    sendMessage,
    addContact,
    removeContact: removeContactById,
    toggleFavorite,
  };
}

export default useDirectChat;
