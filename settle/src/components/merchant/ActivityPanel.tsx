'use client';

import { useState, memo } from 'react';
import { CheckCircle2, History, Star, XCircle, AlertTriangle, ChevronUp, ChevronDown, Clock, ArrowRight, Loader2, Lock } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionsTab } from './TransactionsTab';

interface ActivityPanelProps {
  merchantId: string | null;
  completedOrders: any[];
  cancelledOrders?: any[];
  ongoingOrders?: any[];
  pendingOrders?: any[];
  onRateOrder: (order: any) => void;
  onSelectOrder?: (orderId: string) => void;
  onCollapseChange?: (collapsed: boolean) => void;
}

export const ActivityPanel = memo(function ActivityPanel({
  merchantId,
  completedOrders,
  cancelledOrders = [],
  ongoingOrders = [],
  pendingOrders = [],
  onRateOrder,
  onSelectOrder,
  onCollapseChange,
}: ActivityPanelProps) {
  const [activeTab, setActiveTab] = useState<'transactions' | 'completed' | 'failed' | 'open'>('transactions');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleCollapse = (collapsed: boolean) => {
    setIsCollapsed(collapsed);
    onCollapseChange?.(collapsed);
  };

  const formatTime = (date: Date | string): string => {
    const d = typeof date === 'string' ? new Date(date) : date;
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const calculateProfit = (order: any): number => {
    if (order.protocolFeeAmount && order.protocolFeeAmount > 0) return order.protocolFeeAmount;
    if (order.protocolFeePercent && order.protocolFeePercent > 0) return order.amount * (order.protocolFeePercent / 100);
    return 0;
  };

  // Combine ongoing + pending as "open" orders
  const openOrders = [...ongoingOrders, ...pendingOrders];
  const openCount = openOrders.length;
  const failedCount = cancelledOrders.length;

  // Detect stuck orders: in-progress > 30 min or pending > 15 min
  const isStuck = (order: any): boolean => {
    const created = order.dbOrder?.created_at ? new Date(order.dbOrder.created_at) : order.timestamp;
    if (!created) return false;
    const age = Date.now() - new Date(created).getTime();
    const status = order.dbOrder?.minimal_status || order.dbOrder?.status || '';
    // Escrow locked but no payment after 30 min
    if (['escrowed', 'accepted'].includes(status) && age > 30 * 60 * 1000) return true;
    // Pending for > 15 min
    if (status === 'pending' && age > 15 * 60 * 1000) return true;
    return false;
  };

  const getStatusLabel = (order: any): { label: string; color: string } => {
    const status = order.dbOrder?.minimal_status || order.dbOrder?.status || '';
    const stuck = isStuck(order);

    if (stuck) return { label: 'STUCK', color: 'text-red-400 bg-red-500/10 border-red-500/20' };

    switch (status) {
      case 'pending':
        return { label: 'PENDING', color: 'text-white/40 bg-white/[0.04] border-white/[0.06]' };
      case 'accepted':
        return { label: 'ACCEPTED', color: 'text-primary/70 bg-primary/10 border-orange-500/20' };
      case 'escrowed':
        return { label: 'ESCROWED', color: 'text-primary bg-primary/10 border-orange-500/20' };
      case 'payment_sent':
        return { label: 'PAID', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' };
      case 'payment_confirmed':
        return { label: 'CONFIRMED', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
      default:
        return { label: status.toUpperCase() || 'OPEN', color: 'text-white/40 bg-white/[0.04] border-white/[0.06]' };
    }
  };

  if (isCollapsed) {
    return (
      <div className="flex flex-col">
        <button
          onClick={() => handleCollapse(false)}
          className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] hover:bg-white/[0.04] border-t border-white/[0.04] transition-all"
        >
          <ChevronUp className="w-3.5 h-3.5 text-white/25" />
          <History className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[10px] font-bold text-white/40 font-mono tracking-wider uppercase">
            Activity
          </span>
          <span className="text-[10px] border border-white/[0.08] text-white/30 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {completedOrders.length + failedCount + openCount}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleCollapse(true)}
              className="p-1 rounded hover:bg-white/[0.06] transition-colors text-white/20 hover:text-white/40"
              title="Minimize"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <History className="w-3.5 h-3.5 text-white/30" />
            <h2 className="text-[10px] font-bold text-white/60 font-mono tracking-wider uppercase">
              Activity
            </h2>
          </div>
          <div className="flex items-center gap-0.5">
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
              <button
                onClick={() => setActiveTab('completed')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                  activeTab === 'completed'
                    ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Done{completedOrders.length > 0 ? ` ${completedOrders.length}` : ''}
              </button>
              <button
                onClick={() => setActiveTab('failed')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all ${
                  activeTab === 'failed'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/20'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Failed{failedCount > 0 ? ` ${failedCount}` : ''}
              </button>
              <button
                onClick={() => setActiveTab('open')}
                className={`px-2 py-1 rounded text-[9px] font-medium transition-all relative ${
                  activeTab === 'open'
                    ? 'bg-primary/15 text-primary border border-orange-500/20'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                Open{openCount > 0 ? ` ${openCount}` : ''}
                {openOrders.some(isStuck) && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
                )}
              </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          merchantId ? <TransactionsTab merchantId={merchantId} /> : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-4 h-4 text-white/20 animate-spin" />
            </div>
          )
        )}

        {/* Completed Tab */}
        {activeTab === 'completed' && (
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
                {completedOrders.map((order) => {
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
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] transition-colors cursor-pointer"
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      <div className="text-sm shrink-0">{order.emoji}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-white/70 truncate">{order.user}</span>
                          <CheckCircle2 className="w-3 h-3 text-emerald-400/50 shrink-0" />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-white/30">
                          <span className="tabular-nums">{Math.round(order.amount).toLocaleString()} {order.fromCurrency}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-white/15" />
                          <span className="tabular-nums text-primary/60">{Math.round(order.amount * (order.rate || 3.67)).toLocaleString()} AED</span>
                        </div>
                      </div>
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
                                      ? 'fill-orange-400 text-primary'
                                      : 'text-white/10'
                                  }`}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRateOrder(order); }}
                              className="flex items-center gap-0.5 text-[9px] text-primary/50 hover:text-primary font-medium transition-colors"
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
        )}

        {/* Failed Tab (cancelled + disputed + expired) */}
        {activeTab === 'failed' && (
          <div className="h-full overflow-y-auto p-1.5">
            {cancelledOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-white/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-white/30 mb-0.5">No failed orders</p>
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
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="text-sm">{order.emoji}</div>
                          <span className="text-xs font-medium text-white/70">{order.user}</span>
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                          isDisputed
                            ? 'bg-primary/10 text-primary border-orange-500/20'
                            : 'bg-white/[0.04] text-white/30 border-white/[0.06]'
                        }`}>
                          {isDisputed ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <XCircle className="w-3 h-3" />
                          )}
                          {statusLabel}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className="text-sm font-bold text-white/60 tabular-nums">
                          {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/25 font-mono">
                        {formatTime(order.timestamp)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Open Tab (in-progress + pending, highlights stuck) */}
        {activeTab === 'open' && (
          <div className="h-full overflow-y-auto p-1.5">
            {openOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
                  <Clock className="w-5 h-5 text-white/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-white/30 mb-0.5">No open orders</p>
                  <p className="text-[9px] text-white/15 font-mono">Active trades will appear here</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {openOrders.map((order, index) => {
                  const stuck = isStuck(order);
                  const statusInfo = getStatusLabel(order);
                  const created = order.dbOrder?.created_at ? new Date(order.dbOrder.created_at) : order.timestamp;
                  const hasEscrow = !!order.escrowTxHash;

                  return (
                    <motion.div
                      key={order.id}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.02 }}
                      className={`p-2.5 glass-card rounded-lg transition-colors cursor-pointer ${
                        stuck ? 'border-red-500/20 hover:border-red-500/30' : 'hover:border-white/[0.08]'
                      }`}
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      {/* Header: user + status */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="text-sm">{order.emoji}</div>
                          <span className="text-xs font-medium text-white/70 truncate">{order.user}</span>
                          {order.orderType && (
                            <span className={`text-[9px] font-bold font-mono uppercase ${
                              order.orderType === 'buy' ? 'text-green-400/60' : 'text-primary/60'
                            }`}>
                              {order.orderType === 'buy' ? 'SEND' : 'RECEIVE'}
                            </span>
                          )}
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${statusInfo.color}`}>
                          {stuck && <AlertTriangle className="w-3 h-3" />}
                          {statusInfo.label}
                        </span>
                      </div>

                      {/* Amount + escrow status */}
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-bold text-white/60 tabular-nums">
                          {Math.round(order.amount).toLocaleString()} {order.fromCurrency || 'USDC'}
                        </span>
                        {hasEscrow && (
                          <span className="flex items-center gap-1 text-[9px] text-white/30 font-mono">
                            <Lock className="w-2.5 h-2.5" />
                            Escrowed
                          </span>
                        )}
                      </div>

                      {/* Timer row */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-white/25 font-mono">
                          {created ? formatTime(created) : ''}
                        </span>
                        {order.expiresIn != null && (
                          <span className={`text-[10px] font-mono tabular-nums ${
                            order.expiresIn < 120 ? 'text-red-400' : 'text-white/30'
                          }`}>
                            {Math.floor(order.expiresIn / 60)}:{(order.expiresIn % 60).toString().padStart(2, '0')}
                          </span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
