"use client";

import { MessageCircle } from "lucide-react";
import { DirectChatView } from "@/components/merchant/DirectChatView";
import { MerchantChatTabs } from "@/components/merchant/MerchantChatTabs";

export interface MobileChatViewProps {
  merchantId: string | null;
  directChat: {
    activeContactId: string | null;
    activeContactName: string;
    activeContactType: 'user' | 'merchant';
    messages: any[];
    isLoadingMessages: boolean;
    isContactTyping: boolean;
    conversations: any[];
    totalUnread: number;
    isLoadingConversations: boolean;
    sendMessage: (text: string, imageUrl?: string) => void;
    sendTyping: (orderId?: string) => void;
    closeChat: () => void;
    openChat: (targetId: string, targetType: 'user' | 'merchant', name: string) => void;
  };
  orderStatus?: string;
  playSound: (sound: 'message' | 'send' | 'trade_start' | 'trade_complete' | 'notification' | 'error' | 'click' | 'new_order' | 'order_complete') => void;
}

export function MobileChatView({
  merchantId,
  directChat,
  orderStatus,
  playSound,
}: MobileChatViewProps) {
  return (
    <div className="h-full flex flex-col pb-16">
      {directChat.activeContactId ? (
        <DirectChatView
          contactName={directChat.activeContactName}
          contactType={directChat.activeContactType}
          contactId={directChat.activeContactId}
          isTyping={directChat.isContactTyping}
          onTyping={directChat.sendTyping}
          messages={directChat.messages}
          isLoading={directChat.isLoadingMessages}
          onSendMessage={(text, imageUrl) => {
            directChat.sendMessage(text, imageUrl);
            playSound('send');
          }}
          onBack={() => directChat.closeChat()}
          orderStatus={orderStatus}
        />
      ) : merchantId ? (
        <MerchantChatTabs
          merchantId={merchantId}
          conversations={directChat.conversations}
          totalUnread={directChat.totalUnread}
          isLoading={directChat.isLoadingConversations}
          onOpenChat={(targetId, targetType, username) => directChat.openChat(targetId, targetType, username)}
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
