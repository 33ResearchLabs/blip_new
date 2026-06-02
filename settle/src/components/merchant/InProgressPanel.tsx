"use client";

import { memo, useRef, useState, useMemo } from "react";
import {
  Shield,
  Zap,
  ChevronRight,
  ChevronDown,
  Clock,
  XCircle,
  MessageSquare,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  getAuthoritativeStatus,
  getStatusBadgeConfig,
  getNextAction as getNextActionFromStatus,
  MinimalStatus,
} from "@/lib/orders/statusResolver";
import {
  useCorridorPrices,
  resolveCorridorRef,
} from "@/hooks/useCorridorPrices";
import {
  InfoTooltip,
  type InfoTooltipItem,
} from "@/components/shared/InfoTooltip";

// Rule badge content for the "In Progress" header. Items labels are kept
// short so they fit the 52px min-width label column in InfoTooltip, with
// the expanded explanation in the value column. Source: CLAUDE.md order
// lifecycle + expiration rules — kept in sync there, so don't change
// timings here without updating the state machine notes.
const IN_PROGRESS_RULES: InfoTooltipItem[] = [
  {
    label: "BUY",
    value:
      "You send fiat → receive USDT. Seller locks escrow first; you then mark payment sent and wait for seller to release.",
  },
  {
    label: "SELL",
    value:
      "You lock USDT in escrow first. Wait for fiat in your account, then confirm payment to release USDT.",
  },
  {
    label: "PENDING",
    value:
      "Auto-expires 15 min after creation if no one accepts. No funds at risk.",
  },
  {
    label: "ACCEPTED",
    value:
      "You have 2 hours from accept to lock escrow (if seller) or send payment (if buyer). Auto-cancels otherwise.",
  },
  {
    label: "PAID",
    value:
      'After "payment sent", seller has 24 h to confirm. Auto-moves to dispute for compliance review if not confirmed.',
  },
  {
    label: "DISPUTED",
    value:
      "Auto-resolves and refunds escrow to the funder after 24 h if no compliance action.",
  },
];

interface InProgressPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
  onAction?: (order: any, action: string) => void;
  onOpenChat?: (order: any) => void;
  onOpenDispute?: (order: any) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
  merchantId?: string | null;
  lockingEscrowOrderId?: string | null;
  confirmingOrderId?: string | null;
  /** Global flag — true while ANY mark-paid is in flight. The card uses this
   *  in combination with the action label ("I've Paid"/"Send Payment") to
   *  show a spinner when the merchant clicks the Send Payment button on a card. */
  markingDone?: boolean;
  acceptingOrderId?: string | null;
  cancellingOrderId?: string | null;
}

// Viewer-perspective side resolver: matches the helper in
// PendingOrdersPanel.tsx. Seller locks crypto, buyer sends fiat.
function getViewerSide(
  db: any,
  order: any,
  myId: string | null | undefined,
): "seller" | "buyer" {
  // Enriched API response may already include my_role
  const myRole = order?.myRole || order?.my_role || db?.my_role;
  if (myRole === "seller") return "seller";
  if (myRole === "buyer") return "buyer";

  if (!db) return "seller";
  if (myId && db.merchant_id === myId) return "seller";
  if (myId && db.buyer_merchant_id === myId) return "buyer";
  if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
  if (!db.merchant_id && db.buyer_merchant_id) return "seller";
  const orderType = String(db.type || "").toLowerCase();
  return orderType === "buy" ? "seller" : "buyer";
}

