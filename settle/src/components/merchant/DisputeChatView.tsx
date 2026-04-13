'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, Shield } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';

interface DisputeChatViewProps {
  orderId: string;
  merchantId: string;
  userName: string;
  onBack: () => void;
  onSendSound?: () => void;
}

export function DisputeChatView({ orderId, merchantId, userName, onBack, onSendSound }: DisputeChatViewProps) {
  const { chatWindows, openChat, sendMessage, markAsRead, sendTypingIndicator, loadOlderMessages, hasOlderMessages, isLoadingOlderMessages } = useRealtimeChat({
    maxWindows: 1,
    actorType: 'merchant',
    actorId: merchantId,
  });

  // Open the dispute chat on mount
  useEffect(() => {
    openChat(`Dispute ${userName}`, '⚖️', orderId);
  }, [orderId, userName, openChat]);

  // Mark messages as read once the chat window is created. Unlike useDirectChat,
  // useRealtimeChat does NOT auto-mark-read on fetch — so disputes get stuck
  // showing unread badges. Trigger it explicitly here, then re-trigger any time
  // the message list grows (new messages while the panel is open).
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
      } catch {
        // Best-effort
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [orderId]);

  const isChatClosed = ['completed', 'cancelled', 'expired'].includes(orderStatus || '');
  const chatWindow = chatWindows.find(w => w.orderId === orderId);

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
        <div className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <Shield className="w-3.5 h-3.5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-foreground/80 truncate">Dispute Chat</p>
          <p className="text-[10px] text-foreground/30 font-mono">Order with {userName}</p>
        </div>
        <span className="text-[8px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded font-mono">
          DISPUTE
        </span>
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
            onLoadOlder={() => loadOlderMessages(orderId)}
            hasOlderMessages={hasOlderMessages(orderId)}
            isLoadingOlder={isLoadingOlderMessages(orderId)}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-red-500/40 border-t-red-400 rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
