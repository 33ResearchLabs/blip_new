"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { OrderChatView } from "@/components/merchant/OrderChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import type { OrderConversation } from "@/hooks/useMerchantConversations";

export interface MobileChatViewProps {
  merchantId: string | null;
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoadingConversations: boolean;
  activeOrderChat: { orderId: string; userName: string; orderNumber: string; orderType?: 'buy' | 'sell'; userAvatarUrl?: string | null } | null;
  onOpenOrderChat: (orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell', userAvatarUrl?: string | null) => void;
  onCloseOrderChat: () => void;
  onClearUnread: (orderId: string) => void;
  onClearAllUnread?: () => void;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
}

export function MobileChatView({
  merchantId,
  orderConversations,
  totalUnread,
  isLoadingConversations,
  activeOrderChat,
  onOpenOrderChat,
  onCloseOrderChat,
  onClearUnread,
  onClearAllUnread,
  playSound,
}: MobileChatViewProps) {
  // The fallback below renders while `merchantId` is still resolving. For a
  // logged-in merchant that's near-instant, but if identity never resolves the
  // "Loading chats…" copy would sit forever and read as a stuck loader. After a
  // short grace period, switch to an honest "still connecting" hint.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (merchantId) {
      setSlowLoad(false);
      return;
    }
    const t = setTimeout(() => setSlowLoad(true), 8000);
    return () => clearTimeout(t);
  }, [merchantId]);

  return (
    // In chat mode the parent <main> uses overflow-hidden with NO bottom
    // padding, so this div is the sole clearance for the fixed bottom nav
    // (~58px tall). Use a safe-area-aware value instead of a flat pb-24:
    // 4rem (64px) on non-notched devices → small gap above the nav, plus
    // the home-indicator inset on notched devices → same gap everywhere.
    // Skipped inside an active order chat — the bottom nav is hidden there.
    <div
      className="h-full flex flex-col"
      style={
        !activeOrderChat
          ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 4rem)" }
          : undefined
      }
    >
      {activeOrderChat && merchantId ? (
        <OrderChatView
          orderId={activeOrderChat.orderId}
          merchantId={merchantId}
          userName={activeOrderChat.userName}
          orderNumber={activeOrderChat.orderNumber}
          orderType={activeOrderChat.orderType}
          userAvatarUrl={activeOrderChat.userAvatarUrl}
          onBack={onCloseOrderChat}
          onSendSound={() => playSound('send')}
        />
      ) : merchantId ? (
        <MerchantChatTabs
          merchantId={merchantId}
          orderConversations={orderConversations}
          totalUnread={totalUnread}
          isLoading={isLoadingConversations}
          onOpenOrderChat={onOpenOrderChat}
          onClearUnread={onClearUnread}
          onClearAllUnread={onClearAllUnread}
          hideHeading
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm text-foreground/35">
            {slowLoad ? "Still connecting… pull down to refresh." : "Loading chats..."}
          </p>
        </div>
      )}
    </div>
  );
}