// Resolve seller/buyer display names from the raw DB order. Falls back to
// null on each side when the party hasn't claimed / is a placeholder.
// Mirrors PendingOrdersPanel.getPartyNames exactly.
function getPartyNames(db: any): {
  seller: string | null;
  buyer: string | null;
} {
  if (!db) return { seller: null, buyer: null };
  const userIsPlaceholder =
    typeof db.user?.username === "string" &&
    (db.user.username.startsWith("open_order_") ||
      db.user.username.startsWith("m2m_"));
  const userName = userIsPlaceholder
    ? null
    : db.user?.name || db.user?.username || null;
  const merchantName = db.merchant?.display_name || null;
  const buyerMerchantName = db.buyer_merchant?.display_name || null;

  const isM2M = userIsPlaceholder || !!db.buyer_merchant_id;
  if (isM2M) return { seller: merchantName, buyer: buyerMerchantName };

  const orderType = String(db.type || "").toLowerCase();
  if (orderType === "buy") return { seller: merchantName, buyer: userName };
  return { seller: userName, buyer: merchantName };
}

const WAITING_ACTIONS = [
  "Wait for Acceptance",
  "Wait for Payment",
  "Wait for Escrow",
  "Wait for Confirmation",
  "Waiting for Acceptor",
  "Waiting for Confirmation",
  "Waiting for Payment",
  "Already Claimed",
];

const IP_ITEM_HEIGHT = 160;

