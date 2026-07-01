"use client";

/**
 * Trade Chat — merchant dashboard
 * ────────────────────────────────────────────────────────────────────────
 * 3-pane conversation workspace, theme-aware (uses the app's --accent /
 * --color-* design tokens — NO hardcoded brand colors, so it adapts to all
 * themes). Layout mirrors the merchant-chat mock:
 *
 *   LEFT   — order conversations (useMerchantConversations) with a tab row
 *            (All / Unread / Active / Groups), search, unread badges.
 *   CENTER — the live chat for the selected trade (useRealtimeChat): a trade
 *            summary strip, E2E banner, day dividers, text + receipt cards,
 *            optimistic send, typing, read receipts, image attach, load-older.
 *   RIGHT  — Trade Details: counterparty, active order, a live countdown
 *            (expires_at), payment status, backend-driven action buttons, and
 *            a support-ticket entry point.
 *
 * Backend remains the source of truth for actions: primaryAction /
 * secondaryAction drive the buttons; wallet-signing actions (ACCEPT /
 * LOCK_ESCROW / CLAIM) route to the dashboard escrow flow.
 *
 * Placeholders (no backend yet, rendered inert): New Chat, New Group, the
 * Groups tab, the filter button, GIF + @tag composer affordances, and the
 * Open Support Ticket button.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  SlidersHorizontal,
  Send,
  CheckCheck,
  Check,
  Ban,
  AlertTriangle,
  Lock,
  Info,
  ChevronLeft,
  ArrowLeftRight,
  Loader2,
  MessagesSquare,
  ExternalLink,
  Plus,
  Users,
  Crown,
  Clock,
  Paperclip,
  Smile,
  LifeBuoy,
  CircleDollarSign,
  Flag,
} from "lucide-react";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { openIssueReporter } from "@/components/IssueReporter";
import { useMerchantStore } from "@/stores/merchantStore";
import {
  useMerchantConversations,
  type OrderConversation,
} from "@/hooks/useMerchantConversations";
import { useRealtimeChat, type ChatMessage } from "@/hooks/useRealtimeChat";
import { useRealtimeOrder } from "@/hooks/useRealtimeOrder";
import { usePusher } from "@/context/PusherContext";
import { useOrderActionDispatch } from "@/hooks/useOrderActionDispatch";
import { ImageUpload } from "@/components/chat/ImageUpload";
import { ReceiptCard } from "@/components/chat/cards";
import {
  ImageViewerProvider,
  useImageViewerOptional,
  type ViewerImage,
} from "@/components/chat/shared";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { orderActionKey } from "@/lib/api/idempotencyKeys";
import type { BackendOrder, ActionType } from "@/types/backendOrder";
import { formatCrypto, formatFiat, formatRate } from "@/lib/format";
import { useSolanaWallet } from "@/context/SolanaWalletContext";
import { useSounds } from "@/hooks/useSounds";
import { useNotifications } from "@/hooks/useNotifications";
import { useEscrowOperations } from "@/hooks/useEscrowOperations";
import { mapDbOrderToUI } from "@/lib/orders/mappers";
import { MOCK_MODE } from "@/lib/config/mockMode";
import { EscrowLockModal } from "@/components/merchant/EscrowLockModal";
import { EscrowReleaseModal } from "@/components/merchant/EscrowReleaseModal";
import { MutualCancelAppealBanner } from "@/components/shared/MutualCancelAppealBanner";
import { MerchantAppealSheet } from "@/components/merchant/MerchantAppealSheet";
import { useOrderAppeal, isActiveAppeal } from "@/hooks/useOrderAppeal";
import { personalizeAppealMessage } from "@/lib/appeals/personalizeMessage";

/* ───────────────────────── helpers ───────────────────────── */

/** Order statuses where the trade is live (drives the "Active" tab + badge). */
const ACTIVE_STATUSES = new Set([
  "accepted",
  "escrowed",
  "payment_sent",
  "payment_pending",
  "disputed",
]);

/** Theme-aware status pill classes. Neutral by default; semantic only where
 *  it carries meaning (success / warning / error). */
const STATUS_PILL: Record<string, string> = {
  pending: "bg-white/[0.06] text-foreground/50",
  open: "bg-white/[0.06] text-foreground/50",
  accepted: "bg-white/[0.08] text-foreground/70",
  escrowed: "bg-accent/15 text-accent",
  payment_sent: "bg-warning/15 text-warning",
  payment_pending: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  disputed: "bg-error/15 text-error",
  cancelled: "bg-white/[0.06] text-foreground/40",
  expired: "bg-white/[0.06] text-foreground/40",
};

