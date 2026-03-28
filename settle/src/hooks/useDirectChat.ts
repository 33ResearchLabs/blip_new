'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { usePusherOptional } from '@/context/PusherContext';
import { CHAT_EVENTS } from '@/lib/pusher/events';
import { getMerchantChannel } from '@/lib/pusher/channels';

export interface DirectChatMessage {
  id: string;
  from: 'me' | 'them';
  text: string;
  timestamp: Date;
  messageType: 'text' | 'image' | 'receipt';
  receiptData?: Record<string, unknown> | null;
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
    message_type?: string;
    image_url?: string | null;
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

  const pusher = usePusherOptional();
  const isPusherConnected = pusher?.isConnected ?? false;
  const activeContactIdRef = useRef(activeContactId);
  activeContactIdRef.current = activeContactId;

  // Debounced conversation refresh — coalesces rapid mutation + event calls
  const convRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable ref for fetchConversations — keeps polling interval independent of deps
  const fetchConversationsRef = useRef<() => Promise<void>>(async () => {});

  // Fetch conversation list
  const fetchConversations = useCallback(async () => {
    const mid = merchantIdRef.current;
    if (!mid) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/direct-messages?merchant_id=${mid}`);
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

  // Keep ref in sync
  fetchConversationsRef.current = fetchConversations;

  // Debounced conversation refresh — prevents multiple rapid calls from
  // mutations + Pusher events from causing redundant fetches
  const scheduleFetchConversations = useCallback(() => {
    if (convRefreshTimerRef.current) clearTimeout(convRefreshTimerRef.current);
    convRefreshTimerRef.current = setTimeout(() => {
      fetchConversationsRef.current();
    }, 500);
  }, []);

  // Stable ref for fetchMessages — keeps message polling interval independent of deps
  const fetchMessagesRef = useRef<(targetId: string) => Promise<void>>(async () => {});

  // Fetch messages for active contact
  const fetchMessages = useCallback(async (targetId: string) => {
    const mid = merchantIdRef.current;
    if (!mid) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/direct-messages?merchant_id=${mid}&target_id=${targetId}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.data.messages) {
        const mapped: DirectChatMessage[] = data.data.messages.map((m: {
          id: string;
          sender_id: string;
          content: string;
          created_at: string;
          message_type: 'text' | 'image' | 'receipt';
          receipt_data?: Record<string, unknown> | null;
          image_url?: string | null;
          is_read: boolean;
        }) => ({
          id: m.id,
          from: m.sender_id === mid ? 'me' : 'them',
          text: m.content,
          timestamp: new Date(m.created_at),
          messageType: m.message_type || 'text',
          receiptData: m.receipt_data ?? null,
          imageUrl: m.image_url,
          isRead: m.is_read,
        }));
        setMessages(mapped);
      }
    } catch (error) {
      console.error('[useDirectChat] Error fetching messages:', error);
    }
  }, []);

  // Keep ref in sync
  fetchMessagesRef.current = fetchMessages;

  // Initial fetch on mount (one-time)
  useEffect(() => {
    if (!merchantId) return;
    setIsLoadingConversations(true);
    fetchConversationsRef.current().finally(() => setIsLoadingConversations(false));
  }, [merchantId]);

  // Conversation polling — only when Pusher is NOT delivering events
  useEffect(() => {
    if (!merchantId || isPusherConnected) return;
    pollConvRef.current = setInterval(() => {
      fetchConversationsRef.current();
    }, 15000);
    return () => {
      if (pollConvRef.current) clearInterval(pollConvRef.current);
    };
  }, [merchantId, isPusherConnected]);

  // Real-time: subscribe to merchant's private Pusher channel for incoming DMs
  useEffect(() => {
    if (!pusher || !merchantId) return;

    const channelName = getMerchantChannel(merchantId);
    const channel = pusher.subscribe(channelName);
    if (!channel) return;

    const handleNewDM = (raw: unknown) => {
      const data = raw as {
        messageId: string;
        senderType: string;
        senderId: string;
        content: string;
        messageType: string;
        imageUrl?: string;
        createdAt: string;
      };
      // If we're chatting with this sender, add the message to the list
      const currentContactId = activeContactIdRef.current;
      if (currentContactId && data.senderId === currentContactId) {
        const newMsg: DirectChatMessage = {
          id: data.messageId,
          from: 'them',
          text: data.content,
          timestamp: new Date(data.createdAt),
          messageType: (data.messageType as 'text' | 'image') || 'text',
          imageUrl: data.imageUrl,
          isRead: false,
        };
        setMessages(prev => {
          // Avoid duplicates
          if (prev.some(m => m.id === data.messageId)) return prev;
          return [...prev, newMsg];
        });
      }

      // Refresh conversations to update last message + unread count (debounced)
      scheduleFetchConversations();
    };

    channel.bind(CHAT_EVENTS.DM_NEW, handleNewDM);

    return () => {
      channel.unbind(CHAT_EVENTS.DM_NEW, handleNewDM);
      pusher.unsubscribe(channelName);
    };
  }, [pusher, merchantId, scheduleFetchConversations]);

  // Message polling (5s) when chat is open — skip when Pusher delivers messages
  useEffect(() => {
    if (!activeContactId) {
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
      return;
    }

    // Initial fetch (one-time on contact change)
    setIsLoadingMessages(true);
    fetchMessagesRef.current(activeContactId).finally(() => setIsLoadingMessages(false));

    // Only poll when Pusher is NOT connected
    if (isPusherConnected) return;

    const contactId = activeContactId;
    pollMsgRef.current = setInterval(() => {
      fetchMessagesRef.current(contactId);
    }, 5000);

    return () => {
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
    };
  }, [activeContactId, isPusherConnected]);

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
      const res = await fetchWithAuth('/api/merchant/direct-messages', {
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

    // Refresh conversations to update last message (debounced)
    scheduleFetchConversations();
  }, [merchantId, activeContactId, activeContactType, scheduleFetchConversations]);

  const addContact = useCallback(async (targetId: string, targetType: 'user' | 'merchant') => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth('/api/merchant/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          target_id: targetId,
          target_type: targetType,
        }),
      });
      if (res.ok) {
        scheduleFetchConversations();
      }
    } catch (error) {
      console.error('[useDirectChat] Error adding contact:', error);
    }
  }, [merchantId, scheduleFetchConversations]);

  const removeContactById = useCallback(async (contactId: string) => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/contacts?merchant_id=${merchantId}&contact_id=${contactId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        scheduleFetchConversations();
      }
    } catch (error) {
      console.error('[useDirectChat] Error removing contact:', error);
    }
  }, [merchantId, scheduleFetchConversations]);

  const toggleFavorite = useCallback(async (contactId: string, currentFav: boolean) => {
    if (!merchantId) return;
    try {
      await fetchWithAuth('/api/merchant/contacts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: merchantId,
          contact_id: contactId,
          is_favorite: !currentFav,
        }),
      });
      scheduleFetchConversations();
    } catch (error) {
      console.error('[useDirectChat] Error toggling favorite:', error);
    }
  }, [merchantId, scheduleFetchConversations]);

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