const InProgressOrderList = memo(function InProgressOrderList({
  orders,
  onSelectOrder,
  onAction,
  onOpenChat,
  formatTimeRemaining,
  getNextAction,
  merchantId,
  lockingEscrowOrderId,
  confirmingOrderId,
  markingDone,
  acceptingOrderId,
  cancellingOrderId,
}: {
  orders: any[];
  onSelectOrder: (order: any) => void;
  onAction?: (order: any, action: string) => void;
  onOpenChat?: (order: any) => void;
  formatTimeRemaining: (seconds: number) => string;
  getNextAction: (order: any) => string;
  merchantId?: string | null;
  lockingEscrowOrderId?: string | null;
  confirmingOrderId?: string | null;
  markingDone?: boolean;
  acceptingOrderId?: string | null;
  cancellingOrderId?: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const corridorPrices = useCorridorPrices();

  const virtualizer = useVirtualizer({
    count: orders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => IP_ITEM_HEIGHT,
    overscan: 5,
  });

  if (orders.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
            <Shield className="w-5 h-5 text-foreground/20" />
          </div>
          <div className="text-center">
            <p className="text-[11px] font-medium text-foreground/30 mb-0.5">
              No active trades
            </p>
            <p className="text-[9px] text-foreground/15 font-mono">
              Accepted orders will appear here
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = orders[virtualRow.index];
          // Prefer backend-provided action label over frontend computation
          const nextAction =
            order.dbOrder?.primaryAction?.label || getNextAction(order);
          const isWaiting = WAITING_ACTIONS.includes(nextAction);

          return (
            <div
              key={order.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-1"
            >
              {(() => {
                  const db = order.dbOrder;
                  const { seller, buyer } = getPartyNames(db);
                  const iAmSeller = getViewerSide(db, order, merchantId) === "seller";
                  const counterparty = iAmSeller ? buyer : seller;
                  const avatarSeed = counterparty || order.id;
                  const avatarSrc = db?.user?.avatar_url || db?.merchant?.avatar_url || db?.buyer_merchant?.avatar_url || null;
                  const roleLabel = iAmSeller ? "SELL" : "BUY";

                  const statusCfg = getStatusBadgeConfig(getAuthoritativeStatus(order));
                  const noExpiry = order.minimalStatus === "payment_sent" || db?.status === "payment_sent" || db?.status === "payment_confirmed";
                  const isExpiringSoon = !noExpiry && order.expiresIn > 0 && order.expiresIn <= 1800;

                  const isLockingThis = lockingEscrowOrderId === order.id;
                  const isConfirmingThis = confirmingOrderId === order.id;
                  const isAcceptingThis = acceptingOrderId === order.id;
                  const isCancellingThis = cancellingOrderId === order.id;
                  const labelLower = (nextAction || "").toLowerCase();
                  const isPayActionCard = labelLower.includes("paid") || labelLower.includes("send payment") || labelLower.includes("mark payment");
                  const isMarkingPaidThis = !!markingDone && isPayActionCard;
                  const isActionLoading = isLockingThis || isConfirmingThis || isAcceptingThis || isCancellingThis || isMarkingPaidThis;
                  const loadingLabel = isLockingThis ? "Locking…" : isConfirmingThis ? "Confirming…" : isAcceptingThis ? "Accepting…" : isCancellingThis ? "Cancelling…" : "Marking paid…";

                  const liveRef = resolveCorridorRef(corridorPrices, db?.corridor_id, order.toCurrency || db?.fiat_currency);
                  const storedRef = Number(db?.ref_price_at_create);
                  const refPrice = liveRef && liveRef > 0 ? liveRef : Number.isFinite(storedRef) && storedRef > 0 ? storedRef : null;
                  const premium = refPrice && order.rate ? ((order.rate - refPrice) / refPrice) * 100 : null;

                  // Short status label for pill
                  const minStatus = getAuthoritativeStatus(order);
                  const SHORT_STATUS: Record<string, string> = {
                    open: "OPEN", accepted: "ACCEPTED", escrowed: "ESCROWED",
                    payment_sent: "PAID", completed: "DONE", cancelled: "CANCELLED",
                    disputed: "DISPUTED", expired: "EXPIRED",
                  };
                  const shortLabel = SHORT_STATUS[minStatus] || minStatus.toUpperCase();

                  return (
                    <div
                      data-testid={`order-card-${order.id}`}
                      onClick={() => onSelectOrder(order)}
                      className="relative rounded-xl cursor-pointer transition-all overflow-hidden"
                      style={{ background: "#111113", border: "1px solid rgba(255,255,255,0.07)" }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.13)")}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)")}
                    >
                      {/* Top bar: status chip | live dot */}
                      <div className="flex items-center justify-between px-3 pt-2.5 pb-0">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold font-mono tracking-widest border ${statusCfg.bg} ${statusCfg.border} ${statusCfg.color}`}>
                          <span className={`w-1 h-1 rounded-full bg-current`} />
                          {shortLabel}
                        </span>
                        <span className="flex h-2 w-2">
                          <span className="absolute inline-flex h-2 w-2 rounded-full bg-primary opacity-60 animate-ping" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                        </span>
                      </div>

                      {/* Amount */}
                      <div className="px-3 pt-2 pb-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[22px] font-bold tabular-nums text-white/90 leading-none tracking-tight">
                            {Math.round(order.amount).toLocaleString()}
                          </span>
                          <span className="text-[12px] font-medium text-white/35">{order.fromCurrency}</span>
                          {premium !== null && premium !== 0 && (
                            <span className={`text-[10px] font-mono ml-1 ${premium > 0 ? "text-primary/60" : "text-white/20"}`}>
                              {premium > 0 ? "+" : ""}{premium.toFixed(1)}%
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-[10px] text-white/20">→</span>
                          <span className="text-[11px] font-mono tabular-nums text-white/30">
                            {Math.round(order.amount * (order.rate || 1)).toLocaleString()} {order.toCurrency || "INR"}
                          </span>
                          {order.rate && <span className="text-[10px] text-white/15 font-mono ml-1">@ {order.rate.toFixed(2)}</span>}
                        </div>
                      </div>

                      {/* Urgent banner — only when really close */}
                      {isExpiringSoon && order.expiresIn <= 600 && (
                        <div className={`mx-3 mb-1.5 flex items-center gap-1 px-2 py-1 rounded-md ${order.expiresIn <= 120 ? "bg-red-500/10 border border-red-500/20" : "bg-primary/10 border border-primary/20"}`}>
                          <AlertTriangle className={`w-2.5 h-2.5 shrink-0 ${order.expiresIn <= 120 ? "text-red-400" : "text-primary"}`} />
                          <span className={`text-[9px] font-bold ${order.expiresIn <= 120 ? "text-red-400" : "text-primary"}`}>
                            {order.expiresIn <= 120 ? "Expiring now" : `${formatTimeRemaining(order.expiresIn)} left`}
                          </span>
                        </div>
                      )}
                      {order.cancelRequestedBy && (
                        <div className="mx-3 mb-1.5 flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 border border-primary/20">
                          <XCircle className="w-2.5 h-2.5 text-primary shrink-0" />
                          <span className="text-[9px] font-bold text-primary">Cancel requested</span>
                        </div>
                      )}

                      {/* Footer: avatar + name + timer | action */}
                      <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                        <UserAvatar src={avatarSrc} seed={avatarSeed} size={22} className="rounded-full shrink-0 border border-white/[0.07]" />
                        <span className="text-[11px] font-medium text-white/55 truncate min-w-0 flex-1">{counterparty || "—"}</span>
                        <div className="flex items-center gap-1 shrink-0 text-white/25">
                          <Clock className="w-2.5 h-2.5" />
                          {noExpiry ? (
                            <span className="text-[9px] font-mono text-emerald-400/50">∞</span>
                          ) : (
                            <span className={`text-[9px] font-mono tabular-nums ${order.expiresIn <= 120 ? "text-red-400" : order.expiresIn <= 600 ? "text-primary/60" : "text-white/25"}`}>
                              {order.expiresIn > 0 ? formatTimeRemaining(order.expiresIn) : "—"}
                            </span>
                          )}
                        </div>
                        {onOpenChat && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onOpenChat(order); }}
                            className="shrink-0 text-white/20 hover:text-white/50 transition-colors relative"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            {order.unreadCount > 0 && (
                              <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary text-background text-[7px] font-bold flex items-center justify-center">{order.unreadCount}</span>
                            )}
                          </button>
                        )}
                      </div>

                      {/* Action button — full width, separated by a faint rule */}
                      {!isWaiting && (
                        <div className="border-t border-white/[0.05]">
                          <button
                            data-testid="order-primary-action"
                            disabled={isActionLoading}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isActionLoading) return;
                              if (onAction) onAction(order, nextAction);
                              else onSelectOrder(order);
                            }}
                            className={`w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-bold tracking-wide transition-colors rounded-b-xl ${isActionLoading ? "text-primary/40 cursor-wait" : "text-primary hover:bg-primary/[0.08]"}`}
                          >
                            {isActionLoading ? (
                              <><Loader2 className="w-3 h-3 animate-spin" />{loadingLabel}</>
                            ) : (
                              <><Zap className="w-3 h-3" />{nextAction}</>
                            )}
                          </button>
                        </div>
                      )}
                      {isWaiting && (
                        <div className="border-t border-white/[0.04] flex items-center justify-center gap-1.5 py-1.5">
                          <div className="w-1 h-1 bg-white/10 rounded-full animate-breathe" />
                          <span className="text-[9px] text-white/20 font-mono">Waiting for counterparty</span>
                        </div>
                      )}

                      {/* Extension request */}
                      {db?.extension_requested_by && (
                        <div className="mx-3 mb-2 mt-1 flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/[0.08] border border-amber-500/[0.12]">
                          <Clock className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                          <span className="text-[9px] text-amber-400/80 font-medium truncate">
                            +{db.extension_minutes >= 60 ? `${Math.round(db.extension_minutes / 60)}hr` : `${db.extension_minutes}min`} extension requested
                          </span>
                        </div>
                      )}

                      {/* Urgency bar at bottom */}
                      {!noExpiry && order.expiresIn > 0 && order.expiresIn <= 7200 && (
                        <div className="absolute bottom-0 left-0 right-0 h-px bg-white/[0.03]">
                          <div
                            className={`h-full transition-[width] duration-1000 ease-linear ${order.expiresIn <= 120 ? "bg-red-400/60" : order.expiresIn <= 600 ? "bg-primary/60" : "bg-primary/20"}`}
                            style={{ width: `${Math.min(100, (order.expiresIn / 7200) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}
            </div>
          );
        })}
      </div>
    </div>
  );
});

type FilterValue = MinimalStatus | "all" | "cancel_requested";

const STATUS_FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "accepted", label: "Accepted" },
  { value: "escrowed", label: "Escrowed" },
  { value: "payment_sent", label: "Paid" },
  { value: "cancelled", label: "Cancelled" },
  { value: "disputed", label: "Disputed" },
  { value: "cancel_requested", label: "Cancel Req" },
];

