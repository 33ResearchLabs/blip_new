'use client';

import { useEffect, useState, useRef } from 'react';
import { ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface OrderChatViewProps {
  orderId: string;
  merchantId: string;
  userName: string;
  orderNumber: string;
  orderType?: 'buy' | 'sell';
  onBack: () => void;
  onSendSound?: () => void;
}

function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

export function OrderChatView({ orderId, merchantId, userName, orderNumber, orderType, onBack, onSendSound }: OrderChatViewProps) {
  const { chatWindows, openChat, sendMessage, markAsRead, sendTypingIndicator, loadOlderMessages, hasOlderMessages, isLoadingOlderMessages } = useRealtimeChat({
    maxWindows: 1,
    actorType: 'merchant',
    actorId: merchantId,
  });

  // Open order chat on mount
  useEffect(() => {
    openChat(userName, getUserEmoji(userName), orderId);
  }, [orderId, userName, openChat]);

  // Mark all messages read when this chat panel opens (mount / orderId change).
  // Calls the backend PATCH directly so the server persists the read state to DB
  // + clears the Redis unread counter. This is the primary "I've seen these
  // messages" signal — the chat-window-level markAsRead below is a secondary
  // path for messages that arrive while the panel is already open.
  const mountReadFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!orderId || mountReadFiredRef.current === orderId) return;
    mountReadFiredRef.current = orderId;
    fetchWithAuth(`/api/orders/${orderId}/messages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reader_type: 'merchant' }),
    }).catch(() => { /* best-effort — markAsRead below retries on new messages */ });
  }, [orderId]);

  // Also mark read at the chat-window level when new messages arrive while
  // this panel is open (covers messages that land after mount).
  const chatWindowForRead = chatWindows.find(w => w.orderId === orderId);
  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    if (!chatWindowForRead) return;
    if (chatWindowForRead.messages.length === lastMessageCountRef.current) return;
    lastMessageCountRef.current = chatWindowForRead.messages.length;
    markAsRead(chatWindowForRead.id);
  }, [chatWindowForRead, chatWindowForRead?.messages.length, markAsRead]);

  // Initial-load gate: flip false once the first fetchMessages round-trip
  // has had a chance to complete. Without this, `messages.length === 0`
  // was used as the loading flag — which never turned false for chats
  // that legitimately have no messages yet, producing an infinite spinner.
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  useEffect(() => {
    setInitialLoadPending(true);
    const t = setTimeout(() => setInitialLoadPending(false), 800);
    return () => clearTimeout(t);
  }, [orderId]);
  // As soon as any message lands, stop showing the spinner — this covers
  // the common case of chats that do have history and shouldn't wait
  // the full 800ms to render.
  useEffect(() => {
    const win = chatWindows.find(w => w.orderId === orderId);
    if (win && win.messages.length > 0 && initialLoadPending) {
      setInitialLoadPending(false);
    }
  }, [chatWindows, orderId, initialLoadPending]);

  // Track order status to gate chat input on terminal statuses
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setOrderStatus(data?.data?.status || data?.status || null);
      } catch { /* best-effort */ }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [orderId]);

  const isChatClosed = ['completed', 'cancelled', 'expired'].includes(orderStatus || '');
  const closedReason: string | null = isChatClosed
    ? orderStatus === 'completed'
      ? 'Trade completed — chat is closed. You can no longer send messages.'
      : orderStatus === 'cancelled'
        ? 'Trade cancelled — chat is closed. You can no longer send messages.'
        : 'Trade expired — chat is closed. You can no longer send messages.'
    : null;
  const chatWindow = chatWindows.find(w => w.orderId === orderId);

  const TypeIcon = orderType === 'buy' ? ArrowDownLeft : ArrowUpRight;
  const typeLabel = orderType === 'buy' ? 'BUY' : 'SELL';
  const typeColor = orderType === 'buy' ? 'text-[#f5f5f7] bg-white/[0.06] border-white/[0.09]' : 'text-orange-400 bg-orange-500/15 border-orange-500/20';

  return (
    <div className="h-full flex flex-col bg-background text-foreground">

      {/* Chat Room */}
      <div className="flex-1 min-h-0">
        {chatWindow ? (
          <ChatRoom
            orderId={orderId}
            messages={chatWindow.messages}
            currentUserType="merchant"
            currentUserId={merchantId}
            onSendMessage={(text, imageUrl, fileData) => {
              sendMessage(chatWindow.id, text, imageUrl, fileData);
              onSendSound?.();
            }}
            onTyping={(isTyping) => sendTypingIndicator(chatWindow.id, isTyping)}
            onMarkRead={() => markAsRead(chatWindow.id)}
            isTyping={chatWindow.isTyping}
            typingActorType={chatWindow.typingActorType}
            presence={chatWindow.presence}
            isFrozen={chatWindow.isFrozen}
            isLoading={initialLoadPending && chatWindow.messages.length === 0}
            disabled={isChatClosed}
            chatEnabled={!isChatClosed}
            chatReason={closedReason}
            onLoadOlder={() => loadOlderMessages(orderId)}
            hasOlderMessages={hasOlderMessages(orderId)}
            isLoadingOlder={isLoadingOlderMessages(orderId)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-white/[0.12] border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
