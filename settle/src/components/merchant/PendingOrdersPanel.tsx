'use client';

import { useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  TrendingUp,
  RotateCcw,
  Zap,
  Clock,
  ArrowRight,
  Shield,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface PendingOrdersPanelProps {
  orders: any[];
  mempoolOrders: any[];
  merchantInfo: any;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  pendingFilter: 'all' | 'mineable' | 'premium' | 'large' | 'expiring';
  setPendingFilter: (filter: any) => void;
  pendingSortBy: 'time' | 'premium' | 'amount' | 'rating';
  setPendingSortBy: (sort: any) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  showOrderFilters: boolean;
  setShowOrderFilters: (show: boolean) => void;
  orderFilters: any;
  setOrderFilters: (filters: any) => void;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
  fetchOrders: () => void;
  orderViewFilter: 'new' | 'all';
  setOrderViewFilter: (filter: 'new' | 'all') => void;
}

export function PendingOrdersPanel({
  orders,
  mempoolOrders,
  merchantInfo,
  searchQuery,
  setSearchQuery,
  pendingFilter,
  setPendingFilter,
  pendingSortBy,
  setPendingSortBy,
  soundEnabled,
  setSoundEnabled,
  showOrderFilters,
  setShowOrderFilters,
  orderFilters,
  setOrderFilters,
  onSelectOrder,
  onSelectMempoolOrder,
  fetchOrders,
  orderViewFilter,
  setOrderViewFilter,
}: PendingOrdersPanelProps) {
  // Merge and filter orders
  let displayOrders = [...orders];

  // Add mempool orders when in 'new' view
  if (orderViewFilter === 'new' && mempoolOrders.length > 0) {
    const mempoolAsOrders = mempoolOrders.map((mo) => ({
      ...mo,
      isMempoolOrder: true,
      isMyMempoolOrder: mo.creator_username === merchantInfo?.username,
    }));
    displayOrders = [...mempoolAsOrders, ...displayOrders];
  }

  // Apply quick filters
  if (pendingFilter !== 'all') {
    displayOrders = displayOrders.filter((order) => {
      if ((order as any).isMempoolOrder) return true;

      if (pendingFilter === 'mineable') {
        return !!order.escrowTxHash;
      } else if (pendingFilter === 'premium') {
        const premium = ((order.rate - 3.67) / 3.67) * 100;
        return premium > 0.5;
      } else if (pendingFilter === 'large') {
        return order.amount >= 2000;
      } else if (pendingFilter === 'expiring') {
        return order.expiresIn < 300;
      }
      return true;
    });
  }

  // Apply sorting
  if (pendingSortBy !== 'time') {
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;

      if (pendingSortBy === 'premium') {
        return b.rate - a.rate;
      } else if (pendingSortBy === 'amount') {
        return b.amount - a.amount;
      } else if (pendingSortBy === 'rating') {
        return (b.dbOrder?.user?.rating || 0) - (a.dbOrder?.user?.rating || 0);
      }
      return 0;
    });
  } else {
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;
      return a.expiresIn - b.expiresIn;
    });
  }

  // Apply search and advanced filters
  const filteredOrders = displayOrders.filter((order) => {
    if ((order as any).isMempoolOrder) {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesOrderNum = (order as any).order_number
          ?.toLowerCase()
          .includes(q);
        const matchesAmount = (order as any).amount_usdt?.toString().includes(q);
        if (!matchesOrderNum && !matchesAmount) return false;
      }
      return true;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesUser = order.user?.toLowerCase().includes(q);
      const matchesAmount = order.amount.toString().includes(q);
      const matchesTotal = Math.round(order.total).toString().includes(q);
      const matchesId = order.id?.toLowerCase().includes(q);
      const matchesOrderNum = order.dbOrder?.order_number?.toLowerCase().includes(q);
      if (!matchesUser && !matchesAmount && !matchesTotal && !matchesId && !matchesOrderNum)
        return false;
    }
    if (orderFilters.type !== 'all' && order.orderType !== orderFilters.type) return false;
    if (orderFilters.amount === 'small' && order.amount >= 500) return false;
    if (
      orderFilters.amount === 'medium' &&
      (order.amount < 500 || order.amount > 2000)
    )
      return false;
    if (orderFilters.amount === 'large' && order.amount <= 2000) return false;
    if (
      orderFilters.method !== 'all' &&
      order.dbOrder?.payment_method !== orderFilters.method
    )
      return false;
    if (orderFilters.secured === 'yes' && !order.escrowTxHash) return false;
    if (orderFilters.secured === 'no' && order.escrowTxHash) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-black/20 to-transparent">
      {/* Compact Status Header */}
      <div className="px-4 py-1.5 border-b border-white/[0.04] bg-black/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="text-white/70">USDT → AED</span>
            <span className="text-white/30">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-white/50">Ref</span>
              <span className="text-white font-medium tabular-nums">3.6500</span>
              <span className="text-emerald-400 text-[9px] animate-pulse">▲0.12%</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
            <span className="text-[9px] text-emerald-400/90 font-mono">Online</span>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Tabs */}
            <button
              onClick={() => setOrderViewFilter('new')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                orderViewFilter === 'new'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setOrderViewFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                orderViewFilter === 'all'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              All
            </button>
          </div>

          {/* Tools */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-white/[0.04] rounded-lg">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]" />
              <span className="text-[9px] text-gray-500 font-mono">Live</span>
            </div>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 hover:bg-white/5 rounded transition-colors text-xs"
              title={soundEnabled ? 'Mute' : 'Unmute'}
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
            <button
              onClick={fetchOrders}
              className="p-1.5 hover:bg-white/5 rounded transition-colors"
              title="Refresh"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500 hover:text-white" />
            </button>
            <button
              onClick={() => setShowOrderFilters(!showOrderFilters)}
              className={`p-1.5 rounded-md transition-all ${
                showOrderFilters || Object.values(orderFilters).some((v) => v !== 'all')
                  ? 'bg-white/10 text-white'
                  : 'hover:bg-white/5 text-gray-500'
              }`}
              title="Advanced filters"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
              {filteredOrders.length}
            </span>
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(['all', 'mineable', 'premium', 'large', 'expiring'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPendingFilter(f)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                pendingFilter === f
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all'
                ? 'All'
                : f === 'mineable'
                ? 'Mineable'
                : f === 'premium'
                ? 'High Premium'
                : f === 'large'
                ? 'Large Size'
                : 'Expiring Soon'}
            </button>
          ))}
        </div>

        {/* Sort and Search */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-[#141414] rounded-lg px-3 py-2">
            <Search className="w-3.5 h-3.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orders..."
              className="flex-1 bg-transparent text-xs text-white placeholder:text-gray-600 outline-none"
            />
          </div>
          <select
            value={pendingSortBy}
            onChange={(e) => setPendingSortBy(e.target.value as any)}
            className="text-[10px] font-mono text-gray-400 bg-[#141414] border border-white/[0.06] rounded-lg px-2 py-2 outline-none cursor-pointer hover:border-white/[0.12]"
          >
            <option value="time">Time Left</option>
            <option value="premium">Premium</option>
            <option value="amount">Size</option>
            <option value="rating">Rating</option>
          </select>
        </div>

        {/* Advanced Filters */}
        <AnimatePresence>
          {showOrderFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mt-2"
            >
              <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#111111] rounded-xl border border-white/[0.06]">
                {/* Type filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                  {(['all', 'buy', 'sell'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderFilters((f: any) => ({ ...f, type: t }))}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        orderFilters.type === t
                          ? 'bg-white/10 text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {t === 'all' ? 'Type' : t.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Amount filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                  {[
                    { key: 'all', label: 'Amount' },
                    { key: 'small', label: '<500' },
                    { key: 'medium', label: '500-2k' },
                    { key: 'large', label: '2k+' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, amount: key }))
                      }
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        orderFilters.amount === key
                          ? 'bg-white/10 text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Payment method filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                  {[
                    { key: 'all', label: 'Method' },
                    { key: 'bank', label: 'Bank' },
                    { key: 'cash', label: 'Cash' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, method: key }))
                      }
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        orderFilters.method === key
                          ? 'bg-white/10 text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Secured filter */}
                <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-md p-0.5">
                  {[
                    { key: 'all', label: 'Escrow' },
                    { key: 'yes', label: 'Secured' },
                    { key: 'no', label: 'Open' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() =>
                        setOrderFilters((f: any) => ({ ...f, secured: key }))
                      }
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        orderFilters.secured === key
                          ? 'bg-white/10 text-white'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Clear all */}
                {Object.values(orderFilters).some((v) => v !== 'all') && (
                  <button
                    onClick={() =>
                      setOrderFilters({
                        type: 'all',
                        amount: 'all',
                        method: 'all',
                        secured: 'all',
                      })
                    }
                    className="px-2 py-1 text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Orders List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <TrendingUp className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-xs">No pending orders</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredOrders.map((order, index) => {
              const isMempoolOrder = (order as any).isMempoolOrder;
              const isMyMempoolOrder = (order as any).isMyMempoolOrder;

              if (isMempoolOrder) {
                const mOrder = order as any;
                const premiumPercent = (Number(mOrder.premium_bps_current) / 100).toFixed(2);

                return (
                  <motion.div
                    key={mOrder.id}
                    initial={{ opacity: 0, y: -5, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: index * 0.02, type: "spring", stiffness: 300 }}
                    onClick={() => onSelectMempoolOrder(mOrder)}
                    className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all cursor-pointer animate-[pulse_2s_ease-in-out_1]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-lg bg-[#252525] flex items-center justify-center shrink-0">
                        <Zap className="w-5 h-5 text-[#c9a962]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-sm font-medium text-gray-300 truncate">
                            #{mOrder.order_number}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded font-medium bg-[#c9a962]/15 text-[#c9a962]">
                            PRIORITY
                          </span>
                          {isMyMempoolOrder && (
                            <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 bg-[#c9a962]/20 text-[#c9a962] rounded font-medium">
                              YOURS
                            </span>
                          )}
                          {mOrder.auto_bump_enabled && (
                            <TrendingUp className="w-3 h-3 text-green-500" title="Auto-bump" />
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-bold">
                            {Number(mOrder.amount_usdt).toFixed(2)} USDT
                          </span>
                          <span className="text-xs text-gray-500">@</span>
                          <span className="text-sm font-bold text-[#c9a962]">
                            {Number(mOrder.current_offer_price).toFixed(6)}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 bg-[#c9a962]/10 text-[#c9a962] rounded font-mono">
                            +{premiumPercent}%
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex items-center gap-1 text-[10px] font-mono text-gray-500">
                          <Clock className="w-3 h-3" />
                          {Math.floor(mOrder.seconds_until_expiry / 60)}m
                        </div>
                        <button className="px-3 py-1.5 bg-[#c9a962] text-black rounded-lg text-xs font-bold hover:bg-[#d4b76e] transition-colors">
                          GO
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              }

              // Regular order
              const premium = ((order.rate - 3.67) / 3.67) * 100;
              const isHighPremium = premium > 0.5;
              const isMineable = !!order.escrowTxHash;
              const isMyOwnOrder = !!order.isMyOrder;

              return (
                <motion.div
                  key={order.id}
                  data-testid={`order-card-${order.id}`}
                  initial={{ opacity: 0, y: -5, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => onSelectOrder(order)}
                  className={`p-2.5 rounded-lg border transition-all cursor-pointer leading-tight hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40 ${
                    isMyOwnOrder
                      ? 'bg-[#1a1a1a] border-white/[0.12] opacity-70'
                      : isMineable
                      ? 'bg-[#1a1a1a] border-emerald-500/30 hover:border-emerald-500/50 ring-1 ring-emerald-500/20'
                      : isHighPremium
                      ? 'bg-[#1a1a1a] border-orange-500/30 hover:border-orange-500/50'
                      : 'bg-[#1a1a1a] border-white/[0.08] hover:border-[#c9a962]/30'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0 text-xl border border-white/[0.06]">
                      {order.emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-sm font-medium text-white truncate leading-tight">{order.user}</span>
                        {isMyOwnOrder && (
                          <div className="px-1.5 py-0.5 bg-white/10 border border-white/20 rounded text-[9px] font-bold text-white/60">
                            YOUR ORDER
                          </div>
                        )}
                        {!isMyOwnOrder && isMineable && (
                          <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-500/20 border border-emerald-500/40 rounded text-[9px] font-bold text-emerald-400 animate-pulse">
                            <Zap className="w-2.5 h-2.5" />
                            MINEABLE
                          </div>
                        )}
                        {!isMyOwnOrder && isHighPremium && (
                          <div className="px-1.5 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-[9px] font-bold text-orange-400">
                            HIGH PREMIUM
                          </div>
                        )}
                        {order.hasMessages && order.unreadCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-[#c9a962] text-black text-[9px] font-bold rounded">
                            {order.unreadCount}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 leading-tight">
                        <span className="text-sm font-bold text-white">
                          {order.amount.toFixed(2)} {order.fromCurrency}
                        </span>
                        <ArrowRight className="w-3 h-3 text-gray-600" />
                        <span className="text-sm font-bold text-[#c9a962]">
                          {Math.round(order.total).toLocaleString()} {order.toCurrency}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-gray-500 font-mono leading-tight">
                        <span>@ {order.rate.toFixed(4)}</span>
                        <span>•</span>
                        <span>{order.dbOrder?.payment_method?.toUpperCase()}</span>
                        {isHighPremium && (
                          <>
                            <span>•</span>
                            <span className="text-orange-400">+{premium.toFixed(2)}%</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <div data-testid="order-timer" className="flex items-center gap-1 text-[9px] font-mono text-gray-500">
                        <Clock className="w-3 h-3" />
                        {Math.floor(order.expiresIn / 60)}m
                      </div>
                      {isMyOwnOrder ? (
                        <span className="px-3 py-1.5 rounded-lg text-[9px] font-mono text-white/40">
                          WAITING
                        </span>
                      ) : (
                        <button data-testid="order-primary-action" className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:scale-105 ${
                          isMineable
                            ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                            : 'bg-[#c9a962] text-black hover:bg-[#d4b76e]'
                        }`}>
                          {isMineable ? 'MINE' : 'GO'}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
