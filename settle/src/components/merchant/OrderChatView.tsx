'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { ConnectionIndicator } from '@/components/NotificationToast';

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

  // Auto mark-read when messages arrive
  const chatWindowForRead = chatWindows.find(w => w.orderId === orderId);
  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    if (!chatWindowForRead) return;
    if (chatWindowForRead.messages.length === lastMessageCountRef.current) return;
    lastMessageCountRef.current = chatWindowForRead.messages.length;
    markAsRead(chatWindowForRead.id);
  }, [chatWindowForRead, chatWindowForRead?.messages.length, markAsRead]);

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
  const typeColor = orderType === 'buy' ? 'text-green-400 bg-green-500/15 border-green-500/20' : 'text-orange-400 bg-orange-500/15 border-orange-500/20';

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      {/* Header */}
      <div className="px-3 py-2 border-b border-foreground/[0.04] flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-foreground/[0.06] transition-colors text-foreground/40 hover:text-foreground/70"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="w-7 h-7 rounded-lg bg-foreground/[0.03] border border-foreground/[0.06] flex items-center justify-center text-sm">
          {getUserEmoji(userName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-foreground/80 truncate">
              {userName}
            </p>
            {orderType && (
              <span className={`text-[8px] px-1 py-0.5 rounded font-mono border ${typeColor}`}>
                {typeLabel}
              </span>
            )}
          </div>
          {/* Online / Typing status */}
          <div className="flex items-center gap-1">
            {chatWindow?.isTyping ? (
              <p className="text-[10px] text-green-400 font-medium">typing...</p>
            ) : (
              <>
                <ConnectionIndicator isConnected={chatWindow?.presence?.some(p => p.actorType === 'user' && p.isOnline) ?? false} />
                <p className="text-[10px] text-foreground/30 font-mono truncate">
                  {chatWindow?.presence?.some(p => p.actorType === 'user' && p.isOnline)
                    ? 'Online'
                    : `Order #${orderNumber}`}
                </p>
              </>
            )}
          </div>
        </div>
        {orderStatus && (
          <span className="text-[8px] px-1.5 py-0.5 bg-foreground/[0.04] text-foreground/40 rounded font-mono uppercase">
            {orderStatus}
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
            isLoading={chatWindow.messages.length === 0}
            disabled={isChatClosed}
            chatEnabled={!isChatClosed}
            chatReason={closedReason}
            onLoadOlder={() => loadOlderMessages(orderId)}
            hasOlderMessages={hasOlderMessages(orderId)}
            isLoadingOlder={isLoadingOlderMessages(orderId)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
