'use client';

import { useState, memo, useMemo, useRef, useEffect } from 'react';
import { CheckCircle2, History, Star, XCircle, AlertTriangle, ChevronUp, ChevronDown, Clock, ArrowRight, Loader2, Lock, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionsTab } from './TransactionsTab';
import { FilterDropdown, type FilterOption } from '@/components/user/screens/ui/FilterDropdown';
import { UserAvatar } from '@/components/ui/UserAvatar';

type ActivityTab = 'transactions' | 'completed' | 'failed' | 'open' | 'disputed';

const ACTIVITY_TAB_STORAGE_KEY = 'blip:merchant:activityTab';
const VALID_ACTIVITY_TABS: ReadonlyArray<ActivityTab> = ['transactions', 'completed', 'failed', 'open', 'disputed'];

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
  // Default to 'transactions' for stable SSR/first-render markup. We then
  // hydrate the persisted choice in an effect to avoid hydration mismatches.
  const [activeTab, setActiveTabState] = useState<ActivityTab>('transactions');
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ACTIVITY_TAB_STORAGE_KEY);
      if (stored && (VALID_ACTIVITY_TABS as ReadonlyArray<string>).includes(stored)) {
        setActiveTabState(stored as ActivityTab);
      }
    } catch {
      // localStorage unavailable; keep default.
    }
  }, []);
  const setActiveTab = (next: ActivityTab) => {
    setActiveTabState(next);
    try {
      window.localStorage.setItem(ACTIVITY_TAB_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; in-memory state still updates.
    }
  };
  // Bumping this counter triggers TransactionsTab to refetch the ledger.
  const [txnRefreshKey, setTxnRefreshKey] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Auto-refresh transactions when completed/cancelled orders change
  const prevCountRef = useRef(completedOrders.length + cancelledOrders.length);
  useEffect(() => {
    const newCount = completedOrders.length + cancelledOrders.length;
    if (newCount !== prevCountRef.current) {
      prevCountRef.current = newCount;
      setTxnRefreshKey(k => k + 1);
    }
  }, [completedOrders.length, cancelledOrders.length]);

  // Also refresh when wallet activity (swaps / cross-chain deposits)
  // completes. swapHistory.recordSwap + depositHistory.recordDeposit
  // dispatch a 'blip:wallet-activity' CustomEvent so the desktop
  // transactions tab picks up the new on-chain signature on its next
  // fetch instead of waiting for a poll/page-focus cycle.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setTxnRefreshKey(k => k + 1);
    window.addEventListener('blip:wallet-activity', handler);
    return () => window.removeEventListener('blip:wallet-activity', handler);
  }, []);

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

  // Disputed orders live in `ongoingOrders` — the parent keeps them "in
  // progress" so both parties can still act on them (page.tsx). Older
  // groupings also bucketed them with cancelled, so scan both lists to be
  // safe. They get their own tab below.
  const disputedOrders = useMemo(
    () =>
      [...ongoingOrders, ...cancelledOrders].filter(
        (o) => o?.status === 'disputed',
      ),
    [ongoingOrders, cancelledOrders]
  );
  const disputedCount = disputedOrders.length;
  // "Open" = in-progress + pending, EXCLUDING disputed (they have their own
  // tab) so a disputed order never appears in two places.
  const openOrders = useMemo(
    () =>
      [...ongoingOrders, ...pendingOrders].filter(
        (o) => o?.status !== 'disputed',
      ),
    [ongoingOrders, pendingOrders]
  );
  const openCount = openOrders.length;
  const failedCount = cancelledOrders.length;

  // Build dropdown options dynamically so the labels still show counts.
  const activityOptions = useMemo<ReadonlyArray<FilterOption<ActivityTab>>>(() => [
    { key: 'transactions', label: 'Txns' },
    { key: 'completed',    label: completedOrders.length > 0 ? `Done ${completedOrders.length}` : 'Done' },
    { key: 'disputed',     label: disputedCount > 0 ? `Disputed ${disputedCount}` : 'Disputed' },
    { key: 'failed',       label: failedCount > 0 ? `Failed ${failedCount}` : 'Failed' },
    { key: 'open',         label: openCount > 0 ? `Open ${openCount}` : 'Open' },
  ], [completedOrders.length, disputedCount, failedCount, openCount]);

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
        return { label: 'PENDING', color: 'text-foreground/40 bg-foreground/[0.04] border-foreground/[0.06]' };
      case 'accepted':
        return { label: 'ACCEPTED', color: 'text-white/70 bg-white/[0.06] border-white/[0.12]' };
      case 'escrowed':
        return { label: 'ESCROWED', color: 'text-[#f5f5f7] bg-white/[0.06] border-white/[0.12]' };
      case 'payment_sent':
        return { label: 'PAID', color: 'text-white/60 bg-white/[0.06] border-white/[0.09]' };
      case 'payment_confirmed':
        return { label: 'CONFIRMED', color: 'text-[#f5f5f7] bg-white/[0.06] border-white/[0.09]' };
      default:
        return { label: status.toUpperCase() || 'OPEN', color: 'text-foreground/40 bg-foreground/[0.04] border-foreground/[0.06]' };
    }
  };

  if (isCollapsed) {
    return (
      <div className="flex flex-col">
        <button
          onClick={() => handleCollapse(false)}
          className="flex items-center gap-2 px-3 py-2 bg-foreground/[0.02] hover:bg-foreground/[0.04] border-t border-section-divider transition-all"
        >
          <ChevronUp className="w-3.5 h-3.5 text-foreground/25" />
          <History className="w-3.5 h-3.5 text-foreground/30" />
          <span className="text-[10px] font-bold text-foreground/40 font-mono tracking-wider uppercase">
            Activity
          </span>
          <span className="text-[10px] border border-foreground/[0.08] text-foreground/30 px-1.5 py-0.5 rounded-full font-mono tabular-nums">
            {completedOrders.length + failedCount + openCount}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-section-divider">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleCollapse(true)}
              className="p-1 rounded hover:bg-foreground/[0.06] transition-colors text-foreground/20 hover:text-foreground/40"
              title="Minimize"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <History className="w-3.5 h-3.5 text-foreground/30" />
            <h2 className="text-[10px] font-bold text-foreground/60 font-mono tracking-wider uppercase">
              Activity
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Refresh — only meaningful for the Txns tab (the other tabs
                derive from the page-level orders state which auto-syncs). */}
            {activeTab === 'transactions' && (
              <button
                onClick={() => setTxnRefreshKey(k => k + 1)}
                className="p-1 rounded hover:bg-foreground/[0.06] transition-colors text-foreground/30 hover:text-foreground/60"
                title="Refresh transactions"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
            <div className="relative flex items-center">
              <FilterDropdown
                ariaLabel="Activity filter"
                value={activeTab}
                onChange={setActiveTab}
                options={activityOptions}
                triggerClassName="!rounded-lg !bg-foreground/[0.04] !border-foreground/[0.06]"
              />
              {/* Stuck-order indicator follows the dropdown trigger */}
              {openOrders.some(isStuck) && (
                <span
                  className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full pointer-events-none"
                  title="Stuck orders detected"
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {/* Transactions Tab */}
        {activeTab === 'transactions' && (
          merchantId ? <TransactionsTab merchantId={merchantId} refreshKey={txnRefreshKey} onSelectOrder={onSelectOrder} /> : (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-4 h-4 text-foreground/20 animate-spin" />
            </div>
          )
        )}

        {/* Completed Tab */}
        {activeTab === 'completed' && (
          <div className="h-full overflow-y-auto p-1.5">
            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-foreground/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-foreground/30 mb-0.5">No completed orders</p>
                  <p className="text-[9px] text-foreground/15 font-mono">Finished trades appear here</p>
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
                      className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-foreground/[0.03] transition-colors cursor-pointer"
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      <UserAvatar seed={order.user} src={order.user_avatar} size={22} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-medium text-foreground/70 truncate">{order.user}</span>
                          <CheckCircle2 className="w-3 h-3 text-white/30 shrink-0" />
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-mono text-foreground/30">
                          <span className="tabular-nums">{Math.round(order.amount).toLocaleString()} {order.fromCurrency}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-foreground/15" />
                          <span className="tabular-nums text-white/60">{Math.round(order.total ?? (order.amount * (order.rate || 0))).toLocaleString()} {order.toCurrency || ''}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        {profit > 0 ? (
                          <span className="text-[11px] font-bold font-mono tabular-nums text-[#f5f5f7]">
                            +${profit.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-foreground/20 font-mono">{formatTime(order.timestamp)}</span>
                        )}
                        <div className="flex items-center gap-1">
                          {timeToComplete != null && (
                            <span className="text-[9px] text-foreground/20 font-mono">{timeToComplete}m</span>
                          )}
                          {order.dbOrder?.merchant_rated_at ? (
                            <div className="flex items-center gap-px">
                              {[1, 2, 3, 4, 5].map((s) => (
                                <Star
                                  key={s}
                                  className={`w-2.5 h-2.5 ${
                                    s <= (order.dbOrder?.merchant_rating || 0)
                                      ? 'fill-white/50 text-white'
                                      : 'text-foreground/10'
                                  }`}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); onRateOrder(order); }}
                              className="flex items-center gap-0.5 text-[9px] text-white/40 hover:text-white font-medium transition-colors"
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
                <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                  <XCircle className="w-5 h-5 text-foreground/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-foreground/30 mb-0.5">No failed orders</p>
                  <p className="text-[9px] text-foreground/15 font-mono">Clean record so far</p>
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
                      className="p-2.5 glass-card rounded-lg hover:border-foreground/[0.08] transition-colors cursor-pointer"
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <UserAvatar seed={order.user} src={order.user_avatar} size={22} />
                          <span className="text-xs font-medium text-foreground/70">{order.user}</span>
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                          isDisputed
                            ? 'bg-white/[0.06] text-white/70 border-white/[0.09]'
                            : 'bg-foreground/[0.04] text-foreground/30 border-foreground/[0.06]'
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
                        <span className="text-sm font-bold text-foreground/60 tabular-nums">
                          {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                        </span>
                      </div>
                      <div className="text-[10px] text-foreground/25 font-mono">
                        {formatTime(order.timestamp)}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Disputed Tab — dedicated view for orders currently in dispute.
             Pulls from the same cancelledOrders source as "Failed" but
             filtered to status === 'disputed'. */}
        {activeTab === 'disputed' && (
          <div className="h-full overflow-y-auto p-1.5">
            {disputedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-foreground/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-foreground/30 mb-0.5">No disputes</p>
                  <p className="text-[9px] text-foreground/15 font-mono">Active disputes will appear here</p>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {disputedOrders.map((order, index) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="p-2.5 glass-card rounded-lg hover:border-white/20 transition-colors cursor-pointer border border-white/[0.12] bg-white/[0.055]"
                    onClick={() => onSelectOrder?.(order.id)}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <UserAvatar seed={order.user} src={order.user_avatar} size={22} />
                        <span className="text-xs font-medium text-foreground/70">{order.user}</span>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border bg-white/[0.06] text-white/70 border-white/[0.09]">
                        <AlertTriangle className="w-3 h-3" />
                        Disputed
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="text-sm font-bold text-foreground/60 tabular-nums">
                        {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                      </span>
                    </div>
                    <div className="text-[10px] text-foreground/25 font-mono">
                      {formatTime(order.timestamp)}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Open Tab (in-progress + pending, highlights stuck) */}
        {activeTab === 'open' && (
          <div className="h-full overflow-y-auto p-1.5">
            {openOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3">
                <div className="w-10 h-10 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] flex items-center justify-center">
                  <Clock className="w-5 h-5 text-foreground/20" />
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-medium text-foreground/30 mb-0.5">No open orders</p>
                  <p className="text-[9px] text-foreground/15 font-mono">Active trades will appear here</p>
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
                        stuck ? 'border-red-500/20 hover:border-[var(--color-error)]/30' : 'hover:border-foreground/[0.08]'
                      }`}
                      onClick={() => onSelectOrder?.(order.id)}
                    >
                      {/* Header: user + status */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <UserAvatar seed={order.user} src={order.user_avatar} size={22} />
                          <span className="text-xs font-medium text-foreground/70 truncate">{order.user}</span>
                          {order.orderType && (
                            <span className={`text-[9px] font-bold font-mono uppercase ${
                              order.orderType === 'buy' ? 'text-white/50' : 'text-white/60'
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
                        <span className="text-sm font-bold text-foreground/60 tabular-nums">
                          {Math.round(order.amount).toLocaleString()} {order.fromCurrency || 'USDT'}
                        </span>
                        {hasEscrow && (
                          <span className="flex items-center gap-1 text-[9px] text-foreground/30 font-mono">
                            <Lock className="w-2.5 h-2.5" />
                            Escrowed
                          </span>
                        )}
                      </div>

                      {/* Timer row */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-foreground/25 font-mono">
                          {created ? formatTime(created) : ''}
                        </span>
                        {order.expiresIn != null && (
                          <span className={`text-[10px] font-mono tabular-nums ${
                            order.expiresIn < 120 ? 'text-red-400' : 'text-foreground/30'
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
