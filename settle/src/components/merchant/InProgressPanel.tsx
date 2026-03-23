'use client';

import { memo, useRef, useState, useMemo } from 'react';
import { Shield, Zap, ChevronRight, ChevronDown, Flame, ArrowRight, Clock, XCircle, Filter } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { getAuthoritativeStatus, getStatusBadgeConfig, getNextAction as getNextActionFromStatus, MinimalStatus } from '@/lib/orders/statusResolver';

interface InProgressPanelProps {
  orders: any[];
  onSelectOrder: (order: any) => void;
  onAction?: (order: any, action: string) => void;
  onOpenChat?: (order: any) => void;
  onOpenDispute?: (order: any) => void;
  collapsed?: boolean;
  onCollapseChange?: (collapsed: boolean) => void;
}

const WAITING_ACTIONS = ['Wait for Acceptance', 'Wait for Payment', 'Wait for Escrow', 'Wait for Confirmation', 'Waiting for Acceptor', 'Waiting for Confirmation'];

const IP_ITEM_HEIGHT = 210; // Estimated row height for in-progress orders (includes hero timer + pricing strip)

const InProgressOrderList = memo(function InProgressOrderList({
  orders,
  onSelectOrder,
  onAction,
  onOpenChat,
  formatTimeRemaining,
  getStatusBadge,
  getNextAction,
}: {
  orders: any[];
  onSelectOrder: (order: any) => void;
  onAction?: (order: any, action: string) => void;
  onOpenChat?: (order: any) => void;
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
                    {order.spreadPreference && (
                      <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border flex items-center gap-0.5 ${
                        order.spreadPreference === 'fastest'
                          ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
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
                        <Flame className="w-2.5 h-2.5 text-orange-500/60 animate-pulse" />
                        <span className="text-[9px] font-bold text-white/40 font-mono">
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
                      <div className="flex items-center gap-1">
                        <span className={`text-sm font-bold font-mono tabular-nums ${
                          order.expiresIn <= 120 ? 'text-red-400' : 'text-orange-400'
                        }`}>
                          {order.expiresIn > 0 ? formatTimeRemaining(order.expiresIn) : 'Expired'}
                        </span>
                        <span className="animate-pulse" style={{ filter: order.expiresIn <= 120 ? 'drop-shadow(0 0 6px #ef4444)' : 'drop-shadow(0 0 4px #f97316)' }}>🔥</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Warning banner when under 5 minutes */}
                {order.expiresIn > 0 && order.expiresIn <= 300 && order.minimalStatus !== 'payment_sent' && order.dbOrder?.status !== 'payment_sent' && order.dbOrder?.status !== 'payment_confirmed' && (
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-2 ${
                    order.expiresIn <= 120 ? 'bg-red-500/10 border border-red-500/20' : 'bg-orange-500/10 border border-orange-500/20'
                  }`}>
                    <span className="text-xs shrink-0">🔥</span>
                    <span className={`text-[10px] font-bold ${order.expiresIn <= 120 ? 'text-red-400' : 'text-orange-400'}`}>
                      {order.expiresIn <= 120 ? 'Order expiring soon! Complete action now' : `Order expires in ${formatTimeRemaining(order.expiresIn)}`}
                    </span>
                  </div>
                )}

                {/* Cancel Request Banner on order card */}
                {order.cancelRequestedBy && (
                  <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md mb-2 bg-orange-500/10 border border-orange-500/20`}>
                    <XCircle className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                    <span className="text-[10px] font-bold text-orange-400">
                      Cancel requested — tap to respond
                    </span>
                  </div>
                )}

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
                      if (onAction) {
                        onAction(order, nextAction);
                      } else {
                        onSelectOrder(order);
                      }
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-orange-500 rounded-lg text-[11px] text-white font-bold hover:bg-orange-600 transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {nextAction}
                    <ChevronRight className="w-3.5 h-3.5" />
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
                    className="mt-1.5 flex items-center gap-1.5 text-[10px] text-orange-400/80 font-medium hover:text-orange-300 transition-colors w-full"
                  >
                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-live-dot" />
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

export const InProgressPanel = memo(function InProgressPanel({ orders, onSelectOrder, onAction, onOpenChat, collapsed = false, onCollapseChange }: InProgressPanelProps) {
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
        className="px-2 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[9px] text-white/50 font-medium font-mono"
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
        className="px-3 py-2 border-b border-white/[0.04] cursor-pointer select-none hover:bg-white/[0.02] transition-colors"
        onClick={() => onCollapseChange?.(!collapsed)}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <ChevronDown className={`w-3 h-3 text-white/30 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
            <Shield className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              In Progress
            </h2>
          </div>
          <span className="text-[10px] border border-white/[0.08] text-white/50 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
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
                      ? 'bg-orange-500/15 border-orange-500/30 text-orange-400'
                      : 'bg-white/[0.02] border-white/[0.06] text-white/30 hover:text-white/50 hover:border-white/[0.10]'
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
        />
      )}
    </div>
  );
});
