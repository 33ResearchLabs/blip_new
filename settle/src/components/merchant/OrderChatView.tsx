'use client';

import { useEffect, useState, useRef } from 'react';
import { ArrowUpRight, ArrowDownLeft, ChevronLeft } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface OrderChatViewProps {
  orderId: string;
  merchantId: string;
  userName: string;
  orderNumber: string;
  orderType?: 'buy' | 'sell';
  userAvatarUrl?: string | null;
  onBack: () => void;
  onSendSound?: () => void;
}

function getUserEmoji(username: string): string {
  const emojis = ['🦊', '🐻', '🐼', '🐨', '🦁', '🐯', '🐸', '🐙', '🦋', '🐳', '🦄', '🐲'];
  const hash = username.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  return emojis[hash % emojis.length];
}

export function OrderChatView({ orderId, merchantId, userName, orderNumber, orderType, userAvatarUrl, onBack, onSendSound }: OrderChatViewProps) {
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
  const [orderLabel, setOrderLabel] = useState<string | null>(null);
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
          if (order?.fiat_amount && order?.fiat_currency) {
            const symbol = order.fiat_currency === 'INR' ? '₹' : order.fiat_currency === 'AED' ? 'د.إ' : order.fiat_currency;
            const amount = Number(order.fiat_amount).toLocaleString('en-US', { maximumFractionDigits: 0 });
            const side = orderType === 'buy' ? 'Buy' : 'Sell';
            setOrderLabel(`@${userName} · ${side} ${symbol}${amount}`);
          }
        }
      } catch { /* best-effort */ }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [orderId, userName, orderType]);

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

  // Counterparty presence for the header. In U2M the counterparty is the
  // user; in M2M it's the other merchant — so match "anyone online who isn't
  // me / compliance / system" rather than a fixed actorType.
  const isCounterpartyOnline = !!chatWindow?.presence?.some(
    (p) => p.isOnline && p.actorId !== merchantId && p.actorType !== 'compliance' && p.actorType !== 'system',
  );
  const isCounterpartyTyping = !!chatWindow?.isTyping;

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header — back button + counterparty + buy/sell + presence */}
      <div className="shrink-0 px-3 py-2 border-b border-foreground/[0.04] flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="Back to chats"
          className="shrink-0 p-1 rounded hover:bg-foreground/[0.06] transition-colors text-foreground/40 hover:text-foreground/70"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="shrink-0 w-7 h-7 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center text-sm">
          {getUserEmoji(userName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-foreground/80 truncate">{userName}</p>
            <span className={`shrink-0 inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border font-mono ${typeColor}`}>
              <TypeIcon className="w-2.5 h-2.5" />
              {typeLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {isCounterpartyTyping ? (
              <span className="text-[12px] font-mono text-[#f5f5f7]">typing...</span>
            ) : (
              <>
                <span className={`w-1.5 h-1.5 rounded-full ${isCounterpartyOnline ? 'bg-emerald-500' : 'bg-white/25'}`} />
                <span className={`text-[12px] font-mono ${isCounterpartyOnline ? 'text-[#f5f5f7]' : 'text-foreground/35'}`}>
                  {isCounterpartyOnline ? 'Online' : 'Offline'}
                </span>
              </>
            )}
          </div>
        </div>
        {orderNumber && (
          <span className="shrink-0 text-[10px] px-1.5 py-0.5 bg-foreground/[0.04] text-foreground/35 rounded font-mono truncate max-w-[90px]">
            #{orderNumber}
          </span>
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
            userName={userName}
            userAvatarUrl={userAvatarUrl}
            orderLabel={orderLabel ?? undefined}
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