export const InProgressPanel = memo(function InProgressPanel({
  orders,
  onSelectOrder,
  onAction,
  onOpenChat,
  collapsed = false,
  onCollapseChange,
  merchantId,
  lockingEscrowOrderId,
  confirmingOrderId,
  markingDone,
  acceptingOrderId,
  cancellingOrderId,
}: InProgressPanelProps) {
  const [statusFilter, setStatusFilter] = useState<FilterValue>("all");

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return orders;
    if (statusFilter === "cancel_requested")
      return orders.filter((order) => !!order.cancelRequestedBy);
    return orders.filter(
      (order) => getAuthoritativeStatus(order) === statusFilter,
    );
  }, [orders, statusFilter]);

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return "Expired";
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const getNextAction = (order: any): string => {
    return getNextActionFromStatus(order, order.orderType || order.type);
  };

  return (
    <div className={`flex flex-col ${collapsed ? "" : "h-full"}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-section-divider cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`w-3 h-3 text-foreground/30 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
            />
            <Shield className="w-3.5 h-3.5 text-foreground/30" />
            <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
              In Progress
            </h2>
            {/* Info badge — click/hover for buy/sell flow + expiry rules.
                stopPropagation so the tooltip button doesn't collapse the
                panel. */}
            <span onClick={(e) => e.stopPropagation()}>
              <InfoTooltip
                title="In Progress — rules"
                description="Your role (buyer vs seller) and the auto-timeout at each stage."
                items={IN_PROGRESS_RULES}
                side="bottom"
                size="xs"
              />
            </span>
          </div>
          <span className="text-[10px] border border-foreground/[0.08] text-foreground/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {filteredOrders.length}
            {statusFilter !== "all" ? `/${orders.length}` : ""}
          </span>
        </div>
        {/* Status Filter Pills */}
        {!collapsed && (
          <div
            className="flex items-center gap-0.5 h-7 xl:h-8 [@media(min-height:900px)]:h-8 p-0.5 rounded-lg bg-foreground/[0.04] border border-foreground/[0.06] w-full overflow-x-auto scrollbar-hide"
            onClick={(e) => e.stopPropagation()}
          >
            {STATUS_FILTERS.map((f) => {
              const isActive = statusFilter === f.value;
              const count =
                f.value === "all"
                  ? orders.length
                  : f.value === "cancel_requested"
                    ? orders.filter((o) => !!o.cancelRequestedBy).length
                    : orders.filter(
                        (o) => getAuthoritativeStatus(o) === f.value,
                      ).length;
              return (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`shrink-0 h-full px-2 xl:px-2 [@media(min-height:900px)]:px-2 inline-flex items-center justify-center rounded-md text-[9px] xl:text-[10px] [@media(min-height:900px)]:text-[10px] font-bold whitespace-nowrap transition-all ${
                    isActive
                      ? "bg-white/[0.08] text-white/90 border border-white/[0.12]"
                      : "text-foreground/35 hover:text-foreground/60 border border-transparent"
                  }`}
                >
                  <span className="whitespace-nowrap">
                    {f.label}
                    {count > 0 ? ` ${count}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Orders List — Virtualized */}
      {!collapsed && (
        <InProgressOrderList
          orders={filteredOrders}
          onSelectOrder={onSelectOrder}
          onAction={onAction}
          onOpenChat={onOpenChat}
          formatTimeRemaining={formatTimeRemaining}
getNextAction={getNextAction}
          merchantId={merchantId}
          lockingEscrowOrderId={lockingEscrowOrderId}
          confirmingOrderId={confirmingOrderId}
          markingDone={markingDone}
          acceptingOrderId={acceptingOrderId}
          cancellingOrderId={cancellingOrderId}
        />
      )}
    </div>
  );
});
