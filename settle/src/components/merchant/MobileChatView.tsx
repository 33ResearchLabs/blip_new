"use client";

import { MessageCircle } from "lucide-react";
import { OrderChatView } from "@/components/merchant/OrderChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";
import type { OrderConversation } from "@/hooks/useMerchantConversations";

export interface MobileChatViewProps {
  merchantId: string | null;
  orderConversations: OrderConversation[];
  totalUnread: number;
  isLoadingConversations: boolean;
  activeOrderChat: { orderId: string; userName: string; orderNumber: string; orderType?: 'buy' | 'sell' } | null;
  onOpenOrderChat: (orderId: string, userName: string, orderNumber: string, orderType?: 'buy' | 'sell') => void;
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
  return (
    <div className="h-full flex flex-col pb-16">
      {activeOrderChat && merchantId ? (
        <OrderChatView
          orderId={activeOrderChat.orderId}
          merchantId={merchantId}
          userName={activeOrderChat.userName}
          orderNumber={activeOrderChat.orderNumber}
          orderType={activeOrderChat.orderType}
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
        />
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm text-foreground/35">Loading chats...</p>
        </div>
      )}
    </div>
  );
}
