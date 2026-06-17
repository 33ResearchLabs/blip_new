"use client";

import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ReceiptText,
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
  HelpCircle,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
  Shield,
  Wallet,
  Paperclip,
  Receipt,
  Flag,
} from "lucide-react";
import { ConnectionIndicator } from "@/components/NotificationToast";
import { ReceiptCard } from "@/components/chat/cards/ReceiptCard";
import { ImageMessageBubble, type ImageUploadStatus } from "@/components/chat/ImageMessageBubble";
import { compressImage } from "@/lib/utils/compressImage";
import { explorerUrl } from "@/lib/solana/networkLabel";
import type { Screen, Order, MerchantPaymentMethod } from "./types";
import { ProfileSheet } from "@/components/shared/profile/ProfileSheet";
import { OrderTrackingView } from "./OrderTrackingView";
import { MatchingScreen } from "./MatchingScreen";
import { OrderOverviewScreen } from "./OrderOverviewScreen";
import { OrderPaymentScreen } from "./OrderPaymentScreen";
import { OrderCompletedScreen } from "./OrderCompletedScreen";
import { AppealScreen } from "./AppealScreen";
import { getDisplayOrderId } from "@/lib/displayOrderId";
import {
  type RefObject,
  useState as useLocalState,
  useRef as useLocalRef,
  useCallback as useLocalCallback,
  useEffect as useLocalEffect,
  useMemo as useLocalMemo,
} from "react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import dynamic from "next/dynamic";
import { showAlert } from "@/context/ModalContext";
import { formatCrypto, formatFiat, formatRate } from "@/lib/format";
import { useGlobalNow } from "@/hooks/useGlobalNow";
import { OrderProgressStepper } from "@/components/user/OrderProgressStepper";
import { OrderMinimisedPill } from "@/components/user/OrderMinimisedPill";
import { ScratchRewardModal } from "@/components/user/ScratchRewardModal";
import { EscrowFlowStepper } from "@/components/shared/trade/EscrowFlowStepper";
import { TradeTrustPanel } from "@/components/shared/trade/TradeTrustPanel";
import { useCounterpartyProfile } from "@/components/shared/trade/useCounterpartyProfile";
import { SURFACES } from "@/components/shared/limits/types";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

// Resolve the merchant's receiving payment-method rows (account name, IBAN /
// UPI, …) for the itemised Order Overview. Same source precedence as the
// payment screen: merchantPaymentMethod → lockedPaymentMethod → raw merchant
// fields. The caller only passes these once escrow is locked, since that's
// when the buyer is allowed to see them.
function deriveOverviewPaymentRows(
  order: Order,
): { label: string; value: string; mono?: boolean }[] {
  const rows: { label: string; value: string; mono?: boolean }[] = [];
  const mpm = order.merchantPaymentMethod;
  const lpm = order.lockedPaymentMethod;
  if (mpm) {
    const isUpi =
      (mpm.type || "").toLowerCase() === "upi" ||
      (typeof mpm.details === "string" && mpm.details.includes("@"));
    rows.push({ label: isUpi ? "UPI Name" : "Account Name", value: mpm.name || "—" });
    rows.push({ label: isUpi ? "UPI ID" : "Account No. / IBAN", value: mpm.details || "—", mono: true });
  } else if (lpm) {
    const d = lpm.details || {};
    if (d.bank_name) rows.push({ label: "Bank Name", value: d.bank_name });
    if (d.account_name) rows.push({ label: "Account Name", value: d.account_name });
    if (d.iban) rows.push({ label: "IBAN / Account No.", value: d.iban, mono: true });
    if (d.upi_id) rows.push({ label: "UPI ID", value: d.upi_id, mono: true });
  } else {
    if (order.merchant.bank) rows.push({ label: "Bank Name", value: order.merchant.bank });
    if (order.merchant.accountName) rows.push({ label: "Account Name", value: order.merchant.accountName });
    if (order.merchant.iban) rows.push({ label: "IBAN / Account No.", value: order.merchant.iban, mono: true });
  }
  return rows;
}

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
    <span className="ml-1 text-[11px] font-semibold leading-none tabular-nums">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** One label/value line in the order receipt sheet. Value is right-aligned and
 *  may be an interactive node (copy button / explorer link). */
function ReceiptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-[13px] text-text-tertiary shrink-0">{label}</span>
      <span className="text-[13px] font-medium text-text-primary text-right">
        {children}
      </span>
    </div>
  );
}

