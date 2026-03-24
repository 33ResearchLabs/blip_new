"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  MessageCircle,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import type { Screen, Order } from "./types";
import type { RefObject } from "react";

export interface ChatViewScreenProps {
  setScreen: (s: Screen) => void;
  activeOrder: Order;
  activeChat: {
    id: string;
    orderId?: string;
    messages: Array<{
      id: string;
      text: string;
      from: string;
      timestamp: Date;
      senderName?: string;
      messageType?: string;
    }>;
  } | null;
  chatMessage: string;
  setChatMessage: (m: string) => void;
  sendChatMessage: (orderId: string, msg: string) => void;
  chatMessagesRef: RefObject<HTMLDivElement | null>;
}

export const ChatViewScreen = ({
  setScreen,
  activeOrder,
  activeChat,
  chatMessage,
  setChatMessage,
  sendChatMessage,
  chatMessagesRef,
}: ChatViewScreenProps) => {
  return (
    <>
      {/* Chat Header */}
      <div className="pt-12 pb-3 px-4" style={{ background: '#ffffff', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("chats")}
            className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1"
            style={{ background: '#f4f4f4', border: '1px solid rgba(0,0,0,0.06)' }}>
            <ChevronLeft className="w-5 h-5" style={{ color: 'rgba(0,0,0,0.6)' }} />
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold"
            style={{ background: '#000', color: '#fff' }}>
            {activeOrder.merchant.name.charAt(0)}
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold" style={{ color: '#000' }}>{activeOrder.merchant.name}</p>
            <div className="flex items-center gap-1.5">
              <ConnectionIndicator isConnected={true} />
              <p className="text-[12px] text-orange-500">Online</p>
            </div>
          </div>
          <button
            onClick={() => setScreen("order")}
            className="p-2 rounded-full"
            style={{ background: '#f4f4f4' }}
          >
            <ArrowUpRight className="w-4 h-4" style={{ color: 'rgba(0,0,0,0.5)' }} />
          </button>
        </div>
        {/* Order summary bar */}
        <div className="mt-3 rounded-xl px-3 py-2 flex items-center justify-between"
          style={{ background: '#f4f4f4' }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{
              background: activeOrder.status === 'disputed' ? '#dc2626' : 'rgba(0,0,0,0.2)'
            }} />
            <span className="text-[12px]" style={{ color: 'rgba(0,0,0,0.5)' }}>
              {activeOrder.type === "buy" ? "Buying" : "Selling"} {activeOrder.cryptoAmount} USDC
            </span>
          </div>
          <span className="text-[12px]" style={{ color: 'rgba(0,0,0,0.4)' }}>
            {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={chatMessagesRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        style={{ background: '#f8f8f8' }}
      >
        {activeChat && activeChat.messages.length > 0 ? (
          activeChat.messages.map((msg) => {
            if (msg.messageType === 'dispute') {
              try {
                const data = JSON.parse(msg.text);
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="w-full max-w-[90%] bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        <span className="text-[13px] font-semibold text-red-600">Dispute Opened</span>
                      </div>
                      <p className="text-[14px] mb-1" style={{ color: '#000' }}>
                        <span style={{ color: 'rgba(0,0,0,0.4)' }}>Reason:</span> {data.reason?.replace(/_/g, ' ')}
                      </p>
                      {data.description && (
                        <p className="text-[13px]" style={{ color: 'rgba(0,0,0,0.5)' }}>{data.description}</p>
                      )}
                    </div>
                  </div>
                );
              } catch {
                // Fall back to regular message
              }
            }

            if (msg.messageType === 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="px-4 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)' }}>
                    <p className="text-[12px]" style={{ color: 'rgba(0,0,0,0.45)' }}>{msg.text}</p>
                  </div>
                </div>
              );
            }

            // Detect receipt card messages
            try {
              if (msg.text.startsWith('{')) {
                const parsed = JSON.parse(msg.text);
                if (parsed.type === 'order_receipt' && parsed.data) {
                  return (
                    <div key={msg.id} className="max-w-[90%] mx-auto">
                      <ReceiptCard data={parsed.data} />
                      <p className="text-[10px] mt-1 text-center" style={{ color: 'rgba(0,0,0,0.4)' }}>
                        {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  );
                }
              }
            } catch { /* not JSON */ }

            const isMe = msg.from === "me";
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${isMe ? "rounded-br-md" : "rounded-bl-md"}`}
                  style={isMe
                    ? { background: '#000', color: '#fff' }
                    : { background: '#ffffff', color: '#000', border: '1px solid rgba(0,0,0,0.06)' }
                  }
                >
                  <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  <p className="text-[10px] mt-1" style={{ color: isMe ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)' }}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}>
              <MessageCircle className="w-8 h-8" style={{ color: 'rgba(0,0,0,0.2)' }} />
            </div>
            <p className="text-[15px]" style={{ color: 'rgba(0,0,0,0.45)' }}>No messages yet</p>
            <p className="text-[13px] mt-1" style={{ color: 'rgba(0,0,0,0.3)' }}>Send a message to start the conversation</p>
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="px-4 py-3 pb-8" style={{ background: '#ffffff', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Type a message..."
            className="flex-1 rounded-full px-5 py-3 text-[15px] outline-none"
            style={{ background: '#f4f4f4', color: '#000' }}
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chatMessage.trim()) {
                sendChatMessage(activeOrder.id, chatMessage.trim());
                setChatMessage('');
              }
            }}
          />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={() => {
              if (chatMessage.trim()) {
                sendChatMessage(activeOrder.id, chatMessage.trim());
                setChatMessage('');
              }
            }}
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{ background: chatMessage.trim() ? '#000' : '#f4f4f4' }}
          >
            <ArrowUpRight className="w-5 h-5" style={{ color: chatMessage.trim() ? '#fff' : 'rgba(0,0,0,0.3)' }} />
          </motion.button>
        </div>
      </div>
    </>
  );
};
