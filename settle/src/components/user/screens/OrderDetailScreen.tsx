"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  X,
  Check,
  CheckCheck,
  Star,
  Copy,
  MapPin,
  Clock,
  Lock,
  Navigation,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Wallet,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import { ImageMessageBubble, type ImageUploadStatus } from "@/components/chat/ImageMessageBubble";
import { compressImage } from "@/lib/utils/compressImage";
import type { Screen, Order } from "./types";
import {
  type RefObject,
  useState as useLocalState,
  useRef as useLocalRef,
  useCallback as useLocalCallback,
  useEffect as useLocalEffect,
} from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import dynamic from "next/dynamic";
import { showAlert } from "@/context/ModalContext";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

// Reusable class strings — mirror Card / SectionLabel / CardLabel conventions
const CARD = "bg-surface-card border border-border-subtle";
const CARD_STRONG = "bg-surface-active border border-border-medium";
const AMBER_CARD = "bg-warning-dim border border-warning-border";
const AMBER_CARD_STRONG = "bg-warning-dim border border-warning-border";
const RED_CARD = "bg-error-dim border border-error-border";
// Modal sheets must be solid (not translucent) so the underlying screen
// doesn't bleed through. surface-base is the page background — opaque in
// both themes — and pairs with the dark scrim above it.
const SHEET_BG = "bg-surface-base";
const PRIMARY_BTN = "bg-accent text-accent-text";

/** Map fiat currency code to display symbol */
// Inline unread-count pill shown next to the MessageCircle icon on every
// "Message Merchant" / "Chat" button. Returns null when count is 0/undef so
// the button renders identically to before in the common case.
function ChatBadge({ count }: { count?: number }) {
  if (!count || count <= 0) return null;
  return (
    <span className="ml-0.5 inline-flex items-center justify-center px-1.5 rounded-full bg-primary text-background text-[10px] font-bold min-w-[18px] h-[16px] leading-none">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function fiatSym(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "د.إ";
    default: return (code || "AED").toUpperCase();
  }
}
const SECONDARY_BTN = "bg-surface-active text-text-primary border border-border-medium";
const MUTED_BTN = "bg-surface-active text-text-secondary";

// Shared expiry timer — used on both user and merchant order detail screens
import { OrderExpiryTimer } from '@/components/shared/OrderExpiryTimer';

/** Glossy animated expiry bar — sits at the card's bottom edge.
 *  Shrinks with time. Shimmers to attract attention. Pulses red when urgent. */
function ExpiryProgressBar({ expiresAt, createdAt }: { expiresAt: Date; createdAt: Date }) {
  const [now, setNow] = useLocalState(Date.now());
  useLocalEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const totalMs = expiresAt.getTime() - createdAt.getTime();
  const remainingMs = Math.max(0, expiresAt.getTime() - now);
  const pct = totalMs > 0 ? Math.min(100, (remainingMs / totalMs) * 100) : 0;
  const isUrgent = remainingMs < 5 * 60 * 1000;

  return (
    <div className="mt-3 -mx-4 -mb-4 h-[6px] rounded-b-2xl overflow-hidden bg-surface-hover relative">
      {/* Main bar */}
      <div
        className={`h-full rounded-b-2xl transition-[width] duration-1000 ease-linear relative overflow-hidden ${
          isUrgent ? 'bg-error' : 'bg-gradient-to-r from-accent via-accent to-success'
        } ${isUrgent ? 'animate-pulse' : ''}`}
        style={{ width: `${pct}%` }}
      >
        {/* Glossy shine sweep */}
        <div
          className="absolute inset-0 animate-scanner"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)',
          }}
        />
        {/* Top highlight for glass effect */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 100%)',
          }}
        />
      </div>
      {/* Glow at the leading edge */}
      {pct > 2 && (
        <div
          className={`absolute top-0 bottom-0 w-3 rounded-full blur-sm transition-all duration-1000 ${
            isUrgent ? 'bg-error' : 'bg-accent'
          }`}
          style={{ left: `calc(${pct}% - 6px)`, opacity: 0.8 }}
        />
      )}
    </div>
  );
}

export interface OrderDetailScreenProps {
  setScreen: (s: Screen) => void;
  previousScreen?: Screen;
  activeOrder: Order;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  handleOpenChat: () => void;
  markPaymentSent: () => void;
  confirmFiatReceived: () => void;
  rating: number;
  setRating: (r: number) => void;
  submitReview?: (orderId: string, rating: number, reviewText?: string) => Promise<void>;
  copied: boolean;
  handleCopy: (text: string) => void;
  // Extension
  extensionRequest: {
    orderId: string;
    requestedBy: string;
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  } | null;
  requestExtension: (durationMinutes?: number) => void;
  respondToExtension: (accept: boolean) => void;
  requestingExtension: boolean;
  // Chat modal
  showChat: boolean;
  setShowChat: (v: boolean) => void;
  chatMessage: string;
  setChatMessage: (m: string) => void;
  chatInputRef: RefObject<HTMLInputElement | null>;
  chatMessagesRef: RefObject<HTMLDivElement | null>;
  activeChat: {
    id: string;
    orderId?: string;
    isTyping?: boolean;
    messages: Array<{
      id: string;
      text: string;
      from: string;
      timestamp: Date;
      senderName?: string;
      messageType?: string;
      receiptData?: Record<string, unknown> | null;
      imageUrl?: string;
      isRead?: boolean;
      status?: 'sending' | 'sent' | 'delivered' | 'read';
    }>;
  } | null;
  handleSendMessage: () => void;
  sendChatMessage?: (chatId: string, text: string, imageUrl?: string) => void;
  sendTypingIndicator?: (chatId: string, isTyping: boolean) => void;
  // Dispute
  showDisputeModal: boolean;
  setShowDisputeModal: (v: boolean) => void;
  disputeReason: string;
  setDisputeReason: (r: string) => void;
  disputeDescription: string;
  setDisputeDescription: (d: string) => void;
  submitDispute: () => void;
  isSubmittingDispute: boolean;
  disputeInfo: {
    status?: string;
    proposed_resolution?: string;
    resolution_notes?: string;
    user_confirmed?: boolean;
    merchant_confirmed?: boolean;
  } | null;
  respondToResolution: (action: "accept" | "reject") => void;
  isRespondingToResolution: boolean;
  // Cancel request
  requestCancelOrder: (reason?: string) => void;
  respondToCancelRequest: (accept: boolean) => void;
  isRequestingCancel: boolean;
  // Solana
  solanaWallet: {
    connected: boolean;
    programReady: boolean;
    walletAddress: string | null;
    depositToEscrow: (params: {
      amount: number;
      merchantWallet: string;
    }) => Promise<{
      success: boolean;
      txHash: string;
      tradeId?: number;
      tradePda?: string;
      escrowPda?: string;
    }>;
  };
  setShowWalletModal: (v: boolean) => void;
  userId: string | null;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  playSound: (
    sound:
      | "message"
      | "send"
      | "trade_start"
      | "trade_complete"
      | "notification"
      | "error"
      | "click"
      | "new_order"
      | "order_complete",
  ) => void;
  maxW: string;
}

