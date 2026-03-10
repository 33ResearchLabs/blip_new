"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  MessageCircle,
  ArrowUpRight,
  AlertTriangle,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
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
      <div className="bg-neutral-900 border-b border-neutral-800 pt-12 pb-3 px-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("chats")} className="p-2 -ml-2">
            <ChevronLeft className="w-6 h-6 text-white" />
          </button>
          <div className="w-10 h-10 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-white font-semibold">
            {activeOrder.merchant.name.charAt(0)}
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-white">{activeOrder.merchant.name}</p>
            <div className="flex items-center gap-1.5">
              <ConnectionIndicator isConnected={true} />
              <p className="text-[12px] text-orange-400/80">Online</p>
            </div>
          </div>
          <button
            onClick={() => setScreen("order")}
            className="p-2 bg-neutral-800 rounded-full"
          >
            <ArrowUpRight className="w-4 h-4 text-neutral-400" />
          </button>
        </div>
        {/* Order summary bar */}
        <div className="mt-3 bg-neutral-800/50 rounded-xl px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              activeOrder.status === 'complete' ? 'bg-white/10' :
              activeOrder.status === 'disputed' ? 'bg-red-400' : 'bg-white/10'
            }`} />
            <span className="text-[12px] text-neutral-400">
              {activeOrder.type === "buy" ? "Buying" : "Selling"} {activeOrder.cryptoAmount} USDC
            </span>
          </div>
          <span className="text-[12px] text-neutral-500">
            {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={chatMessagesRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        style={{ background: 'linear-gradient(to bottom, #0a0a0a, #111)' }}
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
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-[13px] font-semibold text-red-400">Dispute Opened</span>
                      </div>
                      <p className="text-[14px] text-white mb-1">
                        <span className="text-neutral-400">Reason:</span> {data.reason?.replace(/_/g, ' ')}
                      </p>
                      {data.description && (
                        <p className="text-[13px] text-neutral-400">{data.description}</p>
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
                  <div className="bg-neutral-800/50 px-4 py-1.5 rounded-full">
                    <p className="text-[12px] text-neutral-400">{msg.text}</p>
                  </div>
                </div>
              );
            }

            const isMe = msg.from === "me";
            return (
              <div
                key={msg.id}
                className={`flex ${isMe ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl ${
                    isMe
                      ? "bg-white/10 text-white rounded-br-md"
                      : "bg-neutral-800 text-white rounded-bl-md"
                  }`}
                >
                  <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  <p className={`text-[10px] mt-1 ${isMe ? 'text-white/70' : 'text-neutral-500'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full bg-neutral-800 flex items-center justify-center mb-4">
              <MessageCircle className="w-8 h-8 text-neutral-600" />
            </div>
            <p className="text-[15px] text-neutral-500">No messages yet</p>
            <p className="text-[13px] text-neutral-600 mt-1">Send a message to start the conversation</p>
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="bg-neutral-900 border-t border-neutral-800 px-4 py-3 pb-8">
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Type a message..."
            className="flex-1 bg-neutral-800 rounded-full px-5 py-3 text-[15px] text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-orange-500/30"
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
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              chatMessage.trim() ? 'bg-white/10' : 'bg-neutral-800'
            }`}
          >
            <ArrowUpRight className={`w-5 h-5 ${chatMessage.trim() ? 'text-white' : 'text-neutral-500'}`} />
          </motion.button>
        </div>
      </div>
    </>
  );
};
