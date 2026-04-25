'use client';

import { memo, useRef, useState, useMemo } from 'react';
import { Shield, Zap, ChevronRight, ChevronDown, Flame, ArrowRight, Clock, XCircle, MessageSquare, AlertTriangle, Loader2 } from 'lucide-react';
import { CountdownRing } from './CountdownRing';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getAuthoritativeStatus, getStatusBadgeConfig, getNextAction as getNextActionFromStatus, MinimalStatus } from '@/lib/orders/statusResolver';
import { useCorridorPrices, resolveCorridorRef } from '@/hooks/useCorridorPrices';
import { InfoTooltip, type InfoTooltipItem } from '@/components/shared/InfoTooltip';

// Rule badge content for the "In Progress" header. Items labels are kept
// short so they fit the 52px min-width label column in InfoTooltip, with
// the expanded explanation in the value column. Source: CLAUDE.md order
// lifecycle + expiration rules — kept in sync there, so don't change
// timings here without updating the state machine notes.
const IN_PROGRESS_RULES: InfoTooltipItem[] = [
  { label: 'BUY', value: 'You send fiat → receive USDT. Seller locks escrow first; you then mark payment sent and wait for seller to release.' },
  { label: 'SELL', value: 'You lock USDT in escrow first. Wait for fiat in your account, then confirm payment to release USDT.' },
  { label: 'PENDING', value: 'Auto-expires 15 min after creation if no one accepts. No funds at risk.' },
  { label: 'ACCEPTED', value: 'You have 2 hours from accept to lock escrow (if seller) or send payment (if buyer). Auto-cancels otherwise.' },
  { label: 'PAID', value: 'After "payment sent", seller has 24 h to confirm. Auto-moves to dispute for compliance review if not confirmed.' },
  { label: 'DISPUTED', value: 'Auto-resolves and refunds escrow to the funder after 24 h if no compliance action.' },
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
function getPartyNames(db: any): { seller: string | null; buyer: string | null } {
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

const WAITING_ACTIONS = ['Wait for Acceptance', 'Wait for Payment', 'Wait for Escrow', 'Wait for Confirmation', 'Waiting for Acceptor', 'Waiting for Confirmation', 'Waiting for Payment', 'Already Claimed'];

const IP_ITEM_HEIGHT = 210; // Estimated row height for in-progress orders (includes hero timer + pricing strip)

const InProgressOrderList = memo(function InProgressOrderList({
  orders,
  onSelectOrder,
  onAction,
  onOpenChat,
  formatTimeRemaining,
  getStatusBadge,
  getNextAction,
  merchantId,
  lockingEscrowOrderId,
  confirmingOrderId,
}: {
  orders: any[];
  onSelectOrder: (order: any) => void;
  onAction?: (order: any, action: string) => void;
  onOpenChat?: (order: any) => void;
  formatTimeRemaining: (seconds: number) => string;
  getStatusBadge: (order: any) => React.ReactNode;
  getNextAction: (order: any) => string;
  merchantId?: string | null;
  lockingEscrowOrderId?: string | null;
  confirmingOrderId?: string | null;
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
            <p className="text-[11px] font-medium text-foreground/30 mb-0.5">No active trades</p>
            <p className="text-[9px] text-foreground/15 font-mono">Accepted orders will appear here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = orders[virtualRow.index];
          // Prefer backend-provided action label over frontend computation
          const nextAction = order.dbOrder?.primaryAction?.label || getNextAction(order);
          const isWaiting = WAITING_ACTIONS.includes(nextAction);

          return (
            <div
              key={order.id}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-1"
            >
              <div
                data-testid={`order-card-${order.id}`}
                onClick={() => onSelectOrder(order)}
                className="relative p-2.5 rounded-lg cursor-pointer transition-colors"
                style={{ background: 'var(--card)', border: '1px solid color-mix(in srgb, var(--primary) 50%, transparent)' }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--primary) 70%, transparent)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--primary) 50%, transparent)'}
              >
                {/* Live pulse dot */}
                <span className="absolute -top-1 -left-1 flex h-2.5 w-2.5 z-20">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                {/* Row 1: Counterparty + type on left, timer on right */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="text-base">{order.emoji}</div>
                    {(() => {
                      const { seller, buyer } = getPartyNames(order.dbOrder);
                      const bothKnown = !!seller && !!buyer;
                      const soloName = seller || buyer || order.user || null;
                      return bothKnown ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-foreground/80 min-w-0">
                          <span className="truncate max-w-[80px]" title={`Seller: ${seller}`}>{seller}</span>
                          <ArrowRight className="w-3 h-3 text-foreground/40 shrink-0" />
                          <span className="truncate max-w-[80px]" title={`Buyer: ${buyer}`}>{buyer}</span>
                        </span>
                      ) : (
                        <span className={`text-xs font-medium truncate max-w-[140px] ${soloName ? 'text-foreground/80' : 'text-foreground/40'}`}>
                          {soloName || "—"}
                        </span>
                      );
                    })()}
                    {order.spreadPreference && (
                      <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border flex items-center gap-0.5 ${
                        order.spreadPreference === 'fastest'
                          ? 'bg-primary/10 border-primary/20 text-primary'
                          : order.spreadPreference === 'cheap'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                      }`}>
                        {order.spreadPreference === 'fastest' && <Zap className="w-2.5 h-2.5" />}
                        {order.spreadPreference === 'fastest' ? 'FAST' : order.spreadPreference === 'best' ? 'BEST' : 'CHEAP'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {order.spreadPreference && (
                      <div className="flex items-center gap-0.5">
                        <Flame className="w-2.5 h-2.5 text-primary/60 animate-pulse" />
                        <span className="text-[9px] font-bold text-foreground/40 font-mono">
                          {order.spreadPreference === 'fastest' ? '5m' : order.spreadPreference === 'best' ? '15m' : '60m'}
                        </span>
                      </div>
                    )}
                    {/* payment_sent orders don't expire */}
                    {order.minimalStatus === 'payment_sent' || order.dbOrder?.status === 'payment_sent' || order.dbOrder?.status === 'payment_confirmed' ? (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/[0.06]">
                        <Shield className="w-3 h-3 text-emerald-400/60" />
                        <span className="text-[10px] font-bold font-mono text-emerald-400/60">No expiry</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span className={`text-sm font-bold font-mono tabular-nums ${
                          order.expiresIn <= 120 ? 'text-[var(--color-error)]' : 'text-primary'
                        }`}>
                          {order.expiresIn > 0 ? formatTimeRemaining(order.expiresIn) : 'Expired'}
                        </span>
                        <CountdownRing remaining={order.expiresIn} total={7200} size={18} strokeWidth={2.5} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Expiry warning banner — tiered so the merchant sees this
                    on the card long before auto-cancellation fires. Matches
                    the toast thresholds in useMerchantEffects (30 / 10 / 2
                    min) so the banner appears at the first toast and
                    escalates in tone as the timer drops.
                    Skipped for payment_sent / payment_confirmed — those have
                    a 24h compliance window, not an inactivity timer. */}
                {order.expiresIn > 0 && order.expiresIn <= 1800 && order.minimalStatus !== 'payment_sent' && order.dbOrder?.status !== 'payment_sent' && order.dbOrder?.status !== 'payment_confirmed' && (
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-2 ${
                    order.expiresIn <= 120
                      ? 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/20'
                      : order.expiresIn <= 600
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-foreground/[0.04] border border-foreground/[0.08]'
                  }`}>
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${
                      order.expiresIn <= 120
                        ? 'text-[var(--color-error)]'
                        : order.expiresIn <= 600
                          ? 'text-primary'
                          : 'text-foreground/50'
                    }`} />
                    <span className={`text-[10px] font-bold ${
                      order.expiresIn <= 120
                        ? 'text-[var(--color-error)]'
                        : order.expiresIn <= 600
                          ? 'text-primary'
                          : 'text-foreground/60'
                    }`}>
                      {order.expiresIn <= 120
                        ? 'Order expiring soon! Complete action now'
                        : `Order expires in ${formatTimeRemaining(order.expiresIn)} — take action`}
                    </span>
                  </div>
                )}

                {/* Cancel Request Banner on order card */}
                {order.cancelRequestedBy && (
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-2 bg-primary/10 border border-primary/20`}>
                    <XCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-[10px] font-bold text-primary">
                      Cancel requested — tap to respond
                    </span>
                  </div>
                )}

                {/* Row 2: Amount — direction based on merchant's role */}
                {(() => {
                  const iAmSeller =
                    getViewerSide(order.dbOrder, order, merchantId) === "seller";
                  const crypto = `${Math.round(order.amount).toLocaleString()} ${order.fromCurrency}`;
                  const fiat = `${Math.round(order.amount * (order.rate || 3.67)).toLocaleString()} ${order.toCurrency || 'INR'}`;

                  return (
                    <div className="mb-1.5">
                      <p className="text-[9px] font-bold text-foreground/30 uppercase tracking-wider mb-1">
                        {iAmSeller ? 'You Send USDT → Get Fiat' : 'You Get USDT → Pay Fiat'}
                      </p>
                      <div className="flex items-center gap-1.5">
                        {iAmSeller ? (
                          <>
                            <span className="text-sm font-bold text-foreground tabular-nums">{crypto}</span>
                            <ArrowRight className="w-3 h-3 text-foreground/20" />
                            <span className="text-sm font-bold text-primary tabular-nums">{fiat}</span>
                          </>
                        ) : (
                          <>
                            <span className="text-sm font-bold text-primary tabular-nums">{crypto}</span>
                            <ArrowRight className="w-3 h-3 text-foreground/20" />
                            <span className="text-sm font-bold text-foreground tabular-nums">{fiat}</span>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Row 3: Rate + premium + earnings + status badge */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] text-foreground/40 font-mono">@ {(order.rate || 3.67).toFixed(2)}</span>
                  {(() => {
                    // Premium = how much this order's rate is above/below the
                    // CURRENT per-corridor reference price. Live prices come
                    // from /api/corridor/dynamic-rate (admin manual price, or
                    // VWAP from corridor_prices) via the shared hook. Falls
                    // back to the order's stored ref_price_at_create when live
                    // is unavailable. No hardcoded constants — different fiat
                    // corridors have different price levels (AED ≈ 3.67,
                    // INR ≈ 83) and a single fallback breaks for the other.
                    const liveRef = resolveCorridorRef(
                      corridorPrices,
                      order.dbOrder?.corridor_id,
                      order.toCurrency || order.dbOrder?.fiat_currency,
                    );
                    const storedRef = Number(order.dbOrder?.ref_price_at_create);
                    const refPrice =
                      liveRef && liveRef > 0
                        ? liveRef
                        : Number.isFinite(storedRef) && storedRef > 0
                          ? storedRef
                          : null;
                    const premium =
                      refPrice && order.rate
                        ? ((order.rate - refPrice) / refPrice) * 100
                        : null;
                    return (
                      <>
                        {premium !== null && premium !== 0 && (
                          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                            premium > 0
                              ? 'bg-primary/10 text-primary'
                              : 'bg-foreground/[0.04] text-foreground/30'
                          }`}>
                            {premium > 0 ? '+' : ''}{premium.toFixed(2)}%
                          </span>
                        )}
                        {order.protocolFeePercent != null && (
                          <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                            +${(order.amount * order.protocolFeePercent / 100).toFixed(2)}
                          </span>
                        )}
                      </>
                    );
                  })()}
                  <div className="flex-1" />
                  {order.expiresIn > 0 && getStatusBadge(order)}
                </div>

                {/* Bottom: Action button or waiting */}
                {isWaiting ? (
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <div className="w-1 h-1 bg-foreground/15 rounded-full animate-breathe" />
                    <span className="text-[9px] text-foreground/25 font-mono">
                      Waiting for other merchant
                    </span>
                  </div>
                ) : (() => {
                  const isLockingThis = lockingEscrowOrderId === order.id;
                  const isConfirmingThis = confirmingOrderId === order.id;
                  const isActionLoading = isLockingThis || isConfirmingThis;
                  const loadingLabel = isLockingThis
                    ? 'Locking escrow…'
                    : isConfirmingThis
                      ? 'Confirming payment…'
                      : null;
                  return (
                    <button
                      data-testid="order-primary-action"
                      disabled={isActionLoading}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isActionLoading) return;
                        if (onAction) {
                          onAction(order, nextAction);
                        } else {
                          onSelectOrder(order);
                        }
                      }}
                      className={`w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[11px] text-white font-bold transition-colors ${
                        isActionLoading
                          ? 'bg-primary/40 cursor-wait'
                          : 'bg-primary hover:bg-primary/80'
                      }`}
                    >
                      {isActionLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {loadingLabel}
                        </>
                      ) : (
                        <>
                          <Zap className="w-3.5 h-3.5" />
                          {nextAction}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  );
                })()}

                {/* Chat button — always visible */}
                {onOpenChat && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenChat(order);
                    }}
                    className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-[10px] font-bold border border-foreground/[0.08] bg-foreground/[0.03] text-foreground/50 hover:bg-foreground/[0.06] hover:text-foreground/70 transition-colors"
                  >
                    <MessageSquare className="w-3 h-3" />
                    Chat
                    {order.unreadCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-primary text-white text-[8px] font-bold min-w-[16px] text-center">
                        {order.unreadCount}
                      </span>
                    )}
                  </button>
                )}

                {/* Extension Request Banner */}
                {order.dbOrder?.extension_requested_by && (
                  <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/[0.08] border border-amber-500/[0.12]">
                    <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                    <span className="text-[10px] text-amber-400/90 font-medium truncate">
                      {order.dbOrder.extension_requested_by === 'user' ? 'Buyer' : 'Seller'} requested +{order.dbOrder.extension_minutes >= 60 ? `${Math.round(order.dbOrder.extension_minutes / 60)}hr` : `${order.dbOrder.extension_minutes}min`} extension
                    </span>
                  </div>
                )}

                {/* Unread Messages */}
                {order.hasMessages && order.unreadCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onOpenChat) onOpenChat(order);
                      else onSelectOrder(order);
                    }}
                    className="mt-1.5 flex items-center gap-1.5 text-[10px] text-primary/80 font-medium hover:text-primary/80 transition-colors w-full"
                  >
                    <div className="w-1.5 h-1.5 bg-primary rounded-full animate-live-dot" />
                    {order.unreadCount} new message{order.unreadCount > 1 ? 's' : ''}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

type FilterValue = MinimalStatus | 'all' | 'cancel_requested';

const STATUS_FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'escrowed', label: 'Escrowed' },
  { value: 'payment_sent', label: 'Paid' },
  { value: 'cancel_requested', label: 'Cancel Req' },
];

export const InProgressPanel = memo(function InProgressPanel({ orders, onSelectOrder, onAction, onOpenChat, collapsed = false, onCollapseChange, merchantId, lockingEscrowOrderId, confirmingOrderId }: InProgressPanelProps) {
  const [statusFilter, setStatusFilter] = useState<FilterValue>('all');

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    if (statusFilter === 'cancel_requested') return orders.filter((order) => !!order.cancelRequestedBy);
    return orders.filter((order) => getAuthoritativeStatus(order) === statusFilter);
  }, [orders, statusFilter]);

  const formatTimeRemaining = (seconds: number): string => {
    if (seconds <= 0) return 'Expired';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const getStatusBadge = (order: any) => {
    const minimalStatus = getAuthoritativeStatus(order);
    const config = getStatusBadgeConfig(minimalStatus);

    return (
      <div
        data-testid="order-status"
        className="px-2 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] text-foreground/50 font-medium font-mono"
      >
        {config.label}
      </div>
    );
  };

  const getNextAction = (order: any): string => {
    return getNextActionFromStatus(order, order.orderType || order.type);
  };

  return (
    <div className={`flex flex-col ${collapsed ? '' : 'h-full'}`}>
      {/* Header */}
      <div
        className="px-3 py-2 border-b border-section-divider cursor-pointer select-none hover:bg-foreground/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-3 h-3 text-foreground/30 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
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
            {filteredOrders.length}{statusFilter !== 'all' ? `/${orders.length}` : ''}
          </span>
        </div>
        {/* Status Filter Pills */}
        {!collapsed && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {STATUS_FILTERS.map((f) => {
              const isActive = statusFilter === f.value;
              const count = f.value === 'all'
                ? orders.length
                : f.value === 'cancel_requested'
                ? orders.filter((o) => !!o.cancelRequestedBy).length
                : orders.filter((o) => getAuthoritativeStatus(o) === f.value).length;
              return (
                <button
                  key={f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full border transition-colors ${
                    isActive
                      ? 'bg-primary/15 border-primary/30 text-primary'
                      : 'bg-foreground/[0.02] border-foreground/[0.06] text-foreground/30 hover:text-foreground/50 hover:border-foreground/[0.10]'
                  }`}
                >
                  {f.label}{count > 0 ? ` ${count}` : ''}
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
          getStatusBadge={getStatusBadge}
          getNextAction={getNextAction}
          merchantId={merchantId}
          lockingEscrowOrderId={lockingEscrowOrderId}
          confirmingOrderId={confirmingOrderId}
        />
      )}
    </div>
  );
});
