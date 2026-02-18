'use client';

import { memo, useRef, useState, useEffect } from 'react';
import {
  Search,
  SlidersHorizontal,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  Zap,
  Target,
  Clock,
  ArrowRight,
  Flame,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMerchantStore } from '@/stores/merchantStore';

interface PendingOrdersPanelProps {
  orders: any[];
  mempoolOrders: any[];
  merchantInfo: any;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
  fetchOrders: () => void;
}

// ─── Virtualized order list (renders only visible rows) ──────────
const ITEM_HEIGHT = 170; // Estimated row height in px (mempool cards are taller with earnings hero)

const OrderList = memo(function OrderList({
  filteredOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
}: {
  filteredOrders: any[];
  merchantInfo: any;
  onSelectOrder: (order: any) => void;
  onSelectMempoolOrder: (order: any) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Live tick — updates every second for countdown + fee decay
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const virtualizer = useVirtualizer({
    count: filteredOrders.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5,
  });

  if (filteredOrders.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-1.5">
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <div className="w-10 h-10 rounded-full border border-white/[0.06] bg-white/[0.02] flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-white/20" />
          </div>
          <div className="text-center">
            <p className="text-[11px] font-medium text-white/30 mb-0.5">No pending orders</p>
            <p className="text-[9px] text-white/15 font-mono">New orders from the network show here</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto p-1.5">
      <div
        style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = filteredOrders[virtualRow.index];
          const isMempoolOrder = (order as any).isMempoolOrder;
          const isMyMempoolOrder = (order as any).isMyMempoolOrder;

          if (isMempoolOrder) {
            const mOrder = order as any;
            const amount = Number(mOrder.amount_usdt);

            // Live decay: compute elapsed since data was received
            const elapsed = Math.floor((now - (mOrder._receivedAt || now)) / 1000);
            const liveExpiry = Math.max(0, mOrder.seconds_until_expiry - elapsed);

            // Premium decays between bumps (resets on next data fetch)
            const bumpInterval = mOrder.bump_interval_sec || 60;
            const bumpStep = mOrder.bump_step_bps || 10;
            const decayPerSec = bumpStep / bumpInterval;
            const decayedBps = Math.max(
              mOrder.premium_bps_current - bumpStep,
              mOrder.premium_bps_current - elapsed * decayPerSec
            );
            const livePremiumPct = decayedBps / 100;
            const livePrice = (Number(mOrder.ref_price_at_create) * (1 + decayedBps / 10000)).toFixed(2);

            // YOUR CUT — what the merchant earns by accepting
            const yourCut = amount * (decayedBps / 10000);

            // Decay progress: 1.0 right after bump, 0.0 at next bump
            const decayProgress = Math.max(0, Math.min(1, 1 - (elapsed * decayPerSec) / bumpStep));

            // Max possible earnings (at premium cap)
            const maxCut = amount * (mOrder.premium_bps_cap / 10000);

            return (
              <div
                key={mOrder.id}
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
                  onClick={() => onSelectMempoolOrder(mOrder)}
                  className="p-2.5 rounded-lg border border-orange-500/20 bg-orange-500/[0.02] hover:border-orange-500/30 transition-all cursor-pointer"
                >
                  {/* Row 1: Order info + timer + action */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-orange-400" />
                      <span className="text-[10px] font-medium text-white/50 font-mono">#{mOrder.order_number}</span>
                      {isMyMempoolOrder && (
                        <span className="text-[9px] px-1 py-0.5 bg-white/[0.04] text-white/40 rounded font-medium">YOURS</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Compact timer */}
                      <span className={`text-[10px] font-bold font-mono tabular-nums ${
                        liveExpiry < 120 ? 'text-red-400' : liveExpiry < 300 ? 'text-orange-400' : 'text-white/30'
                      }`}>
                        {Math.floor(liveExpiry / 60)}:{String(liveExpiry % 60).padStart(2, '0')}
                      </span>
                      {isMyMempoolOrder ? (
                        <span className="px-2 py-0.5 rounded text-[9px] font-mono text-white/20">WAITING</span>
                      ) : (
                        <button className="px-3 py-1 bg-orange-500 text-black rounded-lg text-[10px] font-bold hover:bg-orange-400 transition-colors press-effect">
                          ACCEPT
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: YOUR CUT — hero earnings with decay */}
                  <div className="mb-2 px-3 py-2 rounded-lg bg-orange-500/[0.06] border border-orange-500/15">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-orange-400/50 font-mono font-bold tracking-wider">YOUR CUT</span>
                      <span className="text-[9px] text-white/20 font-mono">
                        max ${maxCut.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-xl font-black tabular-nums font-mono transition-all ${
                        decayProgress < 0.3 ? 'text-red-400' : 'text-orange-400'
                      }`}>
                        ${yourCut.toFixed(2)}
                      </span>
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded transition-all ${
                        decayProgress < 0.3
                          ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                          : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                      }`}>
                        +{livePremiumPct.toFixed(2)}%
                      </span>
                    </div>
                    {/* Decay bar */}
                    <div className="mt-1.5 h-[3px] rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-1000 ease-linear"
                        style={{
                          width: `${decayProgress * 100}%`,
                          background: decayProgress < 0.3
                            ? 'rgb(248, 113, 113)'
                            : decayProgress < 0.6
                            ? 'rgb(251, 146, 60)'
                            : 'rgb(249, 115, 22)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Row 3: Deal details — amount, rate, side */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white tabular-nums">
                        {Math.round(amount).toLocaleString()} USDT
                      </span>
                      <span className="text-[10px] text-white/15">@</span>
                      <span className="text-xs font-bold text-white/50 tabular-nums">
                        {livePrice}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20">
                      PRIORITY
                    </span>
                  </div>
                </div>
              </div>
            );
          }

          const premium = ((order.rate - 3.67) / 3.67) * 100;
          const isHighPremium = premium > 0.5;
          const isMineable = !!order.escrowTxHash;
          const dbUsername = order.dbOrder?.user?.username || '';
          const isPlaceholderUser = dbUsername.startsWith('open_order_') || dbUsername.startsWith('m2m_');
          const isMyOwnOrder = !!order.isMyOrder || (isPlaceholderUser && order.orderMerchantId === merchantInfo?.id);

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
                className={`p-2.5 rounded-lg border transition-colors cursor-pointer ${
                  isMyOwnOrder
                    ? 'bg-white/[0.01] border-white/[0.04] opacity-50'
                    : isMineable
                    ? 'glass-card border-white/[0.10] hover:border-orange-500/30 ring-1 ring-white/[0.04]'
                    : isHighPremium
                    ? 'glass-card border-white/[0.08] hover:border-white/[0.12]'
                    : 'glass-card hover:border-white/[0.08]'
                }`}
              >
                {/* Waiting banner — top of card for own orders */}
                {isMyOwnOrder && (
                  <div className="flex items-center gap-1.5 px-2 py-1 mb-1.5 rounded bg-white/[0.02] border border-white/[0.04]">
                    <div className="w-1 h-1 bg-white/20 rounded-full animate-breathe" />
                    <span className="text-[9px] text-white/30 font-mono font-bold tracking-wider uppercase">Waiting for acceptance</span>
                  </div>
                )}
                {/* Row 1: User + tags on left, timer on right */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.02] flex items-center justify-center shrink-0 text-sm border border-white/[0.04]">
                      {order.emoji}
                    </div>
                    <span className="text-xs font-medium text-white truncate">{order.user}</span>
                    <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                      order.orderType === 'buy'
                        ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                        : 'bg-white/[0.06] border-white/[0.08] text-white/50'
                    }`}>
                      {order.orderType === 'buy' ? 'SELL' : 'BUY'}
                    </span>
                    {order.spreadPreference && (
                      <span className={`flex items-center gap-0.5 text-[9px] font-bold font-mono px-1.5 py-0.5 rounded border ${
                        order.spreadPreference === 'fastest'
                          ? 'bg-orange-500/10 border-orange-500/20 text-orange-400'
                          : order.spreadPreference === 'cheap'
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
                      }`}>
                        {order.spreadPreference === 'fastest' && <Zap className="w-2.5 h-2.5" />}
                        {order.spreadPreference === 'fastest' ? 'FAST' : order.spreadPreference === 'best' ? 'BEST' : 'CHEAP'}
                        {order.protocolFeePercent != null && order.protocolFeePercent > (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5) && (
                          <span className="opacity-70">+{(order.protocolFeePercent - (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5)).toFixed(1)}%</span>
                        )}
                      </span>
                    )}
                    {isMyOwnOrder && (
                      <span className="px-1 py-0.5 bg-white/[0.04] border border-white/[0.06] rounded text-[9px] font-bold text-white/40">YOURS</span>
                    )}
                    {order.hasMessages && order.unreadCount > 0 && (
                      <span className="px-1 py-0.5 bg-orange-500 text-black text-[9px] font-bold rounded">
                        {order.unreadCount}
                      </span>
                    )}
                  </div>
                  {/* Timer */}
                  <span className={`text-xs font-bold font-mono tabular-nums shrink-0 ml-auto px-1.5 py-0.5 rounded ${
                    order.expiresIn <= 0
                      ? 'text-red-400/80 bg-red-500/[0.06]'
                      : order.expiresIn < 120
                      ? 'text-red-400/80 bg-red-500/[0.06]'
                      : order.expiresIn < 300
                      ? 'text-orange-400/70 bg-orange-500/[0.06]'
                      : 'text-white/35'
                  }`}>
                    {order.expiresIn > 0 ? `${Math.floor(order.expiresIn / 60)}m ${String(order.expiresIn % 60).padStart(2, '0')}s` : '0:00'}
                  </span>
                </div>

                {/* Row 2: Amount + profit */}
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm font-bold text-white tabular-nums">
                    {Math.round(order.amount).toLocaleString()} {order.fromCurrency}
                  </span>
                  <ArrowRight className="w-3 h-3 text-white/20" />
                  <span className="text-sm font-bold text-orange-400 tabular-nums">
                    {Math.round(order.total).toLocaleString()} {order.toCurrency}
                  </span>
                  {order.protocolFeePercent != null && order.protocolFeePercent > 0 && (
                    <span className="text-[11px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
                      +${(order.amount * order.protocolFeePercent / 100).toFixed(2)}
                    </span>
                  )}
                </div>

                {/* Row 3: Rate + premium ... small action button on right */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/40 font-mono">@ {order.rate.toFixed(2)}</span>
                  {order.protocolFeePercent != null && order.protocolFeePercent > (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5) && (
                    <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">
                      +{(order.protocolFeePercent - (order.spreadPreference === 'fastest' ? 2.5 : order.spreadPreference === 'best' ? 2.0 : 1.5)).toFixed(1)}%
                    </span>
                  )}
                  <div className="flex-1" />
                  {!isMyOwnOrder && (
                    <button data-testid="order-primary-action" className={`px-3 py-1 rounded-lg text-[10px] font-bold transition-all press-effect shrink-0 ${
                      isMineable
                        ? 'bg-orange-500 text-black hover:bg-orange-400'
                        : 'bg-orange-500/80 text-black hover:bg-orange-400'
                    }`}>
                      {isMineable ? 'MINE' : 'ACCEPT'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export const PendingOrdersPanel = memo(function PendingOrdersPanel({
  orders,
  mempoolOrders,
  merchantInfo,
  onSelectOrder,
  onSelectMempoolOrder,
  fetchOrders,
}: PendingOrdersPanelProps) {
  // ─── Filter/sort state from Zustand (no prop drilling) ───────────
  const searchQuery = useMerchantStore(s => s.searchQuery);
  const setSearchQuery = useMerchantStore(s => s.setSearchQuery);
  const orderViewFilter = useMerchantStore(s => s.orderViewFilter);
  const setOrderViewFilter = useMerchantStore(s => s.setOrderViewFilter);
  const pendingFilter = useMerchantStore(s => s.pendingFilter);
  const setPendingFilter = useMerchantStore(s => s.setPendingFilter);
  const pendingSortBy = useMerchantStore(s => s.pendingSortBy);
  const setPendingSortBy = useMerchantStore(s => s.setPendingSortBy);
  const soundEnabled = useMerchantStore(s => s.soundEnabled);
  const setSoundEnabled = useMerchantStore(s => s.setSoundEnabled);
  const showOrderFilters = useMerchantStore(s => s.showOrderFilters);
  const setShowOrderFilters = useMerchantStore(s => s.setShowOrderFilters);
  const orderFilters = useMerchantStore(s => s.orderFilters);
  const setOrderFilters = useMerchantStore(s => s.setOrderFilters);
  let displayOrders = [...orders];

  if (orderViewFilter === 'new' && mempoolOrders.length > 0) {
    const mempoolAsOrders = mempoolOrders.map((mo) => ({
      ...mo,
      isMempoolOrder: true,
      isMyMempoolOrder: mo.creator_username === merchantInfo?.username,
    }));
    displayOrders = [...mempoolAsOrders, ...displayOrders];
  }

  if (pendingFilter !== 'all') {
    displayOrders = displayOrders.filter((order) => {
      if ((order as any).isMempoolOrder) return true;
      if (pendingFilter === 'mineable') return !!order.escrowTxHash;
      else if (pendingFilter === 'premium') {
        const premium = ((order.rate - 3.67) / 3.67) * 100;
        return premium > 0.5;
      } else if (pendingFilter === 'large') return order.amount >= 2000;
      else if (pendingFilter === 'expiring') return order.expiresIn < 300;
      return true;
    });
  }

  if (pendingSortBy !== 'time') {
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;
      if (pendingSortBy === 'premium') return b.rate - a.rate;
      else if (pendingSortBy === 'amount') return b.amount - a.amount;
      else if (pendingSortBy === 'rating') return (b.dbOrder?.user?.rating || 0) - (a.dbOrder?.user?.rating || 0);
      return 0;
    });
  } else {
    displayOrders = [...displayOrders].sort((a, b) => {
      if ((a as any).isMempoolOrder || (b as any).isMempoolOrder) return 0;
      return a.expiresIn - b.expiresIn;
    });
  }

  const filteredOrders = displayOrders.filter((order) => {
    if ((order as any).isMempoolOrder) {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesOrderNum = (order as any).order_number?.toLowerCase().includes(q);
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
      if (!matchesUser && !matchesAmount && !matchesTotal && !matchesId && !matchesOrderNum) return false;
    }
    if (orderFilters.type !== 'all' && order.orderType !== orderFilters.type) return false;
    if (orderFilters.amount === 'small' && order.amount >= 500) return false;
    if (orderFilters.amount === 'medium' && (order.amount < 500 || order.amount > 2000)) return false;
    if (orderFilters.amount === 'large' && order.amount <= 2000) return false;
    if (orderFilters.method !== 'all' && order.dbOrder?.payment_method !== orderFilters.method) return false;
    if (orderFilters.secured === 'yes' && !order.escrowTxHash) return false;
    if (orderFilters.secured === 'no' && order.escrowTxHash) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="panel-header">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOrderViewFilter('new')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                orderViewFilter === 'new'
                  ? 'bg-white/[0.10] text-white border border-white/[0.14] shadow-sm'
                  : 'text-white/35 hover:text-white/60 hover:bg-white/[0.04]'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setOrderViewFilter('all')}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all ${
                orderViewFilter === 'all'
                  ? 'bg-white/[0.10] text-white border border-white/[0.14] shadow-sm'
                  : 'text-white/35 hover:text-white/60 hover:bg-white/[0.04]'
              }`}
            >
              All
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/[0.02] rounded-md border border-white/[0.06]">
              <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-live-dot" />
              <span className="text-[9px] text-white/40 font-mono">Live</span>
            </div>
            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1 hover:bg-white/[0.06] rounded-md transition-colors text-[10px] text-white/30"
              title={soundEnabled ? 'Mute' : 'Unmute'}
            >
              {soundEnabled ? '🔊' : '🔇'}
            </button>
            <button
              onClick={fetchOrders}
              className="p-1 hover:bg-white/[0.06] rounded-md transition-colors"
            >
              <RotateCcw className="w-3 h-3 text-white/25 hover:text-white/50" />
            </button>
            <button
              onClick={() => setShowOrderFilters(!showOrderFilters)}
              className={`p-1 rounded-md transition-all ${
                showOrderFilters || Object.values(orderFilters).some((v) => v !== 'all')
                  ? 'bg-white/[0.10] text-white/60'
                  : 'hover:bg-white/[0.06] text-white/25'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
            </button>
            <span className="text-[10px] bg-white/[0.04] border border-white/[0.10] text-white/50 px-2 py-0.5 rounded-full font-mono tabular-nums">
              {filteredOrders.length}
            </span>
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-1 mb-1.5">
          {(['all', 'mineable', 'premium', 'large', 'expiring'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setPendingFilter(f)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                pendingFilter === f
                  ? 'bg-white/[0.08] text-white/80 border border-white/[0.10]'
                  : 'text-white/25 hover:text-white/40'
              }`}
            >
              {f === 'all' ? 'All' : f === 'mineable' ? 'Mineable' : f === 'premium' ? 'High Premium' : f === 'large' ? 'Large' : 'Expiring'}
            </button>
          ))}
        </div>

        {/* Search + Sort */}
        <div className="flex items-center gap-1.5">
          <div className="flex-1 flex items-center gap-1.5 bg-white/[0.02] border border-white/[0.06] rounded-lg px-2.5 py-1.5">
            <Search className="w-3 h-3 text-white/20" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search orders..."
              className="flex-1 bg-transparent text-[11px] text-white placeholder:text-white/15 outline-none font-mono"
            />
          </div>
          <select
            value={pendingSortBy}
            onChange={(e) => setPendingSortBy(e.target.value as any)}
            className="text-[9px] font-mono text-white/35 bg-white/[0.02] border border-white/[0.06] rounded-lg px-1.5 py-1.5 outline-none cursor-pointer hover:border-white/[0.10]"
          >
            <option value="time">Time</option>
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
              className="overflow-hidden mt-1.5"
            >
              <div className="flex flex-wrap items-center gap-1 p-1.5 bg-white/[0.015] rounded-lg border border-white/[0.04]">
                {/* Type */}
                <div className="flex items-center gap-0.5 bg-white/[0.02] rounded p-0.5">
                  {(['all', 'buy', 'sell'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setOrderFilters((f: any) => ({ ...f, type: t }))}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.type === t ? 'bg-white/[0.08] text-white/80' : 'text-white/25 hover:text-white/40'
                      }`}
                    >
                      {t === 'all' ? 'Type' : t.toUpperCase()}
                    </button>
                  ))}
                </div>

                {/* Amount */}
                <div className="flex items-center gap-0.5 bg-white/[0.02] rounded p-0.5">
                  {[{ key: 'all', label: 'Amt' }, { key: 'small', label: '<500' }, { key: 'medium', label: '500-2k' }, { key: 'large', label: '2k+' }].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setOrderFilters((f: any) => ({ ...f, amount: key }))}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.amount === key ? 'bg-white/[0.08] text-white/80' : 'text-white/25 hover:text-white/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Method */}
                <div className="flex items-center gap-0.5 bg-white/[0.02] rounded p-0.5">
                  {[{ key: 'all', label: 'Method' }, { key: 'bank', label: 'Bank' }, { key: 'cash', label: 'Cash' }].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setOrderFilters((f: any) => ({ ...f, method: key }))}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.method === key ? 'bg-white/[0.08] text-white/80' : 'text-white/25 hover:text-white/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Escrow */}
                <div className="flex items-center gap-0.5 bg-white/[0.02] rounded p-0.5">
                  {[{ key: 'all', label: 'Escrow' }, { key: 'yes', label: 'Secured' }, { key: 'no', label: 'Open' }].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setOrderFilters((f: any) => ({ ...f, secured: key }))}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                        orderFilters.secured === key ? 'bg-white/[0.08] text-white/80' : 'text-white/25 hover:text-white/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {Object.values(orderFilters).some((v) => v !== 'all') && (
                  <button
                    onClick={() => setOrderFilters({ type: 'all', amount: 'all', method: 'all', secured: 'all' })}
                    className="px-1.5 py-0.5 text-[9px] font-medium text-white/40 hover:text-white/60 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Orders List — Virtualized */}
      <OrderList
        filteredOrders={filteredOrders}
        merchantInfo={merchantInfo}
        onSelectOrder={onSelectOrder}
        onSelectMempoolOrder={onSelectMempoolOrder}
      />
    </div>
  );
});
