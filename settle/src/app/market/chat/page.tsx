"use client";

/**
 * Trade Chat — merchant dashboard
 * ────────────────────────────────────────────────────────────────────────
 * 3-pane conversation workspace styled with the Pulse design language
 * (dark + burnt-orange #ff6b35), wired to live data:
 *
 *   LEFT   — real order conversations (useMerchantConversations), split into
 *            Favorites (local, persisted) and Others, with unread badges.
 *   CENTER — the live chat for the selected trade (useRealtimeChat): Pusher
 *            messages, optimistic send, typing, read receipts, load-older.
 *   RIGHT  — live order details (GET /api/orders/:id) + the backend-driven
 *            action buttons (primaryAction / secondaryAction). Safe
 *            transitions dispatch via useOrderActionDispatch; the
 *            wallet-signing actions (ACCEPT / LOCK_ESCROW / CLAIM) route to
 *            the dashboard escrow flow rather than re-implementing signing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Send,
  Star,
  MoreVertical,
  CheckCheck,
  Check,
  CircleDollarSign,
  Ban,
  AlertTriangle,
  Lock,
  Info,
  ChevronLeft,
  ArrowLeftRight,
  Loader2,
  MessagesSquare,
  ExternalLink,
} from "lucide-react";
import { MerchantNavbar } from "@/components/merchant/MerchantNavbar";
import { useMerchantStore } from "@/stores/merchantStore";
import {
  useMerchantConversations,
  type OrderConversation,
} from "@/hooks/useMerchantConversations";
import { useRealtimeChat, type ChatMessage } from "@/hooks/useRealtimeChat";
import { useOrderActionDispatch } from "@/hooks/useOrderActionDispatch";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { BackendOrder, ActionType } from "@/types/backendOrder";
import { formatCrypto, formatFiat } from "@/lib/format";

/* ───────────────────────── helpers ───────────────────────── */

const FAV_KEY = "blip_chat_favorites";

