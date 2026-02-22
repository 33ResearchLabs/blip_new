'use client';

import { useState, memo } from 'react';
import { CheckCircle2, History, Star, XCircle, AlertTriangle, ChevronUp, ChevronDown, Clock, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionsTab } from './TransactionsTab';

interface ActivityPanelProps {
  merchantId: string | null;
  completedOrders: any[];
  cancelledOrders?: any[];
  onRateOrder: (order: any) => void;
  onSelectOrder?: (orderId: string) => void;
  onCollapseChange?: (collapsed: boolean) => void;
}

export const ActivityPanel = memo(function ActivityPanel({
  merchantId,
  completedOrders,
  cancelledOrders = [],
  onRateOrder,
  onSelectOrder,
  onCollapseChange,
}: ActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<'completed' | 'cancelled' | 'transactions'>('completed');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleCollapse = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    onCollapseChange?.(collapsed);
  };

  const formatTime = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const calculateProfit = (order: any): number => {
    // Use protocol_fee_amount if available, otherwise derive from protocolFeePercent
    if (order.protocolFeeAmount && order.protocolFeeAmount > 0) return order.protocolFeeAmount;
    if (order.protocolFeePercent && order.protocolFeePercent > 0) return order.amount * (order.protocolFeePercent / 100);
    return 0;
  };

  if (isCollapsed) {
    return (
      <div className="flex flex-col h-full justify-end">
        <button
          onClick={() => handleCollapse(false)}
          className="flex items-center justify-between px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] border-t border-white/[0.04] transition-all"
        >
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-white/30" />
            <span className="text-[10px] font-bold text-white/40 font-mono tracking-wider uppercase">
              Activity
            </span>
            <span className="text-[10px] border border-white/[0.08] text-white/30 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
              {completedOrders.length + cancelledOrders.length}
            </span>
          </div>
          <ChevronUp className="w-3.5 h-3.5 text-white/25" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Activity
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex gap-1">
              <button
                onClick={() => setActiveTab('completed')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                  activeTab === 'completed'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Done
              </button>
              <button
                onClick={() => setActiveTab('cancelled')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                  activeTab === 'cancelled'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Cancelled{cancelledOrders.length > 0 ? ` (${cancelledOrders.length})` : ''}
              </button>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                  activeTab === 'transactions'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Txns
              </button>
            </div>
            <button
              onClick={() => handleCollapse(true)}
              className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/20 hover:text-white/40"
              title="Minimize"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'cancelled' ? (
          <div className="h-full overflow-y-auto p-1.5">
            {cancelledOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-white/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-white/30 mb-0.5">No cancelled orders</p>
                  <p className="text-[9px] text-white/15 font-mono">Clean record so far</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {cancelledOrders.map((order, index) => {
                  const isCancelled = order.status === 'cancelled';
                  const isDisputed = order.status === 'disputed';
                  const statusLabel = isDisputed ? 'Disputed' : isCancelled ? 'Cancelled' : 'Expired';

                  return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className="p-2.5 glass-card rounded-lg hover:border-white/[0.08] transition-colors cursor-pointer"
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      {/* Header: user + status */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="text-sm">{order.emoji}</div>
                          <span className="text-xs font-medium text-white/70">{order.user}</span>
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                          isDisputed
                            ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                            : 'bg-white/[0.04] text-white/30 border border-white/[0.06]'
                        }`}>
                          {isDisputed ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {statusLabel}
                        </span>
                      </div>

                      {/* Amount */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-sm font-bold text-white/60 tabular-nums">
                          {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                        </span>
                      </div>

                      {/* Time */}
                      <div className="text-[10px] text-white/25 font-mono">
                        {formatTime(order.timestamp)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        ) : activeTab === 'completed' ? (
          <div className="h-full overflow-y-auto p-1.5">
            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-white/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-white/30 mb-0.5">No completed orders</p>
                  <p className="text-[9px] text-white/15 font-mono">Finished trades appear here</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {completedOrders.map((order, index) => {
                  const profit = calculateProfit(order);
                  const timeToComplete = order.dbOrder?.completed_at && order.dbOrder?.created_at
                    ? Math.floor(
                        (new Date(order.dbOrder.completed_at).getTime() -
                          new Date(order.dbOrder.created_at).getTime()) /
                          60000
                      )
                    : null;

                  return (
                    <div
                      key={order.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors"
                    >
                      {/* Emoji */}
                      <div className="text-sm shrink-0">{order.emoji}</div>

                      {/* Name + amount */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-white/70 truncate">{order.user}</span>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400/50 shrink-0" />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-white/30">
                          <span className="tabular-nums">{Math.round(order.amount).toLocaleString()} {order.fromCurrency}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-white/15" />
                          <span className="tabular-nums text-orange-400/60">{Math.round(order.amount * (order.rate || 3.67)).toLocaleString()} AED</span>
                        </div>
                      </div>

                      {/* Right: profit + rating/time */}
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {profit > 0 ? (
                          <span className="text-[11px] font-bold font-mono tabular-nums text-emerald-400">
                            +${profit.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-white/20 font-mono">{formatTime(order.timestamp)}</span>
                        )}
                        <div className="flex items-center gap-1">
                          {timeToComplete != null && (
                            <span className="text-[9px] text-white/20 font-mono">{timeToComplete}m</span>
                          )}
                          {order.dbOrder?.merchant_rated_at ? (
                            <div className="flex items-center gap-px">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                  key={s}
                                  className={`w-2.5 h-2.5 ${
                                    s <= (order.dbOrder?.merchant_rating || 0)
                                      ? 'fill-orange-400 text-orange-400'
                                      : 'text-white/10'
                                  }`}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={() => onRateOrder(order)}
                              className="flex items-center gap-0.5 text-[9px] text-orange-400/50 hover:text-orange-400 font-medium transition-colors"
                            >
                              <Star className="w-2.5 h-2.5" />
                              Rate
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          merchantId && <TransactionsTab merchantId={merchantId} />
        )}
      </div>
    </div>
  );
});
