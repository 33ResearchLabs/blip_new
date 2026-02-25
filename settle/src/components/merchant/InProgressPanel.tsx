'use client';

import { memo, useRef, useMemo } from 'react';
import { Shield, Zap, ChevronRight, Target, TrendingDown, Flame, ArrowRight, Search } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getAuthoritativeStatus, getStatusBadgeConfig, getNextAction as getNextActionFromStatus } from '@/lib/orders/statusResolver';
import { useMerchantStore, type InProgressQuickFilter } from '@/stores/merchantStore';

interface InProgressPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
}

const WAITING_ACTIONS = ['Wait for Acceptance', 'Wait for Payment', 'Wait for Escrow', 'Wait for Confirmation', 'Waiting for Acceptor', 'Waiting for Confirmation'];

const IP_ITEM_HEIGHT = 210; // Estimated row height for in-progress orders (includes hero timer + pricing strip)

const InProgressOrderList = memo(function InProgressOrderList({
  orders,
  onSelectOrder,
  formatTimeRemaining,
  getStatusBadge,
  getNextAction,
}: {
  orders: any[];
  onSelectOrder: (order: any) => void;
  formatTimeRemaining: (seconds: number) => string;
  getStatusBadge: (order: any) => React.ReactNode;
  getNextAction: (order: any) => string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

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
          <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
            <Shield className="w-5 h-5 text-white/20" />
          </div>
          <div className="text-center">
            <p className="text-[11px] font-medium text-white/30 mb-0.5">No active trades</p>
            <p className="text-[9px] text-white/15 font-mono">Accepted orders will appear here</p>
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
          const nextAction = getNextAction(order);
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
                className="p-2.5 glass-card rounded-lg hover:border-white/[0.10] transition-colors cursor-pointer"
              >
                {/* Row 1: User + type on left, timer on right */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="text-base">{order.emoji}</div>
                    <span className="text-xs font-medium text-white/80">{order.user}</span>
                    <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                      order.orderType === 'buy'
                        ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                        : 'bg-white/[0.06] border-white/[0.08] text-white/50'
                    }`}>
                      {order.orderType === 'buy' ? 'SELL' : 'BUY'}
                    </span>
                  </div>
                  <span className={`text-xs font-bold font-mono tabular-nums shrink-0 px-1.5 py-0.5 rounded ${
                    order.expiresIn <= 0
                      ? 'text-red-400/80 bg-red-500/[0.06]'
                      : order.expiresIn < 120
                      ? 'text-red-400/80 bg-red-500/[0.06]'
                      : order.expiresIn < 300
                      ? 'text-orange-400/70 bg-orange-500/[0.06]'
                      : 'text-white/35'
                  }`}>
                    {order.expiresIn > 0 ? formatTimeRemaining(order.expiresIn) : '0:00'}
                  </span>
                </div>

                {/* Row 2: Amount + rate */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-white tabular-nums">
                      {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                    </span>
                    <ArrowRight className="w-3 h-3 text-white/20" />
                    <span className="text-sm font-bold text-orange-400 tabular-nums">
                      {Math.round(order.amount * (order.rate || 3.67)).toLocaleString()} {order.toCurrency || 'AED'}
                    </span>
                  </div>
                </div>

                {/* Row 3: Rate + premium + earnings + status badge */}
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-[10px] text-white/40 font-mono">@ {(order.rate || 3.67).toFixed(2)}</span>
                  {(() => {
                    const premium = ((order.rate - 3.67) / 3.67) * 100;
                    return (
                      <>
                        {premium !== 0 && (
                          <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                            premium > 0
                              ? 'bg-orange-500/10 text-orange-400'
                              : 'bg-white/[0.04] text-white/30'
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

                {/* Pricing strip */}
                {(order.spreadPreference || order.protocolFeePercent) && (
                  <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-white/[0.02] border border-white/[0.05] rounded-md">
                    {order.spreadPreference && (
                      <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border ${
                        order.spreadPreference === 'fastest'
                          ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                          : order.spreadPreference === 'cheap'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                      }`}>
                        {order.spreadPreference === 'fastest' && <Zap className="w-3 h-3" />}
                        {order.spreadPreference === 'best' && <Target className="w-3 h-3" />}
                        {order.spreadPreference === 'cheap' && <TrendingDown className="w-3 h-3" />}
                        <span className="text-[10px] font-bold">
                          {order.spreadPreference === 'fastest' ? 'FAST' : order.spreadPreference === 'best' ? 'BEST' : 'CHEAP'}
                        </span>
                      </div>
                    )}
                    {order.protocolFeePercent != null && order.protocolFeePercent > (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5) && (
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] text-white/30 font-mono">PRIORITY</span>
                        <span className="text-sm font-bold text-white/70 tabular-nums font-mono">
                          +{(order.protocolFeePercent - (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5)).toFixed(1)}%
                        </span>
                      </div>
                    )}
                    <div className="flex-1" />
                    <div className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-orange-500/60 animate-pulse" />
                      <span className="text-[10px] font-bold text-white/50 font-mono">
                        {order.spreadPreference === 'fastest'
                          ? '5m'
                          : order.spreadPreference === 'best'
                          ? '15m'
                          : '60m'}
                      </span>
                      <span className="text-[9px] text-white/25 font-mono">decay</span>
                    </div>
                  </div>
                )}

                {/* Bottom: Action button or waiting */}
                {isWaiting ? (
                  <div className="flex items-center gap-1.5 px-1 py-1">
                    <div className="w-1 h-1 bg-white/15 rounded-full animate-breathe" />
                    <span className="text-[9px] text-white/25 font-mono">
                      Waiting for other merchant
                    </span>
                  </div>
                ) : (
                  <button
                    data-testid="order-primary-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectOrder(order);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-[11px] text-orange-400 font-bold hover:bg-orange-500/15 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {nextAction}
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}

                {/* Unread Messages */}
                {order.hasMessages && order.unreadCount > 0 && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-orange-400/80 font-medium">
                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-live-dot" />
                    {order.unreadCount} new message{order.unreadCount > 1 ? 's' : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// Actions that mean "I need to do something"
const ACTION_NEEDED = ['Lock Escrow', "I've Paid", "Send Fiat Payment", 'Confirm Receipt', 'Confirm Receipt & Release', 'Claim Order', 'Accept Order'];
// Actions that map to the lock_escrow filter
const LOCK_ESCROW_ACTIONS = ['Lock Escrow', 'Wait for Escrow'];
// Actions that map to the send_payment filter
const SEND_PAYMENT_ACTIONS = ["I've Paid", "Send Fiat Payment", 'Wait for Payment', 'Waiting for Payment'];
// Actions that map to the confirm_receipt filter
const CONFIRM_RECEIPT_ACTIONS = ['Confirm Receipt', 'Confirm Receipt & Release', 'Wait for Confirmation', 'Waiting for Confirmation'];

const QUICK_FILTERS: { key: InProgressQuickFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'lock_escrow', label: 'Lock Wallet' },
  { key: 'send_payment', label: 'Payment' },
  { key: 'confirm_receipt', label: 'Confirm' },
  { key: 'waiting', label: 'Waiting' },
];

function matchesQuickFilter(nextAction: string, filter: InProgressQuickFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'lock_escrow': return LOCK_ESCROW_ACTIONS.includes(nextAction);
    case 'send_payment': return SEND_PAYMENT_ACTIONS.includes(nextAction);
    case 'confirm_receipt': return CONFIRM_RECEIPT_ACTIONS.includes(nextAction);
    case 'waiting': return WAITING_ACTIONS.includes(nextAction);
    default: return true;
  }
}

export const InProgressPanel = memo(function InProgressPanel({ orders, onSelectOrder }: InProgressPanelProps) {
  // ─── Filter/sort state from Zustand ───────────────────────
  const ipSearchQuery = useMerchantStore(s => s.ipSearchQuery);
  const setIpSearchQuery = useMerchantStore(s => s.setIpSearchQuery);
  const ipQuickFilter = useMerchantStore(s => s.ipQuickFilter);
  const setIpQuickFilter = useMerchantStore(s => s.setIpQuickFilter);
  const ipSortBy = useMerchantStore(s => s.ipSortBy);
  const setIpSortBy = useMerchantStore(s => s.setIpSortBy);

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
        className="px-2 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[9px] text-white/50 font-medium font-mono"
      >
        {config.label}
      </div>
    );
  };

  const getNextAction = (order: any): string => {
    return getNextActionFromStatus(order, order.orderType || order.type);
  };

  // ─── Count per filter category ─────────────────────────────
  const filterCounts = useMemo(() => {
    const counts: Record<InProgressQuickFilter, number> = {
      all: orders.length,
      lock_escrow: 0,
      send_payment: 0,
      confirm_receipt: 0,
      waiting: 0,
    };
    for (const order of orders) {
      const action = getNextActionFromStatus(order, order.orderType || order.type);
      if (LOCK_ESCROW_ACTIONS.includes(action)) counts.lock_escrow++;
      if (SEND_PAYMENT_ACTIONS.includes(action)) counts.send_payment++;
      if (CONFIRM_RECEIPT_ACTIONS.includes(action)) counts.confirm_receipt++;
      if (WAITING_ACTIONS.includes(action)) counts.waiting++;
    }
    return counts;
  }, [orders]);

  // ─── Filter + sort logic ──────────────────────────────────
  const filteredOrders = useMemo(() => {
    let result = orders;

    // Quick filter by order step
    if (ipQuickFilter !== 'all') {
      result = result.filter(order => {
        const action = getNextActionFromStatus(order, order.orderType || order.type);
        return matchesQuickFilter(action, ipQuickFilter);
      });
    }

    // Search filter
    if (ipSearchQuery.trim()) {
      const q = ipSearchQuery.toLowerCase();
      result = result.filter(order => {
        const matchesUser = order.user?.toLowerCase().includes(q);
        const matchesAmount = order.amount?.toString().includes(q);
        const matchesTotal = Math.round(order.amount * (order.rate || 3.67)).toString().includes(q);
        const matchesId = order.id?.toLowerCase().includes(q);
        const matchesOrderNum = order.dbOrder?.order_number?.toLowerCase().includes(q);
        return matchesUser || matchesAmount || matchesTotal || matchesId || matchesOrderNum;
      });
    }

    // Sort
    if (ipSortBy !== 'time') {
      result = [...result].sort((a, b) => {
        if (ipSortBy === 'amount') return b.amount - a.amount;
        if (ipSortBy === 'premium') return (b.rate || 0) - (a.rate || 0);
        return 0;
      });
    } else {
      result = [...result].sort((a, b) => a.expiresIn - b.expiresIn);
    }

    return result;
  }, [orders, ipQuickFilter, ipSearchQuery, ipSortBy]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              In Progress
            </h2>
          </div>
          <span className="text-[10px] border border-white/[0.08] text-white/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {filteredOrders.length}{filteredOrders.length !== orders.length ? `/${orders.length}` : ''}
          </span>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-1 mb-1.5">
          {QUICK_FILTERS.map(({ key, label }) => {
            const count = filterCounts[key];
            return (
              <button
                key={key}
                onClick={() => setIpQuickFilter(key)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                  ipQuickFilter === key
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/25 hover:text-white/40'
                }`}
              >
                {label}{count > 0 && <span className="ml-0.5 text-orange-400 font-bold">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Search + Sort */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-1">
            <Search className="w-3 h-3 text-white/20" />
            <input
              type="text"
              value={ipSearchQuery}
              onChange={(e) => setIpSearchQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/15 outline-none font-mono"
            />
          </div>
          <select
            value={ipSortBy}
            onChange={(e) => setIpSortBy(e.target.value as any)}
            className="text-[9px] font-mono text-white/35 bg-white/[0.02] border border-white/[0.06] rounded-lg px-1.5 py-1 outline-none cursor-pointer hover:border-white/[0.10]"
          >
            <option value="time">Time</option>
            <option value="amount">Size</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      </div>

      {/* Orders List — Virtualized */}
      <InProgressOrderList
        orders={filteredOrders}
        onSelectOrder={onSelectOrder}
        formatTimeRemaining={formatTimeRemaining}
        getStatusBadge={getStatusBadge}
        getNextAction={getNextAction}
      />
    </div>
  );
});
