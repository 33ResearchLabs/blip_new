'use client';

import { useEffect, useState, useRef } from 'react';
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

function getInitials(username: string): string {
  const words = username.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
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
  const mountReadFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!orderId || mountReadFiredRef.current === orderId) return;
    mountReadFiredRef.current = orderId;
    fetchWithAuth(`/api/orders/${orderId}/messages`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reader_type: 'merchant' }),
    }).catch(() => { /* best-effort */ });
  }, [orderId]);

  // Also mark read at the chat-window level when new messages arrive while open.
  const chatWindowForRead = chatWindows.find(w => w.orderId === orderId);
  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    if (!chatWindowForRead) return;
    if (chatWindowForRead.messages.length === lastMessageCountRef.current) return;
    lastMessageCountRef.current = chatWindowForRead.messages.length;
    markAsRead(chatWindowForRead.id);
  }, [chatWindowForRead, chatWindowForRead?.messages.length, markAsRead]);

  // Initial-load gate
  const [initialLoadPending, setInitialLoadPending] = useState(true);
  useEffect(() => {
    setInitialLoadPending(true);
    const t = setTimeout(() => setInitialLoadPending(false), 800);
    return () => clearTimeout(t);
  }, [orderId]);
  useEffect(() => {
    const win = chatWindows.find(w => w.orderId === orderId);
    if (win && win.messages.length > 0 && initialLoadPending) {
      setInitialLoadPending(false);
    }
  }, [chatWindows, orderId, initialLoadPending]);

  // Track order status + amounts for context strip
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [cryptoAmount, setCryptoAmount] = useState<number | null>(null);
  const [fiatAmount, setFiatAmount] = useState<number | null>(null);
  const [fiatCurrency, setFiatCurrency] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}`);
        if (!res.ok) return;
        const data = await res.json();
        const order = data?.data || data;
        if (!cancelled) {
          setOrderStatus(order?.status || null);
          setCryptoAmount(order?.crypto_amount ?? null);
          setFiatAmount(order?.fiat_amount ?? null);
          setFiatCurrency(order?.fiat_currency ?? null);
        }
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

  const isUserOnline = chatWindow?.presence?.some(p => p.actorType === 'user' && p.isOnline) ?? false;
  const initials = getInitials(userName);

  const fiatSymbol =
    fiatCurrency === 'INR' ? '₹'
    : fiatCurrency === 'AED' ? 'د.إ'
    : fiatCurrency ?? '';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#08080a', color: '#f5f5f7' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.09)', flexShrink: 0 }}>
        {/* Back button */}
        <button
          onClick={onBack}
          style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aeaeb2', cursor: 'pointer', flexShrink: 0 }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Gradient avatar with online dot */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: 999, background: 'linear-gradient(150deg,#ff8a3d,#ff5d73)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 15 }}>
            {initials}
          </div>
          {isUserOnline && (
            <span style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderRadius: 999, background: '#b8e9d4', boxShadow: '0 0 0 2.5px #08080a' }} />
          )}
        </div>

        {/* Name + status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 800, fontSize: 16, color: '#f5f5f7', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userName}</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#b8e9d4" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div style={{ color: chatWindow?.isTyping ? '#b8e9d4' : isUserOnline ? '#b8e9d4' : '#86868b', fontSize: 11.5, fontWeight: 600, marginTop: 1 }}>
            {chatWindow?.isTyping ? 'typing…' : isUserOnline ? 'Active now' : `#${orderNumber}`}
          </div>
        </div>

        {/* Profile icon button */}
        <button style={{ width: 38, height: 38, borderRadius: 999, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aeaeb2', cursor: 'pointer', flexShrink: 0 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </button>
      </div>

      {/* Order context strip */}
      <div style={{ margin: '10px 16px 2px', padding: '11px 14px', borderRadius: 16, background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.09)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: '#f5f5f7', whiteSpace: 'nowrap' }}>
              {cryptoAmount != null ? `${Number(cryptoAmount).toFixed(2)} USDT` : `#${orderNumber}`}
            </span>
            {cryptoAmount != null && <span style={{ color: '#86868b', display: 'flex' }}>→</span>}
            {fiatAmount != null && (
              <span style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: 'tabular-nums', color: '#f5f5f7', whiteSpace: 'nowrap' }}>
                {fiatSymbol}{Number(fiatAmount).toLocaleString()}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, color: '#b8e9d4', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            {orderStatus === 'escrowed'
              ? 'Awaiting your release'
              : orderStatus === 'payment_sent'
                ? 'Awaiting your confirmation'
                : orderStatus || 'Active'}
          </div>
        </div>
        {orderStatus === 'escrowed' && (
          <button style={{ flexShrink: 0, padding: '10px 16px', borderRadius: 12, border: 'none', background: '#f5f5f7', color: '#0b0b0c', fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
            Release
          </button>
        )}
      </div>

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div style={{ width: 20, height: 20, border: '2px solid rgba(184,233,212,0.3)', borderTopColor: '#b8e9d4', borderRadius: 999, animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}
      </div>
    </div>
  );
}
