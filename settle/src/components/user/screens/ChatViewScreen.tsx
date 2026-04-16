"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStatus } from "@/hooks/useChatStatus";
import { ImagePreviewModal } from "@/components/chat/ImagePreviewModal";
import { ImageMessageBubble, type ImageUploadStatus } from "@/components/chat/ImageMessageBubble";
import { compressImage } from "@/lib/utils/compressImage";
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
  Check,
  CheckCheck,
  Clock,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
// ImageMessage replaced by ImageMessageBubble (WhatsApp-style with progress/retry)
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
  // Infinite-scroll pagination
  onLoadOlder?: () => Promise<boolean | void>;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  // Typing indicators
  onTyping?: (chatId: string, isTyping: boolean) => void;
  isCounterpartyTyping?: boolean;
}

export const ChatViewScreen = ({
  setScreen,
  activeOrder,
  activeChat,
  chatMessage,
  setChatMessage,
  sendChatMessage,
  chatMessagesRef,
  onLoadOlder,
  hasOlderMessages = true,
  isLoadingOlder = false,
  onTyping,
  isCounterpartyTyping = false,
}: ChatViewScreenProps) => {
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadOlderTriggeredRef = useRef(false);

  // ── Optimistic image uploads — WhatsApp-style ──────────────────────
  // Track in-progress uploads so the message bubble can show progress/retry.
  // Each upload gets a tempId used as the message ID until the backend confirms.
  interface PendingUpload {
    tempId: string;
    localUrl: string;
    caption: string;
    file: File;
    status: ImageUploadStatus;
    progress: number;
    abortController: AbortController | null;
    createdAt: number; // Date.now() — for stable sort order on retry
  }
  const [pendingUploads, setPendingUploads] = useState<Map<string, PendingUpload>>(new Map());
  const pendingUploadsRef = useRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;

  // Backend-controlled chat availability — the ONLY source of truth
  const { chatEnabled, chatReason, chatState } = useChatStatus(activeOrder.id);

  // ── Typing indicator debounce (auto-stop after 3s) ──
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);
  const lastTypingStartRef = useRef(0); // Throttle: min 2s between start events
  const activeChatIdRef = useRef(activeChat?.id);
  activeChatIdRef.current = activeChat?.id;

  // Force-stop typing — used by send, unmount, and chat switch.
  // Clears both the ref flag and the debounce timer.
  const stopTyping = useCallback(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current && activeChatIdRef.current && onTyping) {
      isTypingRef.current = false;
      onTyping(activeChatIdRef.current, false);
    }
  }, [onTyping]);

  // Reset typing state when chat/order changes (prevents stuck indicator
  // from the previous chat leaking into the new one).
  useEffect(() => {
    return () => { stopTyping(); };
  }, [activeOrder.id, stopTyping]);

  // Also clean up on unmount
  useEffect(() => {
    return () => { stopTyping(); };
  }, [stopTyping]);

  const handleTypingChange = useCallback((text: string) => {
    setChatMessage(text);
    if (!activeChat || !onTyping || !chatEnabled) return;

    if (text.length > 0 && !isTypingRef.current) {
      // Throttle: don't fire typing:start more than once per 2s.
      // Prevents rapid start→stop→start cycles from flooding the network.
      const now = Date.now();
      if (now - lastTypingStartRef.current < 2000) return;
      lastTypingStartRef.current = now;
      isTypingRef.current = true;
      onTyping(activeChat.id, true);
    }
    // Reset the auto-stop timer on every keystroke
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current && activeChat) {
        isTypingRef.current = false;
        onTyping(activeChat.id, false);
      }
    }, 3000);

    // If text is cleared, stop typing immediately
    if (text.length === 0 && isTypingRef.current) {
      isTypingRef.current = false;
      onTyping(activeChat.id, false);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    }
  }, [activeChat, onTyping, chatEnabled, setChatMessage]);

  // Detect scroll near top → trigger loading older messages
  const handleChatScroll = useCallback(() => {
    const el = chatMessagesRef.current;
    if (
      el &&
      el.scrollTop < 100 &&
      onLoadOlder &&
      hasOlderMessages &&
      !isLoadingOlder &&
      !loadOlderTriggeredRef.current
    ) {
      loadOlderTriggeredRef.current = true;
      const prevScrollHeight = el.scrollHeight;
      onLoadOlder().finally(() => {
        requestAnimationFrame(() => {
          const newScrollHeight = el.scrollHeight;
          el.scrollTop += newScrollHeight - prevScrollHeight;
          loadOlderTriggeredRef.current = false;
        });
      });
    }
  }, [chatMessagesRef, onLoadOlder, hasOlderMessages, isLoadingOlder]);

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
      if (msg.messageType === 'receipt' && msg.receiptData) {
        const num = msg.receiptData.order_number as string | undefined;
        if (num) orderNumbers.push(num);
        if (activeChat.orderId) orderIds.push(activeChat.orderId);
        continue;
      }
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
    fetchWithAuth(`/api/orders/status?order_numbers=${encodeURIComponent(unique.join(','))}`)
      .then(res => res.json())
      .then(data => { if (data.success && data.data) setReceiptStatuses(data.data); })
      .catch(() => {});
  }, [activeChat?.messages?.length]);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFile = e.target.files?.[0];
    if (!rawFile) return;
    if (rawFile.size > 10 * 1024 * 1024) return; // 10MB hard limit
    if (!rawFile.type.startsWith('image/')) return;
    if (fileInputRef.current) fileInputRef.current.value = '';

    // Compress before preview — reduces upload time and data usage.
    // compressImage is a no-op for files already under 1MB.
    const file = await compressImage(rawFile, { maxDimension: 1600, quality: 0.8 });
    const previewUrl = URL.createObjectURL(file);
    setPendingImage({ file, previewUrl });
  };

  const clearPendingImage = () => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  };

  // Clean up preview URL on unmount
  useEffect(() => {
    return () => {
      if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  // ── Abort ALL in-flight uploads on unmount (prevent ghost uploads) ──
  // Without this, navigating away lets uploads complete silently,
  // wasting bandwidth and potentially sending unexpected messages.
  useEffect(() => {
    return () => {
      for (const entry of pendingUploadsRef.current.values()) {
        if (entry.abortController) entry.abortController.abort();
      }
    };
  }, []);

  /**
   * WhatsApp-style image send:
   *  1. Close preview modal
   *  2. Insert optimistic message (localUrl, status=uploading)
   *  3. Upload to Cloudinary in background
   *  4. On success: send real message via chat, remove pending
   *  5. On failure: mark as failed, show retry button
   */
  const startImageUpload = useCallback(async (
    file: File,
    localUrl: string,
    caption: string,
    tempId: string,
  ) => {
    if (!activeChat) return;

    const abortController = new AbortController();

    // 30s upload timeout — prevents stuck uploads on slow/dead connections.
    // The AbortController cancels both the signature fetch and the XHR upload.
    const uploadTimeout = setTimeout(() => abortController.abort(), 30_000);

    // Insert into pending uploads (triggers optimistic UI render)
    setPendingUploads(prev => {
      const next = new Map(prev);
      const existing = prev.get(tempId);
      next.set(tempId, {
        tempId, localUrl, caption, file,
        status: 'uploading', progress: 0,
        abortController,
        createdAt: existing?.createdAt ?? Date.now(), // Preserve original time on retry
      });
      return next;
    });

    // Auto-scroll to bottom — but only if the user is already near the bottom.
    // If they've scrolled up to read history, don't yank them away.
    requestAnimationFrame(() => {
      const el = chatMessagesRef.current;
      if (!el) return;
      const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
      if (isNearBottom) el.scrollTop = el.scrollHeight;
    });

    try {
      // Step 1: Get Cloudinary signature
      const sigRes = await fetchWithAuth('/api/upload/signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: activeOrder.id }),
        signal: abortController.signal,
      });
      if (!sigRes.ok) throw new Error('Signature request failed');
      const sigData = await sigRes.json();
      if (!sigData.success) throw new Error('Invalid signature');
      const sig = sigData.data;

      // Strict guard: prevent silent failures from missing credentials
      if (!sig.signature || !sig.timestamp || !sig.apiKey || !sig.cloudName || !sig.folder) {
        throw new Error('Incomplete upload credentials from server');
      }

      // Update progress: signature obtained
      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 20 });
        return next;
      });

      // Step 2: Upload to Cloudinary
      // ONLY send params that were signed on the backend. Sending unsigned
      // params (allowed_formats, max_bytes) causes Cloudinary to compute a
      // different string-to-sign → 401 "Invalid Signature".
      // File type/size is enforced client-side (handleFileSelect) + Cloudinary
      // upload preset (configured in dashboard).
      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', sig.signature);
      formData.append('timestamp', sig.timestamp.toString());
      formData.append('api_key', sig.apiKey);
      formData.append('folder', sig.folder);

      // Cloudinary upload with XHR for progress tracking
      const imageUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = 20 + Math.round((e.loaded / e.total) * 70); // 20-90%
            setPendingUploads(prev => {
              const next = new Map(prev);
              const entry = next.get(tempId);
              if (entry) next.set(tempId, { ...entry, progress: pct });
              return next;
            });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            const result = JSON.parse(xhr.responseText);
            resolve(result.secure_url);
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));

        // Wire abort
        abortController.signal.addEventListener('abort', () => xhr.abort());
        if (abortController.signal.aborted) { xhr.abort(); return; }

        xhr.send(formData);
      });

      // Step 3: Send the real chat message with the CDN URL
      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 95 });
        return next;
      });

      sendChatMessage(activeChat.id, caption || 'Photo', imageUrl);

      // Step 4: Remove from pending (the real message will appear via Pusher)
      clearTimeout(uploadTimeout);
      setPendingUploads(prev => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });

    } catch (err: any) {
      clearTimeout(uploadTimeout);
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        // Cancelled by user or timed out
        setPendingUploads(prev => {
          const next = new Map(prev);
          next.delete(tempId);
          return next;
        });
      } else {
        // Failed — show retry
        console.error('[ChatViewScreen] Image upload error:', err);
        setPendingUploads(prev => {
          const next = new Map(prev);
          const entry = next.get(tempId);
          if (entry) next.set(tempId, { ...entry, status: 'failed', progress: 0, abortController: null });
          return next;
        });
      }
    }
  }, [activeChat, activeOrder?.id, sendChatMessage]);

  /** Called from ImagePreviewModal when user clicks Send */
  const handleImageSend = useCallback((caption: string) => {
    if (!pendingImage || !chatEnabled) return;
    const tempId = `temp-img-${Date.now()}`;
    const { file, previewUrl } = pendingImage;
    setPendingImage(null); // Close preview modal
    startImageUpload(file, previewUrl, caption, tempId);
  }, [pendingImage, chatEnabled, startImageUpload]);

  /** Cancel an in-progress upload */
  const cancelUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (entry?.abortController) entry.abortController.abort();
    setPendingUploads(prev => {
      const next = new Map(prev);
      next.delete(tempId);
      return next;
    });
  }, []);

  /** Retry a failed upload */
  const retryUpload = useCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (!entry) return;
    startImageUpload(entry.file, entry.localUrl, entry.caption, tempId);
  }, [startImageUpload]);

  const handleSend = () => {
    if (!activeChat) return;
    if (pendingImage) {
      return;
    }
    if (chatMessage.trim()) {
      stopTyping(); // Clear typing indicator on send
      sendChatMessage(activeChat.id, chatMessage.trim());
      setChatMessage('');
    }
  };

  return (
    <>
      {/* Chat Header — pinned to top of the panel */}
      <div className="shrink-0 pt-12 pb-3 px-4 bg-surface-raised border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("chats")} className="p-2 -ml-2">
            <ChevronLeft className="w-6 h-6 text-text-primary" />
          </button>
          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-[16px] bg-accent/20 border border-accent/30 text-accent overflow-hidden shrink-0">
            {activeOrder.merchant.avatarUrl ? (
              <img
                src={activeOrder.merchant.avatarUrl}
                alt={activeOrder.merchant.name}
                className="w-full h-full object-cover"
              />
            ) : (
              (activeOrder.merchant.name || 'M').charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold text-text-primary">{activeOrder.merchant.name}</p>
            <div className="flex items-center gap-1.5">
              {isCounterpartyTyping && chatEnabled ? (
                // Typing replaces online/lastSeen — exactly like WhatsApp
                <p className="text-[12px] text-success font-medium">typing...</p>
              ) : (
                <>
                  <ConnectionIndicator isConnected={activeOrder.merchant.isOnline ?? false} />
                  <p className={`text-[12px] ${activeOrder.merchant.isOnline ? '' : 'text-text-tertiary'}`}>
                    {activeOrder.merchant.isOnline && <span className="text-success">{formatLastSeen(activeOrder.merchant.isOnline, activeOrder.merchant.lastSeenAt)}</span>}
                    {!activeOrder.merchant.isOnline && formatLastSeen(activeOrder.merchant.isOnline, activeOrder.merchant.lastSeenAt)}
                  </p>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => setScreen("order")}
            className="p-2 rounded-full bg-surface-card"
          >
            <ArrowUpRight className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>
        {/* Order summary bar */}
        <div className="mt-3 rounded-xl px-3 py-2 flex items-center justify-between bg-surface-card">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              activeOrder.status === 'complete' ? 'bg-surface-active' :
              activeOrder.status === 'disputed' ? 'bg-error' : 'bg-surface-active'
            }`} />
            <span className="text-[12px] text-text-secondary">
              {activeOrder.type === "buy" ? "Buying" : "Selling"} {parseFloat(activeOrder.cryptoAmount).toFixed(2)} USDT
            </span>
          </div>
          <span className="text-[12px] text-text-tertiary">
            {'\u062F.\u0625'} {parseFloat(activeOrder.fiatAmount).toLocaleString()}
          </span>
        </div>
      </div>

      {/* Messages Area — only this scrolls; min-h-0 lets flex-1 actually
          constrain inside the flex column instead of growing past it. */}
      <div
        ref={chatMessagesRef}
        onScroll={handleChatScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3 bg-surface-base"
      >
        {/* Older-messages loading spinner */}
        {isLoadingOlder && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="w-4 h-4 text-text-tertiary animate-spin" />
            <span className="ml-2 text-[10px] text-text-tertiary">Loading older messages…</span>
          </div>
        )}
        {!hasOlderMessages && activeChat && activeChat.messages.length > 0 && (
          <div className="text-center py-2">
            <span className="text-[10px] text-text-quaternary">Beginning of conversation</span>
          </div>
        )}

        {activeChat && activeChat.messages.length > 0 ? (
          activeChat.messages.map((msg) => {
            if (msg.messageType === 'dispute') {
              try {
                const data = JSON.parse(msg.text);
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="w-full max-w-[90%] rounded-2xl p-4 bg-error-dim border border-error-border">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle className="w-4 h-4 text-error" />
                        <span className="text-[13px] font-semibold text-error">Dispute Opened</span>
                      </div>
                      <p className="text-[14px] mb-1 text-text-primary">
                        <span className="text-text-secondary">Reason:</span> {data.reason?.replace(/_/g, ' ')}
                      </p>
                      {data.description && (
                        <p className="text-[13px] text-text-secondary">{data.description}</p>
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
                  <div className="px-4 py-1.5 rounded-full bg-surface-card">
                    <p className="text-[12px] text-text-secondary">{msg.text}</p>
                  </div>
                </div>
              );
            }

            {
              let receiptPayload: Record<string, unknown> | null = null;
              if (msg.messageType === 'receipt' && msg.receiptData) {
                receiptPayload = msg.receiptData;
              } else {
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
                    <p className="text-[10px] mt-1 text-center text-text-tertiary">
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                );
              }
            }

            if (msg.from === 'system' && msg.messageType !== 'system') {
              return (
                <div key={msg.id} className="flex justify-center">
                  <div className="w-full max-w-[90%] rounded-2xl px-4 py-3 bg-surface-hover border border-border-strong">
                    <p className="text-[13px] whitespace-pre-line leading-relaxed text-text-secondary">{msg.text}</p>
                    <p className="text-[10px] mt-1.5 text-text-tertiary">
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
                    isMe ? "rounded-br-md bg-accent text-accent-text" : "rounded-bl-md bg-surface-card text-text-primary"
                  }`}
                >
                  {isImageMsg ? (
                    <ImageMessageBubble
                      imageUrl={msg.imageUrl!}
                      caption={msg.text !== 'Photo' ? msg.text : undefined}
                      uploadStatus="sent"
                      isOwn={isMe}
                    />
                  ) : (
                    <p className="text-[15px] leading-relaxed">{msg.text}</p>
                  )}
                  <div className={`flex items-center gap-1 mt-1 ${isMe ? 'justify-end' : ''}`}>
                    <span className={`text-[10px] ${isMe ? 'text-accent-text/60' : 'text-text-tertiary'}`}>
                      {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMe && (
                      msg.status === 'sending' ? (
                        <Clock className="w-3 h-3 text-text-tertiary" />
                      ) : msg.status === 'read' || msg.isRead ? (
                        // ✓✓ blue — counterparty has READ the message
                        <CheckCheck className="w-3.5 h-3.5 text-info" />
                      ) : msg.status === 'delivered' ? (
                        // ✓✓ grey — message DELIVERED to counterparty's device
                        <CheckCheck className="w-3.5 h-3.5 text-accent-text/60" />
                      ) : (
                        // ✓ single — message SENT to server, not yet delivered
                        <Check className="w-3 h-3 text-accent-text/60" />
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4 bg-surface-card">
              <MessageCircle className="w-8 h-8 text-text-quaternary" />
            </div>
            <p className="text-[15px] text-text-tertiary">No messages yet</p>
            <p className="text-[13px] mt-1 text-text-quaternary">Send a message to start the conversation</p>
          </div>
        )}

        {/* Pending image upload bubbles — INSIDE the scroll container so they're
            visible and auto-scroll works. Previously these were OUTSIDE the scroll
            div, making them invisible (the user couldn't see the optimistic message). */}
        {pendingUploads.size > 0 && (
          Array.from(pendingUploads.values())
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((upload) => (
            <div key={upload.tempId} className="flex justify-end">
              <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-accent text-accent-text">
                <ImageMessageBubble
                  imageUrl={upload.localUrl}
                  caption={upload.caption || undefined}
                  uploadStatus={upload.status}
                  uploadProgress={upload.progress}
                  onCancel={() => cancelUpload(upload.tempId)}
                  onRetry={() => retryUpload(upload.tempId)}
                  isOwn
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Full-screen image preview modal (WhatsApp-style) */}
      {pendingImage && (
        <ImagePreviewModal
          previewUrl={pendingImage.previewUrl}
          onSend={handleImageSend}
          onClose={clearPendingImage}
          isSending={isUploading}
        />
      )}

      {/* Message Input / Chat Status Banner — pinned to bottom */}
      {chatEnabled ? (
        <div className="shrink-0 px-4 py-3 pb-8 bg-surface-raised border-t border-border-subtle">
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
                <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
              ) : (
                <Paperclip className="w-5 h-5 text-text-tertiary" />
              )}
            </button>
            <input
              type="text"
              placeholder={pendingImage ? "Add a caption..." : "Type a message..."}
              className="flex-1 rounded-full px-5 py-3 text-[15px] outline-none bg-surface-card border border-border-subtle text-text-primary"
              value={chatMessage}
              onChange={(e) => handleTypingChange(e.target.value)}
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
              className={`w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50 ${
                chatMessage.trim() || pendingImage ? 'bg-accent' : 'bg-surface-card'
              }`}
            >
              {isUploading ? (
                <Loader2 className="w-5 h-5 text-accent-text animate-spin" />
              ) : (
                <Send className={`w-5 h-5 ${chatMessage.trim() || pendingImage ? 'text-accent-text' : 'text-text-quaternary'}`} />
              )}
            </motion.button>
          </div>
        </div>
      ) : (
        <div className="shrink-0 px-4 py-4 pb-8 bg-surface-raised border-t border-border-subtle">
          <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-full bg-surface-card border border-border-subtle">
            {chatState === 'waiting' ? (
              <>
                <Clock className="w-4 h-4 text-text-tertiary animate-pulse" />
                <span className="text-[13px] font-medium text-text-tertiary">
                  {chatReason || 'Waiting for counterparty to join'}
                </span>
              </>
            ) : (
              <>
                <MessageCircle className="w-4 h-4 text-text-quaternary" />
                <span className="text-[13px] font-medium text-text-quaternary">
                  {chatReason || 'Chat closed for this order'}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
