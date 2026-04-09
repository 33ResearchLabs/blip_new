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
  const [isContactTyping, setIsContactTyping] = useState(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentTypingRef = useRef<boolean>(false);
  const sendStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Typing indicators (1:1 direct chat)
    const handleTypingStart = (raw: unknown) => {
      const data = raw as { senderId: string };
      const currentContactId = activeContactIdRef.current;
      console.log('[useDirectChat] TYPING_START received', { senderId: data.senderId, currentContactId });
      if (!currentContactId || data.senderId !== currentContactId) return;
      setIsContactTyping(true);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => setIsContactTyping(false), 5000);
    };
    const handleTypingStop = (raw: unknown) => {
      const data = raw as { senderId: string };
      const currentContactId = activeContactIdRef.current;
      console.log('[useDirectChat] TYPING_STOP received', { senderId: data.senderId, currentContactId });
      if (!currentContactId || data.senderId !== currentContactId) return;
      setIsContactTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    };
    console.log('[useDirectChat] subscribing to typing on', channelName);
    channel.bind(CHAT_EVENTS.TYPING_START, handleTypingStart);
    channel.bind(CHAT_EVENTS.TYPING_STOP, handleTypingStop);

    return () => {
      channel.unbind(CHAT_EVENTS.DM_NEW, handleNewDM);
      channel.unbind(CHAT_EVENTS.TYPING_START, handleTypingStart);
      channel.unbind(CHAT_EVENTS.TYPING_STOP, handleTypingStop);
      pusher.unsubscribe(channelName);
    };
  }, [pusher, merchantId, scheduleFetchConversations]);

  // Reset typing state when switching contacts
  useEffect(() => {
    setIsContactTyping(false);
    sentTypingRef.current = false;
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    if (sendStopTimerRef.current) clearTimeout(sendStopTimerRef.current);
  }, [activeContactId]);

  // Send typing indicator (throttled) — call on every keystroke.
  // Optionally accepts an `orderId` so we ALSO fire on the order channel,
  // letting the counterpart see typing in their order chat view (e.g. user OrderDetailScreen).
  const sendTyping = useCallback(async (orderId?: string) => {
    const contactId = activeContactIdRef.current;
    const contactType = activeContactType;
    if (!contactId) return;

    const fireDirectStart = async () => {
      try {
        await fetchWithAuth('/api/merchant/direct-messages/typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactType, contactId, isTyping: true }),
        });
      } catch { /* best-effort */ }
    };
    const fireDirectStop = async () => {
      try {
        await fetchWithAuth('/api/merchant/direct-messages/typing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactType, contactId, isTyping: false }),
        });
      } catch { /* best-effort */ }
    };
    const fireOrderTyping = async (isTyping: boolean) => {
      if (!orderId) return;
      try {
        await fetchWithAuth(`/api/orders/${orderId}/typing`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actor_type: 'merchant', is_typing: isTyping }),
        });
      } catch { /* best-effort */ }
    };

    if (!sentTypingRef.current) {
      sentTypingRef.current = true;
      fireDirectStart();
      fireOrderTyping(true);
    }

    if (sendStopTimerRef.current) clearTimeout(sendStopTimerRef.current);
    sendStopTimerRef.current = setTimeout(() => {
      sentTypingRef.current = false;
      fireDirectStop();
      fireOrderTyping(false);
    }, 2000);
  }, [activeContactType]);

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
    // If re-opening the SAME contact (e.g. clicking a notification for the
    // chat that's already active), don't wipe messages — setState would be a
    // no-op so the fetch effect wouldn't re-run, leaving the panel empty.
    // Just refresh in place.
    const isSameContact = activeContactIdRef.current === targetId;
    setActiveContactType(targetType);
    setActiveContactName(name);
    if (isSameContact) {
      fetchMessagesRef.current(targetId);
    } else {
      setActiveContactId(targetId);
      setMessages([]);
    }

    // Optimistically clear the unread badge for this contact in the local
    // conversation list (the GET fetch on the active chat marks them read on
    // the backend; we mirror that locally so the inbox badge updates immediately).
    setConversations(prev => {
      let removed = 0;
      const next = prev.map(c => {
        if (c.contact_target_id === targetId && c.contact_type === targetType) {
          removed += c.unread_count || 0;
          return { ...c, unread_count: 0 };
        }
        return c;
      });
      if (removed > 0) {
        setTotalUnread(t => Math.max(0, t - removed));
      }
      return next;
    });

    // Refetch the authoritative list shortly after — picks up the server-side
    // is_read updates from the messages GET so the badge stays cleared.
    scheduleFetchConversations();
  }, [scheduleFetchConversations]);

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
    isContactTyping,

    // Actions
    openChat,
    closeChat,
    sendMessage,
    sendTyping,
    addContact,
    removeContact: removeContactById,
    toggleFavorite,
  };
}

export default useDirectChat;