export const OrderDetailScreen = ({
  setScreen,
  previousScreen,
  activeOrder,
  isLoading,
  setIsLoading,
  handleOpenChat,
  markPaymentSent,
  confirmFiatReceived,
  rating,
  setRating,
  submitReview,
  copied,
  handleCopy,
  extensionRequest,
  requestExtension,
  respondToExtension,
  requestingExtension,
  showChat,
  setShowChat,
  chatMessage,
  setChatMessage,
  chatInputRef,
  chatMessagesRef,
  activeChat,
  handleSendMessage,
  sendChatMessage,
  sendTypingIndicator,
  showDisputeModal,
  setShowDisputeModal,
  disputeReason,
  setDisputeReason,
  disputeDescription,
  setDisputeDescription,
  submitDispute,
  isSubmittingDispute,
  disputeInfo,
  respondToResolution,
  isRespondingToResolution,
  requestCancelOrder,
  respondToCancelRequest,
  isRequestingCancel,
  solanaWallet,
  setShowWalletModal,
  userId,
  setOrders,
  playSound,
  maxW,
}: OrderDetailScreenProps) => {
  // Suppress unused-param lint: `copied` is part of the prop API but not rendered here.
  void copied;
  const [showEmojiPicker, setShowEmojiPicker] = useLocalState(false);
  const [isUploading, setIsUploading] = useLocalState(false);
  const [copiedField, setCopiedField] = useLocalState<string | null>(null);
  const [reviewText, setReviewText] = useLocalState("");

  const copyField = useLocalCallback(
    (field: string, text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopiedField(field);
        handleCopy(text);
        setTimeout(() => setCopiedField(null), 1500);
      });
    },
    [handleCopy],
  );
  const [pendingImage, setPendingImage] = useLocalState<{
    file: File;
    previewUrl: string;
  } | null>(null);
  const fileInputRef = useLocalRef<HTMLInputElement>(null);
  const typingTimeoutRef = useLocalRef<NodeJS.Timeout | null>(null);

  // ── Optimistic image uploads — WhatsApp-style ──────────────────────
  interface PendingUpload {
    tempId: string;
    localUrl: string;
    caption: string;
    file: File;
    status: ImageUploadStatus;
    progress: number;
    abortController: AbortController | null;
    createdAt: number;
  }
  const [pendingUploads, setPendingUploads] = useLocalState<Map<string, PendingUpload>>(new Map());
  const pendingUploadsRef = useLocalRef(pendingUploads);
  pendingUploadsRef.current = pendingUploads;

  // Abort all uploads on unmount
  useLocalEffect(() => {
    return () => {
      for (const entry of pendingUploadsRef.current.values()) {
        if (entry.abortController) entry.abortController.abort();
      }
    };
  }, []);

  // Handle file select — compress + show preview
  const handleFileSelect = useLocalCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawFile = e.target.files?.[0];
      if (!rawFile) return;
      if (rawFile.size > 10 * 1024 * 1024) return;
      if (!rawFile.type.startsWith("image/")) return;
      if (fileInputRef.current) fileInputRef.current.value = "";

      const file = await compressImage(rawFile, { maxDimension: 1600, quality: 0.8 });
      const previewUrl = URL.createObjectURL(file);
      setPendingImage({ file, previewUrl });
    },
    [],
  );

  // Clear pending image
  const clearPendingImage = useLocalCallback(() => {
    if (pendingImage?.previewUrl) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  }, [pendingImage]);

  /**
   * WhatsApp-style optimistic image upload:
   *  1. Close preview, insert optimistic bubble instantly
   *  2. Upload to Cloudinary with XHR progress
   *  3. On success: send real message, remove pending
   *  4. On failure: show retry
   */
  const startImageUpload = useLocalCallback(async (
    file: File, localUrl: string, caption: string, tempId: string,
  ) => {
    if (!activeChat || !sendChatMessage) return;

    const abortController = new AbortController();
    const uploadTimeout = setTimeout(() => abortController.abort(), 30_000);

    setPendingUploads(prev => {
      const next = new Map(prev);
      const existing = prev.get(tempId);
      next.set(tempId, {
        tempId, localUrl, caption, file,
        status: 'uploading', progress: 0,
        abortController,
        createdAt: existing?.createdAt ?? Date.now(),
      });
      return next;
    });

    // Auto-scroll
    requestAnimationFrame(() => {
      if (chatMessagesRef.current) {
        chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
      }
    });

    try {
      const sigRes = await fetchWithAuth("/api/upload/signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: activeChat.orderId || "chat" }),
        signal: abortController.signal,
      });
      if (!sigRes.ok) throw new Error("Signature failed");
      const sigData = await sigRes.json();
      if (!sigData.success) throw new Error("Invalid signature");
      const sig = sigData.data;

      if (!sig.signature || !sig.timestamp || !sig.apiKey || !sig.cloudName || !sig.folder) {
        throw new Error("Incomplete upload credentials");
      }

      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 20 });
        return next;
      });

      const formData = new FormData();
      formData.append("file", file);
      formData.append("signature", sig.signature);
      formData.append("timestamp", sig.timestamp.toString());
      formData.append("api_key", sig.apiKey);
      formData.append("folder", sig.folder);

      const imageUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `https://api.cloudinary.com/v1_1/${sig.cloudName}/image/upload`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = 20 + Math.round((e.loaded / e.total) * 70);
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
            resolve(JSON.parse(xhr.responseText).secure_url);
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error"));

        abortController.signal.addEventListener("abort", () => xhr.abort());
        if (abortController.signal.aborted) { xhr.abort(); return; }
        xhr.send(formData);
      });

      setPendingUploads(prev => {
        const next = new Map(prev);
        const entry = next.get(tempId);
        if (entry) next.set(tempId, { ...entry, progress: 95 });
        return next;
      });

      sendChatMessage(activeChat.id, caption || "Photo", imageUrl);
      playSound("send");

      clearTimeout(uploadTimeout);
      setPendingUploads(prev => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });
    } catch (err: any) {
      clearTimeout(uploadTimeout);
      if (err?.name === "AbortError" || abortController.signal.aborted) {
        setPendingUploads(prev => { const next = new Map(prev); next.delete(tempId); return next; });
      } else {
        console.error("[OrderDetailScreen] Image upload error:", err);
        setPendingUploads(prev => {
          const next = new Map(prev);
          const entry = next.get(tempId);
          if (entry) next.set(tempId, { ...entry, status: 'failed', progress: 0, abortController: null });
          return next;
        });
      }
    }
  }, [activeChat, sendChatMessage, playSound]);

  const cancelUpload = useLocalCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (entry?.abortController) entry.abortController.abort();
    setPendingUploads(prev => { const next = new Map(prev); next.delete(tempId); return next; });
  }, []);

  const retryUpload = useLocalCallback((tempId: string) => {
    const entry = pendingUploadsRef.current.get(tempId);
    if (!entry) return;
    startImageUpload(entry.file, entry.localUrl, entry.caption, tempId);
  }, [startImageUpload]);

  /** Called when user confirms image from preview */
  const handleImageConfirm = useLocalCallback(() => {
    if (!pendingImage) return;
    const tempId = `temp-img-${Date.now()}`;
    const { file, previewUrl } = pendingImage;
    const caption = chatMessage.trim();
    setPendingImage(null); // Close preview
    setChatMessage("");
    startImageUpload(file, previewUrl, caption, tempId);
  }, [pendingImage, chatMessage, setChatMessage, startImageUpload]);

  // Cleanup preview URL on unmount
  useLocalEffect(() => {
    return () => {
      if (pendingImage?.previewUrl)
        URL.revokeObjectURL(pendingImage.previewUrl);
    };
  }, [pendingImage]);

  // Handle typing indicator — fires order-channel typing AND direct-chat typing
  // (so the merchant sees it whether they're in TradeChat or the Messages panel).
  const directTypingSentRef = useLocalRef(false);
  const directTypingStopTimerRef = useLocalRef<NodeJS.Timeout | null>(null);
  const handleTypingChange = useLocalCallback(
    (value: string) => {
      setChatMessage(value);
      if (!activeChat) return;

      // 1) Order-channel typing (existing — for TradeChat / order chat views)
      if (sendTypingIndicator) {
        sendTypingIndicator(activeChat.id, true);
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
          sendTypingIndicator(activeChat.id, false);
        }, 2000);
      }

      // 2) Direct-chat typing — fires once per burst, stops after 2s idle
      const merchantId = activeOrder?.merchant?.id;
      if (merchantId) {
        if (!directTypingSentRef.current) {
          directTypingSentRef.current = true;
          fetchWithAuth('/api/merchant/direct-messages/typing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactType: 'merchant', contactId: merchantId, isTyping: true }),
          }).catch(() => {});
        }
        if (directTypingStopTimerRef.current) clearTimeout(directTypingStopTimerRef.current);
        directTypingStopTimerRef.current = setTimeout(() => {
          directTypingSentRef.current = false;
          fetchWithAuth('/api/merchant/direct-messages/typing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contactType: 'merchant', contactId: merchantId, isTyping: false }),
          }).catch(() => {});
        }, 2000);
      }
    },
    [activeChat, sendTypingIndicator, setChatMessage, activeOrder?.merchant?.id],
  );

  // Cleanup typing timeout
  useLocalEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  // Guard: if activeOrder is null/undefined (briefly during state transitions
  // like trade completion), show a loading state instead of crashing.
  if (!activeOrder) {
    return (
      <div className="min-h-[100dvh] bg-surface-base flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-6 h-6 text-text-secondary animate-spin mx-auto mb-2" />
          <p className="text-[13px] text-text-secondary">Loading order...</p>
        </div>
      </div>
    );
  }

  // Guard: if merchant data is missing (rare — usually mapDbOrderToUI provides
  // a fallback), show a recovery state with a back button.
  if (!activeOrder.merchant) {
    return (
      <div className="min-h-[100dvh] bg-surface-base flex flex-col items-center justify-center px-5">
        <div className="text-center mb-4">
          <p className="text-[15px] font-medium text-text-primary mb-1">Order data unavailable</p>
          <p className="text-[13px] text-text-secondary">Please refresh or go back to home.</p>
        </div>
        <button
          onClick={() => setScreen("home")}
          className="px-5 py-2.5 rounded-xl bg-accent text-accent-text text-[14px] font-semibold"
        >
          Back to Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-surface-base">
      <div className="h-12" />

      <div className="px-5 py-4 flex items-center">
        <button
          onClick={() => {
            // Only go back to screens that are safe to return to.
            // Transient trade-flow screens (escrow, matching, trade, cash-confirm)
            // may have cleared their data by now, causing a blank screen.
            const safeScreens = new Set(["home", "orders", "profile", "chats", "notifications"]);
            const target = previousScreen && safeScreens.has(previousScreen) ? previousScreen : "home";
            setScreen(target);
          }}
          className="w-9 h-9 rounded-xl flex items-center justify-center -ml-1 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold pr-8 text-text-primary">
          Order Details
        </h1>
      </div>

      <div className="flex-1 px-5 overflow-auto pb-6">
        {/* Order Summary */}
        <div className={`rounded-2xl p-4 mb-4 ${CARD}`}>
          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center ${
                activeOrder.type === "buy"
                  ? "bg-success-dim"
                  : "bg-error-dim"
              }`}
            >
              {activeOrder.type === "buy" ? (
                <ArrowDownLeft className="w-5 h-5 text-success" />
              ) : (
                <ArrowUpRight className="w-5 h-5 text-error" />
              )}
            </div>
            <div>
              <p className="text-[17px] font-semibold text-text-primary">
                {activeOrder.type === "buy" ? "Buying" : "Selling"}{" "}
                {parseFloat(activeOrder.cryptoAmount).toFixed(2)} USDC
              </p>
              <p className="text-[13px] text-text-secondary">
                {fiatSym(activeOrder.fiatCode)}{" "}
                {parseFloat(activeOrder.fiatAmount).toLocaleString()}
              </p>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-1.5 mb-2">
            {[1, 2, 3, 4].map((step) => {
              // Dynamic: per-step computed background color based on status/step.
              const bg =
                activeOrder.status === "cancelled" ||
                activeOrder.status === "expired"
                  ? "bg-error"
                  : step <= activeOrder.step
                    ? "bg-text-primary"
                    : "bg-text-quaternary";
              return (
                <div key={step} className={`flex-1 h-1.5 rounded-full ${bg}`} />
              );
            })}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[13px] text-text-secondary">
              {activeOrder.status === "cancelled"
                ? "Order Cancelled"
                : activeOrder.status === "expired"
                  ? "Order Expired"
                  : `Step ${activeOrder.step} of 4`}
            </p>
            {/* Expiry countdown inline — visible in all active states */}
            {activeOrder.expiresAt &&
              activeOrder.status !== "cancelled" &&
              activeOrder.status !== "expired" &&
              activeOrder.status !== "complete" && (
              <OrderExpiryTimer
                expiresAt={activeOrder.expiresAt}
                status={activeOrder.dbStatus}
                viewerRole={activeOrder.type === 'buy' ? 'buyer' : 'seller'}
                compact
              />
            )}
          </div>

          {/* Bottom expiry bar — fills proportionally to time remaining */}
          {activeOrder.expiresAt &&
            activeOrder.status !== "cancelled" &&
            activeOrder.status !== "expired" &&
            activeOrder.status !== "complete" && (
            <ExpiryProgressBar
              expiresAt={activeOrder.expiresAt}
              createdAt={activeOrder.createdAt}
            />
          )}
        </div>

        {/* Escrow Status Section - Show for sell orders with escrow */}
        {activeOrder.type === "sell" && activeOrder.escrowTxHash && (
          <div className={`rounded-2xl p-4 mb-4 ${CARD}`}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                <Lock className="w-5 h-5 text-text-secondary" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-text-primary">
                  Escrow Locked
                </p>
                <p className="text-[13px] text-text-secondary">
                  Your USDC is secured on-chain
                </p>
              </div>
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active">
                <Check className="w-4 h-4 text-text-primary" />
              </div>
            </div>

            <div className="space-y-2 text-[13px]">
              {activeOrder.escrowTradeId && (
                <div className="flex items-center justify-between">
                  <span className="text-text-tertiary">Trade ID</span>
                  <span className="font-mono font-semibold text-text-primary">
                    #{activeOrder.escrowTradeId}
                  </span>
                </div>
              )}
              {activeOrder.escrowTxHash && (
                <div className="flex items-center justify-between">
                  <span className="text-text-tertiary">Transaction</span>
                  <a
                    href={`https://explorer.solana.com/tx/${activeOrder.escrowTxHash}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-text-secondary"
                  >
                    <span className="font-mono">
                      {activeOrder.escrowTxHash.slice(0, 8)}...
                      {activeOrder.escrowTxHash.slice(-6)}
                    </span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Extension Request Banner */}
        {extensionRequest &&
          extensionRequest.requestedBy === "merchant" &&
          extensionRequest.orderId === activeOrder.id && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 mb-4 ${CARD}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                  <Clock className="w-5 h-5 text-text-secondary" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-text-primary">
                    Extension Requested
                  </p>
                  <p className="text-[13px] text-text-secondary">
                    Merchant wants +
                    {extensionRequest.extensionMinutes >= 60
                      ? `${Math.round(extensionRequest.extensionMinutes / 60)} hour${Math.round(extensionRequest.extensionMinutes / 60) > 1 ? "s" : ""}`
                      : `${extensionRequest.extensionMinutes} minutes`}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToExtension(true)}
                  disabled={requestingExtension}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 bg-accent text-accent-text"
                >
                  {requestingExtension ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    "Accept"
                  )}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToExtension(false)}
                  disabled={requestingExtension}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 bg-surface-active text-text-secondary"
                >
                  Decline
                </motion.button>
              </div>
              <p className="text-[11px] text-center mt-2 text-text-tertiary">
                Extensions used: {extensionRequest.extensionCount}/
                {extensionRequest.maxExtensions}
              </p>
            </motion.div>
          )}

        {/* Cancel Request Banner — merchant requested cancel, user decides */}
        {activeOrder.cancelRequest &&
          activeOrder.cancelRequest.requestedBy === "merchant" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 mb-4 ${AMBER_CARD}`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-warning-dim">
                  <X className="w-5 h-5 text-warning" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-warning">
                    Cancel Requested
                  </p>
                  <p className="text-[13px] text-warning">
                    Merchant wants to cancel: {activeOrder.cancelRequest.reason}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToCancelRequest(true)}
                  disabled={isRequestingCancel}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 bg-warning-dim text-warning"
                >
                  {isRequestingCancel ? (
                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                  ) : (
                    "Agree to Cancel"
                  )}
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => respondToCancelRequest(false)}
                  disabled={isRequestingCancel}
                  className="flex-1 py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 bg-surface-active text-text-secondary"
                >
                  Continue Order
                </motion.button>
              </div>
            </motion.div>
          )}

        {/* Cancel Request Pending — user requested, waiting for merchant */}
        {activeOrder.cancelRequest &&
          activeOrder.cancelRequest.requestedBy === "user" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 mb-4 ${AMBER_CARD}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-warning-dim">
                  <Loader2 className="w-5 h-5 animate-spin text-warning" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-warning">
                    Cancel Request Sent
                  </p>
                  <p className="text-[13px] text-warning">
                    Waiting for merchant to approve
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Inactivity Warning / Extension Sent / Extension Granted Banner */}
        {activeOrder.inactivityWarned &&
          activeOrder.status !== "disputed" &&
          activeOrder.status !== "complete" &&
          activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            (() => {
              // DEBUG: check what data we have
              console.log('[OrderDetail] Extension banner check:', {
                extensionRequest,
                lastExtendedAt: activeOrder.lastExtendedAt,
                inactivityWarned: activeOrder.inactivityWarned,
                orderId: activeOrder.id,
              });
              // Priority 1: Extension was granted (extended after warning)
              const wasExtended = activeOrder.lastExtendedAt &&
                (!activeOrder.lastActivityAt ||
                  new Date(activeOrder.lastExtendedAt).getTime() >
                  new Date(activeOrder.lastActivityAt).getTime() - 60_000);

              if (wasExtended) {
                return (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl p-4 mb-4 ${CARD}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-success-dim">
                        <Check className="w-5 h-5 text-success" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[15px] font-semibold text-success">
                          Merchant Approved Extension
                        </p>
                        <p className="text-[13px] text-text-secondary">
                          Your time has been extended.{' '}
                          {activeOrder.expiresAt && (
                            <OrderExpiryTimer
                              expiresAt={activeOrder.expiresAt}
                              status={activeOrder.dbStatus}
                              viewerRole={activeOrder.type === 'buy' ? 'buyer' : 'seller'}
                            />
                          )}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              // Priority 2: I sent an extension request, waiting for merchant
              if (extensionRequest && extensionRequest.requestedBy === "user" && extensionRequest.orderId === activeOrder.id) {
                const durLabel = extensionRequest.extensionMinutes >= 60
                  ? `${Math.round(extensionRequest.extensionMinutes / 60)} hour${Math.round(extensionRequest.extensionMinutes / 60) > 1 ? 's' : ''}`
                  : `${extensionRequest.extensionMinutes} minutes`;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl p-4 mb-4 ${CARD}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                        <Loader2 className="w-5 h-5 text-text-secondary animate-spin" />
                      </div>
                      <div className="flex-1">
                        <p className="text-[15px] font-semibold text-text-primary">
                          Extension Request Sent
                        </p>
                        <p className="text-[13px] text-text-secondary">
                          Waiting for merchant to approve +{durLabel} extension
                        </p>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              // Priority 3: No extension sent — show warning
              return (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-2xl p-4 mb-4 ${AMBER_CARD_STRONG}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-warning-dim">
                      <AlertTriangle className="w-5 h-5 text-warning" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[15px] font-semibold text-warning">
                        Inactivity Warning
                      </p>
                      <p className="text-[13px] text-warning">
                        No activity for 15+ minutes. Complete this order soon or it
                        will be auto-cancelled/disputed.
                      </p>
                    </div>
                  </div>
                </motion.div>
              );
            })()
          )}

        {/* Dispute Auto-Resolve Countdown */}
        {activeOrder.status === "disputed" &&
          activeOrder.disputeAutoResolveAt && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-2xl p-4 mb-4 ${RED_CARD}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-error-dim">
                  <Clock className="w-5 h-5 text-error" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-error">
                    Dispute Timer
                  </p>
                  <p className="text-[13px] text-error">
                    {new Date(activeOrder.disputeAutoResolveAt) > new Date()
                      ? `Auto-refund to escrow funder in ${Math.max(0, Math.round((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) / 3600000))}h ${Math.max(0, Math.round(((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) % 3600000) / 60000))}m`
                      : "Auto-refund processing..."}
                  </p>
                </div>
              </div>
            </motion.div>
          )}

        {/* Request Extension — duration picker for payment_sent, simple button otherwise */}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          !extensionRequest &&
          (activeOrder.step === 3 ? (
            /* Payment sent: fiat sender picks duration */
            <div className="mb-4">
              <p className="text-[12px] font-medium mb-2 flex items-center gap-1.5 text-text-tertiary">
                <Clock className="w-3.5 h-3.5" />
                Request Time Extension
              </p>
              <div className="flex gap-2">
                {[
                  { minutes: 15, label: "15 min" },
                  { minutes: 60, label: "1 hour" },
                  { minutes: 720, label: "12 hours" },
                ].map((opt) => (
                  <motion.button
                    key={opt.minutes}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => requestExtension(opt.minutes)}
                    disabled={requestingExtension}
                    className={`flex-1 py-2.5 rounded-xl text-[13px] font-medium flex items-center justify-center gap-1 disabled:opacity-50 transition-colors text-text-secondary ${CARD}`}
                  >
                    {requestingExtension ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      opt.label
                    )}
                  </motion.button>
                ))}
              </div>
            </div>
          ) : (
            /* Pre-payment: simple extension request */
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => requestExtension()}
              disabled={requestingExtension}
              className={`w-full py-3 rounded-xl text-[13px] font-medium mb-4 flex items-center justify-center gap-2 disabled:opacity-50 text-text-secondary ${CARD}`}
            >
              {requestingExtension ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Clock className="w-4 h-4" />
                  Request Time Extension
                </>
              )}
            </motion.button>
          ))}

        {/* Cancelled/Expired Banner */}
        {(activeOrder.status === "cancelled" ||
          activeOrder.status === "expired") && (
          <div className={`mb-4 p-4 rounded-2xl ${RED_CARD}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-error-dim">
                <X className="w-5 h-5 text-error" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-error">
                  {activeOrder.status === "cancelled"
                    ? "Order Cancelled"
                    : "Order Expired"}
                </p>
                <p className="text-[13px] text-error">
                  {activeOrder.status === "cancelled"
                    ? "This trade was cancelled and did not complete."
                    : "This order expired before it could be completed."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Steps — hidden when cancelled/expired */}
        {activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <div className="space-y-3">
              {/* Step 1 */}
              <div className={`p-4 rounded-2xl ${CARD}`}>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                      activeOrder.step >= 1
                        ? "bg-accent text-accent-text"
                        : "bg-surface-card text-text-tertiary"
                    }`}
                  >
                    {activeOrder.step > 1 ? <Check className="w-4 h-4" /> : "1"}
                  </div>
                  <div>
                    <p
                      className={`text-[15px] font-medium ${
                        activeOrder.step >= 1
                          ? "text-text-primary"
                          : "text-text-tertiary"
                      }`}
                    >
                      Order created
                    </p>
                    {activeOrder.step >= 1 && (
                      <p className="text-[13px] text-text-secondary">
                        {activeOrder.dbStatus === "pending"
                          ? "Waiting for merchant..."
                          : `Matched with ${activeOrder.merchant.name}`}
                      </p>
                    )}
                    {/* For sell orders waiting for merchant to mine/claim */}
                    {activeOrder.step === 1 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "escrowed" && (
                        <div className={`mt-3 rounded-xl p-4 ${CARD_STRONG}`}>
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active">
                              <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />
                            </div>
                            <div>
                              <p className="text-[14px] font-medium text-text-primary">
                                Waiting for Merchant
                              </p>
                              <p className="text-[12px] text-text-secondary">
                                Your USDT is locked. Waiting for merchant to
                                claim
                              </p>
                            </div>
                          </div>
                          <p className="text-[12px] text-text-tertiary">
                            Your USDT is secured in escrow on-chain. A merchant
                            will claim this order and send fiat to your bank
                            account.
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className={`p-4 rounded-2xl ${CARD}`}>
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                      activeOrder.step >= 2
                        ? "bg-accent text-accent-text"
                        : "bg-surface-card text-text-tertiary"
                    }`}
                  >
                    {activeOrder.step > 2 ? <Check className="w-4 h-4" /> : "2"}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-[15px] font-medium ${
                        activeOrder.step >= 2
                          ? "text-text-primary"
                          : "text-text-tertiary"
                      }`}
                    >
                      {activeOrder.type === "buy"
                        ? activeOrder.merchant.paymentMethod === "cash"
                          ? "Meet & pay cash"
                          : "Send payment"
                        : "Waiting for merchant"}
                    </p>

                    {/* Funds Locked indicator - show when escrow is locked */}
                    {activeOrder.step === 2 &&
                      activeOrder.dbStatus === "escrowed" && (
                        <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 ${CARD_STRONG}`}>
                          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-surface-active">
                            <Lock className="w-3 h-3 text-text-primary" />
                          </div>
                          <span className="text-[13px] font-medium text-text-primary">
                            {activeOrder.type === "buy"
                              ? "Funds locked in escrow"
                              : "Your USDT locked in escrow"}
                          </span>
                        </div>
                      )}

                    {/* Show escrow funding in progress for buy orders when escrow not yet funded */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus !== "escrowed" && (
                        <div className="mt-3 space-y-3">
                          <div className={`rounded-xl p-4 ${CARD_STRONG}`}>
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                                <Loader2 className="w-5 h-5 animate-spin text-text-secondary" />
                              </div>
                              <div>
                                <p className="text-[15px] font-medium text-text-primary">
                                  Escrow Funding in Progress
                                </p>
                                <p className="text-[12px] text-text-secondary">
                                  Merchant is locking USDT in escrow
                                </p>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden bg-surface-active">
                              <motion.div
                                className="h-full bg-text-tertiary"
                                style={{ width: "40%" }}
                                animate={{ x: ["-100%", "100%"] }}
                                transition={{
                                  duration: 1.5,
                                  repeat: Infinity,
                                  ease: "linear",
                                }}
                              />
                            </div>
                            <p className="mt-3 text-[12px] text-text-tertiary">
                              Once the merchant funds the escrow, you&apos;ll be
                              able to send your payment.
                            </p>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {/* Show payment UI when escrow is funded (escrowed or payment_pending) */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "buy" &&
                      (activeOrder.dbStatus === "escrowed" ||
                        activeOrder.dbStatus === "payment_pending") && (
                        <div className="mt-3 space-y-3">
                          {activeOrder.merchant.paymentMethod === "cash" ? (
                            <>
                              {/* Map Preview */}
                              <div className="relative rounded-xl overflow-hidden">
                                <div
                                  className="h-40 relative bg-surface-raised bg-cover bg-center"
                                  style={{
                                    // Dynamic: mapbox URL built from merchant lat/lng.
                                    backgroundImage: `url('https://api.mapbox.com/styles/v1/mapbox/light-v11/static/pin-s+000000(${activeOrder.merchant.lng},${activeOrder.merchant.lat})/${activeOrder.merchant.lng},${activeOrder.merchant.lat},14,0/400x200@2x?access_token=pk.placeholder')`,
                                  }}
                                >
                                  {/* Fallback map UI */}
                                  <div className="absolute inset-0 bg-surface-card" />
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="flex flex-col items-center">
                                      <div className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg mb-1 bg-surface-raised">
                                        <MapPin className="w-5 h-5 text-text-primary" />
                                      </div>
                                      <div className="w-1 h-3 rounded-b-full bg-text-tertiary" />
                                    </div>
                                  </div>
                                  {/* Grid pattern for map feel */}
                                  <div
                                    className="absolute inset-0 opacity-10 bg-[length:40px_40px]"
                                    style={{
                                      backgroundImage:
                                        'linear-gradient(var(--color-border-strong) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-strong) 1px, transparent 1px)',
                                    }}
                                  />
                                </div>
                                <button
                                  onClick={() =>
                                    window.open(
                                      `https://maps.google.com/?q=${activeOrder.merchant.lat},${activeOrder.merchant.lng}`,
                                      "_blank",
                                    )
                                  }
                                  className="absolute top-3 right-3 backdrop-blur-sm rounded-lg px-3 py-1.5 flex items-center gap-1.5 bg-surface-raised"
                                >
                                  <ExternalLink className="w-3.5 h-3.5 text-text-primary" />
                                  <span className="text-[12px] font-medium text-text-primary">
                                    Open Maps
                                  </span>
                                </button>
                              </div>

                              {/* Meeting Details */}
                              <div
                                className={`rounded-xl p-3 space-y-3 ${CARD}`}
                              >
                                <div>
                                  <p className="text-[11px] uppercase tracking-wide mb-1 text-text-tertiary">
                                    Meeting Location
                                  </p>
                                  <p className="text-[15px] font-medium text-text-primary">
                                    {activeOrder.merchant.location}
                                  </p>
                                  <p className="text-[13px] text-text-secondary">
                                    {activeOrder.merchant.address}
                                  </p>
                                </div>
                                <div className="pt-2 border-t border-border-medium">
                                  <p className="text-[11px] uppercase tracking-wide mb-1 text-text-tertiary">
                                    Meeting Spot
                                  </p>
                                  <div className="flex items-start gap-2">
                                    <Navigation className="w-4 h-4 flex-shrink-0 mt-0.5 text-text-secondary" />
                                    <p className="text-[13px] text-text-primary">
                                      {activeOrder.merchant.meetingSpot}
                                    </p>
                                  </div>
                                </div>
                                <div className="pt-2 border-t border-border-medium">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[13px] text-text-secondary">
                                      Cash Amount
                                    </span>
                                    <span className="text-[17px] font-semibold text-text-primary">
                                      {fiatSym(activeOrder.fiatCode)}{" "}
                                      {parseFloat(
                                        activeOrder.fiatAmount,
                                      ).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className={`flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                                >
                                  <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  className={`flex-[2] py-3 rounded-xl text-[15px] font-semibold ${PRIMARY_BTN}`}
                                >
                                  I&apos;m at the location
                                </motion.button>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* Warning when merchant has no payment method configured */}
                              {!activeOrder.merchantPaymentMethod &&
                                !activeOrder.lockedPaymentMethod &&
                                !activeOrder.merchant.bank &&
                                !activeOrder.merchant.iban && (
                                  <div className={`rounded-xl p-3 mb-2 border border-warning-border bg-warning-dim`}>
                                    <div className="flex items-start gap-2">
                                      <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                                      <div className="flex-1">
                                        <p className="text-[13px] font-semibold text-warning mb-1">
                                          Payment method not provided
                                        </p>
                                        <p className="text-[11px] text-text-secondary">
                                          The merchant hasn&apos;t shared their payment details. Tap Chat to ask for their bank/UPI info before sending payment.
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              <div
                                className={`rounded-xl p-3 space-y-2 ${CARD}`}
                              >
                                {/* Locked payment method header */}
                                {activeOrder.lockedPaymentMethod && (
                                  <div className="flex items-center gap-1.5 pb-2 border-b border-border-medium">
                                    <Lock className="w-3 h-3 text-warning" />
                                    <span className="text-[10px] text-warning font-bold uppercase tracking-wide">
                                      Send payment to this method only
                                    </span>
                                  </div>
                                )}
                                {/* Show merchant's payment method if available, then locked payment method, then fall back to offer details */}
                                {activeOrder.merchantPaymentMethod ? (
                                  <>
                                    <div className="flex items-center justify-between">
                                      <span className="text-[13px] text-text-secondary">
                                        Method
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[13px] font-medium text-text-primary">
                                          {
                                            activeOrder.merchantPaymentMethod
                                              .name
                                          }
                                        </span>
                                        <button
                                          onClick={() =>
                                            copyField(
                                              "method",
                                              activeOrder.merchantPaymentMethod!
                                                .name,
                                            )
                                          }
                                          className="p-0.5 rounded hover:bg-surface-active"
                                        >
                                          {copiedField === "method" ? (
                                            <Check className="w-3.5 h-3.5 text-success" />
                                          ) : (
                                            <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                    {activeOrder.merchantPaymentMethod
                                      .details && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          Details
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] font-mono text-text-primary">
                                            {
                                              activeOrder.merchantPaymentMethod
                                                .details
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "details",
                                                activeOrder
                                                  .merchantPaymentMethod!
                                                  .details,
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "details" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : activeOrder.lockedPaymentMethod ? (
                                  <>
                                    {activeOrder.lockedPaymentMethod.details
                                      .bank_name && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          Bank
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] text-text-primary">
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.bank_name
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "bank",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.bank_name || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "bank" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .iban && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          IBAN
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] font-mono text-text-primary">
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.iban
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "iban",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.iban || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "iban" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .account_name && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          Name
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] text-text-primary">
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.account_name
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "name",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.account_name || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "name" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .upi_id && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          UPI
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] font-mono text-text-primary">
                                            {
                                              activeOrder.lockedPaymentMethod
                                                .details.upi_id
                                            }
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "upi",
                                                activeOrder.lockedPaymentMethod!
                                                  .details.upi_id || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "upi" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {activeOrder.merchant.bank && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          Bank
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] text-text-primary">
                                            {activeOrder.merchant.bank}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "bank",
                                                activeOrder.merchant.bank || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "bank" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.merchant.iban && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          IBAN
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] font-mono text-text-primary">
                                            {activeOrder.merchant.iban}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "iban",
                                                activeOrder.merchant.iban || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "iban" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                    {activeOrder.merchant.accountName && (
                                      <div className="flex items-center justify-between">
                                        <span className="text-[13px] text-text-secondary">
                                          Name
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] text-text-primary">
                                            {activeOrder.merchant.accountName}
                                          </span>
                                          <button
                                            onClick={() =>
                                              copyField(
                                                "name",
                                                activeOrder.merchant
                                                  .accountName || "",
                                              )
                                            }
                                            className="p-0.5 rounded hover:bg-surface-active"
                                          >
                                            {copiedField === "name" ? (
                                              <Check className="w-3.5 h-3.5 text-success" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                            )}
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                                <div className="pt-2 border-t border-border-medium">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[13px] text-text-secondary">
                                      Amount
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[17px] font-semibold text-text-primary">
                                        {fiatSym(activeOrder.fiatCode)}{" "}
                                        {parseFloat(
                                          activeOrder.fiatAmount,
                                        ).toLocaleString()}
                                      </span>
                                      <button
                                        onClick={() =>
                                          copyField(
                                            "amount",
                                            parseFloat(
                                              activeOrder.fiatAmount,
                                            ).toString(),
                                          )
                                        }
                                        className="p-0.5 rounded hover:bg-surface-active"
                                      >
                                        {copiedField === "amount" ? (
                                          <Check className="w-3.5 h-3.5 text-success" />
                                        ) : (
                                          <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                        )}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className={`flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                                >
                                  <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                                  Chat
                                </button>
                                <motion.button
                                  whileTap={{ scale: 0.98 }}
                                  onClick={markPaymentSent}
                                  disabled={isLoading}
                                  className={`flex-[2] py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${PRIMARY_BTN}`}
                                >
                                  {isLoading
                                    ? "Processing..."
                                    : "I've sent the payment"}
                                </motion.button>
                              </div>
                            </>
                          )}
                        </div>
                      )}

                    {/* Sell order step 2 - merchant accepted with wallet signature, now user locks escrow */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "accepted" &&
                      !activeOrder.escrowTxHash && (
                        <div className="mt-3 space-y-3">
                          <div className={`rounded-xl p-4 ${CARD_STRONG}`}>
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                                <Lock className="w-5 h-5 text-text-primary" />
                              </div>
                              <div>
                                <p className="text-[15px] font-medium text-text-primary">
                                  Merchant Accepted - Lock Escrow
                                </p>
                                <p className="text-[12px] text-text-secondary">
                                  Merchant verified their wallet. Lock funds to
                                  proceed.
                                </p>
                              </div>
                            </div>
                            <p className="text-[12px] mb-3 text-text-tertiary">
                              The merchant has signed with their wallet (
                              {activeOrder.acceptorWalletAddress?.slice(0, 4)}
                              ...{activeOrder.acceptorWalletAddress?.slice(-4)}
                              ). Lock your{" "}
                              {parseFloat(activeOrder.cryptoAmount).toFixed(
                                2,
                              )}{" "}
                              USDT to the escrow. Funds will be released to this
                              wallet when you confirm payment received.
                            </p>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={async () => {
                                if (!solanaWallet.connected) {
                                  setShowWalletModal(true);
                                  return;
                                }
                                if (!solanaWallet.programReady) {
                                  showAlert(
                                    "Wallet Error",
                                    "Wallet not ready. Please reconnect your wallet.",
                                    "error",
                                  );
                                  return;
                                }
                                setIsLoading(true);
                                try {
                                  const merchantWallet =
                                    activeOrder.acceptorWalletAddress ||
                                    activeOrder.merchant.walletAddress;
                                  if (
                                    !merchantWallet ||
                                    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(
                                      merchantWallet,
                                    )
                                  ) {
                                    showAlert(
                                      "Wallet Error",
                                      "Merchant wallet not available. Please wait for merchant to accept the order with their wallet.",
                                      "warning",
                                    );
                                    setIsLoading(false);
                                    return;
                                  }
                                  const escrowResult =
                                    await solanaWallet.depositToEscrow({
                                      amount: parseFloat(
                                        activeOrder.cryptoAmount,
                                      ),
                                      merchantWallet,
                                    });
                                  if (escrowResult.success) {
                                    await fetchWithAuth(
                                      `/api/orders/${activeOrder.id}/escrow`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                        },
                                        body: JSON.stringify({
                                          tx_hash: escrowResult.txHash,
                                          actor_type: "user",
                                          actor_id: userId,
                                          escrow_address:
                                            solanaWallet.walletAddress,
                                          escrow_trade_id: escrowResult.tradeId,
                                          escrow_trade_pda:
                                            escrowResult.tradePda,
                                          escrow_pda: escrowResult.escrowPda,
                                          escrow_creator_wallet:
                                            solanaWallet.walletAddress,
                                        }),
                                      },
                                    );
                                    setOrders((prev) =>
                                      prev.map((o) =>
                                        o.id === activeOrder.id
                                          ? {
                                              ...o,
                                              dbStatus: "escrowed",
                                              escrowTxHash: escrowResult.txHash,
                                            }
                                          : o,
                                      ),
                                    );
                                    playSound("trade_complete");
                                  }
                                } catch (err: any) {
                                  console.error("Escrow failed:", err);
                                  showAlert(
                                    "Escrow Failed",
                                    err?.message ||
                                      "Failed to lock escrow. Please try again.",
                                    "error",
                                  );
                                  playSound("error");
                                } finally {
                                  setIsLoading(false);
                                }
                              }}
                              disabled={
                                isLoading ||
                                (solanaWallet.connected &&
                                  !solanaWallet.programReady)
                              }
                              className={`w-full py-3 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${PRIMARY_BTN}`}
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                  Locking...
                                </>
                              ) : !solanaWallet.connected ? (
                                <>
                                  <Wallet className="w-5 h-5" />
                                  Connect Wallet to Lock
                                </>
                              ) : !solanaWallet.programReady ? (
                                "Wallet Not Ready"
                              ) : (
                                <>
                                  <Lock className="w-5 h-5" />
                                  Lock{" "}
                                  {parseFloat(activeOrder.cryptoAmount).toFixed(
                                    2,
                                  )}{" "}
                                  USDT to Escrow
                                </>
                              )}
                            </motion.button>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {/* Sell order step 2 - escrow IS locked, waiting for payment */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      (activeOrder.dbStatus === "escrowed" ||
                        activeOrder.escrowTxHash) && (
                        <div className="mt-2">
                          <p className="text-[13px] text-text-secondary">
                            Your USDT is locked in escrow. Waiting for merchant
                            to send {activeOrder.fiatCode || 'AED'} payment...
                          </p>

                          <div className={`mt-3 rounded-xl p-3 ${CARD}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[12px] text-text-secondary">
                                Expected payment
                              </span>
                              <span className="text-[15px] font-semibold text-text-primary">
                                {fiatSym(activeOrder.fiatCode)}{" "}
                                {parseFloat(
                                  activeOrder.fiatAmount,
                                ).toLocaleString()}
                              </span>
                            </div>
                            {activeOrder.lockedPaymentMethod ? (
                              <div className="pt-2 space-y-1.5 border-t border-border-medium">
                                <div className="flex items-center gap-1.5">
                                  <Lock className="w-3 h-3 text-warning" />
                                  <span className="text-[11px] text-warning font-semibold uppercase tracking-wide">
                                    Locked Payment Method
                                  </span>
                                </div>
                                <p className="text-[13px] font-medium text-text-primary">
                                  {activeOrder.lockedPaymentMethod.label}
                                </p>
                                {activeOrder.lockedPaymentMethod.type ===
                                  "bank" && (
                                  <div className="space-y-1 text-[12px]">
                                    {activeOrder.lockedPaymentMethod.details
                                      .bank_name && (
                                      <p className="text-text-secondary">
                                        {
                                          activeOrder.lockedPaymentMethod
                                            .details.bank_name
                                        }
                                      </p>
                                    )}
                                    {activeOrder.lockedPaymentMethod.details
                                      .iban && (
                                      <p className="font-mono text-text-secondary">
                                        {
                                          activeOrder.lockedPaymentMethod
                                            .details.iban
                                        }
                                      </p>
                                    )}
                                  </div>
                                )}
                                {activeOrder.lockedPaymentMethod.type ===
                                  "upi" &&
                                  activeOrder.lockedPaymentMethod.details
                                    .upi_id && (
                                    <p className="text-[12px] font-mono text-text-secondary">
                                      {
                                        activeOrder.lockedPaymentMethod.details
                                          .upi_id
                                      }
                                    </p>
                                  )}
                                <p className="text-[10px] text-text-tertiary">
                                  Merchant will send payment to this method
                                </p>
                              </div>
                            ) : (
                              <p className="text-[11px] text-text-tertiary">
                                Merchant will send this amount to your bank
                                account
                              </p>
                            )}
                          </div>

                          <div className="mt-3 h-1 rounded-full overflow-hidden bg-surface-active">
                            <motion.div
                              className="h-full bg-warning"
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                              style={{ width: "30%" }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Merchant
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className={`p-4 rounded-2xl ${CARD}`}>
                <div className="flex items-start gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0 ${
                      activeOrder.step >= 3
                        ? "bg-accent text-accent-text"
                        : "bg-surface-card text-text-tertiary"
                    }`}
                  >
                    {activeOrder.step > 3 ? <Check className="w-4 h-4" /> : "3"}
                  </div>
                  <div className="flex-1">
                    <p
                      className={`text-[15px] font-medium ${
                        activeOrder.step >= 3
                          ? "text-text-primary"
                          : "text-text-tertiary"
                      }`}
                    >
                      {activeOrder.dbStatus === "disputed"
                        ? "Dispute"
                        : activeOrder.type === "buy"
                          ? "Confirming payment"
                          : "Confirm received"}
                    </p>

                    {activeOrder.step === 3 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus === "disputed" && (
                        <div className="mt-2">
                          <p className="text-[13px] text-text-secondary">
                            This order is under dispute. Our team is reviewing
                            the case.
                          </p>
                          <button
                            onClick={handleOpenChat}
                            className={`mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Seller
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus !== "disputed" && (
                        <div className="mt-2">
                          <p className="text-[13px] text-text-secondary">
                            Seller is verifying your payment...
                          </p>
                          <div className="mt-2 h-1 rounded-full overflow-hidden bg-surface-active">
                            <motion.div
                              className="h-full bg-text-tertiary"
                              style={{ width: "30%" }}
                              animate={{ x: ["-100%", "100%"] }}
                              transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: "linear",
                              }}
                            />
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Seller
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "disputed" && (
                        <div className="mt-2">
                          <p className="text-[13px] text-text-secondary">
                            This order is under dispute. Our team is reviewing
                            the case.
                          </p>
                          <button
                            onClick={handleOpenChat}
                            className={`mt-3 w-full py-2.5 rounded-xl text-[14px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message Merchant
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus !== "disputed" && (
                        <div className="mt-3">
                          <div className={`rounded-xl p-3 mb-3 ${CARD_STRONG}`}>
                            <p className="text-[13px] text-text-primary">
                              Merchant has sent {fiatSym(activeOrder.fiatCode)}{" "}
                              {parseFloat(
                                activeOrder.fiatAmount,
                              ).toLocaleString()}{" "}
                              to your bank.
                            </p>
                            <p className="text-[12px] mt-1 text-text-secondary">
                              Check your bank account before confirming.
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleOpenChat}
                              className={`flex-1 py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                            >
                              <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                              Chat
                            </button>
                            <motion.button
                              whileTap={{ scale: 0.98 }}
                              onClick={confirmFiatReceived}
                              disabled={isLoading}
                              className={`flex-[2] py-3 rounded-xl text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${PRIMARY_BTN}`}
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Releasing...
                                </>
                              ) : (
                                <>
                                  <Check className="w-4 h-4" />
                                  Confirm & Release
                                </>
                              )}
                            </motion.button>
                          </div>
                          <p className="text-[11px] mt-2 text-center text-text-tertiary">
                            This will sign a wallet transaction to release
                            escrow to merchant
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 4 */}
              <div className={`p-4 rounded-2xl ${CARD}`}>
                <div className="flex items-center gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-semibold ${
                      activeOrder.step >= 4
                        ? "bg-accent text-accent-text"
                        : "bg-surface-card text-text-tertiary"
                    }`}
                  >
                    {activeOrder.step >= 4 ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      "4"
                    )}
                  </div>
                  <div>
                    <p
                      className={`text-[15px] font-medium ${
                        activeOrder.step >= 4
                          ? "text-text-primary"
                          : "text-text-tertiary"
                      }`}
                    >
                      Complete
                    </p>
                    {activeOrder.status === "complete" &&
                      activeOrder.step >= 4 && (
                        <p className="text-[13px] text-text-secondary">
                          Trade completed successfully
                        </p>
                      )}
                  </div>
                </div>
              </div>

              {/* Rating - only for completed orders */}
              {activeOrder.status === "complete" && activeOrder.step >= 4 && (() => {
                const alreadyRated = !!(activeOrder.userRating);
                const displayRating = alreadyRated ? activeOrder.userRating! : rating;
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl p-4 text-center ${CARD}`}
                  >
                    <p className="text-[15px] mb-3 text-text-secondary">
                      {alreadyRated ? "Your rating" : "Rate your experience"}
                    </p>
                    <div className="flex justify-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          disabled={alreadyRated}
                          onClick={() => {
                            if (alreadyRated) return;
                            setRating(star);
                          }}
                        >
                          <Star
                            className={`w-8 h-8 ${
                              star <= displayRating
                                ? "fill-warning text-warning"
                                : "text-text-quaternary"
                            } ${alreadyRated ? "opacity-80" : ""}`}
                          />
                        </button>
                      ))}
                    </div>
                    {/* Expandable review text + submit — shows after selecting stars */}
                    <AnimatePresence>
                      {!alreadyRated && rating > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <textarea
                            placeholder="Write a short review (optional)..."
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            maxLength={200}
                            className="w-full mt-3 p-3 rounded-xl text-[13px] text-text-primary bg-surface-active border border-border-medium resize-none outline-none placeholder:text-text-quaternary"
                            rows={2}
                          />
                          <button
                            onClick={async () => {
                              await submitReview?.(activeOrder.id, rating, reviewText || undefined);
                              setReviewText("");
                              setRating(0);
                            }}
                            className="w-full mt-2 py-2.5 rounded-xl text-[14px] font-semibold bg-accent text-accent-text"
                          >
                            Submit Review
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    {alreadyRated && (
                      <p className="text-[12px] text-text-quaternary mt-2">
                        You rated this trade {activeOrder.userRating} star{activeOrder.userRating !== 1 ? "s" : ""}
                      </p>
                    )}
                  </motion.div>
                );
              })()}
            </div>
          )}

        {/* Merchant */}
        <div className={`mt-4 rounded-2xl p-4 ${CARD}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold bg-accent text-accent-text">
                {(activeOrder.merchant.name || 'M').charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-text-primary">
                    {activeOrder.merchant.name || 'Waiting for merchant...'}
                  </p>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-active text-text-secondary">
                    {activeOrder.merchant.paymentMethod === "cash"
                      ? "Cash"
                      : "Bank"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="w-3 h-3 fill-warning text-warning" />
                  <span className="text-[13px] text-text-secondary">
                    {activeOrder.merchant.rating} {"\u00b7"}{" "}
                    {activeOrder.merchant.trades} trades
                  </span>
                </div>
              </div>
            </div>
            <button
              onClick={handleOpenChat}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active"
            >
              <MessageCircle className="w-5 h-5 text-text-secondary" /><ChatBadge count={activeOrder?.unreadCount} />
            </button>
          </div>
        </div>

        {/* Cancel & Dispute Buttons - Show for active orders (step 2-3) */}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          activeOrder.status !== "disputed" &&
          !activeOrder.cancelRequest && (
            <button
              onClick={() => requestCancelOrder()}
              disabled={isRequestingCancel}
              className={`w-full mt-3 py-3 rounded-2xl text-[14px] font-medium flex items-center justify-center gap-2 disabled:opacity-50 text-warning ${AMBER_CARD}`}
            >
              {isRequestingCancel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              Request Cancellation
            </button>
          )}
        {activeOrder.step >= 2 &&
          activeOrder.step < 4 &&
          activeOrder.status !== "disputed" && (
            <button
              onClick={() => setShowDisputeModal(true)}
              className={`w-full mt-3 py-3 rounded-2xl text-[14px] font-medium flex items-center justify-center gap-2 text-error ${RED_CARD}`}
            >
              <AlertTriangle className="w-4 h-4" />
              Report Issue
            </button>
          )}

        {/* Already Disputed */}
        {activeOrder.status === "disputed" && (
          <div className={`mt-3 py-3 px-4 rounded-2xl ${RED_CARD}`}>
            <div className="flex items-center gap-2 text-error">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-[14px] font-medium">
                Dispute in Progress
              </span>
            </div>
            <p className="text-[12px] mt-1 text-error">
              Our team is reviewing this case.
            </p>
          </div>
        )}

        {(activeOrder.step >= 4 ||
          activeOrder.status === "cancelled" ||
          activeOrder.status === "expired") && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setScreen("home")}
            className="w-full mt-4 py-4 rounded-2xl text-[17px] font-semibold bg-surface-raised border border-border-medium text-text-primary"
          >
            Done
          </motion.button>
        )}
      </div>

      {/* Dispute Modal */}
      <AnimatePresence>
        {showDisputeModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50"
              onClick={() => setShowDisputeModal(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 350, mass: 0.8 }}
              className={`fixed bottom-0  left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl p-6 ${SHEET_BG}`}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-error" />
                  <h3 className="text-[17px] font-semibold text-text-primary">
                    Report Issue
                  </h3>
                </div>
                <button onClick={() => setShowDisputeModal(false)}>
                  <X className="w-5 h-5 text-text-tertiary" />
                </button>
              </div>

              <p className="text-[13px] mb-4 text-text-secondary">
                If you&apos;re having a problem with this trade, let us know and
                our support team will help resolve it.
              </p>

              <div className="mb-4">
                <label className="text-[12px] uppercase tracking-wide mb-2 block text-text-tertiary">
                  Reason
                </label>
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  className="w-full rounded-xl px-4 py-3 text-[15px] outline-none appearance-none bg-surface-raised text-text-primary border border-border-medium"
                >
                  <option value="">Select a reason...</option>
                  <option value="payment_not_received">
                    Payment not received
                  </option>
                  <option value="crypto_not_received">
                    Crypto not received
                  </option>
                  <option value="wrong_amount">Wrong amount sent</option>
                  <option value="fraud">Suspected fraud</option>
                  <option value="other">Other issue</option>
                </select>
              </div>

              <div className="mb-6">
                <label className="text-[12px] uppercase tracking-wide mb-2 block text-text-tertiary">
                  Description
                </label>
                <textarea
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  placeholder="Describe the issue in detail..."
                  rows={3}
                  className="w-full rounded-xl px-4 py-3 text-[15px] outline-none resize-none bg-surface-raised text-text-primary border border-border-medium"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDisputeModal(false)}
                  className={`flex-1 py-3 rounded-xl text-[15px] font-medium ${MUTED_BTN}`}
                >
                  Cancel
                </button>
                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={submitDispute}
                  disabled={!disputeReason || isSubmittingDispute}
                  className="flex-[2] py-3 rounded-xl text-[15px] font-semibold disabled:opacity-50 flex items-center justify-center gap-2 bg-error text-text-primary"
                >
                  {isSubmittingDispute ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <AlertTriangle className="w-4 h-4" />
                  )}
                  {isSubmittingDispute ? "Submitting..." : "Submit Dispute"}
                </motion.button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Chat */}
      <AnimatePresence>
        {showChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-40"
              onClick={() => setShowChat(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 350, mass: 0.8 }}
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl h-[70vh] flex flex-col ${SHEET_BG}`}
            >
              <div className="flex items-center justify-between p-4 border-b border-border-medium">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-[14px] bg-accent/20 border border-accent/30 text-accent overflow-hidden shrink-0">
                    {activeOrder.merchant.avatarUrl ? (
                      <img src={activeOrder.merchant.avatarUrl} alt={activeOrder.merchant.name} className="w-full h-full object-cover" />
                    ) : (
                      (activeOrder.merchant.name || 'M').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <p className="text-[15px] font-medium text-text-primary">
                      {activeOrder.merchant.name}
                    </p>
                    <div className="flex items-center gap-1.5">
                      {activeChat?.isTyping ? (
                        <p className="text-[11px] text-success font-medium">typing...</p>
                      ) : (
                        <>
                          <ConnectionIndicator isConnected={activeOrder.merchant.isOnline ?? true} />
                          <p className="text-[11px] text-success">
                            {activeOrder.merchant.isOnline !== false ? 'Online' : 'Offline'}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setShowChat(false)} className="p-2">
                  <X className="w-5 h-5 text-text-tertiary" />
                </button>
              </div>
              <div
                ref={chatMessagesRef}
                className="flex-1 overflow-y-auto p-4 space-y-3"
              >
                {activeChat && activeChat.messages.length > 0 ? (
                  activeChat.messages.map((msg) => {
                    // Parse dispute/resolution messages from JSON content
                    if (msg.messageType === "dispute") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className={`w-full max-w-[90%] rounded-2xl p-4 ${RED_CARD}`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <AlertTriangle className="w-4 h-4 text-error" />
                                <span className="text-[13px] font-semibold text-error">
                                  Dispute Opened
                                </span>
                              </div>
                              <p className="text-[14px] mb-1 text-text-primary">
                                <span className="text-text-tertiary">
                                  Reason:
                                </span>{" "}
                                {data.reason?.replace(/_/g, " ")}
                              </p>
                              {data.description && (
                                <p className="text-[13px] text-text-secondary">
                                  {data.description}
                                </p>
                              )}
                              <p className="text-[11px] mt-2 text-text-tertiary">
                                Our support team will review this case
                              </p>
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message if parsing fails
                      }
                    }

                    if (msg.messageType === "resolution") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className={`w-full max-w-[90%] rounded-2xl p-4 ${CARD_STRONG}`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Shield className="w-4 h-4 text-text-secondary" />
                                <span className="text-[13px] font-semibold text-text-secondary">
                                  {data.type === "resolution_proposed"
                                    ? "Resolution Proposed"
                                    : "Resolution Finalized"}
                                </span>
                              </div>
                              <p className="text-[14px] mb-1 text-text-primary">
                                <span className="text-text-tertiary">
                                  Decision:
                                </span>{" "}
                                {data.resolution?.replace(/_/g, " ")}
                              </p>
                              {data.notes && (
                                <p className="text-[13px] mb-2 text-text-secondary">
                                  {data.notes}
                                </p>
                              )}
                              {data.type === "resolution_proposed" &&
                                !disputeInfo?.user_confirmed && (
                                  <div className="flex gap-2 mt-3">
                                    <button
                                      onClick={() =>
                                        respondToResolution("reject")
                                      }
                                      disabled={isRespondingToResolution}
                                      className={`flex-1 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50 ${MUTED_BTN}`}
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() =>
                                        respondToResolution("accept")
                                      }
                                      disabled={isRespondingToResolution}
                                      className="flex-1 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-50 bg-accent text-accent-text"
                                    >
                                      Accept
                                    </button>
                                  </div>
                                )}
                              {disputeInfo?.user_confirmed &&
                                !disputeInfo?.merchant_confirmed && (
                                  <p className="text-[11px] mt-2 text-text-secondary">
                                    You accepted. Waiting for merchant
                                    confirmation...
                                  </p>
                                )}
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message if parsing fails
                      }
                    }

                    // Resolution finalized message
                    if (msg.messageType === "resolution_finalized") {
                      try {
                        const data = JSON.parse(msg.text);
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className={`w-full max-w-[90%] rounded-2xl p-4 ${CARD_STRONG}`}
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <Check className="w-4 h-4 text-text-primary" />
                                <span className="text-[13px] font-semibold text-text-primary">
                                  Resolution Finalized
                                </span>
                              </div>
                              <p className="text-[14px] text-text-primary">
                                Decision: {data.resolution?.replace(/_/g, " ")}
                              </p>
                              <p className="text-[11px] mt-2 text-text-tertiary">
                                Both parties confirmed. Case closed.
                              </p>
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message
                      }
                    }

                    // Resolution accepted/rejected system messages
                    if (
                      msg.messageType === "resolution_accepted" ||
                      msg.messageType === "resolution_rejected"
                    ) {
                      try {
                        const data = JSON.parse(msg.text);
                        const isAccepted = data.type === "resolution_accepted";
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div
                              className={`px-4 py-2 rounded-2xl text-[13px] ${
                                isAccepted
                                  ? "bg-surface-active text-text-secondary"
                                  : "bg-error-dim text-error"
                              }`}
                            >
                              {data.party === "user" ? "You" : "Merchant"}{" "}
                              {isAccepted ? "accepted" : "rejected"} the
                              resolution
                            </div>
                          </div>
                        );
                      } catch {
                        // Fall back to regular message
                      }
                    }

                    // Receipt card messages — structured (new) or JSON fallback (old)
                    {
                      let receiptPayload: Record<string, unknown> | null = null;
                      if (msg.messageType === "receipt" && msg.receiptData) {
                        receiptPayload = msg.receiptData;
                      } else {
                        try {
                          if (msg.text.startsWith("{")) {
                            const parsed = JSON.parse(msg.text);
                            if (
                              parsed.type === "order_receipt" &&
                              parsed.data
                            ) {
                              receiptPayload = parsed.data;
                            }
                          }
                        } catch {
                          /* not JSON */
                        }
                      }
                      if (receiptPayload) {
                        return (
                          <div key={msg.id} className="max-w-[90%] mx-auto">
                            <ReceiptCard
                              data={receiptPayload as any}
                              currentStatus={
                                activeOrder?.dbStatus || activeOrder?.status
                              }
                            />
                            <p className="text-[10px] mt-1 text-center text-text-tertiary">
                              {msg.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        );
                      }
                    }

                    // Regular messages
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${msg.from === "me" ? "justify-end" : msg.from === "system" ? "justify-center" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[80%] flex flex-col ${msg.from === "me" ? "items-end" : "items-start"}`}
                        >
                          {msg.from !== "me" &&
                            msg.from !== "system" &&
                            msg.senderName && (
                              <span className="text-[11px] mb-0.5 px-1 text-text-tertiary">
                                {msg.senderName}
                              </span>
                            )}
                          <div
                            className={`px-4 py-2 rounded-2xl ${
                              msg.from === "me"
                                ? "bg-accent text-accent-text text-[15px]"
                                : msg.from === "system"
                                  ? "bg-surface-active text-text-secondary text-[13px]"
                                  : "bg-surface-card text-text-primary text-[15px]"
                            }`}
                          >
                            {msg.messageType === "image" && msg.imageUrl && (
                              <a
                                href={msg.imageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <img
                                  src={msg.imageUrl}
                                  alt="Shared image"
                                  className="max-w-full max-h-48 rounded-xl mb-1 object-contain"
                                  loading="lazy"
                                />
                              </a>
                            )}
                            {msg.text !== "Photo" && <span>{msg.text}</span>}
                            {/* Timestamp + delivery status ticks */}
                            <div className={`flex items-center gap-1 mt-1 ${msg.from === "me" ? "justify-end" : ""}`}>
                              <span className={`text-[10px] ${msg.from === "me" ? "text-accent-text/60" : "text-text-tertiary"}`}>
                                {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                              {msg.from === "me" && (
                                msg.status === "sending" ? (
                                  <Clock className="w-3 h-3 text-text-tertiary" />
                                ) : msg.status === "read" || msg.isRead ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-info" />
                                ) : msg.status === "delivered" ? (
                                  <CheckCheck className="w-3.5 h-3.5 text-accent-text/60" />
                                ) : (
                                  <Check className="w-3 h-3 text-accent-text/60" />
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 flex items-center justify-center h-full">
                    <p className="text-[15px] text-text-tertiary">
                      No messages yet
                    </p>
                  </div>
                )}

                {/* Pending image upload bubbles — optimistic UI */}
                {pendingUploads.size > 0 && (
                  Array.from(pendingUploads.values())
                  .sort((a, b) => a.createdAt - b.createdAt)
                  .map((upload) => (
                    <div key={upload.tempId} className="flex justify-end">
                      <div className="max-w-[80%] px-4 py-2 rounded-2xl bg-accent text-accent-text">
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

                {/* Show pending resolution if dispute exists and has a proposal */}
                {disputeInfo?.status === "pending_confirmation" &&
                  disputeInfo.proposed_resolution &&
                  !activeChat?.messages.some(
                    (m) => m.messageType === "resolution",
                  ) && (
                    <div className="flex justify-center">
                      <div
                        className={`w-full max-w-[90%] rounded-2xl p-4 ${CARD}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Shield className="w-4 h-4 text-text-secondary" />
                          <span className="text-[13px] font-semibold text-text-secondary">
                            Resolution Proposed
                          </span>
                        </div>
                        <p className="text-[14px] mb-1 text-text-primary">
                          <span className="text-text-tertiary">Decision:</span>{" "}
                          {disputeInfo.proposed_resolution.replace(/_/g, " ")}
                        </p>
                        {disputeInfo.resolution_notes && (
                          <p className="text-[13px] mb-2 text-text-secondary">
                            {disputeInfo.resolution_notes}
                          </p>
                        )}
                        {!disputeInfo.user_confirmed && (
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => respondToResolution("reject")}
                              disabled={isRespondingToResolution}
                              className={`flex-1 py-2 rounded-xl text-[13px] font-medium disabled:opacity-50 ${MUTED_BTN}`}
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => respondToResolution("accept")}
                              disabled={isRespondingToResolution}
                              className="flex-1 py-2 rounded-xl text-[13px] font-semibold disabled:opacity-50 bg-accent text-accent-text"
                            >
                              Accept
                            </button>
                          </div>
                        )}
                        {disputeInfo.user_confirmed &&
                          !disputeInfo.merchant_confirmed && (
                            <p className="text-[11px] mt-2 text-text-secondary">
                              You accepted. Waiting for merchant confirmation...
                            </p>
                          )}
                      </div>
                    </div>
                  )}
              </div>
              {/* Typing indicator moved to header — dynamic online ↔ typing */}

              {/* Emoji picker */}
              {showEmojiPicker && (
                <div className="absolute bottom-24 left-4 right-4 z-50">
                  <EmojiPicker
                    onEmojiClick={(emojiData: { emoji: string }) => {
                      setChatMessage(chatMessage + emojiData.emoji);
                      setShowEmojiPicker(false);
                      chatInputRef.current?.focus();
                    }}
                    width="100%"
                    height={350}
                    theme={"dark" as any}
                    searchDisabled
                    skinTonesDisabled
                    previewConfig={{ showPreview: false }}
                  />
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Image preview bar */}
              {pendingImage && (
                <div className="px-4 py-2 flex items-center gap-3 border-t border-border-medium">
                  <div className="relative">
                    <img
                      src={pendingImage.previewUrl}
                      alt="Preview"
                      className="w-16 h-16 rounded-xl object-cover border border-border-medium"
                    />
                    <button
                      onClick={clearPendingImage}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center bg-text-tertiary"
                    >
                      <X className="w-3 h-3 text-text-primary" />
                    </button>
                  </div>
                  <span className="text-[13px] flex-1 text-text-secondary">
                    Image ready to send
                  </span>
                </div>
              )}

              <div className="p-4 pb-8 border-t border-border-medium">
                <div className="flex items-center gap-2">
                  {/* Emoji button */}
                  <button
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised"
                  >
                    <span className="text-lg">😊</span>
                  </button>
                  {/* Image attach button */}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 bg-surface-raised"
                  >
                    {isUploading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-text-tertiary" />
                    )}
                  </button>
                  <input
                    ref={chatInputRef}
                    value={chatMessage}
                    onChange={(e) => handleTypingChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        if (pendingImage) {
                          handleImageConfirm();
                        } else {
                          handleSendMessage();
                        }
                        setShowEmojiPicker(false);
                      }
                    }}
                    placeholder={
                      pendingImage ? "Add a caption..." : "Message..."
                    }
                    className="flex-1 rounded-xl px-4 py-3 text-[15px] outline-none bg-surface-raised text-text-primary"
                  />
                  <button
                    onClick={() => {
                      if (pendingImage) {
                        handleImageConfirm();
                      } else {
                        handleSendMessage();
                      }
                      setShowEmojiPicker(false);
                    }}
                    disabled={!chatMessage.trim() && !pendingImage}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-50 ${
                      pendingImage ? "bg-warning" : "bg-accent"
                    }`}
                  >
                    {isUploading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-accent-text" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-accent-text" />
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
