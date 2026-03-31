"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  MessageCircle,
  ArrowUpRight,
  AlertTriangle,
  Paperclip,
  Loader2,
  X,
  Send,
  CheckCheck,
  Clock,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import { ImageMessage } from "@/components/chat/ImageMessage";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { usePusherOptional } from "@/context/PusherContext";
import { getOrderChannel } from "@/lib/pusher/channels";
import { ORDER_EVENTS } from "@/lib/pusher/events";
import { formatLastSeen } from "./helpers";
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
      receiptData?: Record<string, unknown> | null;
      imageUrl?: string | null;
      isRead?: boolean;
      status?: 'sending' | 'sent' | 'delivered' | 'read';
    }>;
  } | null;
  chatMessage: string;
  setChatMessage: (m: string) => void;
  sendChatMessage: (chatId: string, msg: string, imageUrl?: string) => void;
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
  const [isUploading, setIsUploading] = useState(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live order statuses for receipt cards — Pusher with initial fetch fallback
  const [receiptStatuses, setReceiptStatuses] = useState<Record<string, string>>({});
  const pusher = usePusherOptional();

  // Extract order numbers from receipt messages for status lookups + Pusher subscriptions
  const receiptOrderIds = useRef<string[]>([]);
  useEffect(() => {
    if (!activeChat?.messages) return;
    const orderNumbers: string[] = [];
    const orderIds: string[] = [];
    for (const msg of activeChat.messages) {
      // New structured format
      if (msg.messageType === 'receipt' && msg.receiptData) {
        const num = msg.receiptData.order_number as string | undefined;
        if (num) orderNumbers.push(num);
        if (activeChat.orderId) orderIds.push(activeChat.orderId);
        continue;
      }
      // Backward compat: old JSON-in-content format
      try {
        if (msg.text.startsWith('{')) {
          const parsed = JSON.parse(msg.text);
          if (parsed.type === 'order_receipt' && parsed.data?.order_number) {
            orderNumbers.push(parsed.data.order_number);
            if (activeChat.orderId) orderIds.push(activeChat.orderId);
          }
        }
      } catch { /* not JSON */ }
    }
    receiptOrderIds.current = [...new Set(orderIds)];
    if (orderNumbers.length === 0) return;
    const unique = [...new Set(orderNumbers)];
    // Initial fetch — single request to seed statuses
    fetchWithAuth(`/api/orders/status?order_numbers=${encodeURIComponent(unique.join(','))}`)
      .then(res => res.json())
      .then(data => { if (data.success && data.data) setReceiptStatuses(data.data); })
      .catch(() => {});
  }, [activeChat?.messages?.length]);

  // Subscribe to Pusher for real-time receipt status updates
  useEffect(() => {
    if (!pusher || receiptOrderIds.current.length === 0) return;

    const channels: ReturnType<typeof pusher.subscribe>[] = [];
    const handleStatusUpdate = (rawData: unknown) => {
      const data = rawData as { orderId: string; status: string };
      if (data.orderId && data.status) {
        setReceiptStatuses(prev => ({ ...prev, [data.orderId]: data.status }));
      }
    };

    for (const orderId of receiptOrderIds.current) {
      const channel = pusher.subscribe(getOrderChannel(orderId));
      if (channel) {
        channel.bind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdate);
        channel.bind(ORDER_EVENTS.CANCELLED, handleStatusUpdate);
        channels.push(channel);
      }
    }

    return () => {
      for (const channel of channels) {
        if (channel) {
          channel.unbind(ORDER_EVENTS.STATUS_UPDATED, handleStatusUpdate);
          channel.unbind(ORDER_EVENTS.CANCELLED, handleStatusUpdate);
        }
      }
      for (const orderId of receiptOrderIds.current) {
        pusher.unsubscribe(getOrderChannel(orderId));
      }
    };
  }, [pusher, activeChat?.messages?.length]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return;
    if (!file.type.startsWith('image/')) return;
    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearPendingImage = () => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  };

  const uploadAndSend = async () => {
    if (!pendingImage || !activeChat) return;
    setIsUploading(true);
    try {
      const sigRes = await fetchWithAuth('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: activeOrder.id }),
      });
      if (!sigRes.ok) { setIsUploading(false); return; }
      const sigData = await sigRes.json();
      if (!sigData.success) { setIsUploading(false); return; }
      const sig = sigData.data;

      const formData = new FormData();
      formData.append('file', pendingImage.file);
      formData.append('signature', sig.signature);
      formData.append('timestamp', sig.timestamp.toString());
      formData.append('api_key', sig.apiKey);
      formData.append('folder', sig.folder);

      const uploadRes = await fetch(
        `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`,
        { method: 'POST', body: formData }
      );
      if (uploadRes.ok) {
        const result = await uploadRes.json();
        const text = chatMessage.trim() || 'Photo';
        sendChatMessage(activeChat.id, text, result.secure_url);
        setChatMessage('');
      } else {
        console.error('[ChatViewScreen] Cloudinary upload failed:', uploadRes.status, await uploadRes.text().catch(() => ''));
      }
    } catch (err) {
      console.error('[ChatViewScreen] Image upload error:', err);
    } finally {
      setIsUploading(false);
      clearPendingImage();
    }
  };

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  const handleSend = () => {
    if (!activeChat) return;
    if (pendingImage) {
      uploadAndSend();
    } else if (chatMessage.trim()) {
      sendChatMessage(activeChat.id, chatMessage.trim());
      setChatMessage('');
    }
  };

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
              <ConnectionIndicator isConnected={activeOrder.merchant.isOnline ?? false} />
              <p className={`text-[12px] ${activeOrder.merchant.isOnline ? 'text-emerald-400/80' : 'text-neutral-500'}`}>
                {formatLastSeen(activeOrder.merchant.isOnline, activeOrder.merchant.lastSeenAt)}
              </p>
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

            // Receipt card messages — structured (new) or JSON fallback (old)
            {
              let receiptPayload: Record<string, unknown> | null = null;
              if (msg.messageType === 'receipt' && msg.receiptData) {
                // New structured format
                receiptPayload = msg.receiptData;
              } else {
                // Backward compat: old messages stored as JSON in content
                try {
                  if (msg.text.startsWith('{')) {
                    const parsed = JSON.parse(msg.text);
                    if (parsed.type === 'order_receipt' && parsed.data) {
                      receiptPayload = parsed.data;
                    }
                  }
                } catch { /* not JSON */ }
              }
              if (receiptPayload) {
                const orderNum = receiptPayload.order_number as string | undefined;
                return (
                  <div key={msg.id} className="max-w-[90%] mx-auto">
                    <ReceiptCard data={receiptPayload as any} currentStatus={(orderNum ? receiptStatuses[orderNum] : undefined) || activeOrder?.dbStatus || activeOrder?.status} theme="light" />
                    <p className="text-[10px] text-neutral-500 mt-1 text-center">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                );
              }
            }

            // System guidance messages (default status messages)
            if (msg.from === 'system' && msg.messageType !== 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="w-full max-w-[90%] bg-blue-500/5 border border-blue-500/10 rounded-2xl px-4 py-3">
                    <p className="text-[13px] text-neutral-300 whitespace-pre-line leading-relaxed">{msg.text}</p>
                    <p className="text-[10px] text-neutral-500 mt-1.5">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              );
            }

            const isMe = msg.from === "me";
            const isImageMsg = msg.messageType === 'image' && msg.imageUrl;

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
                  {isImageMsg && (
                    <ImageMessage
                      imageUrl={msg.imageUrl!}
                      caption={msg.text !== 'Photo' ? msg.text : undefined}
                      isOwn={isMe}
                    />
                  )}
                  {!isImageMsg && (
                    <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  )}
                  <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : ''}`}>
                    <span className={`text-[10px] ${isMe ? 'text-white/70' : 'text-neutral-500'}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMe && (
                      msg.status === 'sending' ? (
                        <Clock className="w-3 h-3 text-white/40" />
                      ) : msg.status === 'read' || msg.isRead ? (
                        <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                      ) : (
                        <CheckCheck className="w-3.5 h-3.5 text-white/40" />
                      )
                    )}
                  </div>
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

      {/* Image preview bar */}
      {pendingImage && (
        <div className="bg-neutral-900 border-t border-neutral-800 px-4 py-2 flex items-center gap-3">
          <div className="relative">
            <img
              src={pendingImage.previewUrl}
              alt="Preview"
              className="w-14 h-14 rounded-xl object-cover border border-white/10"
            />
            <button
              onClick={clearPendingImage}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-700 flex items-center justify-center"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
          <span className="text-[13px] text-neutral-400 flex-1">Ready to send</span>
        </div>
      )}

      {/* Message Input */}
      <div className="bg-neutral-900 border-t border-neutral-800 px-4 py-3 pb-8">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="w-12 h-12 rounded-full flex items-center justify-center bg-neutral-800 disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-neutral-400 animate-spin" />
            ) : (
              <Paperclip className="w-5 h-5 text-neutral-400" />
            )}
          </button>
          <input
            type="text"
            placeholder={pendingImage ? "Add a caption..." : "Type a message..."}
            className="flex-1 bg-neutral-800 rounded-full px-5 py-3 text-[15px] text-white placeholder:text-neutral-500 outline-none focus:ring-2 focus:ring-orange-500/30"
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <motion.button
            whileTap={{ scale: 0.95 }}
            onClick={handleSend}
            disabled={!chatMessage.trim() && !pendingImage}
            className={`w-12 h-12 rounded-full flex items-center justify-center ${
              chatMessage.trim() || pendingImage ? 'bg-white/10' : 'bg-neutral-800'
            } disabled:opacity-50`}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Send className={`w-5 h-5 ${chatMessage.trim() || pendingImage ? 'text-white' : 'text-neutral-500'}`} />
            )}
          </motion.button>
        </div>
      </div>
    </>
  );
};