/** Compact label/value fact for the inline order breakdown on the summary card. */
function SummaryFact({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className="text-[14px] font-semibold text-text-primary truncate">{value}</p>
    </div>
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
  // Shared 1-sec tick — was previously a per-instance setInterval that caused
  // N timers + N re-renders/sec when N orders were on screen.
  const now = useGlobalNow();

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
  // Appeal (lightweight chat message to the counterparty — not a dispute)
  showAppeal: boolean;
  setShowAppeal: (v: boolean) => void;
  appealReason: string;
  setAppealReason: (r: string) => void;
  appealDescription: string;
  setAppealDescription: (d: string) => void;
  submitAppeal: () => void;
  isSubmittingAppeal: boolean;
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
  cancelOrderDirect: (reason?: string) => void;
  respondToCancelRequest: (accept: boolean) => void;
  isRequestingCancel: boolean;
  // Stuck on-chain refund recovery
  claimRefund: () => void;
  isClaimingRefund: boolean;
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
  // Re-fetch the active order (full relations) — used after the buyer picks a
  // merchant pay-into account so the realtime copy reflects the new selection.
  refetchActiveOrder?: () => Promise<void> | void;
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
  showAppeal,
  setShowAppeal,
  appealReason,
  setAppealReason,
  appealDescription,
  setAppealDescription,
  submitAppeal,
  isSubmittingAppeal,
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
  cancelOrderDirect,
  respondToCancelRequest,
  isRequestingCancel,
  claimRefund,
  isClaimingRefund,
  solanaWallet,
  setShowWalletModal,
  userId,
  setOrders,
  refetchActiveOrder,
  playSound,
  maxW,
}: OrderDetailScreenProps) => {
  // Suppress unused-param lint: `copied` is part of the prop API but not rendered here.
  void copied;
  const [showEmojiPicker, setShowEmojiPicker] = useLocalState(false);
  const [showProfile, setShowProfile] = useLocalState(false);
  const [isUploading, setIsUploading] = useLocalState(false);
  const [copiedField, setCopiedField] = useLocalState<string | null>(null);
  const [reviewText, setReviewText] = useLocalState("");
  // Order receipt sheet — opened by tapping the summary card.
  const [showReceipt, setShowReceipt] = useLocalState(false);
  const [showTracker, setShowTracker] = useLocalState(false);
  // Chat popup: collapse the order-details (receipt) card by default so the
  // message area gets the full height. Toggled from the chat header.
  const [showOrderDetails, setShowOrderDetails] = useLocalState(false);

  // Pull the order receipt out of the chat stream so the header toggle can
  // render it on demand. Mirrors the inline receipt-message parsing below.
  const receiptForHeader = useLocalMemo<Record<string, unknown> | null>(() => {
    const msgs = activeChat?.messages;
    if (!msgs) return null;
    for (const msg of msgs) {
      if (msg.messageType === "receipt" && msg.receiptData) return msg.receiptData;
      if (msg.text?.startsWith("{")) {
        try {
          const parsed = JSON.parse(msg.text);
          if (parsed.type === "order_receipt" && parsed.data) return parsed.data;
        } catch {
          /* not JSON */
        }
      }
    }
    return null;
  }, [activeChat?.messages]);
  // For a BUY order still in the matching phase, show the rich tracking view as
  // the primary screen instead of the step-body "Order Details" screen.
  // Keyed off the MAPPED UI step (step 1 = matching) rather than the raw status
  // string, so it's robust to whatever exact dbStatus the order carries. It's
  // also DERIVED each render (not stored state) so it stays correct when this
  // panel is reused — the desktop keeps the order panel mounted across
  // navigations, which made a one-time useState initial go stale. Once a
  // merchant accepts (step ≥ 2) the payment screen renders and covers this.
  // SELL orders keep the step-body (it holds their lock-escrow / confirm
  // actions).
  // A buy order that's genuinely still matching shows the live MatchingScreen.
  // `cancelled` / `expired` also map to step 1 (see helpers mapDbStatusToUI),
  // so the status guard keeps them OFF the "Finding the best merchant" flow.
  const isMatching =
    String(activeOrder.type).toLowerCase() === "buy" &&
    activeOrder.step === 1 &&
    activeOrder.status === "pending";
  // Auto-open the full tracker for ANY buy order that began in the matching
  // flow — including a now-cancelled/expired one — so the SAME tracker screen
  // stays up and just updates its content (OrderTrackingView renders the
  // cancelled/expired banner) instead of jumping the user to a different layout.
  const autoTracker =
    String(activeOrder.type).toLowerCase() === "buy" && activeOrder.step === 1;
  // Live countdown for the matching screen rendered on the auto-tracker path.
  const nowMs = useGlobalNow();
  // Itemised order-overview overlay (the collapsible Order/Transaction/Payment
  // details view). Opened directly by the "Order Overview" cards on the
  // payment & completed screens — one tap, no tracker hop in between.
  const [showOrderOverview, setShowOrderOverview] = useLocalState(false);

  // Receipt timestamps. Dates only — locale fixed to en-US for consistency
  // with the @/lib/format number rules.
  const fmtDateTime = (d?: Date | null) =>
    d
      ? new Date(d).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

  // ── Consumer UX additions (Swiggy-style tracking) ─────────────────────
  // - `minimised` collapses the entire order body into a top pill
  //   ("Hide Details"); persisted per-order in sessionStorage so a refresh
  //   keeps the chosen state.
  // - `showScratchModal` auto-pops the scratch card on first land for any
  //   SELL/QR order that has an unrevealed, non-voided pending reward.
  //   Gated by sessionStorage key so it doesn't re-popup on refresh.
  const orderId = activeOrder.id;
  const isSellQR = activeOrder.type === "sell";
  const minimisedKey = `blip_order_${orderId}_minimised`;
  const scratchShownKey = `blip_scratch_shown_${orderId}`;
  const [minimised, setMinimised] = useLocalState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem(minimisedKey) === "1";
  });
  const [showScratchModal, setShowScratchModal] = useLocalState(false);
  const [pendingReward, setPendingReward] = useLocalState<{
    id: string;
    amount_usdt: number;
    reward_bps: number;
    claimable_at: string | null;
  } | null>(null);

  useLocalEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.setItem(minimisedKey, minimised ? "1" : "0");
  }, [minimised, minimisedKey]);

  // First-mount: if we just landed here from a fresh SELL/QR order and the
  // user hasn't been shown the scratch card yet for this order, pop it.
  useLocalEffect(() => {
    if (!isSellQR) return;
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(scratchShownKey) === "1") return;
    let cancelled = false;
    fetchWithAuth("/api/user/rewards")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const rows = (d?.data?.recent || []) as Array<{
          id: string;
          order_id: string;
          amount_usdt: string;
          reward_bps: number;
          revealed_at: string | null;
          claimable_at: string | null;
          voided_at: string | null;
        }>;
        const match = rows.find(
          (r) => r.order_id === orderId && !r.revealed_at && !r.voided_at,
        );
        if (match) {
          setPendingReward({
            id: match.id,
            amount_usdt: Number(match.amount_usdt),
            reward_bps: match.reward_bps,
            claimable_at: match.claimable_at,
          });
          setShowScratchModal(true);
          sessionStorage.setItem(scratchShownKey, "1");
        }
      })
      .catch(() => { /* non-fatal — modal just won't auto-popup */ });
    return () => { cancelled = true; };
  }, [isSellQR, orderId, scratchShownKey, setPendingReward, setShowScratchModal]);

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
  // ── Part 4: buyer picks which of the merchant's matching accounts to pay ──
  // After a merchant accepts a broadcast buy order, the order carries the
  // merchant's accounts whose type matches the buyer's chosen rails. The buyer
  // taps one; we persist it (merchant_payment_method_id) and reflect the pick
  // locally so the existing "where to pay" details render.
  const matchingPayMethods = activeOrder.merchantMatchingPaymentMethods ?? [];
  const needsPayMethodPick =
    activeOrder.type === "buy" &&
    !activeOrder.merchantPaymentMethod &&
    matchingPayMethods.length > 0;
  const handleChoosePayMethod = useLocalCallback(
    async (method: MerchantPaymentMethod) => {
      if (isLoading) return;
      setIsLoading(true);
      try {
        const res = await fetchWithAuth(
          `/api/orders/${activeOrder.id}/pay-method`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method_id: method.id }),
          },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          showAlert("Couldn't select", data?.error || "Please try again.", "error");
          playSound("error");
          return;
        }
        // Optimistic for the list copy, then refetch so the realtime copy
        // (which wins in the activeOrder merge) reflects the persisted choice.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === activeOrder.id ? { ...o, merchantPaymentMethod: method } : o,
          ),
        );
        await refetchActiveOrder?.();
        playSound("click");
      } catch {
        showAlert("Couldn't select", "Please try again.", "error");
        playSound("error");
      } finally {
        setIsLoading(false);
      }
    },
    [activeOrder.id, isLoading, setIsLoading, setOrders, refetchActiveOrder, playSound],
  );

  // Surface tokens for the user app scope (drives the shared trade components).
  const surfaces = SURFACES.user;
  // Seller (merchant) trust shown on the buyer's "escrow locked / pay now"
  // step. Read-only profile fetch, gated to the escrowed BUY state so we don't
  // fetch on unrelated screens. Renders nothing if unavailable (graceful).
  const sellerTrust = useCounterpartyProfile(
    "merchant",
    activeOrder.merchant?.id,
    activeOrder.type === "buy" &&
      (activeOrder.dbStatus === "escrowed" || activeOrder.dbStatus === "payment_pending"),
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
    <div className="flex-1 min-h-0 flex flex-col bg-surface-base">
      {/* Header — matches SupportScreen: back + title left-aligned, action pinned right */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-3">
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
        <h1 className="text-[17px] font-semibold text-text-primary">
          Order Details
        </h1>
        <div className="flex-1" />
        {isSellQR && (
          <button
            onClick={() => setMinimised(true)}
            className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-surface-raised border border-border-subtle text-text-secondary hover:text-text-primary"
            aria-label="Hide details"
          >
            Hide details
          </button>
        )}
      </div>

      {/* Minimised pill — replaces the full tracking card while open. */}
      {minimised && (
        <OrderMinimisedPill
          status={String(activeOrder.dbStatus || activeOrder.status || "")}
          onExpand={() => setMinimised(false)}
        />
      )}

      <div className={`flex-1 min-h-0 px-5 overflow-y-auto pb-6 ${minimised ? "hidden" : ""}`}>
        {/* Consumer-style progress stepper — only for SELL/QR orders.
            Sits above the existing summary card so the technical details
            stay available for users who scroll, but the headline is the
            three-step "Finding payer → Payment on the way → Done" timeline. */}
        {isSellQR && (
          <div className="mb-4 pt-1">
            <OrderProgressStepper
              status={String(activeOrder.dbStatus || activeOrder.status || "")}
            />
          </div>
        )}

        {/* Order Summary — key facts inline, full receipt one tap away */}
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
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-semibold text-text-primary">
                {activeOrder.type === "buy" ? "Buying" : "Selling"}{" "}
                {formatCrypto(parseFloat(activeOrder.cryptoAmount))} USDT
              </p>
              <p className="text-[13px] text-text-secondary">
                {fiatSym(activeOrder.fiatCode)}{" "}
                {formatCrypto(parseFloat(activeOrder.fiatAmount))}
              </p>
            </div>
            <span className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active shrink-0">
              <Receipt className="w-4 h-4 text-text-secondary" />
            </span>
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

          {/* Inline breakdown — key facts visible without opening the receipt */}
          <div className="mt-4 pt-4 border-t border-border-subtle grid grid-cols-2 gap-x-4 gap-y-3">
            <SummaryFact
              label={activeOrder.type === "buy" ? "You pay" : "You sell"}
              value={
                activeOrder.type === "buy"
                  ? `${fiatSym(activeOrder.fiatCode)} ${formatCrypto(parseFloat(activeOrder.fiatAmount))}`
                  : `${formatCrypto(parseFloat(activeOrder.cryptoAmount))} USDT`
              }
            />
            <SummaryFact
              label="You get"
              value={
                activeOrder.type === "buy"
                  ? `${formatCrypto(parseFloat(activeOrder.cryptoAmount))} USDT`
                  : `${fiatSym(activeOrder.fiatCode)} ${formatCrypto(parseFloat(activeOrder.fiatAmount))}`
              }
            />
            <SummaryFact
              label="Rate"
              value={`${fiatSym(activeOrder.fiatCode)} ${formatRate(activeOrder.merchant.rate)}`}
            />
            <SummaryFact
              label="Method"
              value={activeOrder.merchant.paymentMethod === "cash" ? "Cash" : "Bank"}
            />
            {activeOrder.merchant.name && (
              <SummaryFact
                className="col-span-2"
                label={activeOrder.type === "buy" ? "Seller" : "Payer"}
                value={activeOrder.merchant.name}
              />
            )}
          </div>

          {/* Full receipt — opens the rich, full-screen order tracker. */}
          <button
            type="button"
            onClick={() => setShowTracker(true)}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium bg-surface-active text-text-secondary hover:text-text-primary transition-colors"
          >
            <Receipt className="w-4 h-4" />
            View full receipt
          </button>
        </div>

        {/* "Payment secured" card — consumer-friendly version of the old
            Escrow Locked panel. Trade ID and on-chain tx are tucked behind
            a small "View receipt" link instead of being headline labels. */}
        {activeOrder.type === "sell" && activeOrder.escrowTxHash && (
          <div className={`rounded-2xl p-4 mb-4 ${CARD}`}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                <Shield className="w-5 h-5 text-text-secondary" />
              </div>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-text-primary">
                  Payment secured
                </p>
                <p className="text-[13px] text-text-secondary">
                  Held safely until your payment lands
                </p>
              </div>
              <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active">
                <Check className="w-4 h-4 text-text-primary" />
              </div>
            </div>

            {/* Receipt link — only surface for users who want the proof. */}
            {activeOrder.escrowTxHash && (
              <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between">
                <span className="text-[11px] text-text-tertiary">
                  {activeOrder.escrowTradeId
                    ? `Order #${activeOrder.escrowTradeId}`
                    : "Order receipt"}
                </span>
                <a
                  href={explorerUrl('tx', activeOrder.escrowTxHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] text-text-secondary hover:text-text-primary"
                >
                  View receipt
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
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
                    Your payer wants +
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
                    Your payer wants to cancel: {activeOrder.cancelRequest.reason}
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
                          Extension approved
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
                      ? `Auto-refund in ${Math.max(0, Math.round((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) / 3600000))}h ${Math.max(0, Math.round(((new Date(activeOrder.disputeAutoResolveAt).getTime() - Date.now()) % 3600000) / 60000))}m`
                      : "Refund processing…"}
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

        {/* Stuck on-chain refund — appears when the order is in a terminal
            state but the escrow's on-chain release/refund tx never landed
            (worker is backing off, backend signer lost authority, or an
            RPC blip). Only the user who funded the escrow sees it —
            `escrowDebitedEntityId` is the authoritative funder regardless
            of whether merchant_id has since been reassigned. */}
        {(() => {
          const isTerminal =
            activeOrder.status === "cancelled" ||
            activeOrder.status === "expired" ||
            activeOrder.status === "disputed" ||
            activeOrder.dbStatus === "cancelled" ||
            activeOrder.dbStatus === "expired" ||
            activeOrder.dbStatus === "disputed";
          const hasOnChainEscrow =
            !!activeOrder.escrowTxHash && !!activeOrder.escrowTradeId;
          const refundPending = !activeOrder.releaseTxHash;
          const isFunder =
            activeOrder.escrowDebitedEntityType === "user" &&
            !!activeOrder.escrowDebitedEntityId &&
            activeOrder.escrowDebitedEntityId === userId;

          if (!isTerminal || !hasOnChainEscrow || !refundPending || !isFunder) {
            return null;
          }

          return (
            <div className={`mb-4 p-4 rounded-2xl ${AMBER_CARD}`}>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-warning-dim flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-warning" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-warning">
                    Refund not yet received?
                  </p>
                  <p className="text-[13px] text-warning mt-0.5">
                    We&apos;re still releasing your funds. Our system retries
                    automatically, but you can claim your refund now.
                  </p>
                  <button
                    onClick={claimRefund}
                    disabled={isClaimingRefund}
                    className={`mt-3 w-full h-11 rounded-xl flex items-center justify-center gap-2 text-[14px] font-semibold ${PRIMARY_BTN} disabled:opacity-60`}
                  >
                    {isClaimingRefund ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Processing…
                      </>
                    ) : (
                      <>
                        <Shield className="w-4 h-4" />
                        Claim refund
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* One continuous order panel — steps + merchant + actions */}
        <div className={`mt-4 rounded-2xl overflow-hidden divide-y divide-border-subtle ${CARD}`}>
        {/* Steps — hidden when cancelled/expired */}
        {activeOrder.status !== "cancelled" &&
          activeOrder.status !== "expired" && (
            <>
              {/* Step 1 */}
              <div className="p-4">
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
                          ? "Looking for a payer…"
                          : `Paired with ${activeOrder.merchant.name}`}
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
                                Looking for a payer
                              </p>
                              <p className="text-[12px] text-text-secondary">
                                Your funds are safe — we&apos;re finding someone to pay you
                              </p>
                            </div>
                          </div>
                          <p className="text-[12px] text-text-tertiary">
                            A payer will accept your request and send the money
                            straight to your account. You don&apos;t need to do
                            anything yet.
                          </p>
                        </div>
                      )}
                    {/* For buy orders: merchant paired, waiting for them to
                        lock escrow before payment details unlock at step 2. */}
                    {activeOrder.step === 1 &&
                      activeOrder.type === "buy" &&
                      activeOrder.dbStatus !== "pending" && (
                        <div className={`mt-3 rounded-xl p-4 ${CARD_STRONG}`}>
                          <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center bg-surface-active">
                              <Loader2 className="w-4 h-4 animate-spin text-text-secondary" />
                            </div>
                            <div>
                              <p className="text-[14px] font-medium text-text-primary">
                                Waiting for merchant to secure funds
                              </p>
                              <p className="text-[12px] text-text-secondary">
                                {activeOrder.merchant.name} is locking the USDT in escrow
                              </p>
                            </div>
                          </div>
                          <p className="text-[12px] text-text-tertiary">
                            Payment details will appear here once the funds are
                            secured. You don&apos;t need to do anything yet.
                          </p>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 2 */}
              <div className="p-4">
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
                        : "Waiting for your payer"}
                    </p>

                    {/* Funds secured indicator — replaces the old
                        "Funds locked in escrow" line. Same trust signal,
                        no technical jargon. */}
                    {activeOrder.step === 2 &&
                      activeOrder.dbStatus === "escrowed" && (
                        <div className={`mt-2 flex items-center gap-2 rounded-lg px-3 py-2 ${CARD_STRONG}`}>
                          <div className="w-5 h-5 rounded-full flex items-center justify-center bg-surface-active">
                            <Shield className="w-3 h-3 text-text-primary" />
                          </div>
                          <span className="text-[13px] font-medium text-text-primary">
                            {activeOrder.type === "buy"
                              ? "Funds secured"
                              : "Your money is safe"}
                          </span>
                        </div>
                      )}

                    {/* BUY: payer is getting ready to send. Was "Escrow
                        Funding in Progress" — same loader, plain words. */}
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
                                  Getting things ready
                                </p>
                                <p className="text-[12px] text-text-secondary">
                                  We&apos;re setting up your trade
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
                              You&apos;ll be able to send your payment in just a
                              moment.
                            </p>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message your payer
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
                                      {formatCrypto(parseFloat(activeOrder.fiatAmount))}
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
                              {/* Ref-2: "Escrow locked — pay now" headline +
                                  progress stepper. Additive; the existing
                                  pay-into details + CTA below are unchanged. */}
                              <div className={`rounded-2xl p-4 ${CARD}`}>
                                <div className="flex items-center gap-2 mb-3">
                                  <Shield className="w-4 h-4 text-success" />
                                  <p className="text-[14px] font-semibold text-text-primary">
                                    Escrow locked — pay the seller
                                  </p>
                                </div>
                                <EscrowFlowStepper
                                  steps={["Accepted", "Escrow Locked", "You Pay", "Seller Verifies", "USDT Released"]}
                                  currentIndex={1}
                                  surfaces={surfaces}
                                />
                              </div>

                              {/* Trade summary */}
                              <div className={`rounded-2xl p-4 space-y-3 ${CARD}`}>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-text-secondary">You Buy</span>
                                  <span className="text-[15px] font-semibold text-text-primary">
                                    {formatCrypto(parseFloat(activeOrder.cryptoAmount))} USDT
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-text-secondary">Total Amount</span>
                                  <span className="text-[15px] font-semibold text-text-primary">
                                    {fiatSym(activeOrder.fiatCode)}{" "}
                                    {formatCrypto(parseFloat(activeOrder.fiatAmount))}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-text-secondary">Rate (Locked)</span>
                                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-text-primary">
                                    <Lock className="w-3 h-3 text-success" />
                                    {formatRate(activeOrder.merchant.rate)} {fiatSym(activeOrder.fiatCode)}/USDT
                                  </span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-[13px] text-text-secondary">Order ID</span>
                                  <button
                                    type="button"
                                    onClick={() => copyField("summaryOrderId", activeOrder.id)}
                                    className="inline-flex items-center gap-1.5 font-mono text-[13px] text-text-secondary hover:text-text-primary"
                                  >
                                    {activeOrder.id.slice(0, 8)}…
                                    {copiedField === "summaryOrderId" ? (
                                      <Check className="w-3.5 h-3.5 text-success" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                                    )}
                                  </button>
                                </div>
                              </div>

                              {/* Seller trust — live profile fetch */}
                              <TradeTrustPanel
                                title="Seller Trust"
                                profile={sellerTrust.profile}
                                loading={sellerTrust.loading}
                                surfaces={surfaces}
                              />

                              {/* Part 4: buyer chooses which of the merchant's
                                  matching accounts to pay into. Shown until a
                                  method is chosen; tapping one persists it. */}
                              {needsPayMethodPick && (
                                <div className={`rounded-xl p-3 space-y-2 ${CARD}`}>
                                  <p className="text-[11px] uppercase tracking-wide text-text-tertiary">
                                    Choose where to pay
                                  </p>
                                  {matchingPayMethods.map((pm) => (
                                    <button
                                      key={pm.id}
                                      disabled={isLoading}
                                      onClick={() => handleChoosePayMethod(pm)}
                                      className="w-full flex items-center justify-between gap-2 rounded-lg p-3 border border-border-medium hover:bg-surface-hover disabled:opacity-50 text-left"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-[14px] font-medium text-text-primary truncate">
                                          {pm.name}
                                        </p>
                                        <p className="text-[12px] text-text-secondary truncate font-mono">
                                          {pm.details}
                                        </p>
                                      </div>
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary flex-shrink-0">
                                        {pm.type}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                              {/* Warning when merchant has no payment method configured */}
                              {!needsPayMethodPick &&
                                !activeOrder.merchantPaymentMethod &&
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
                                {/* Payment details header — verified by Blip */}
                                <div className="flex items-center justify-between pb-2 border-b border-border-medium">
                                  <span className="text-[11px] uppercase tracking-wide text-text-tertiary">
                                    Payment Details
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success">
                                    <Check className="w-3.5 h-3.5" />
                                    Verified by Blip
                                  </span>
                                </div>
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
                                  (() => {
                                    const m = activeOrder.merchantPaymentMethod!;
                                    const t = (m.type || "").toLowerCase();
                                    const isUpi =
                                      t === "upi" ||
                                      (typeof m.details === "string" &&
                                        m.details.includes("@"));
                                    const isBank = t === "bank";
                                    const typeLabel = isUpi
                                      ? "UPI"
                                      : isBank
                                        ? "Bank Transfer"
                                        : m.name || "Payment";
                                    const identifier = m.details || m.name;
                                    return (
                                      <div className="rounded-xl p-3 bg-surface-active border border-border-medium">
                                        {/* Prominent identifier + copy */}
                                        <div className="flex items-start justify-between gap-2">
                                          <div className="min-w-0">
                                            <p className="text-[12px] font-semibold text-accent">
                                              {typeLabel}
                                              {m.is_default ? " · Preferred" : ""}
                                            </p>
                                            <p className="text-[15px] font-semibold text-text-primary font-mono truncate mt-0.5">
                                              {identifier}
                                            </p>
                                          </div>
                                          <button
                                            onClick={() =>
                                              copyField("pm-id", identifier)
                                            }
                                            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-card border border-border-subtle text-[12px] font-medium text-text-secondary hover:bg-surface-hover"
                                          >
                                            {copiedField === "pm-id" ? (
                                              <>
                                                <Check className="w-3.5 h-3.5 text-success" />
                                                Copied
                                              </>
                                            ) : (
                                              <>
                                                <Copy className="w-3.5 h-3.5" />
                                                Copy
                                              </>
                                            )}
                                          </button>
                                        </div>
                                        {/* Labelled grid (matches the buyer mock) */}
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3 pt-3 border-t border-border-medium">
                                          <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-text-tertiary">
                                              {isUpi ? "UPI Name" : "Account Name"}
                                            </p>
                                            <p className="text-[13px] text-text-primary truncate">
                                              {m.name || "—"}
                                            </p>
                                          </div>
                                          {isUpi && (
                                            <div className="min-w-0">
                                              <p className="text-[10px] uppercase tracking-wide text-text-tertiary">
                                                UPI App
                                              </p>
                                              <p className="text-[13px] text-text-primary">
                                                Any UPI App
                                              </p>
                                            </div>
                                          )}
                                          <div className="min-w-0">
                                            <p className="text-[10px] uppercase tracking-wide text-text-tertiary">
                                              Payment Type
                                            </p>
                                            <p className="text-[13px] text-text-primary">
                                              {isUpi
                                                ? "UPI Transfer Only"
                                                : isBank
                                                  ? "Bank Transfer Only"
                                                  : "Direct Transfer"}
                                            </p>
                                          </div>
                                          <div className="col-span-2">
                                            <p className="text-[10px] uppercase tracking-wide text-text-tertiary">
                                              Note
                                            </p>
                                            <p className="text-[13px] text-text-primary">
                                              Do not add any note while making payment.
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()
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
                                        {formatCrypto(parseFloat(activeOrder.fiatAmount))}
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
                              {/* What happens next */}
                              <div className={`rounded-2xl p-4 ${CARD}`}>
                                <p className="text-[11px] uppercase tracking-wide text-text-tertiary mb-3">
                                  What happens next
                                </p>
                                <div className="space-y-2.5">
                                  {[
                                    "Pay the seller using the details above",
                                    "Tap “I Have Made Payment”",
                                    "Seller verifies the payment in their account",
                                    "Seller releases USDT to you",
                                  ].map((t, i) => (
                                    <div key={i} className="flex items-start gap-2.5">
                                      <span
                                        className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${surfaces.chip} text-text-secondary`}
                                      >
                                        {i + 1}
                                      </span>
                                      <span className="text-[13px] text-text-secondary">{t}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Never cancel once paid */}
                              <div className={`rounded-2xl p-3 ${AMBER_CARD}`}>
                                <div className="flex items-start gap-2">
                                  <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                                  <p className="text-[12px] text-warning">
                                    Never cancel the payment once made. Only send to the
                                    details above and verify with the seller before
                                    proceeding.
                                  </p>
                                </div>
                              </div>

                              {/* Actions — help / appeal, then mark paid */}
                              <div className="flex gap-2">
                                <button
                                  onClick={handleOpenChat}
                                  className={`flex-1 py-3 rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 ${SECONDARY_BTN}`}
                                >
                                  <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                                  Need Help
                                </button>
                                <button
                                  onClick={() => setShowAppeal(true)}
                                  className={`flex-1 py-3 rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 ${SECONDARY_BTN}`}
                                >
                                  <Flag className="w-4 h-4" />
                                  Raise Appeal
                                </button>
                              </div>
                              <motion.button
                                whileTap={{ scale: 0.98 }}
                                onClick={markPaymentSent}
                                disabled={isLoading || needsPayMethodPick}
                                className={`w-full py-3.5 rounded-xl text-[15px] font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${PRIMARY_BTN}`}
                              >
                                {isLoading
                                  ? "Processing..."
                                  : needsPayMethodPick
                                    ? "Choose where to pay"
                                    : "I Have Made Payment"}
                              </motion.button>
                            </>
                          )}
                        </div>
                      )}

                    {/* SELL step 2 — a payer has accepted, user needs to
                        confirm the trade to move funds to the safe-hold.
                        Old copy talked about wallets, escrow, locking. New
                        copy frames it as "confirm" / "send to safe-hold". */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "accepted" &&
                      !activeOrder.escrowTxHash && (
                        <div className="mt-3 space-y-3">
                          <div className={`rounded-xl p-4 ${CARD_STRONG}`}>
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active">
                                <Shield className="w-5 h-5 text-text-primary" />
                              </div>
                              <div>
                                <p className="text-[15px] font-medium text-text-primary">
                                  Ready to send
                                </p>
                                <p className="text-[12px] text-text-secondary">
                                  Your payer is ready. Confirm to continue.
                                </p>
                              </div>
                            </div>
                            <p className="text-[12px] mb-3 text-text-tertiary">
                              Confirm{" "}
                              {formatCrypto(parseFloat(activeOrder.cryptoAmount))}{" "}
                              USDT to start the trade. We&apos;ll hold it safely
                              and release it to your payer only after you
                              confirm the money has landed.
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
                                    "Something went wrong",
                                    "Please try again in a moment.",
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
                                      "Just a moment",
                                      "Waiting for your payer. Please try again shortly.",
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
                                    "Couldn't start the Order",
                                    err?.message ||
                                      "Something went wrong. Please try again.",
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
                                  Processing…
                                </>
                              ) : !solanaWallet.connected ? (
                                <>
                                  <Wallet className="w-5 h-5" />
                                  Continue
                                </>
                              ) : !solanaWallet.programReady ? (
                                "One moment…"
                              ) : (
                                <>
                                  <Shield className="w-5 h-5" />
                                  Continue with{" "}
                                  {formatCrypto(parseFloat(activeOrder.cryptoAmount))}{" "}
                                  USDT
                                </>
                              )}
                            </motion.button>
                          </div>
                          <button
                            onClick={handleOpenChat}
                            className={`w-full py-3 rounded-xl text-[15px] font-medium flex items-center justify-center gap-2 ${SECONDARY_BTN}`}
                          >
                            <MessageCircle className="w-4 h-4" /><ChatBadge count={activeOrder?.unreadCount} />
                            Message your payer
                          </button>
                        </div>
                      )}

                    {/* SELL step 2 — funds are safe, waiting for the payer
                        to send the money. Old copy said "locked in escrow"
                        + "Locked Payment Method"; both now phrased plainly. */}
                    {activeOrder.step === 2 &&
                      activeOrder.type === "sell" &&
                      (activeOrder.dbStatus === "escrowed" ||
                        activeOrder.escrowTxHash) && (
                        <div className="mt-2">
                          <p className="text-[13px] text-text-secondary">
                            Your money is safe. Waiting for your payer to send
                            you {activeOrder.fiatCode || 'AED'}…
                          </p>

                          <div className={`mt-3 rounded-xl p-3 ${CARD}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[12px] text-text-secondary">
                                You&apos;ll receive
                              </span>
                              <span className="text-[15px] font-semibold text-text-primary">
                                {fiatSym(activeOrder.fiatCode)}{" "}
                                {formatCrypto(parseFloat(activeOrder.fiatAmount))}
                              </span>
                            </div>
                            {activeOrder.lockedPaymentMethod ? (
                              <div className="pt-2 space-y-1.5 border-t border-border-medium">
                                <div className="flex items-center gap-1.5">
                                  <Shield className="w-3 h-3 text-warning" />
                                  <span className="text-[11px] text-warning font-semibold uppercase tracking-wide">
                                    Where they&apos;ll pay you
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
                                  They&apos;ll send the money here
                                </p>
                              </div>
                            ) : (
                              <p className="text-[11px] text-text-tertiary">
                                They&apos;ll send this amount to your account
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
                            Message your payer
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              </div>

              {/* Step 3 */}
              <div className="p-4">
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
                            Message your payer
                          </button>
                        </div>
                      )}

                    {activeOrder.step === 3 &&
                      activeOrder.type === "sell" &&
                      activeOrder.dbStatus === "payment_sent" && (
                        <div className="mt-3">
                          <div className={`rounded-xl p-3 mb-3 ${CARD_STRONG}`}>
                            <p className="text-[13px] text-text-primary">
                              Your payer sent {fiatSym(activeOrder.fiatCode)}{" "}
                              {formatCrypto(parseFloat(activeOrder.fiatAmount))}{" "}
                              to your account.
                            </p>
                            <p className="text-[12px] mt-1 text-text-secondary">
                              Check your account before confirming.
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
              <div className="p-4">
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
                    className="p-4 text-center"
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
            </>
          )}

          {/* Merchant */}
          <div className="p-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => activeOrder.merchant.name && setShowProfile(true)}
              disabled={!activeOrder.merchant.name}
              className="flex items-center gap-3 text-left disabled:cursor-default"
            >
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-semibold bg-accent text-accent-text">
                {(activeOrder.merchant.name || 'M').charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[15px] font-medium text-text-primary">
                    {activeOrder.merchant.name || 'Looking for a payer…'}
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
            </button>
            <button
              onClick={handleOpenChat}
              className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-active"
            >
              <MessageCircle className="w-5 h-5 text-text-secondary" /><ChatBadge count={activeOrder?.unreadCount} />
            </button>
          </div>
          </div>

          {/* Cancel & Dispute Buttons.
              CANCEL is only valid before payment is sent (state machine:
              open/accepted/escrowed). step===2 covers accepted / escrow_pending
              / escrowed / payment_pending; step 3 (payment_sent /
              payment_confirmed / releasing) is excluded so Cancel can't render
              once the buyer has paid. */}
        {activeOrder.step === 2 &&
          activeOrder.status !== "disputed" &&
          !activeOrder.cancelRequest && (
            <button
              onClick={() => requestCancelOrder()}
              disabled={isRequestingCancel}
              className={`w-full py-3 px-4 text-[13.5px] font-medium flex items-center justify-center gap-2 disabled:opacity-50 text-warning hover:bg-warning-dim transition-colors`}
            >
              {isRequestingCancel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              Request Cancellation
            </button>
          )}

        {/* Cancel button for SELL orders waiting for a merchant (step 1).
            These have on-chain escrow locked by the user but no merchant
            assigned yet, so cancellation is unilateral — the user is alone
            and can pull their offer + refund themselves. Without this
            button, escrowed sell offers with no merchant claim had no UI
            cancel path and would only auto-cancel via cron expiry. */}
        {activeOrder.step === 1 &&
          activeOrder.type === "sell" &&
          activeOrder.dbStatus === "escrowed" &&
          !activeOrder.cancelRequest && (
            <button
              onClick={() => requestCancelOrder("Cancelled by seller — offer withdrawn")}
              disabled={isRequestingCancel}
              className={`w-full py-3 px-4 text-[13.5px] font-medium flex items-center justify-center gap-2 disabled:opacity-50 text-warning hover:bg-warning-dim transition-colors`}
            >
              {isRequestingCancel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              Cancel & Refund
            </button>
          )}
        {/* DISPUTE is only valid from escrowed / payment_sent (state machine).
            In every other state the user instead gets the always-on "Need
            help" button below. */}
        {["escrowed", "payment_sent"].includes(activeOrder.dbStatus || "") && (
            <button
              onClick={() => setShowAppeal(true)}
              className={`w-full py-3 px-4 text-[13.5px] font-medium flex items-center justify-center gap-2 text-warning hover:bg-warning-dim transition-colors`}
            >
              <Flag className="w-4 h-4" />
              Raise Appeal
            </button>
          )}

        {/* Need help — always available support path (navigation only, no
            order-state mutation, so it needs no gate). */}
        <button
          onClick={() => setScreen("support")}
          className={`w-full py-3 px-4 text-[13.5px] font-medium flex items-center justify-center gap-2 text-text-secondary hover:bg-surface-hover transition-colors`}
        >
          <HelpCircle className="w-4 h-4" />
          Need help
        </button>
        </div>

        {/* Counterparty profile — opened by tapping the merchant name/avatar above. */}
        <ProfileSheet
          open={showProfile}
          entityType="merchant"
          id={activeOrder.merchant.id}
          variant="user"
          onClose={() => setShowProfile(false)}
          onMessage={() => {
            setShowProfile(false);
            handleOpenChat();
          }}
        />

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

      {/* Raise Appeal — full-screen form. An appeal is NOT a dispute: Submit
          posts the reason + details as a message into the order chat so the
          counterparty sees it (no escrow freeze, no status change). If the
          appeal doesn't resolve things, a dispute is raised separately. */}
      <AnimatePresence>
        {showAppeal && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            className={`fixed inset-0 z-[55] mx-auto ${maxW} flex flex-col ${SHEET_BG}`}
          >
            <AppealScreen
              order={activeOrder}
              displayId={getDisplayOrderId(activeOrder.id, new Date(activeOrder.createdAt))}
              reason={appealReason}
              description={appealDescription}
              onReasonChange={setAppealReason}
              onDescriptionChange={setAppealDescription}
              onClose={() => setShowAppeal(false)}
              onOpenChat={handleOpenChat}
              onViewProfile={() => setShowProfile(true)}
              onNeedHelp={() => setScreen("support")}
              onSubmit={submitAppeal}
              isSubmitting={isSubmittingAppeal}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Buyer payment view — replaces the step layout for an accepted/escrowed
          BUY order. Bank details + pay action are gated on escrow lock inside. */}
      {activeOrder.type === "buy" &&
        ["accepted", "escrow_pending", "escrowed", "payment_pending", "payment_sent"].includes(
          String(activeOrder.dbStatus || "").toLowerCase(),
        ) && (
          <div className={`fixed inset-0 z-40 mx-auto ${maxW} flex flex-col ${SHEET_BG}`}>
            <OrderPaymentScreen
              order={activeOrder}
              displayId={getDisplayOrderId(activeOrder.id, new Date(activeOrder.createdAt))}
              onClose={() => setScreen(previousScreen || "orders")}
              onOpenOverview={() => setShowTracker(true)}
              onViewOverview={() => setShowOrderOverview(true)}
              onOpenChat={handleOpenChat}
              onViewProfile={() => setShowProfile(true)}
              onNeedHelp={() => setScreen("support")}
              onMarkPaymentSent={markPaymentSent}
              onCancel={() => {
                // Pre-escrow (accepted / escrow_pending): no crypto is locked,
                // so cancel directly via the CANCEL action. Once escrow is
                // locked (escrowed / payment_pending), fall back to the mutual
                // cancel-request flow so the counterparty agrees before locked
                // funds are released.
                const s = String(
                  activeOrder.dbStatus || activeOrder.status || "",
                ).toLowerCase();
                const escrowLocked =
                  s === "escrowed" ||
                  s === "payment_pending" ||
                  s === "payment_sent";
                if (escrowLocked) requestCancelOrder();
                else cancelOrderDirect();
              }}
              onAppeal={() => setShowAppeal(true)}
              onCopy={(key, value) => copyField(key, value)}
              copiedField={copiedField}
              needsPayMethodPick={needsPayMethodPick}
              matchingPayMethods={matchingPayMethods}
              onChoosePayMethod={handleChoosePayMethod}
              isSubmitting={isLoading}
              isCancelling={isRequestingCancel}
            />
          </div>
        )}

      {/* Completion + rating view — replaces the step layout for a completed
          BUY order. */}
      {activeOrder.type === "buy" &&
        String(activeOrder.dbStatus || "").toLowerCase() === "completed" && (
          <div className={`fixed inset-0 z-40 mx-auto ${maxW} flex flex-col ${SHEET_BG}`}>
            <OrderCompletedScreen
              order={activeOrder}
              displayId={getDisplayOrderId(activeOrder.id, new Date(activeOrder.createdAt))}
              rating={rating}
              reviewText={reviewText}
              onRate={setRating}
              onReviewTextChange={setReviewText}
              onViewProfile={() => setShowProfile(true)}
              onViewOverview={() => setShowOrderOverview(true)}
              onHelp={() => setScreen("support")}
              onBackHome={() => {
                if (rating > 0 && activeOrder.userRating == null && submitReview) {
                  submitReview(activeOrder.id, rating, reviewText || undefined);
                  setReviewText("");
                  setRating(0);
                }
                setScreen("home");
              }}
            />
          </div>
        )}

      {/* Rich full-screen order tracker. Auto-shown as the primary screen for a
          matching BUY order (autoTracker); also opened manually via "View full
          receipt" in other states. */}
      <AnimatePresence>
        {(showTracker || autoTracker) && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            className={`fixed inset-0 z-50 mx-auto ${maxW} flex flex-col ${SHEET_BG}`}
          >
            {isMatching ? (
              // Matching BUY order → show the same MatchingScreen the user sees
              // right after placing, fed from the order so it's identical on
              // reopen (timer-in-banner, "Finding the best merchant", Cancel).
              <MatchingScreen
                setScreen={setScreen}
                pendingTradeData={{
                  amount: activeOrder.cryptoAmount,
                  fiatAmount: activeOrder.fiatAmount,
                  type: activeOrder.type,
                  paymentMethod:
                    activeOrder.merchant?.paymentMethod === "cash" ? "cash" : "bank",
                }}
                matchingTimeLeft={Math.max(
                  0,
                  Math.floor((new Date(activeOrder.expiresAt).getTime() - nowMs) / 1000),
                )}
                formatTimeLeft={(s) =>
                  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
                }
                currentRate={
                  Number(activeOrder.merchant?.rate) ||
                  Number(activeOrder.fiatAmount) / Number(activeOrder.cryptoAmount) ||
                  0
                }
                currency={activeOrder.fiatCode === "INR" ? "INR" : "AED"}
                activeOrderId={activeOrder.id}
                orderStatus={activeOrder.dbStatus || activeOrder.status}
                userId={userId}
                setOrders={setOrders}
                // No-op: this embedded matching view runs under screen==='order',
                // where the realtime watcher doesn't redirect, so there's no
                // navigation conflict to defuse by clearing the active order.
                setActiveOrderId={() => {}}
                setPendingTradeData={() => {}}
                toast={{
                  showOrderCancelled: (m: string) =>
                    showAlert("Order cancelled", m, "success"),
                  showWarning: (m: string) => showAlert("Notice", m, "warning"),
                }}
                maxW={maxW}
              />
            ) : (
              <OrderTrackingView
                order={activeOrder}
                displayId={getDisplayOrderId(activeOrder.id, new Date(activeOrder.createdAt))}
                onClose={() => {
                  // When the tracker is the auto/primary screen (e.g. a
                  // cancelled order reopened from Activity), Back should leave
                  // the order screen; when opened manually over the detail
                  // view ("View full receipt"), just close the overlay.
                  if (autoTracker) setScreen(previousScreen || "orders");
                  else setShowTracker(false);
                }}
                onCancel={() => {
                  requestCancelOrder();
                  setShowTracker(false);
                }}
                isCancelling={isRequestingCancel}
                onOpenSupport={() => setScreen("support")}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Itemised Order Overview — opened directly by the "Order Overview"
          cards on the payment/completed screens (z above the z-40 screen
          overlays and the z-50 tracker). */}
      <AnimatePresence>
        {showOrderOverview && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            className={`fixed inset-0 z-[60] mx-auto ${maxW} flex flex-col ${SHEET_BG}`}
          >
            <OrderOverviewScreen
              displayId={getDisplayOrderId(activeOrder.id, new Date(activeOrder.createdAt))}
              status={String(activeOrder.dbStatus || activeOrder.status || "")}
              type={activeOrder.type}
              cryptoAmount={parseFloat(activeOrder.cryptoAmount)}
              fiatAmount={parseFloat(activeOrder.fiatAmount)}
              rate={Number(activeOrder.merchant?.rate)}
              fiatCode={activeOrder.fiatCode}
              paymentMethod={activeOrder.merchant?.paymentMethod === "cash" ? "cash" : "bank"}
              createdAt={activeOrder.createdAt ? new Date(activeOrder.createdAt) : new Date()}
              paymentLocked={["escrowed", "payment_pending", "payment_sent", "completed"].includes(
                String(activeOrder.dbStatus || activeOrder.status || "").toLowerCase(),
              )}
              paymentRows={deriveOverviewPaymentRows(activeOrder)}
              onClose={() => setShowOrderOverview(false)}
              onCancel={() => {
                requestCancelOrder();
                setShowOrderOverview(false);
              }}
              isCancelling={isRequestingCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Order Receipt Sheet — opened by tapping the summary card */}
      <AnimatePresence>
        {showReceipt && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/80 z-50"
              onClick={() => setShowReceipt(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 350, mass: 0.8 }}
              className={`fixed bottom-0 left-1/2 -translate-x-1/2 z-50 w-full ${maxW} rounded-t-3xl p-6 max-h-[85dvh] overflow-y-auto scrollbar-hide ${SHEET_BG}`}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-text-secondary" />
                  <h3 className="text-[17px] font-semibold text-text-primary">
                    Order receipt
                  </h3>
                </div>
                <button onClick={() => setShowReceipt(false)} aria-label="Close receipt">
                  <X className="w-5 h-5 text-text-tertiary" />
                </button>
              </div>

              {/* Headline — direction + amount + total (rate already inclusive of fees) */}
              <div className="mb-4">
                <p className="text-[22px] font-semibold text-text-primary tracking-[-0.01em]">
                  {activeOrder.type === "buy" ? "Buying" : "Selling"}{" "}
                  {formatCrypto(parseFloat(activeOrder.cryptoAmount))} USDT
                </p>
                <p className="text-[13px] text-text-secondary mt-1">
                  {fiatSym(activeOrder.fiatCode)}{" "}
                  {formatCrypto(parseFloat(activeOrder.fiatAmount))} total
                  <span className="text-text-tertiary"> · inclusive of all fees</span>
                </p>
              </div>

              {/* Details */}
              <div className={`rounded-2xl divide-y divide-border-subtle ${CARD}`}>
                <ReceiptRow label="Rate">
                  {formatRate(activeOrder.merchant.rate)} {fiatSym(activeOrder.fiatCode)}/USDT
                </ReceiptRow>
                <ReceiptRow label="Status">
                  {activeOrder.status === "cancelled"
                    ? "Cancelled"
                    : activeOrder.status === "expired"
                      ? "Expired"
                      : activeOrder.status === "complete"
                        ? "Completed"
                        : `Step ${activeOrder.step} of 4`}
                </ReceiptRow>
                <ReceiptRow label="Payment method">
                  {activeOrder.merchant.paymentMethod === "cash" ? "Cash" : "Bank"}
                </ReceiptRow>
                {activeOrder.merchant.name && (
                  <ReceiptRow label={activeOrder.type === "buy" ? "Seller" : "Payer"}>
                    {activeOrder.merchant.name}
                  </ReceiptRow>
                )}
                <ReceiptRow label="Order ID">
                  <button
                    type="button"
                    onClick={() => copyField("orderId", activeOrder.id)}
                    className="inline-flex items-center gap-1.5 font-mono text-text-secondary hover:text-text-primary"
                  >
                    {activeOrder.id.slice(0, 8)}…
                    {copiedField === "orderId" ? (
                      <Check className="w-3.5 h-3.5 text-success" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-text-tertiary" />
                    )}
                  </button>
                </ReceiptRow>
                {activeOrder.escrowTradeId != null && (
                  <ReceiptRow label="Trade ID">
                    <span className="font-mono">#{activeOrder.escrowTradeId}</span>
                  </ReceiptRow>
                )}
                <ReceiptRow label="Created">
                  {fmtDateTime(activeOrder.createdAt)}
                </ReceiptRow>
                {activeOrder.status !== "cancelled" &&
                  activeOrder.status !== "expired" &&
                  activeOrder.status !== "complete" && (
                    <ReceiptRow label="Expires">
                      {fmtDateTime(activeOrder.expiresAt)}
                    </ReceiptRow>
                  )}
                {activeOrder.escrowTxHash && (
                  <ReceiptRow label="Escrow tx">
                    <a
                      href={explorerUrl("tx", activeOrder.escrowTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-text-secondary hover:text-text-primary"
                    >
                      {activeOrder.escrowTxHash.slice(0, 6)}…{activeOrder.escrowTxHash.slice(-4)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </ReceiptRow>
                )}
                {activeOrder.releaseTxHash && (
                  <ReceiptRow label="Release tx">
                    <a
                      href={explorerUrl("tx", activeOrder.releaseTxHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-text-secondary hover:text-text-primary"
                    >
                      {activeOrder.releaseTxHash.slice(0, 6)}…{activeOrder.releaseTxHash.slice(-4)}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </ReceiptRow>
                )}
              </div>

              <button
                onClick={() => setShowReceipt(false)}
                className={`mt-5 w-full py-3 rounded-xl text-[15px] font-medium ${MUTED_BTN}`}
              >
                Done
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Chat — portaled OUT of the transformed Panel ancestor
          (left-1/2 -translate-x-1/2 + framer slide), which would otherwise
          contain the `fixed` overlay and make it float over the order content
          instead of covering the screen. We target #user-scope-root (the
          `.user-scope` wrapper) rather than document.body so the sheet keeps
          the user-theme CSS variables (bg-surface-base etc.) — body is outside
          .user-scope, where those vars are undefined and the sheet renders
          transparent. */}
      {typeof document !== "undefined" && createPortal(
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
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowOrderDetails((v) => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-surface-card text-text-secondary"
                    aria-expanded={showOrderDetails}
                    aria-label={showOrderDetails ? "Hide order details" : "Show order details"}
                  >
                    <ReceiptText className="w-4 h-4" />
                    <span className="text-[12px] font-medium hidden sm:inline">Details</span>
                    <ChevronDown
                      className={`w-4 h-4 transition-transform duration-300 ${showOrderDetails ? "rotate-180" : ""}`}
                    />
                  </button>
                  <button onClick={() => setShowChat(false)} className="p-2">
                    <X className="w-5 h-5 text-text-tertiary" />
                  </button>
                </div>
              </div>

              {/* Collapsible order-details (receipt) card — hidden by default,
                  toggled from the header. Animates height so the message list
                  reflows smoothly. */}
              <AnimatePresence initial={false}>
                {showOrderDetails && receiptForHeader && (
                  <motion.div
                    key="chat-order-details"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden border-b border-border-medium shrink-0"
                  >
                    <div className="p-4">
                      <ReceiptCard
                        data={receiptForHeader as any}
                        currentStatus={activeOrder?.dbStatus || activeOrder?.status}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
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
                              {data.party === "user" ? "You" : "Payer"}{" "}
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
                      // The order receipt is no longer shown inline — it's
                      // surfaced on demand via the collapsible "Details" toggle
                      // in the chat header. Skip rendering it as a message.
                      if (receiptPayload) {
                        return null;
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
                <div className="flex items-center gap-2 w-full">
                  {/* Pill: emoji + attach + text input all live in one rounded row.
                      min-w-0 on the wrapper + the input keeps long text from
                      pushing the Send button off-screen on narrow viewports. */}
                  <div className="flex-1 min-w-0 flex items-center gap-1 rounded-full bg-surface-raised pl-1.5 pr-1.5 focus-within:ring-1 focus-within:ring-accent/40">
                    {/* Emoji picker trigger */}
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-active transition-colors"
                    >
                      <span className="text-lg leading-none">😊</span>
                    </button>
                    <input
                      ref={chatInputRef}
                      maxLength={1000}
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
                      className="flex-1 min-w-0 appearance-none border-0 bg-transparent px-2 py-3 text-[15px] outline-none text-text-primary placeholder:text-text-tertiary"
                    />
                    {/* Image attach — placed after the input so the
                        paperclip sits to the right of the text field. */}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-active transition-colors disabled:opacity-50"
                      title="Attach image"
                    >
                      {isUploading ? (
                        <Loader2 className="w-4 h-4 animate-spin text-text-tertiary" />
                      ) : (
                        <Paperclip className="w-4 h-4 text-text-tertiary" />
                      )}
                    </button>
                  </div>
                  {/* Send — separate circular button outside the pill */}
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
                    className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center disabled:opacity-50 ${
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
        </AnimatePresence>,
        document.getElementById("user-scope-root") ?? document.body,
      )}

      {/* Scratch-card reward — auto-opens once on first land for SELL/QR
          orders with an unrevealed pending reward. After reveal the reward
          row stays pending in DB; it only becomes claimable when the order
          reaches `completed` (see migration 124 + routes/orders.ts). */}
      <ScratchRewardModal
        open={showScratchModal}
        reward={pendingReward}
        onClose={() => setShowScratchModal(false)}
        onDone={() => setShowScratchModal(false)}
      />
    </div>
  );
};