const STATUS_PILL: Record<string, string> = {
  pending: "bg-gray-500/15 text-gray-400",
  accepted: "bg-blue-500/15 text-blue-400",
  escrowed: "bg-[#ff6b35]/15 text-[#ff6b35]",
  payment_sent: "bg-yellow-500/15 text-yellow-400",
  payment_pending: "bg-yellow-500/15 text-yellow-400",
  completed: "bg-green-500/15 text-green-400",
  disputed: "bg-red-500/15 text-red-400",
  cancelled: "bg-gray-500/15 text-gray-500",
  expired: "bg-gray-500/15 text-gray-500",
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

const AVATAR_COLORS = [
  "bg-orange-500/20 text-orange-400",
  "bg-purple-500/20 text-purple-400",
  "bg-blue-500/20 text-blue-400",
  "bg-green-500/20 text-green-400",
  "bg-pink-500/20 text-pink-400",
];
function avatarColor(name: string) {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

const EMOJIS = ["🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🐸", "🐙", "🦋", "🐳", "🦄", "🐲"];
function userEmoji(name: string) {
  const hash = name.split("").reduce((a, b) => a + b.charCodeAt(0), 0);
  return EMOJIS[hash % EMOJIS.length];
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

function fiatSymbol(ccy?: string) {
  return ccy === "INR" ? "₹" : ccy === "AED" ? "AED " : (ccy ? ccy + " " : "");
}

/* Actions that require the embedded-wallet / on-chain escrow signing flow.
   We do NOT re-implement signing here — clicking routes to the dashboard. */
const WALLET_FLOW_ACTIONS = new Set<ActionType>(["ACCEPT", "LOCK_ESCROW", "CLAIM"]);

const ACTION_ICON: Partial<Record<ActionType, typeof Check>> = {
  ACCEPT: Check,
  CLAIM: Check,
  LOCK_ESCROW: Lock,
  SEND_PAYMENT: ArrowLeftRight,
  CONFIRM_PAYMENT: CheckCheck,
  CANCEL: Ban,
  DISPUTE: AlertTriangle,
};

/* ───────────────────────── page ───────────────────────── */

export default function TradeChatPage() {
  const router = useRouter();
  const merchantId = useMerchantStore((s) => s.merchantId);
  const merchantInfo = useMerchantStore((s) => s.merchantInfo);

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
  const [draft, setDraft] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── favorites (persisted locally — OrderConversation has no favorite flag) ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavorites(new Set(JSON.parse(raw)));
    } catch {
      /* ignore */
    }
  }, []);
  const toggleFav = useCallback((userId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ── filtered + grouped conversations ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orderConversations;
    return orderConversations.filter(
      (c) =>
        c.user.username.toLowerCase().includes(q) ||
        c.order_number.toLowerCase().includes(q),
    );
  }, [orderConversations, search]);

  const favConvos = filtered.filter((c) => favorites.has(c.user.id));
  const otherConvos = filtered.filter((c) => !favorites.has(c.user.id));

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
  const [order, setOrder] = useState<BackendOrder | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);

  const loadOrder = useCallback(async (orderId: string) => {
    setOrderLoading(true);
    try {
      const res = await fetchWithAuth(`/api/orders/${orderId}`);
      if (!res.ok) return;
      const data = await res.json();
      const o: BackendOrder = data?.data ?? data;
      setOrder(o);
    } catch {
      /* best-effort */
    } finally {
      setOrderLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeOrderId) {
      setOrder(null);
      return;
    }
    loadOrder(activeOrderId);
    const t = setInterval(() => loadOrder(activeOrderId), 15000);
    return () => clearInterval(t);
  }, [activeOrderId, loadOrder]);

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

  const handleAction = useCallback(
    async (type: ActionType) => {
      if (!activeOrderId) return;

      // Wallet-signing / on-chain escrow actions live on the dashboard.
      if (WALLET_FLOW_ACTIONS.has(type)) {
        router.push("/market");
        return;
      }

      let reason: string | undefined;
      if (type === "CANCEL") {
        const r = window.prompt("Reason for cancelling this order?");
        if (r === null) return; // user dismissed
        reason = r || "Cancelled by merchant";
      } else if (type === "DISPUTE") {
        const r = window.prompt("Describe the issue to open a dispute:");
        if (r === null) return;
        reason = r || "Dispute raised by merchant";
      } else {
        const labels: Record<string, string> = {
          SEND_PAYMENT: "Mark this order as payment sent?",
          CONFIRM_PAYMENT: "Confirm payment received and release escrow?",
        };
        if (!window.confirm(labels[type] ?? `Run ${type}?`)) return;
      }

      setActionMsg(null);
      await dispatch(activeOrderId, type, { reason });
    },
    [activeOrderId, dispatch, router],
  );

  // ── send a message ──
  const send = useCallback(() => {
    const body = draft.trim();
    if (!body || !activeWindow) return;
    chat.sendMessage(activeWindow.id, body);
    setDraft("");
  }, [draft, activeWindow, chat]);

  /* ───────────────────────── render ───────────────────────── */

  const signedOut = !merchantId;

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-white">
      <MerchantNavbar activePage="chat" merchantInfo={merchantInfo} />

      <div className="flex-1 min-h-0 flex">
        {/* ───────────── LEFT: people list ───────────── */}
        <aside className="hidden md:flex w-72 shrink-0 border-r border-white/[0.06] bg-[#111] flex-col">
          <div className="px-4 py-3 border-b border-white/[0.06]">
            <h2 className="text-sm font-semibold text-white mb-2.5">Trades</h2>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
                placeholder="Search name or order…"
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#ff6b35]/50 transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pulse-scroll py-2">
            {signedOut ? (
              <ListMessage text="Sign in to the merchant dashboard to see your trades." />
            ) : isLoadingConversations && orderConversations.length === 0 ? (
              <ListMessage spinner text="Loading conversations…" />
            ) : orderConversations.length === 0 ? (
              <ListMessage text="No trade conversations yet." />
            ) : (
              <>
                <PeopleSection
                  title="Favorites"
                  convos={favConvos}
                  activeId={activeOrderId}
                  favorites={favorites}
                  onSelect={selectConvo}
                  onToggleFav={toggleFav}
                />
                <PeopleSection
                  title="Others"
                  convos={otherConvos}
                  activeId={activeOrderId}
                  favorites={favorites}
                  onSelect={selectConvo}
                  onToggleFav={toggleFav}
                />
              </>
            )}
          </div>
        </aside>

        {/* ───────────── CENTER: conversation ───────────── */}
        <main className="flex-1 min-w-0 flex flex-col bg-[#0d0d0d]">
          {!activeConvo ? (
            <EmptyCenter signedOut={signedOut} />
          ) : (
            <>
              {/* chat header */}
              <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-white/[0.06]">
                <div className="relative shrink-0">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${avatarColor(activeConvo.user.username)}`}
                  >
                    {initials(activeConvo.user.username)}
                  </div>
                  {isCounterpartyOnline(activeWindow, merchantId) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0d0d0d] bg-green-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">
                      @{activeConvo.user.username}
                    </p>
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-gray-400">
                      <Star className="w-3 h-3 text-[#ff6b35] fill-[#ff6b35]" />
                      {activeConvo.user.rating?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {activeWindow?.isTyping
                      ? "typing…"
                      : isCounterpartyOnline(activeWindow, merchantId)
                        ? "Online"
                        : "Offline"}{" "}
                    · {activeConvo.user.total_trades ?? 0} trades
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[order?.status ?? activeConvo.order_status] ?? STATUS_PILL.pending}`}
                >
                  {order?.statusLabel ?? statusLabel(activeConvo.order_status)}
                </span>
                <button
                  onClick={() => setShowDetails((v) => !v)}
                  className="lg:hidden p-2 text-gray-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
                  aria-label="Order details"
                >
                  <Info className="w-5 h-5" />
                </button>
              </div>

              {/* messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto pulse-scroll px-4 py-4 space-y-3">
                {activeOrderId && chat.hasOlderMessages(activeOrderId) && activeWindow?.messages.length ? (
                  <div className="flex justify-center">
                    <button
                      onClick={() => chat.loadOlderMessages(activeOrderId)}
                      disabled={chat.isLoadingOlderMessages(activeOrderId)}
                      className="text-[11px] text-gray-500 hover:text-[#ff6b35] px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] transition-colors"
                    >
                      {chat.isLoadingOlderMessages(activeOrderId) ? "Loading…" : "Load earlier messages"}
                    </button>
                  </div>
                ) : null}

                {!activeWindow || activeWindow.messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-gray-600 text-sm">
                    {activeWindow ? "No messages yet — say hello." : <Loader2 className="w-5 h-5 animate-spin" />}
                  </div>
                ) : (
                  activeWindow.messages.map((m) => <MessageBubble key={m.id} m={m} />)
                )}
              </div>

              {/* composer */}
              <div className="shrink-0 border-t border-white/[0.06] p-3">
                {isChatClosed(order?.status) ? (
                  <p className="text-center text-[11px] text-gray-600 py-2">
                    This trade is {statusLabel(order?.status ?? "")} — chat is closed.
                  </p>
                ) : (
                  <div className="flex items-end gap-2">
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
                      placeholder="Type a message…"
                      className="flex-1 resize-none bg-black/40 border border-white/10 rounded-2xl px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-[#ff6b35]/50 max-h-32"
                    />
                    <button
                      onClick={send}
                      disabled={!draft.trim()}
                      className="p-2.5 rounded-full bg-[#ff6b35] text-black hover:bg-[#ff7a4a] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
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

        {/* ───────────── RIGHT: order details + actions ───────────── */}
        {activeConvo && (
          <OrderDetailsPane
            convo={activeConvo}
            order={order}
            loading={orderLoading}
            actionLoading={actionLoading}
            actionMsg={actionMsg}
            onAction={handleAction}
            show={showDetails}
            onClose={() => setShowDetails(false)}
          />
        )}
      </div>
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

/* ───────────────────── message bubble ───────────────────── */

function MessageBubble({ m }: { m: ChatMessage }) {
  if (m.from === "system" || m.from === "compliance") {
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[10px] text-gray-400 max-w-[80%] text-center">
          {m.from === "compliance" && <span className="text-[#ff6b35] font-semibold">Compliance:</span>}
          {m.text}
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
            ? "bg-[#ff6b35] text-black rounded-br-md"
            : "bg-[#1a1a1a] text-gray-100 border border-white/[0.06] rounded-bl-md"
        }`}
      >
        {m.imageUrl && (
          <img src={m.imageUrl} alt="" className="rounded-lg mb-1 max-h-48 object-cover" />
        )}
        {m.fileUrl && !m.imageUrl && (
          <a
            href={m.fileUrl}
            target="_blank"
            rel="noreferrer"
            className={`flex items-center gap-1.5 text-xs underline ${mine ? "text-black/80" : "text-[#ff6b35]"}`}
          >
            <ExternalLink className="w-3 h-3" />
            {m.fileName ?? "Attachment"}
          </a>
        )}
        {m.text && <p className="text-sm leading-snug whitespace-pre-wrap break-words">{m.text}</p>}
        <div
          className={`flex items-center gap-1 justify-end mt-0.5 ${mine ? "text-black/50" : "text-gray-600"}`}
        >
          <span className="text-[9px]">
            {m.timestamp instanceof Date ? clock(m.timestamp) : clock(new Date(m.timestamp))}
          </span>
          {mine &&
            (m.status === "read" ? (
              <CheckCheck className="w-3 h-3 text-blue-700" />
            ) : m.status === "delivered" ? (
              <CheckCheck className="w-3 h-3" />
            ) : m.status === "sending" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────── left list section ───────────────────── */

function ListMessage({ text, spinner }: { text: string; spinner?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center text-gray-600 gap-2">
      {spinner && <Loader2 className="w-5 h-5 animate-spin" />}
      <p className="text-xs">{text}</p>
    </div>
  );
}

function EmptyCenter({ signedOut }: { signedOut: boolean }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-3">
      <MessagesSquare className="w-10 h-10 opacity-40" />
      <p className="text-sm">{signedOut ? "Sign in to view trade chats." : "Select a trade to start chatting."}</p>
    </div>
  );
}

function PeopleSection({
  title,
  convos,
  activeId,
  favorites,
  onSelect,
  onToggleFav,
}: {
  title: string;
  convos: OrderConversation[];
  activeId: string | null;
  favorites: Set<string>;
  onSelect: (c: OrderConversation) => void;
  onToggleFav: (userId: string) => void;
}) {
  if (convos.length === 0) return null;
  return (
    <div className="mb-2">
      <p className="px-4 text-[10px] text-gray-500 uppercase tracking-wider mb-1">{title}</p>
      {convos.map((c) => {
        const isActive = c.order_id === activeId;
        const isFav = favorites.has(c.user.id);
        const preview =
          c.last_message?.content ??
          `${fiatSymbol(c.fiat_currency)}${formatCrypto(c.fiat_amount)} · ${formatCrypto(c.crypto_amount)} USDT`;
        return (
          <button
            key={c.order_id}
            onClick={() => onSelect(c)}
            className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left mx-auto ${
              isActive
                ? "bg-[#ff6b35]/10 border border-[#ff6b35]/20"
                : "hover:bg-white/[0.04] border border-transparent"
            }`}
            style={{ width: "calc(100% - 0.5rem)" }}
          >
            <div
              className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold ${avatarColor(c.user.username)}`}
            >
              {initials(c.user.username)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-white truncate">@{c.user.username}</p>
                <span className="text-[10px] text-gray-600 shrink-0">{rowTime(c.last_activity)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-gray-500 truncate">{preview}</p>
                {c.unread_count > 0 ? (
                  <span className="min-w-[18px] h-[18px] bg-[#ff6b35] text-black text-[10px] font-bold rounded-full flex items-center justify-center px-1 shrink-0">
                    {c.unread_count}
                  </span>
                ) : (
                  <Star
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFav(c.user.id);
                    }}
                    className={`w-3.5 h-3.5 shrink-0 cursor-pointer transition-colors ${
                      isFav
                        ? "text-[#ff6b35] fill-[#ff6b35]"
                        : "text-gray-600 opacity-0 group-hover:opacity-100 hover:text-[#ff6b35]"
                    }`}
                  />
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────────────────── right details pane ───────────────────── */

function OrderDetailsPane({
  convo,
  order,
  loading,
  actionLoading,
  actionMsg,
  onAction,
  show,
  onClose,
}: {
  convo: OrderConversation;
  order: BackendOrder | null;
  loading: boolean;
  actionLoading: boolean;
  actionMsg: string | null;
  onAction: (type: ActionType) => void;
  show: boolean;
  onClose: () => void;
}) {
  // Prefer live order data, fall back to the conversation snapshot.
  const status = order?.status ?? convo.order_status;
  const type = order?.type ?? convo.order_type;
  const crypto = order?.crypto_amount ?? convo.crypto_amount;
  const fiat = order?.fiat_amount ?? convo.fiat_amount;
  const ccy = order?.fiat_currency ?? convo.fiat_currency;
  const pay = order?.payment_details;

  // Backend-driven buttons (never computed on the frontend). primaryAction is
  // always present; secondaryAction may be null. Fall back to nothing if the
  // order hasn't loaded yet.
  const buttons: { type: ActionType; label: string; enabled: boolean; reason?: string; kind: "primary" | "secondary" }[] = [];
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

  const body = (
    <div className="flex flex-col h-full">
      <div className="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06]">
        <h2 className="text-sm font-semibold text-white">Order details</h2>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="w-3.5 h-3.5 text-gray-500 animate-spin" />}
          <button className="p-1.5 text-gray-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all">
            <MoreVertical className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 text-gray-400 hover:text-white hover:bg-white/[0.08] rounded-lg transition-all"
            aria-label="Close"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pulse-scroll p-4 space-y-4">
        <div className="bg-[#141414] border border-white/[0.06] rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="font-mono text-sm font-semibold text-white">
              {order?.order_number ?? convo.order_number}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wide ${
                type === "buy" ? "bg-green-500/15 text-green-400" : "bg-[#ff6b35]/15 text-[#ff6b35]"
              }`}
            >
              {type}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="bg-black/40 rounded-xl px-3 py-2.5">
              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Crypto</p>
              <p className="text-base font-bold text-white leading-none mt-1">
                {formatCrypto(crypto)}
                <span className="text-[10px] text-gray-500 font-medium ml-1">USDT</span>
              </p>
            </div>
            <div className="bg-black/40 rounded-xl px-3 py-2.5">
              <p className="text-[9px] text-gray-400 uppercase tracking-wider">Fiat</p>
              <p className="text-base font-bold text-white leading-none mt-1">{formatFiat(fiat, ccy)}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-black/20">
          <span className="text-[11px] text-gray-500">Status</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_PILL[status] ?? STATUS_PILL.pending}`}>
            {order?.statusLabel ?? statusLabel(status)}
          </span>
        </div>

        {order?.nextStepText && (
          <p className="text-[11px] text-gray-400 leading-snug px-1">{order.nextStepText}</p>
        )}

        {/* counterparty */}
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Counterparty</p>
          <div className="bg-[#141414] border border-white/[0.06] rounded-xl p-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${avatarColor(convo.user.username)}`}
              >
                {initials(convo.user.username)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">@{convo.user.username}</p>
                <p className="text-[11px] text-gray-500 flex items-center gap-1">
                  <Star className="w-3 h-3 text-[#ff6b35] fill-[#ff6b35]" />
                  {convo.user.rating?.toFixed(1) ?? "—"} · {convo.user.total_trades ?? 0} trades
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* payment details */}
        {pay && (pay.bank_name || pay.bank_account_name || pay.bank_iban || pay.location_name) && (
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Payment details</p>
            <div className="space-y-1">
              {pay.bank_name && <InfoRow label="Bank" value={pay.bank_name} />}
              {pay.bank_account_name && <InfoRow label="Account name" value={pay.bank_account_name} />}
              {pay.bank_iban && <InfoRow label="Account / IBAN" value={pay.bank_iban} mono />}
              {pay.location_name && <InfoRow label="Location" value={pay.location_name} />}
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#ff6b35]/[0.06] border border-[#ff6b35]/15">
          <CircleDollarSign className="w-3.5 h-3.5 text-[#ff6b35] shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-300 leading-snug">
            Merchant rate + Blip fee apply on settlement. Release only after funds confirm.
          </p>
        </div>
      </div>

      {/* action buttons */}
      <div className="shrink-0 border-t border-white/[0.06] p-3 space-y-2">
        {actionMsg && (
          <p className="text-[11px] text-red-400 text-center px-2">{actionMsg}</p>
        )}
        {buttons.length === 0 ? (
          <p className="text-center text-[11px] text-gray-600 py-2">
            {order ? "No actions available for this status." : loading ? "Loading actions…" : "—"}
          </p>
        ) : (
          buttons.map((b) => {
            const Icon = ACTION_ICON[b.type] ?? Check;
            const isWalletFlow = WALLET_FLOW_ACTIONS.has(b.type);
            const cls =
              b.kind === "secondary"
                ? b.type === "DISPUTE"
                  ? "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
                  : "text-gray-300 hover:text-white hover:bg-white/[0.06] border border-white/10"
                : "bg-[#ff6b35] hover:bg-[#ff7a4a] text-black font-semibold";
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
                {isWalletFlow && <ExternalLink className="w-3 h-3 opacity-60" />}
              </button>
            );
          })
        )}
        {buttons.some((b) => WALLET_FLOW_ACTIONS.has(b.type)) && (
          <p className="text-[10px] text-gray-600 text-center leading-snug">
            Escrow & accept require your wallet — opens the trade panel.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex w-80 shrink-0 border-l border-white/[0.06] bg-[#111] flex-col">
        {body}
      </aside>

      {show && (
        <>
          <div className="lg:hidden fixed inset-0 z-30 bg-black/50" onClick={onClose} />
          <aside className="lg:hidden fixed inset-y-0 right-0 z-40 w-80 max-w-[85vw] bg-[#111] border-l border-white/[0.06] shadow-2xl flex flex-col">
            {body}
          </aside>
        </>
      )}
    </>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-black/20">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className={`text-[11px] font-semibold text-gray-200 truncate ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
