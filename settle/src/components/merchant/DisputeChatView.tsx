'use client';

import { useEffect } from 'react';
import { ChevronLeft, Shield } from 'lucide-react';
import { ChatRoom } from '@/components/chat/ChatRoom';
import { useRealtimeChat } from '@/hooks/useRealtimeChat';

interface DisputeChatViewProps {
  orderId: string;
  merchantId: string;
  userName: string;
  onBack: () => void;
  onSendSound?: () => void;
}

export function DisputeChatView({ orderId, merchantId, userName, onBack, onSendSound }: DisputeChatViewProps) {
  const { chatWindows, openChat, sendMessage, markAsRead, sendTypingIndicator } = useRealtimeChat({
    maxWindows: 1,
    actorType: 'merchant',
    actorId: merchantId,
  });

  // Open the dispute chat on mount
  useEffect(() => {
    openChat(`Dispute ${userName}`, '⚖️', orderId);
  }, [orderId, userName, openChat]);

  const chatWindow = chatWindows.find(w => w.orderId === orderId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04] flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/40 hover:text-white/70"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="w-7 h-7 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <Shield className="w-3.5 h-3.5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-white/80 truncate">Dispute Chat</p>
          <p className="text-[10px] text-white/30 font-mono">Order with {userName}</p>
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