function statusLabel(s: string) {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function initials(name: string) {
  return name.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "??";
}

/** Neutral avatar tint (theme-aware, derived from name for stable variety). */
function avatarTint(name: string) {
  const alpha = [0.1, 0.14, 0.08, 0.12, 0.16];
  const a = alpha[(name.charCodeAt(0) || 0) % alpha.length];
  return { backgroundColor: `rgba(255,255,255,${a})` };
}

const EMOJIS = ["🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸", "🐙", "🦋", "🐳", "🦄", "🐲"];
function userEmoji(name: string) {
  const hash = name.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return EMOJIS[hash % EMOJIS.length];
}

/** Counterparty avatar — renders the profile image when present, falling back
 *  to the tinted-initials block on a missing URL or a load error. Keeps the
 *  existing initials look as the graceful fallback. */
function Avatar({
  name,
  src,
  className,
  textClassName = "text-sm",
}: {
  name: string;
  src?: string | null;
  className: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className={`${className} object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`${className} flex items-center justify-center font-bold text-foreground ${textClassName}`}
      style={avatarTint(name)}
    >
      {initials(name)}
    </div>
  );
}

function clock(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Relative-ish label for the conversation row timestamp. */
function rowTime(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return clock(d);
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Day-divider label for the message stream. */
function dayLabel(d: Date) {
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function fiatSymbol(ccy?: string) {
  return ccy === "INR" ? "₹" : ccy === "AED" ? "AED " : ccy ? ccy + " " : "";
}

/** Lifecycle progress (0–1) for the summary-strip bar. */
function progressFraction(status?: string) {
  switch (status) {
    case "accepted":
      return 0.25;
    case "escrowed":
      return 0.5;
    case "payment_sent":
    case "payment_pending":
      return 0.75;
    case "completed":
      return 1;
    default:
      return 0;
  }
}

/* Actions that require the embedded-wallet / on-chain escrow signing flow.
   LOCK_ESCROW now runs in-chat via the escrow modal; ACCEPT / CLAIM still
   route to the dashboard (handled in handleAction). */
const WALLET_FLOW_ACTIONS = new Set<ActionType>(["ACCEPT", "LOCK_ESCROW", "CLAIM"]);

/* Wallet-flow actions that still bounce the merchant to the dashboard (i.e.
   everything except LOCK_ESCROW, which we now handle in the chat tab). Drives
   the ↗ icon + caption so Lock Escrow no longer looks like a redirect. */
const DASHBOARD_REDIRECT_ACTIONS = new Set<ActionType>(["ACCEPT", "CLAIM"]);

const ACTION_ICON: Partial<Record<ActionType, typeof Check>> = {
  ACCEPT: Check,
  CLAIM: Check,
  LOCK_ESCROW: Lock,
  SEND_PAYMENT: ArrowLeftRight,
  CONFIRM_PAYMENT: CheckCheck,
  CANCEL: Ban,
  DISPUTE: AlertTriangle,
};

type TabKey = "all" | "unread" | "active" | "groups";
const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "active", label: "Active" },
  { key: "groups", label: "Groups" },
];

/* ───────────────────────── page ───────────────────────── */

export default function TradeChatPage() {
  const router = useRouter();
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);

  // Initialize the Pusher actor for this page. The dashboard does this via
  // useMerchantEffects, but the chat tab doesn't mount that hook — so on a HARD
  // REFRESH of /market/chat (vs. navigating in from the dashboard, where the
  // connection is already live) the Pusher client was never created. That left
  // the whole tab on polling only: chat history (loaded inside subscribeToOrder,
  // which bails when there's no channel), the right-rail order, and the inbox
  // all fell back to slow polls. Setting the actor here connects Pusher so chat
  // + order state load and update in realtime. setActor is idempotent.
  const { setActor: setPusherActor } = usePusher();
  useEffect(() => {
    if (merchantId) setPusherActor("merchant", merchantId);
  }, [merchantId, setPusherActor]);

  const {
    orderConversations,
    isLoadingConversations,
    fetchOrderConversations,
    clearUnreadForOrder,
  } = useMerchantConversations();

  const chat = useRealtimeChat({
    maxWindows: 6,
    actorType: "merchant",
    actorId: merchantId ?? undefined,
  });

  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabKey>("all");
  const [draft, setDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── filtered + tabbed conversations ──
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderConversations;
    return orderConversations.filter(
      (c) =>
        c.user.username.toLowerCase().includes(q) ||
        c.order_number.toLowerCase().includes(q),
    );
  }, [orderConversations, search]);

  const visibleConvos = useMemo(() => {
    switch (tab) {
      case "unread":
        return searched.filter((c) => c.unread_count > 0);
      case "active":
        return searched.filter((c) => ACTIVE_STATUSES.has(c.order_status));
      case "groups":
        return []; // placeholder — group chats not backed yet
      default:
        return searched;
    }
  }, [searched, tab]);

  const unreadTotal = useMemo(
    () => orderConversations.filter((c) => c.unread_count > 0).length,
    [orderConversations],
  );

  const activeConvo =
    orderConversations.find((c) => c.order_id === activeOrderId) ?? null;

  // ── select a conversation: open the realtime window + clear unread ──
  const selectConvo = useCallback(
    (c: OrderConversation) => {
      setActiveOrderId(c.order_id);
      setShowDetails(false);
      setDraft("");
      if (merchantId) {
        chat.openChat(c.user.username, userEmoji(c.user.username), c.order_id);
        clearUnreadForOrder(c.order_id);
      }
    },
    [chat, merchantId, clearUnreadForOrder],
  );

  // Auto-select the first conversation once data arrives.
  useEffect(() => {
    if (!activeOrderId && orderConversations.length > 0 && merchantId) {
      selectConvo(orderConversations[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderConversations, merchantId]);

  const activeWindow = chat.chatWindows.find((w) => w.orderId === activeOrderId);

  // Ordered list of every image in the open conversation — feeds the shared
  // Telegram-style viewer's filmstrip + prev/next navigation.
  const chatViewerImages = useMemo<ViewerImage[]>(
    () =>
      (activeWindow?.messages ?? [])
        .filter((m) => !!m.imageUrl)
        .map((m) => ({
          url: m.imageUrl as string,
          caption: m.text && m.text !== "Photo" ? m.text : undefined,
          senderName: m.senderName,
          timestamp: m.timestamp,
        })),
    [activeWindow?.messages],
  );

  // Mark read whenever the open conversation gains messages.
  const lastCountRef = useRef(0);
  useEffect(() => {
    if (!activeWindow) return;
    if (activeWindow.messages.length === lastCountRef.current) return;
    lastCountRef.current = activeWindow.messages.length;
    chat.markAsRead(activeWindow.id);
  }, [activeWindow, activeWindow?.messages.length, chat]);

  // Auto-scroll to newest.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeOrderId, activeWindow?.messages.length]);

  // ── live order details for the right rail ──
  // Realtime (Pusher per-order channel) with a polling fallback. This replaces
  // the old 15s-only poll so order-state changes — especially a counterparty's
  // mutual-cancel request, which doesn't change `status` — reflect near-instantly
  // (the hook refetches on every order event, so `cancel_requested_by` and the
  // Agree/Decline button appear at the ~2s backend floor instead of up to 15s).
  const {
    order: realtimeOrder,
    isLoading: orderLoading,
    refetch: refetchOrder,
  } = useRealtimeOrder(activeOrderId);
  const order = realtimeOrder as unknown as BackendOrder | null;
  // Back-compat alias: existing call sites imperatively reload after an action.
  // The hook always refetches its bound order (activeOrderId), so the orderId
  // arg is accepted but ignored.
  const loadOrder = useCallback(
    (_orderId?: string) => refetchOrder(),
    [refetchOrder],
  );

  // ── action dispatch ──
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const { dispatch, isLoading: actionLoading } = useOrderActionDispatch({
    actorId: merchantId ?? "",
    actorType: "merchant",
    onSuccess: () => {
      setActionMsg(null);
      if (activeOrderId) loadOrder(activeOrderId);
      fetchOrderConversations();
    },
    onError: (e) => setActionMsg(e),
  });

  // Reason modal for initiating a cancel / dispute (replaces native prompt()).
  const [reasonModal, setReasonModal] = useState<{
    type: "CANCEL" | "DISPUTE";
    reason: string;
  } | null>(null);
  // Confirm modal for plain confirm-then-dispatch actions (e.g. SEND_PAYMENT),
  // replacing the native window.confirm(). The orderId is captured at open time
  // so confirming after switching conversations can't dispatch against the
  // wrong order — window.confirm was synchronous and couldn't be raced this way.
  const [confirmModal, setConfirmModal] = useState<{
    type: ActionType;
    orderId: string;
    message: string;
  } | null>(null);
  // Responding to an incoming mutual-cancel request (Agree / Decline).
  const [respondingCancel, setRespondingCancel] = useState(false);

  // ── in-chat escrow lock ──
  // Lets the merchant lock escrow directly from the chat tab instead of being
  // bounced to the dashboard. Reuses the dashboard's exact escrow hook + modal,
  // so the on-chain signing / idempotency path is identical — only the mount
  // point differs. Wallet connection still lives on the dashboard (handleAction
  // falls back to /market when the wallet isn't connected).
  const solanaWallet = useSolanaWallet();
  const { playSound } = useSounds();
  const { addNotification } = useNotifications(merchantId, !!merchantId);
  // effectiveBalance mirrors useOrderFetching: mock mode uses a fixed in-app
  // balance, live mode reads on-chain USDT. The modal shows it; executeLockEscrow
  // re-checks the real on-chain balance before signing.
  const inAppBalance = MOCK_MODE ? 10000 : null;
  const effectiveBalance = MOCK_MODE ? inAppBalance : (solanaWallet?.usdtBalance ?? null);
  const {
    showEscrowModal,
    escrowOrder,
    isLockingEscrow,
    escrowTxHash,
    escrowError,
    openEscrowModal,
    executeLockEscrow,
    closeEscrowModal,
    // Release flow — used by CONFIRM_PAYMENT so the seller signs the on-chain
    // release (sends USDT to the buyer + completes) directly in the chat tab.
    showReleaseModal,
    releaseOrder,
    isReleasingEscrow,
    releaseTxHash,
    releaseError,
    openReleaseModal,
    executeRelease,
    closeReleaseModal,
  } = useEscrowOperations({
    solanaWallet,
    effectiveBalance,
    inAppBalance,
    addNotification,
    playSound,
    afterMutationReconcile: async (orderId: string) => {
      await loadOrder(orderId);
      fetchOrderConversations();
    },
    fetchOrders: async () => {
      fetchOrderConversations();
    },
    refreshBalance: () => {
      solanaWallet?.refreshBalances?.();
    },
    // Wallet connection lives on the dashboard; if the escrow flow needs it,
    // send the merchant there (handleAction also pre-checks `connected`).
    setShowWalletModal: (show: boolean) => {
      if (show) router.push("/market");
    },
    setRatingModalData: () => {},
  });

  const handleAction = useCallback(
    async (type: ActionType) => {
      if (!activeOrderId) return;

      // Lock Escrow runs IN the chat tab via the escrow modal. Wallet
      // connection still lives on the dashboard, so fall back to /market when
      // the wallet isn't connected.
      if (type === "LOCK_ESCROW") {
        if (!order) return;
        if (!solanaWallet?.connected) {
          router.push("/market");
          return;
        }
        openEscrowModal(
          mapDbOrderToUI(
            order as unknown as Parameters<typeof mapDbOrderToUI>[0],
            merchantId,
            merchantInfo?.display_name ?? null,
          ),
        );
        return;
      }

      // Confirm Payment = release escrow. The seller must sign the on-chain
      // release that sends USDT to the buyer + completes the order. Previously
      // this fell through to the generic action dispatch, which only advanced
      // the DB to `payment_confirmed` and NEVER released the crypto (a dead-end
      // state with no further action). Now it opens the release modal and runs
      // the same on-chain release the dashboard uses. Wallet connection still
      // lives on the dashboard, so fall back to /market when not connected.
      if (type === "CONFIRM_PAYMENT") {
        if (!order) return;
        if (!solanaWallet?.connected) {
          router.push("/market");
          return;
        }
        openReleaseModal(
          mapDbOrderToUI(
            order as unknown as Parameters<typeof mapDbOrderToUI>[0],
            merchantId,
            merchantInfo?.display_name ?? null,
          ),
        );
        return;
      }

      // ACCEPT / CLAIM still need the dashboard wallet flow.
      if (WALLET_FLOW_ACTIONS.has(type)) {
        router.push("/market");
        return;
      }

      // Cancel / dispute collect a reason via an in-app modal (not window.prompt).
      if (type === "CANCEL" || type === "DISPUTE") {
        setReasonModal({ type, reason: "" });
        return;
      }

      const labels: Record<string, string> = {
        SEND_PAYMENT: "Mark this order as payment sent?",
      };
      // In-app confirm modal (replaces the native window.confirm). The actual
      // dispatch runs in confirmGenericAction when the user confirms.
      setConfirmModal({
        type,
        orderId: activeOrderId,
        message: labels[type] ?? `Run ${type}?`,
      });
    },
    [activeOrderId, dispatch, router, order, solanaWallet, openEscrowModal, openReleaseModal, merchantId, merchantInfo],
  );

  // Confirm the reason modal → dispatch the cancel/dispute with the typed reason.
  const confirmReasonAction = useCallback(async () => {
    if (!reasonModal || !activeOrderId) return;
    const { type, reason } = reasonModal;
    const fallback = type === "CANCEL" ? "Cancelled by merchant" : "Dispute raised by merchant";
    setReasonModal(null);
    setActionMsg(null);
    await dispatch(activeOrderId, type, { reason: reason.trim() || fallback });
  }, [reasonModal, activeOrderId, dispatch]);

  // Confirm the generic confirm modal → dispatch against the captured orderId
  // (not the current activeOrderId, which may have changed if the merchant
  // switched conversations while the modal was open).
  const confirmGenericAction = useCallback(async () => {
    if (!confirmModal) return;
    const { type, orderId } = confirmModal;
    setConfirmModal(null);
    setActionMsg(null);
    await dispatch(orderId, type, {});
  }, [confirmModal, dispatch]);

  // Respond to an incoming mutual-cancel request: accept (refund) or decline.
  const respondCancel = useCallback(
    async (accept: boolean) => {
      if (!activeOrderId || !merchantId || respondingCancel) return;
      setRespondingCancel(true);
      setActionMsg(null);
      try {
        const res = await fetchWithAuth(`/api/orders/${activeOrderId}/cancel-request`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": orderActionKey(activeOrderId, "cancel_respond"),
          },
          body: JSON.stringify({ actor_type: "merchant", actor_id: merchantId, accept }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          loadOrder(activeOrderId);
          fetchOrderConversations();
        } else {
          setActionMsg(data.error || "Failed to respond to the cancellation request");
        }
      } catch {
        setActionMsg("Failed to respond to the cancellation request");
      } finally {
        setRespondingCancel(false);
      }
    },
    [activeOrderId, merchantId, respondingCancel, loadOrder, fetchOrderConversations],
  );

  // ── send a message (text + optional image) ──
  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !activeWindow) return;
    chat.sendMessage(activeWindow.id, body);
    setDraft("");
  }, [draft, activeWindow, chat]);

  const sendImage = useCallback(
    (imageUrl: string) => {
      if (!activeWindow) return;
      chat.sendMessage(activeWindow.id, "", imageUrl);
    },
    [activeWindow, chat],
  );

  /* ───────────────────────── render ───────────────────────── */

  const signedOut = !merchantId;
  const chatClosed = isChatClosed(order?.status);
  // Mutual-cancel request state. Prefer the requester id (reliable for M2M
  // where both parties are merchants); fall back to actor type for legacy rows.
  const cancelReqBy = order?.cancel_requested_by ?? null;
  const cancelReqById = order?.cancel_requested_by_id ?? null;
  const cancelReqReason = order?.cancel_request_reason ?? null;
  const iRequestedCancel =
    !!cancelReqBy && (cancelReqById ? cancelReqById === merchantId : cancelReqBy === "merchant");
  const incomingCancel = !!cancelReqBy && !iRequestedCancel;

  return (
    <div className="flex flex-col h-screen bg-[var(--color-bg-primary)] text-foreground">
      <MerchantNavbar activePage="chat" merchantInfo={merchantInfo} />

      <div className="flex-1 min-h-0 flex">
        {/* ───────────── LEFT: chats list ───────────── */}
        <aside className="hidden md:flex w-80 shrink-0 border-r border-white/[0.06] bg-[var(--color-bg-secondary)] flex-col">
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-foreground">Chats</h2>
              <button
                type="button"
                title="Start a new chat (coming soon)"
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:opacity-80 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-foreground/40 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  maxLength={100}
                  placeholder="Search chats…"
                  className="w-full bg-black/30 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-foreground placeholder-foreground/40 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <button
                type="button"
                title="Filters (coming soon)"
                className="p-2 rounded-lg border border-white/10 text-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-all"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>
            </div>

            {/* tabs */}
            <div className="flex items-center gap-1 mt-3">
              {TABS.map((t) => {
                const isActive = tab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`relative px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isActive
                        ? "bg-accent text-accent-text"
                        : "text-foreground/55 hover:text-foreground hover:bg-white/[0.06]"
                    }`}
                  >
                    {t.label}
                    {t.key === "unread" && unreadTotal > 0 && (
                      <span
                        className={`ml-1.5 text-[10px] font-bold ${
                          isActive ? "text-accent-text/70" : "text-accent"
                        }`}
                      >
                        {unreadTotal}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pulse-scroll py-2">
            {signedOut ? (
              <ListMessage text="Sign in to the merchant dashboard to see your trades." />
            ) : isLoadingConversations && orderConversations.length === 0 ? (
              <ListMessage spinner text="Loading conversations…" />
            ) : tab === "groups" ? (
              <ListMessage icon={Users} text="Group chats are coming soon." />
            ) : visibleConvos.length === 0 ? (
              <ListMessage
                text={
                  tab === "unread"
                    ? "No unread conversations."
                    : tab === "active"
                      ? "No active trades right now."
                      : search
                        ? "No matches."
                        : "No trade conversations yet."
                }
              />
            ) : (
              visibleConvos.map((c) => (
                <ConversationRow
                  key={c.order_id}
                  convo={c}
                  active={c.order_id === activeOrderId}
                  onSelect={selectConvo}
                />
              ))
            )}
          </div>
        </aside>

        {/* ───────────── CENTER: conversation ───────────── */}
        <main className="flex-1 min-w-0 flex flex-col bg-[var(--color-bg-primary)]">
          {!activeConvo ? (
            <EmptyCenter signedOut={signedOut} />
          ) : (
            <>
              {/* chat header */}
              <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-white/[0.06]">
                <div className="relative shrink-0">
                  <Avatar
                    name={activeConvo.user.username}
                    src={activeConvo.user.avatar_url}
                    className="w-9 h-9 rounded-full"
                  />
                  {isCounterpartyOnline(activeWindow, merchantId) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[var(--color-bg-primary)] bg-success" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {activeConvo.user.username}
                  </p>
                  <p className="text-[11px] text-foreground/50">
                    {activeWindow?.isTyping
                      ? "typing…"
                      : isCounterpartyOnline(activeWindow, merchantId)
                        ? "Online"
                        : "Offline"}
                  </p>
                </div>
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  className="lg:hidden p-2 text-foreground/50 hover:text-foreground hover:bg-white/[0.08] rounded-lg transition-all"
                  aria-label="Order details"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>

              {/* trade summary strip */}
              <TradeSummaryStrip
                convo={activeConvo}
                order={order}
                onViewOrder={() => setShowDetails(true)}
              />

              {/* messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto pulse-scroll px-4 py-4 space-y-3">
                {/* E2E banner */}
                <div className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-[11px] text-foreground/45 text-center max-w-xl mx-auto">
                  <Lock className="w-3 h-3 shrink-0" />
                  Never share personal info or payment details outside Blip Market. All chats are end-to-end encrypted.
                </div>

                {activeOrderId && chat.hasOlderMessages(activeOrderId) && activeWindow?.messages.length ? (
                  <div className="flex justify-center">
                    <button
                      onClick={() => chat.loadOlderMessages(activeOrderId)}
                      disabled={chat.isLoadingOlderMessages(activeOrderId)}
                      className="text-[11px] text-foreground/50 hover:text-accent px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] transition-colors"
                    >
                      {chat.isLoadingOlderMessages(activeOrderId) ? "Loading…" : "Load earlier messages"}
                    </button>
                  </div>
                ) : null}

                {!activeWindow || activeWindow.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-foreground/40 text-sm">
                    {activeWindow ? "No messages yet — say hello." : <Loader2 className="w-5 h-5 animate-spin" />}
                  </div>
                ) : (
                  <ImageViewerProvider images={chatViewerImages}>
                    <MessageStream messages={activeWindow.messages} status={order?.status ?? activeConvo.order_status} viewerRole={order?.my_role === "buyer" || order?.my_role === "seller" ? order.my_role : null} onRetry={(id) => chat.retryMessage(activeWindow.id, id)} />
                  </ImageViewerProvider>
                )}
              </div>

              {/* Incoming mutual-cancel request — respond inline in the chat. */}
              {incomingCancel && (
                <div className="shrink-0 border-t border-white/[0.06] px-3 py-2.5 bg-white/[0.03]">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-semibold text-foreground">
                        Cancel &amp; refund requested
                      </p>
                      <p className="text-[11px] text-foreground/55 leading-snug truncate">
                        {cancelReqReason || "Agree to cancel this order and refund the escrow."}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => respondCancel(true)}
                        disabled={respondingCancel}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-text text-[12.5px] font-semibold disabled:opacity-50"
                      >
                        {respondingCancel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        Agree
                      </button>
                      <button
                        onClick={() => respondCancel(false)}
                        disabled={respondingCancel}
                        className="px-3 py-1.5 rounded-lg border border-white/[0.12] text-foreground/80 hover:text-foreground hover:bg-white/[0.06] text-[12.5px] font-medium disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* composer */}
              <div className="shrink-0 border-t border-white/[0.06] p-3">
                {chatClosed ? (
                  <p className="text-center text-[11px] text-foreground/40 py-2">
                    This trade is {statusLabel(order?.status ?? "")} — chat is closed.
                  </p>
                ) : (
                  <div className="flex items-end gap-1.5">
                    {activeOrderId && (
                      <ImageUpload
                        orderId={activeOrderId}
                        onUploadComplete={sendImage}
                        onUploadError={(e) => setActionMsg(e)}
                      />
                    )}
                    <button
                      type="button"
                      title="Attach a file (coming soon)"
                      className="p-2 rounded-lg text-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                    >
                      <Paperclip className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      title="GIF (coming soon)"
                      className="p-2 rounded-lg text-foreground/50 hover:text-foreground hover:bg-white/[0.06] transition-colors"
                    >
                      <Smile className="w-5 h-5" />
                    </button>
                    <textarea
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (activeWindow) chat.sendTypingIndicator(activeWindow.id, e.target.value.length > 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      maxLength={1000}
                      placeholder="Type a message…  ( @ to tag a task )"
                      className="flex-1 resize-none bg-black/30 border border-white/10 rounded-2xl px-3 py-2.5 text-sm text-foreground placeholder-foreground/40 focus:outline-none focus:border-accent/50 max-h-32"
                    />
                    <button
                      onClick={send}
                      disabled={!draft.trim()}
                      className="p-2.5 rounded-full bg-accent text-accent-text hover:bg-accent-bright transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                      aria-label="Send"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </main>

        {/* ───────────── RIGHT: trade details + actions ───────────── */}
        {activeConvo && (
          <TradeDetailsPane
            convo={activeConvo}
            order={order}
            merchantId={merchantId}
            loading={orderLoading}
            actionLoading={actionLoading}
            actionMsg={actionMsg}
            onAction={handleAction}
            onRespondCancel={respondCancel}
            respondingCancel={respondingCancel}
            incomingCancelRequest={incomingCancel}
            iRequestedCancel={iRequestedCancel}
            cancelReqReason={cancelReqReason}
            onAppealResolved={() => {
              if (activeOrderId) loadOrder(activeOrderId);
              fetchOrderConversations();
            }}
            show={showDetails}
            onClose={() => setShowDetails(false)}
          />
        )}
      </div>

      {/* Reason modal — replaces the native prompt() for cancel / dispute. */}
      {reasonModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setReasonModal(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-2xl bg-[var(--color-bg-secondary)] border border-white/[0.1] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-semibold text-foreground">
              {reasonModal.type === "CANCEL" ? "Cancel order" : "Open a dispute"}
            </h3>
            <p className="text-[13px] text-foreground/55 mt-1.5 leading-snug">
              {reasonModal.type === "CANCEL"
                ? "The other party must accept before the order is cancelled and the escrow refunded."
                : "Describe the issue. A moderator will review it."}
            </p>
            <input
              autoFocus
              value={reasonModal.reason}
              onChange={(e) => setReasonModal({ ...reasonModal, reason: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmReasonAction();
              }}
              placeholder={
                reasonModal.type === "CANCEL" ? "Reason for cancelling…" : "Describe the issue…"
              }
              maxLength={200}
              className="mt-3 w-full rounded-xl px-3.5 py-2.5 text-[14px] text-foreground bg-white/[0.04] border border-white/[0.12] outline-none placeholder:text-foreground/35"
            />
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setReasonModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/[0.12] bg-white/[0.04] text-foreground text-[14px] font-medium hover:bg-white/[0.08]"
              >
                Back
              </button>
              <button
                onClick={confirmReasonAction}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-xl bg-accent text-accent-text text-[14px] font-semibold disabled:opacity-50"
              >
                {reasonModal.type === "CANCEL" ? "Request cancellation" : "Open dispute"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generic confirm modal — replaces the native window.confirm() for
          plain confirm-then-dispatch actions (e.g. Mark Payment Sent). */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="w-full max-w-[380px] rounded-2xl bg-[var(--color-bg-secondary)] border border-white/[0.1] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-semibold text-foreground">Confirm</h3>
            <p className="text-[13px] text-foreground/55 mt-1.5 leading-snug">
              {confirmModal.message}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-white/[0.12] bg-white/[0.04] text-foreground text-[14px] font-medium hover:bg-white/[0.08]"
              >
                Cancel
              </button>
              <button
                onClick={confirmGenericAction}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-xl bg-accent text-accent-text text-[14px] font-semibold disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escrow lock — opens in-chat when the merchant taps "Lock Escrow"
          (reuses the dashboard's escrow modal + signing flow). */}
      <EscrowLockModal
        showEscrowModal={showEscrowModal}
        escrowOrder={escrowOrder}
        isLockingEscrow={isLockingEscrow}
        escrowTxHash={escrowTxHash}
        escrowError={escrowError}
        effectiveBalance={effectiveBalance}
        onClose={closeEscrowModal}
        onExecute={executeLockEscrow}
      />

      {/* Confirm Payment → release escrow — opens in-chat when the seller taps
          "Confirm Payment" (signs the on-chain release, sends USDT to the buyer,
          completes the order). Reuses the dashboard's escrow release flow. */}
      <EscrowReleaseModal
        showReleaseModal={showReleaseModal}
        releaseOrder={releaseOrder}
        isReleasingEscrow={isReleasingEscrow}
        releaseTxHash={releaseTxHash}
        releaseError={releaseError}
        onClose={closeReleaseModal}
        onExecute={executeRelease}
      />
    </div>
  );
}

/* ───────────────────── presence / status helpers ───────────────────── */

function isCounterpartyOnline(
  w: ReturnType<typeof useRealtimeChat>["chatWindows"][number] | undefined,
  merchantId: string | null,
) {
  return !!w?.presence?.some(
    (p) =>
      p.isOnline &&
      p.actorId !== merchantId &&
      p.actorType !== "compliance" &&
      p.actorType !== "system",
  );
}

function isChatClosed(status?: string) {
  return ["completed", "cancelled", "expired"].includes(status ?? "");
}

/* ───────────────────── trade summary strip ───────────────────── */

function TradeSummaryStrip({
  convo,
  order,
  onViewOrder,
}: {
  convo: OrderConversation;
  order: BackendOrder | null;
  onViewOrder: () => void;
}) {
  const status = order?.status ?? convo.order_status;
  const crypto = order?.crypto_amount ?? convo.crypto_amount;
  const fiat = order?.fiat_amount ?? convo.fiat_amount;
  const ccy = order?.fiat_currency ?? convo.fiat_currency;
  const rate = order?.rate;
  // Perspective from the merchant's resolved role (backend-driven).
  const verb = order?.my_role === "buyer" ? "buying" : order?.my_role === "seller" ? "selling" : "trading";
  const pct = progressFraction(status);

  return (
    <div className="shrink-0 border-b border-white/[0.06] bg-[var(--color-bg-secondary)]/60 px-4 py-2.5">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="text-[10px] text-foreground/45 uppercase tracking-wider">You are {verb}</p>
          <p className="text-sm font-semibold text-foreground leading-tight">
            {formatCrypto(crypto)} <span className="text-foreground/50 text-xs font-medium">USDT</span>
          </p>
          {rate != null && (
            <p className="text-[10px] text-foreground/45">Price: {fiatSymbol(ccy)}{formatRate(rate)}</p>
          )}
        </div>

        <div className="min-w-0">
          <p className="text-[10px] text-foreground/45 uppercase tracking-wider">Total Amount</p>
          <p className="text-sm font-semibold text-foreground leading-tight">{formatFiat(fiat, ccy)}</p>
        </div>

        <div className="min-w-0 ml-auto">
          <p className="text-[10px] text-foreground/45 uppercase tracking-wider">Status</p>
          <p className="text-xs font-semibold text-warning">
            {order?.statusLabel ?? statusLabel(status)}
          </p>
          <div className="mt-1 h-1 w-28 rounded-full bg-white/[0.08] overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.round(pct * 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── message stream ───────────────────── */

function MessageStream({
  messages,
  status,
  viewerRole,
  onRetry,
}: {
  messages: ChatMessage[];
  status: string;
  viewerRole?: "buyer" | "seller" | null;
  onRetry?: (messageId: string) => void;
}) {
  const out: ReactNode[] = [];
  let lastDay = "";
  for (const m of messages) {
    const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp);
    const day = ts.toDateString();
    if (day !== lastDay) {
      lastDay = day;
      out.push(
        <div key={`day-${day}`} className="flex justify-center my-2">
          <span className="px-3 py-0.5 rounded-full bg-white/[0.05] text-[10px] text-foreground/45">
            {dayLabel(ts)}
          </span>
        </div>,
      );
    }
    out.push(<MessageItem key={m.id} m={m} status={status} viewerRole={viewerRole} onRetry={onRetry} />);
  }
  return <>{out}</>;
}

function MessageItem({
  m,
  status,
  viewerRole,
  onRetry,
}: {
  m: ChatMessage;
  status: string;
  viewerRole?: "buyer" | "seller" | null;
  onRetry?: (messageId: string) => void;
}) {
  const viewer = useImageViewerOptional();
  // Rich receipt cards (Payment Sent / Trade Completed) when the message
  // carries structured receipt data.
  if (m.messageType === "receipt" && m.receiptData) {
    return (
      <div className="flex justify-center">
        <div className="max-w-sm w-full">
          <ReceiptCard
            data={m.receiptData as unknown as ComponentProps<typeof ReceiptCard>["data"]}
            currentStatus={status}
            theme="dark"
          />
        </div>
      </div>
    );
  }

  // System / compliance events render as a centered pill.
  if (m.from === "system" || m.from === "compliance") {
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[10px] text-foreground/50 max-w-[80%] text-center">
          {m.from === "compliance" && <span className="text-accent font-semibold">Compliance:</span>}
          {personalizeAppealMessage(m.text, viewerRole)}
        </span>
      </div>
    );
  }

  const mine = m.from === "me";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3.5 py-2 ${
          mine
            ? "bg-accent text-accent-text rounded-br-md"
            : "bg-white/[0.05] text-foreground border border-white/[0.06] rounded-bl-md"
        }`}
      >
        {m.imageUrl && (
          <img
            src={m.imageUrl}
            alt=""
            className="rounded-lg mb-1 max-h-48 object-cover cursor-zoom-in"
            onClick={() =>
              viewer ? viewer.open(m.imageUrl!) : window.open(m.imageUrl!, "_blank", "noopener")
            }
          />
        )}
        {m.fileUrl && !m.imageUrl && (
          <a
            href={m.fileUrl}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-1.5 text-xs underline ${mine ? "text-accent-text/80" : "text-accent"}`}
          >
            <ExternalLink className="w-3 h-3" />
            {m.fileName ?? "Attachment"}
          </a>
        )}
        {m.text && <p className="text-sm leading-snug whitespace-pre-wrap break-words">{m.text}</p>}
        <div
          className={`flex items-center gap-1 justify-end mt-0.5 ${mine ? "text-accent-text/50" : "text-foreground/40"}`}
        >
          <span className="text-[9px]">
            {m.timestamp instanceof Date ? clock(m.timestamp) : clock(new Date(m.timestamp))}
          </span>
          {mine &&
            (m.status === "read" ? (
              <CheckCheck className="w-3 h-3 text-info" />
            ) : m.status === "delivered" ? (
              <CheckCheck className="w-3 h-3" />
            ) : m.status === "sending" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : m.status === "failed" ? (
              <button
                type="button"
                onClick={() => onRetry?.(m.id)}
                title="Not delivered — tap to retry"
                aria-label="Message failed to send. Tap to retry."
                className="flex items-center gap-0.5 text-error"
              >
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[9px] underline">Retry</span>
              </button>
            ) : (
              <Check className="w-3 h-3" />
            ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── left list pieces ───────────────────── */

function ListMessage({
  text,
  spinner,
  icon: Icon,
}: {
  text: string;
  spinner?: boolean;
  icon?: typeof Users;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-foreground/40 gap-2">
      {spinner && <Loader2 className="w-5 h-5 animate-spin" />}
      {Icon && <Icon className="w-7 h-7 opacity-50" />}
      <p className="text-xs">{text}</p>
    </div>
  );
}

function EmptyCenter({ signedOut }: { signedOut: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
      <MessagesSquare className="w-10 h-10 opacity-40" />
      <p className="text-sm">{signedOut ? "Sign in to view trade chats." : "Select a trade to start chatting."}</p>
    </div>
  );
}

function ConversationRow({
  convo: c,
  active,
  onSelect,
}: {
  convo: OrderConversation;
  active: boolean;
  onSelect: (c: OrderConversation) => void;
}) {
  const isActiveTrade = ACTIVE_STATUSES.has(c.order_status);
  const preview =
    c.last_message?.content ??
    `${fiatSymbol(c.fiat_currency)}${formatCrypto(c.fiat_amount)} · ${formatCrypto(c.crypto_amount)} USDT`;

  return (
    <button
      onClick={() => onSelect(c)}
      className={`group w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left border-l-2 ${
        active
          ? "bg-white/[0.05] border-accent"
          : "border-transparent hover:bg-white/[0.03]"
      }`}
    >
      <Avatar
        name={c.user.username}
        src={c.user.avatar_url}
        className="w-10 h-10 shrink-0 rounded-full"
        textClassName="text-[11px]"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 min-w-0">
            <span className="text-sm font-medium text-foreground truncate">{c.user.username}</span>
            {(c.user.total_trades ?? 0) >= 100 && (
              <Crown className="w-3 h-3 text-warning shrink-0" />
            )}
          </span>
          <span className="text-[10px] text-foreground/40 shrink-0">{rowTime(c.last_activity)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {isActiveTrade && <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />}
          <span className="text-[11px] text-foreground/45 shrink-0">
            {isActiveTrade ? "Active trade" : statusLabel(c.order_status)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-[11px] text-foreground/40 truncate">{preview}</p>
          {c.unread_count > 0 && (
            <span className="min-w-[18px] h-[18px] bg-accent text-accent-text text-[10px] font-bold rounded-full flex items-center justify-center px-1 shrink-0">
              {c.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ───────────────────── right trade-details pane ───────────────────── */

function TradeDetailsPane({
  convo,
  order,
  merchantId,
  loading,
  actionLoading,
  actionMsg,
  onAction,
  onRespondCancel,
  respondingCancel,
  incomingCancelRequest,
  iRequestedCancel,
  cancelReqReason,
  onAppealResolved,
  show,
  onClose,
}: {
  convo: OrderConversation;
  order: BackendOrder | null;
  merchantId: string | null;
  loading: boolean;
  actionLoading: boolean;
  actionMsg: string | null;
  onAction: (type: ActionType) => void;
  onRespondCancel: (accept: boolean) => void;
  respondingCancel: boolean;
  incomingCancelRequest: boolean;
  iRequestedCancel: boolean;
  cancelReqReason: string | null;
  onAppealResolved: () => void;
  show: boolean;
  onClose: () => void;
}) {
  // Prefer live order data, fall back to the conversation snapshot.
  const status = order?.status ?? convo.order_status;
  const type = order?.type ?? convo.order_type;
  const crypto = order?.crypto_amount ?? convo.crypto_amount;
  const fiat = order?.fiat_amount ?? convo.fiat_amount;
  const ccy = order?.fiat_currency ?? convo.fiat_currency;
  const rate = order?.rate;

  // Raise-Appeal entry point. Mirrors OrderQuickView: the merchant can open an
  // appeal once the trade is accepted (accepted / escrowed / payment_sent) and
  // no appeal is already active. Opening one pauses the auto-cancel timers and
  // starts the peer-resolution flow. `appealOrderId` falls back to the convo
  // snapshot so the hook works before the live order loads.
  const appealOrderId = order?.id ?? convo.order_id;
  const { appeal, refetch: refetchAppeal } = useOrderAppeal(appealOrderId, {
    enabled: !!appealOrderId,
  });
  const appealActive = isActiveAppeal(appeal);
  const showAppeal =
    ["accepted", "escrowed", "payment_sent"].includes(status) && !appealActive;
  const [appealSheetOpen, setAppealSheetOpen] = useState(false);

  // Backend-driven buttons (never computed on the frontend). primaryAction is
  // always present; secondaryAction may be null.
  const buttons: {
    type: ActionType;
    label: string;
    enabled: boolean;
    reason?: string;
    kind: "primary" | "secondary";
  }[] = [];
  if (order?.primaryAction?.type) {
    buttons.push({
      type: order.primaryAction.type,
      label: order.primaryAction.label,
      enabled: order.primaryAction.enabled,
      reason: order.primaryAction.disabledReason,
      kind: "primary",
    });
  }
  if (order?.secondaryAction?.type) {
    buttons.push({
      type: order.secondaryAction.type,
      label: order.secondaryAction.label,
      enabled: true,
      kind: "secondary",
    });
  }

  // Hide the normal "Cancel Order" button while a cancel request is in flight —
  // the responder card / waiting note covers it.
  const visibleButtons =
    incomingCancelRequest || iRequestedCancel
      ? buttons.filter((b) => b.type !== "CANCEL")
      : buttons;

  const body = (
    <div className="flex flex-col h-full">
      <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-foreground">Trade Details</h2>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="w-3.5 h-3.5 text-foreground/40 animate-spin" />}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 text-foreground/50 hover:text-foreground hover:bg-white/[0.08] rounded-lg transition-all"
            aria-label="Close"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pulse-scroll p-4 space-y-4">
        {/* active order */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-foreground/45 uppercase tracking-wider">Active Order</p>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${
                type === "buy" ? "bg-success/15 text-success" : "bg-error/15 text-error"
              }`}
            >
              {type}
            </span>
          </div>
          <div className="bg-[var(--color-bg-tertiary)] border border-white/[0.06] rounded-xl divide-y divide-white/[0.05]">
            <DetailRow label="Amount" value={`${formatCrypto(crypto)} USDT`} />
            {rate != null && <DetailRow label="Price" value={`${fiatSymbol(ccy)}${formatRate(rate)}`} />}
            <DetailRow label="Total" value={formatFiat(fiat, ccy)} />
            <DetailRow label="Order ID" value={order?.order_number ?? convo.order_number} mono />
            <div className="flex items-center justify-between px-3 py-2.5">
              <span className="text-[11px] text-foreground/50">Status</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[status] ?? STATUS_PILL.pending}`}>
                {order?.statusLabel ?? statusLabel(status)}
              </span>
            </div>
          </div>
          {order?.nextStepText && (
            <p className="text-[11px] text-foreground/45 leading-snug px-1 mt-2">{order.nextStepText}</p>
          )}
        </div>

        {/* time remaining */}
        {order?.expires_at && !order.isTerminal && (
          <TimeRemaining expiresAt={order.expires_at} />
        )}

        {/* payment status */}
        <PaymentStatus status={status} />

        {/* actions */}
        <div className="space-y-2">
          <p className="text-[10px] text-foreground/45 uppercase tracking-wider">Actions</p>
          {actionMsg && <p className="text-[11px] text-error px-1">{actionMsg}</p>}

          {/* Mutual-cancellation APPEAL — Agree to Cancel / Reject when the
              counterparty raised one, or a "waiting" note when I did. Self-hides
              when there's no active mutual_cancel appeal. This is the current
              cancellation path; the cancel_requested_by block below is legacy. */}
          {(order?.id ?? convo.order_id) && (
            <MutualCancelAppealBanner
              orderId={order?.id ?? convo.order_id}
              viewerActorId={merchantId}
              variant="merchant"
              enabled={!["cancelled", "expired", "completed", "disputed"].includes(status)}
              onResolved={onAppealResolved}
            />
          )}

          {/* Incoming mutual-cancel request — respond inline (Agree / Decline). */}
          {incomingCancelRequest && (
            <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-3 space-y-2">
              <p className="text-[12px] font-semibold text-foreground">
                Cancel &amp; refund requested
              </p>
              {cancelReqReason && (
                <p className="text-[11px] text-foreground/55 leading-snug">{cancelReqReason}</p>
              )}
              <p className="text-[11px] text-foreground/55 leading-snug">
                If you agree, the order is cancelled and the escrow is refunded.
              </p>
              <div className="flex gap-2 pt-0.5">
                <button
                  onClick={() => onRespondCancel(true)}
                  disabled={respondingCancel}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-accent text-accent-text text-[13px] font-semibold disabled:opacity-50"
                >
                  {respondingCancel ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Agree to cancel
                </button>
                <button
                  onClick={() => onRespondCancel(false)}
                  disabled={respondingCancel}
                  className="flex-1 px-3 py-2 rounded-lg border border-white/[0.12] bg-transparent text-foreground/80 hover:text-foreground hover:bg-white/[0.06] text-[13px] font-medium disabled:opacity-50"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* I requested a cancel — waiting for the other party. */}
          {iRequestedCancel && (
            <div className="rounded-xl border border-white/[0.12] bg-white/[0.04] p-3">
              <p className="text-[12px] font-medium text-foreground/70 leading-snug">
                Waiting for the other party to accept your cancellation request…
              </p>
            </div>
          )}

          {visibleButtons.length === 0 ? (
            !incomingCancelRequest && !iRequestedCancel ? (
              <p className="text-[11px] text-foreground/40 py-1">
                {order ? "No actions available for this status." : loading ? "Loading actions…" : "—"}
              </p>
            ) : null
          ) : (
            visibleButtons.map((b) => {
              const Icon = ACTION_ICON[b.type] ?? Check;
              const redirectsToDashboard = DASHBOARD_REDIRECT_ACTIONS.has(b.type);
              const cls =
                b.kind === "secondary"
                  ? b.type === "DISPUTE"
                    ? "bg-transparent text-error border border-error/40 hover:bg-error/10"
                    : "bg-transparent text-foreground/80 hover:text-foreground border border-white/12 hover:bg-white/[0.06]"
                  : "bg-accent hover:bg-accent-bright text-accent-text font-semibold";
              return (
                <button
                  key={`${b.kind}-${b.type}`}
                  onClick={() => onAction(b.type)}
                  disabled={!b.enabled || actionLoading}
                  title={b.reason}
                  className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${cls}`}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                  {b.label}
                  {redirectsToDashboard && <ExternalLink className="w-3 h-3 opacity-60" />}
                </button>
              );
            })
          )}
          {visibleButtons.some((b) => DASHBOARD_REDIRECT_ACTIONS.has(b.type)) && (
            <p className="text-[10px] text-foreground/40 text-center leading-snug">
              Accepting a trade opens the dashboard for wallet signing.
            </p>
          )}

          {/* Raise Appeal — available once the trade is accepted and no appeal
              is already active. Opens the merchant appeal sheet (same endpoint /
              flow as the dashboard quick-view). */}
          {showAppeal && (
            <button
              type="button"
              onClick={() => setAppealSheetOpen(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-white/12 text-foreground/80 hover:text-foreground hover:bg-white/[0.06] text-sm transition-colors"
            >
              <Flag className="w-4 h-4" />
              Raise Appeal
            </button>
          )}
        </div>

        {/* settlement note */}
        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <CircleDollarSign className="w-3.5 h-3.5 text-foreground/50 shrink-0 mt-0.5" />
          <p className="text-[11px] text-foreground/60 leading-snug">
            Merchant rate + Blip fee apply on settlement. Release only after funds confirm.
          </p>
        </div>
      </div>

      {/* need help */}
      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <p className="text-[10px] text-foreground/45 uppercase tracking-wider mb-1.5">Need Help?</p>
        <button
          type="button"
          title="Support"
          onClick={() => openIssueReporter()}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-white/12 text-foreground/80 hover:text-foreground hover:bg-white/[0.06] text-sm transition-colors"
        >
          <LifeBuoy className="w-4 h-4" />
          Support
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex w-80 shrink-0 border-l border-white/[0.06] bg-[var(--color-bg-secondary)] flex-col">
        {body}
      </aside>

      {show && (
        <>
          <div className="lg:hidden fixed inset-0 z-30 bg-black/50" onClick={onClose} />
          <aside className="lg:hidden fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] bg-[var(--color-bg-secondary)] border-l border-white/[0.06] shadow-2xl flex flex-col">
            {body}
          </aside>
        </>
      )}

      {/* Merchant Raise-Appeal sheet — fixed overlay (z-[150]). On submit, refresh
          the appeal (hides the button, surfaces the mutual-cancel banner) and the
          order so its actions reflect the paused timers. */}
      {appealSheetOpen && appealOrderId && (
        <MerchantAppealSheet
          orderId={appealOrderId}
          orderStatus={status}
          displayId={order?.order_number ?? convo.order_number}
          onClose={() => setAppealSheetOpen(false)}
          onSubmitted={() => {
            void refetchAppeal();
            onAppealResolved();
          }}
        />
      )}
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-[11px] text-foreground/50 shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

/** Live mm:ss countdown to expires_at. Hides itself once elapsed. */
function TimeRemaining({ expiresAt }: { expiresAt: string }) {
  const target = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, Math.floor((target - now) / 1000));
  if (remaining <= 0) return null;

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");
  const urgent = remaining < 120;

  return (
    <div>
      <p className="text-[10px] text-foreground/45 uppercase tracking-wider mb-1.5">Time Remaining</p>
      <div className="bg-[var(--color-bg-tertiary)] border border-white/[0.06] rounded-xl px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Clock className={`w-4 h-4 ${urgent ? "text-warning" : "text-foreground/50"}`} />
          <span className={`text-lg font-bold font-mono tabular-nums ${urgent ? "text-warning" : "text-foreground"}`}>
            {mm}:{ss}
          </span>
          <span className="text-[11px] text-foreground/45">min</span>
        </div>
        <p className="text-[10px] text-foreground/45 mt-1">Do not release crypto before receiving payment.</p>
      </div>
    </div>
  );
}

/** Derived payment status. Wording is deliberately conservative — we never
 *  assert "Payment Received" until the order is completed. */
function PaymentStatus({ status }: { status: string }) {
  let label: string;
  let tone: "success" | "warning" | "muted";
  let Icon = Clock;
  switch (status) {
    case "completed":
      label = "Payment received & released";
      tone = "success";
      Icon = CheckCheck;
      break;
    case "payment_sent":
    case "payment_pending":
      label = "Buyer marked as paid — verify before releasing";
      tone = "warning";
      Icon = AlertTriangle;
      break;
    case "escrowed":
      label = "Awaiting buyer payment";
      tone = "muted";
      break;
    case "disputed":
      label = "Under dispute review";
      tone = "warning";
      Icon = AlertTriangle;
      break;
    default:
      label = "Not started";
      tone = "muted";
  }
  const toneCls =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground/55";

  return (
    <div>
      <p className="text-[10px] text-foreground/45 uppercase tracking-wider mb-1.5">Payment Status</p>
      <div className="flex items-center gap-2 bg-[var(--color-bg-tertiary)] border border-white/[0.06] rounded-xl px-3 py-2.5">
        <Icon className={`w-4 h-4 shrink-0 ${toneCls}`} />
        <span className={`text-xs font-medium ${toneCls}`}>{label}</span>
      </div>
    </div>
  );
}
