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
import { colors, sectionLabel, mono } from "@/lib/design/theme";
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
      <div className="pt-12 pb-3 px-4" style={{ background: colors.bg.secondary, borderBottom: `1px solid ${colors.border.subtle}` }}>
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("chats")} className="p-2 -ml-2">
            <ChevronLeft className="w-6 h-6" style={{ color: colors.text.primary }} />
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold" style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}>
            {activeOrder.merchant.name.charAt(0)}
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold" style={{ color: colors.text.primary }}>{activeOrder.merchant.name}</p>
            <div className="flex items-center gap-1.5">
              <ConnectionIndicator isConnected={activeOrder.merchant.isOnline ?? false} />
              <p className="text-[12px]" style={{ color: activeOrder.merchant.isOnline ? undefined : colors.text.tertiary }}>
                {activeOrder.merchant.isOnline && <span className="text-emerald-500">{formatLastSeen(activeOrder.merchant.isOnline, activeOrder.merchant.lastSeenAt)}</span>}
                {!activeOrder.merchant.isOnline && formatLastSeen(activeOrder.merchant.isOnline, activeOrder.merchant.lastSeenAt)}
              </p>
            </div>
          </div>
          <button
            onClick={() => setScreen("order")}
            className="p-2 rounded-full"
            style={{ background: colors.surface.card }}
          >
            <ArrowUpRight className="w-4 h-4" style={{ color: colors.text.tertiary }} />
          </button>
        </div>
        {/* Order summary bar */}
        <div className="mt-3 rounded-xl px-3 py-2 flex items-center justify-between" style={{ background: colors.surface.card }}>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              activeOrder.status === 'complete' ? 'bg-white/10' :
              activeOrder.status === 'disputed' ? 'bg-red-400' : 'bg-white/10'
            }`} />
            <span className="text-[12px]" style={{ color: colors.text.secondary }}>
              {activeOrder.type === "buy" ? "Buying" : "Selling"} {parseFloat(activeOrder.cryptoAmount).toFixed(2)} USDC
            </span>
          </div>
          <span className="text-[12px]" style={{ color: colors.text.tertiary }}>
            {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Messages Area */}
      <div
        ref={chatMessagesRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3"
        style={{ background: colors.bg.primary }}
      >
        {activeChat && activeChat.messages.length > 0 ? (
          activeChat.messages.map((msg) => {
            if (msg.messageType === 'dispute') {
              try {
                const data = JSON.parse(msg.text);
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="w-full max-w-[90%] rounded-2xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" />
                        <span className="text-[13px] font-semibold text-red-400">Dispute Opened</span>
                      </div>
                      <p className="text-[14px] mb-1" style={{ color: colors.text.primary }}>
                        <span style={{ color: colors.text.secondary }}>Reason:</span> {data.reason?.replace(/_/g, ' ')}
                      </p>
                      {data.description && (
                        <p className="text-[13px]" style={{ color: colors.text.secondary }}>{data.description}</p>
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
                  <div className="px-4 py-1.5 rounded-full" style={{ background: colors.surface.card }}>
                    <p className="text-[12px]" style={{ color: colors.text.secondary }}>{msg.text}</p>
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
                    <ReceiptCard data={receiptPayload as any} currentStatus={(orderNum ? receiptStatuses[orderNum] : undefined) || activeOrder?.dbStatus || activeOrder?.status} />
                    <p className="text-[10px] mt-1 text-center" style={{ color: colors.text.tertiary }}>
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
                  <div className="w-full max-w-[90%] rounded-2xl px-4 py-3" style={{ background: colors.accent.subtle, border: `1px solid ${colors.accent.border}` }}>
                    <p className="text-[13px] whitespace-pre-line leading-relaxed" style={{ color: colors.text.secondary }}>{msg.text}</p>
                    <p className="text-[10px] mt-1.5" style={{ color: colors.text.tertiary }}>
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
                    isMe ? "rounded-br-md" : "rounded-bl-md"
                  }`}
                  style={{
                    background: isMe ? colors.accent.primary : colors.surface.card,
                    color: isMe ? colors.white : colors.text.primary,
                  }}
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
                    <span className="text-[10px]" style={{ color: isMe ? 'rgba(255,255,255,0.5)' : colors.text.tertiary }}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMe && (
                      msg.status === 'sending' ? (
                        <Clock className="w-3 h-3 text-white/40" />
                      ) : msg.status === 'read' || msg.isRead ? (
                        <CheckCheck className="w-3.5 h-3.5 text-blue-400" />
                      ) : (
                        <CheckCheck className="w-3.5 h-3.5 text-white/50" />
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: colors.surface.card }}>
              <MessageCircle className="w-8 h-8" style={{ color: colors.text.quaternary }} />
            </div>
            <p className="text-[15px]" style={{ color: colors.text.tertiary }}>No messages yet</p>
            <p className="text-[13px] mt-1" style={{ color: colors.text.quaternary }}>Send a message to start the conversation</p>
          </div>
        )}
      </div>

      {/* Image preview bar */}
      {pendingImage && (
        <div className="px-4 py-2 flex items-center gap-3" style={{ background: colors.bg.secondary, borderTop: `1px solid ${colors.border.subtle}` }}>
          <div className="relative">
            <img
              src={pendingImage.previewUrl}
              alt="Preview"
              className="w-14 h-14 rounded-xl object-cover"
              style={{ border: `1px solid ${colors.border.medium}` }}
            />
            <button
              onClick={clearPendingImage}
              className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.6)' }}
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
          <span className="text-[13px] flex-1" style={{ color: colors.text.secondary }}>Ready to send</span>
        </div>
      )}

      {/* Message Input */}
      <div className="px-4 py-3 pb-8" style={{ background: colors.bg.secondary, borderTop: `1px solid ${colors.border.subtle}` }}>
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
            className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: colors.text.tertiary }} />
            ) : (
              <Paperclip className="w-5 h-5" style={{ color: colors.text.tertiary }} />
            )}
          </button>
          <input
            type="text"
            placeholder={pendingImage ? "Add a caption..." : "Type a message..."}
            className="flex-1 rounded-full px-5 py-3 text-[15px] outline-none"
            style={{ background: colors.surface.card, border: `1px solid ${colors.border.subtle}`, color: colors.text.primary }}
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
            className="w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50"
            style={{ background: chatMessage.trim() || pendingImage ? colors.accent.primary : colors.surface.card }}
          >
            {isUploading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <Send className="w-5 h-5" style={{ color: chatMessage.trim() || pendingImage ? colors.white : colors.text.quaternary }} />
            )}
          </motion.button>
        </div>
      </div>
    </>
  );
};
