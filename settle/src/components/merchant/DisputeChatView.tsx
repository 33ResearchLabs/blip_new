'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronLeft, Shield } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { notifyError, notifyApiError } from '@/lib/notify/notifyError';
import { AlertTriangle } from 'lucide-react';

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

  // Mutual cancel state
  const [myMutualCancel, setMyMutualCancel] = useState(false);
  const [counterpartyMutualCancel, setCounterpartyMutualCancel] = useState(false);
  const [mutualCancelLoading, setMutualCancelLoading] = useState(false);
  // Synchronous re-entrancy guard (state has render latency) so a double-tap
  // can't fire two mutual-cancel requests.
  const mutualCancelInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchWithAuth(`/api/orders/${orderId}/dispute/mutual-cancel`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (data?.data) {
          setMyMutualCancel(!!data.data.mutual_cancel_requested_by_merchant);
          setCounterpartyMutualCancel(!!data.data.mutual_cancel_requested_by_user);
        }
      } catch { /* best-effort */ }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [orderId]);

  const handleMutualCancel = async (action: 'request' | 'withdraw') => {
    if (mutualCancelInFlightRef.current) return;
    mutualCancelInFlightRef.current = true;
    setMutualCancelLoading(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}/dispute/mutual-cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, actor_type: 'merchant', actor_id: merchantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMyMutualCancel(action === 'request');
        if (data.mutualCancelComplete) onBack();
      } else {
        // Previously swallowed — a failed cancel request showed nothing.
        await notifyApiError('mutualCancel', res, {
          body: data,
          title: "Couldn't update cancellation",
          fallbackMessage: 'Failed to update the cancellation request. Please try again.',
        });
      }
    } catch (e) {
      notifyError('mutualCancel', e, {
        title: "Couldn't update cancellation",
        fallbackMessage: 'Failed to update the cancellation request. Please try again.',
      });
    } finally {
      mutualCancelInFlightRef.current = false;
      setMutualCancelLoading(false);
    }
  };

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
          <p className="text-[12px] text-foreground/30 font-mono">Order with {userName}</p>
        </div>
        <span className="text-[12px] px-1.5 py-0.5 bg-red-500/15 text-red-400 rounded font-mono">
          DISPUTE
        </span>
      </div>

      {/* Mutual cancel bar */}
      {!isChatClosed && (
        <div className="px-3 py-2 bg-red-500/5 border-b border-red-500/10">
          {counterpartyMutualCancel && !myMutualCancel && (
            <p className="text-[11px] text-yellow-400 mb-1.5">Buyer has requested to cancel — agree below to refund funds.</p>
          )}
          {myMutualCancel && !counterpartyMutualCancel && (
            <p className="text-[11px] text-foreground/40 mb-1.5">Waiting for buyer to agree…</p>
          )}
          <div className="flex gap-2">
            {myMutualCancel ? (
              <button
                onClick={() => handleMutualCancel('withdraw')}
                disabled={mutualCancelLoading}
                className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-foreground/[0.06] text-foreground/50 border border-foreground/[0.08] disabled:opacity-50"
              >
                {mutualCancelLoading ? 'Processing…' : 'Continue Dispute'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleMutualCancel('request')}
                  disabled={mutualCancelLoading}
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-white text-black disabled:opacity-50"
                >
                  {mutualCancelLoading ? 'Processing…' : 'Cancel Dispute'}
                </button>
                <button
                  disabled
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-medium bg-foreground/[0.06] text-foreground/40 border border-foreground/[0.06] opacity-50"
                >
                  Continue Dispute
                </button>
              </>
            )}
          </div>
        </div>
      )}

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
