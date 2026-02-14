# Dashboard Refactor Implementation Guide

## ✅ Completed
- ✅ Global CSS for non-scrollable layout (`body.dashboard-layout`)
- ✅ Ledger entries migration (`022_ledger_entries.sql`)
- ✅ TransactionsTab component (`src/components/merchant/TransactionsTab.tsx`)
- ✅ Ledger API endpoint (`/api/ledger`)

## 📋 Implementation Steps

### Step 1: Add dashboard-layout class to body

In `src/app/merchant/page.tsx`, add the class to body when logged in:

```tsx
useEffect(() => {
  if (isLoggedIn) {
    document.body.classList.add('dashboard-layout');
  } else {
    document.body.classList.remove('dashboard-layout');
  }

  return () => {
    document.body.classList.remove('dashboard-layout');
  };
}, [isLoggedIn]);
```

### Step 2: Replace the main layout structure

Replace the existing desktop layout (around line 3500+) with this 3-column grid:

```tsx
{/* DESKTOP: 3-Column Non-Scrollable Layout */}
<div className="hidden md:grid grid-cols-[25%_45%_30%] h-screen overflow-hidden">
  {/* LEFT COLUMN: Config Panel (25%) */}
  <div className="flex flex-col border-r border-white/[0.06] bg-[#0a0a0a]">
    <ConfigPanel
      merchantId={merchantId}
      merchantInfo={merchantInfo}
      effectiveBalance={effectiveBalance}
      openTradeForm={openTradeForm}
      setOpenTradeForm={setOpenTradeForm}
      isCreatingTrade={isCreatingTrade}
      setShowOpenTradeModal={setShowOpenTradeModal}
      refreshBalance={refreshBalance}
    />
  </div>

  {/* CENTER COLUMN: Pending (60%) + Leaderboard (40%) */}
  <div className="flex flex-col border-r border-white/[0.06] bg-black">
    {/* Pending Orders: 60% height */}
    <div className="h-[60%] flex flex-col border-b border-white/[0.06]">
      <PendingOrdersPanel
        orders={pendingOrders}
        mempoolOrders={mempoolOrders}
        merchantInfo={merchantInfo}
        onSelectOrder={handleOrderSelect}
        onAcceptOrder={handleAcceptOrder}
      />
    </div>

    {/* Leaderboard: 40% height */}
    <div className="h-[40%] flex flex-col">
      <LeaderboardPanel
        leaderboardData={leaderboardData}
        leaderboardTab={leaderboardTab}
        setLeaderboardTab={setLeaderboardTab}
      />
    </div>
  </div>

  {/* RIGHT COLUMN: In Progress (35%) + Activity (65%) */}
  <div className="flex flex-col bg-[#0a0a0a]">
    {/* In Progress: 35% height */}
    <div className="h-[35%] flex flex-col border-b border-white/[0.06]">
      <InProgressPanel
        orders={ongoingOrders}
        onSelectOrder={handleOrderSelect}
        onNextAction={handleNextAction}
      />
    </div>

    {/* Activity Panel: 65% height */}
    <div className="h-[65%] flex flex-col">
      <ActivityPanel
        merchantId={merchantId}
        completedOrders={completedOrders}
        onRateOrder={handleRateOrder}
      />
    </div>
  </div>
</div>
```

### Step 3: Create ConfigPanel Component

Create `src/components/merchant/ConfigPanel.tsx`:

```tsx
'use client';

import { Activity, DollarSign } from 'lucide-react';

export function ConfigPanel({
  merchantId,
  merchantInfo,
  effectiveBalance,
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  setShowOpenTradeModal,
  refreshBalance,
}: any) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <h2 className="text-sm font-bold text-white font-mono tracking-wider">
          CONFIG
        </h2>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Balance Widget */}
        <div className="bg-[#141414] border border-white/[0.06] rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-500 font-mono uppercase">Balance</span>
            <button
              onClick={refreshBalance}
              className="p-1 hover:bg-white/5 rounded transition-colors"
            >
              <Activity className="w-3.5 h-3.5 text-gray-500 hover:text-white" />
            </button>
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {effectiveBalance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
          </div>
          <div className="text-xs text-gray-500 font-mono">USDT</div>
        </div>

        {/* Buy/Sell Toggle */}
        <div className="bg-[#141414] border border-white/[0.06] rounded-lg p-3">
          <label className="text-[10px] text-gray-500 font-mono uppercase mb-2 block">
            Order Type
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: 'buy' })}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                openTradeForm.tradeType === 'buy'
                  ? 'bg-[#c9a962] text-black'
                  : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
              }`}
            >
              BUY
            </button>
            <button
              onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: 'sell' })}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                openTradeForm.tradeType === 'sell'
                  ? 'bg-[#c9a962] text-black'
                  : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
              }`}
            >
              SELL
            </button>
          </div>
        </div>

        {/* Amount Input */}
        <div className="bg-[#141414] border border-white/[0.06] rounded-lg p-3">
          <label className="text-[10px] text-gray-500 font-mono uppercase mb-2 block">
            Amount (USDT)
          </label>
          <input
            type="number"
            value={openTradeForm.cryptoAmount}
            onChange={(e) => setOpenTradeForm({ ...openTradeForm, cryptoAmount: e.target.value })}
            placeholder="100"
            className="w-full bg-[#1f1f1f] rounded-lg px-3 py-2 text-sm font-medium outline-none text-white placeholder:text-gray-600 focus:ring-1 focus:ring-white/20"
          />
        </div>

        {/* Payment Method */}
        <div className="bg-[#141414] border border-white/[0.06] rounded-lg p-3">
          <label className="text-[10px] text-gray-500 font-mono uppercase mb-2 block">
            Payment Method
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: 'bank' })}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                openTradeForm.paymentMethod === 'bank'
                  ? 'bg-white/10 text-white'
                  : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
              }`}
            >
              Bank
            </button>
            <button
              onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: 'cash' })}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                openTradeForm.paymentMethod === 'cash'
                  ? 'bg-white/10 text-white'
                  : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
              }`}
            >
              Cash
            </button>
          </div>
        </div>

        {/* Fee Mode */}
        <div className="bg-[#141414] border border-white/[0.06] rounded-lg p-3">
          <label className="text-[10px] text-gray-500 font-mono uppercase mb-2 block">
            Fee Mode
          </label>
          <div className="flex flex-col gap-2">
            {['best', 'fastest', 'cheap'].map((mode) => (
              <button
                key={mode}
                onClick={() => setOpenTradeForm({ ...openTradeForm, spreadPreference: mode })}
                className={`py-2 rounded-lg text-xs font-medium transition-all ${
                  openTradeForm.spreadPreference === mode
                    ? 'bg-white/10 text-white'
                    : 'bg-white/[0.04] text-gray-500 hover:bg-white/[0.08]'
                }`}
              >
                {mode.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Create Order Button */}
        <button
          onClick={() => setShowOpenTradeModal(true)}
          disabled={isCreatingTrade || !openTradeForm.cryptoAmount}
          className="w-full py-3 rounded-lg bg-[#c9a962] text-black font-bold text-sm hover:bg-[#d4b76e] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Create Order
        </button>

        {/* Online Toggle (if you have it) */}
        {/* Add your online toggle component here */}

        {/* How it Works Tooltip */}
        <div className="mt-6 p-3 bg-white/[0.02] border border-white/[0.04] rounded-lg">
          <p className="text-[10px] text-gray-500 font-mono leading-relaxed">
            <span className="text-[#c9a962] font-bold">How it works:</span><br />
            1) Set your min price & liquidity<br />
            2) Watch Pending orders<br />
            3) Accept mineable orders<br />
            4) Complete in In Progress<br />
            5) Review Completed + Transactions
          </p>
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Create PendingOrdersPanel Component

Create `src/components/merchant/PendingOrdersPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Search, SlidersHorizontal, TrendingUp, RotateCcw } from 'lucide-react';
import { motion } from 'framer-motion';

export function PendingOrdersPanel({
  orders,
  mempoolOrders,
  merchantInfo,
  onSelectOrder,
  onAcceptOrder,
}: any) {
  const [activeTab, setActiveTab] = useState<'pending' | 'all'>('pending');
  const [quickFilter, setQuickFilter] = useState<'all' | 'mineable' | 'premium' | 'large' | 'expiring'>('all');
  const [sortBy, setSortBy] = useState<'time' | 'premium' | 'size' | 'profit'>('time');
  const [showFilters, setShowFilters] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('1s');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {/* Tabs */}
            <button
              onClick={() => setActiveTab('pending')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'pending'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Pending
            </button>
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'all'
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
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
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
              className="p-1.5 hover:bg-white/5 rounded transition-colors"
              title="Refresh"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500 hover:text-white" />
            </button>
            <span className="text-[9px] text-gray-500 font-mono">
              {lastUpdated} ago
            </span>
          </div>
        </div>

        {/* Quick Filters */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {(['all', 'mineable', 'premium', 'large', 'expiring'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setQuickFilter(f)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                quickFilter === f
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'All' :
               f === 'mineable' ? 'Mineable' :
               f === 'premium' ? 'High Premium' :
               f === 'large' ? 'Large Size' : 'Expiring Soon'}
            </button>
          ))}
        </div>

        {/* Sort Dropdown */}
        <div className="flex items-center gap-2">
          <Search className="w-3.5 h-3.5 text-gray-500" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="flex-1 text-[10px] font-mono text-gray-500 bg-transparent border-none outline-none cursor-pointer"
          >
            <option value="time">Time Left</option>
            <option value="premium">Premium</option>
            <option value="size">Size</option>
            <option value="profit">Profit</option>
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-1.5 rounded-md transition-all ${
              showFilters
                ? 'bg-white/10 text-white'
                : 'hover:bg-white/5 text-gray-500'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
            {orders.length + mempoolOrders.length}
          </span>
        </div>
      </div>

      {/* Orders List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {orders.length === 0 && mempoolOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500">
              <TrendingUp className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-xs">No pending orders</p>
            </div>
          ) : (
            <>
              {/* Render your order cards here */}
              {orders.map((order: any, index: number) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  onClick={() => onSelectOrder(order)}
                  className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">
                        {order.amount.toFixed(2)} USDT
                      </div>
                      <div className="text-xs text-gray-500">
                        @ {order.rate.toFixed(4)} AED
                      </div>
                    </div>
                    <button className="px-3 py-1.5 bg-[#c9a962] text-black rounded-lg text-xs font-bold hover:bg-[#d4b76e]">
                      GO
                    </button>
                  </div>
                </motion.div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

### Step 5: Create LeaderboardPanel Component

Create `src/components/merchant/LeaderboardPanel.tsx`:

```tsx
'use client';

import { Crown, Star, TrendingUp } from 'lucide-react';

export function LeaderboardPanel({
  leaderboardData,
  leaderboardTab,
  setLeaderboardTab,
}: any) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#c9a962]" />
            <h2 className="text-xs font-bold text-white/90 font-mono tracking-wider">
              LEADERBOARD
            </h2>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setLeaderboardTab('traders')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                leaderboardTab === 'traders'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Traders
            </button>
            <button
              onClick={() => setLeaderboardTab('rated')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                leaderboardTab === 'rated'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Top Rated
            </button>
          </div>
        </div>
      </div>

      {/* Leaderboard List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {leaderboardData.map((entry: any, index: number) => (
            <div
              key={entry.id}
              className="p-2.5 bg-[#141414] rounded-lg border border-white/[0.04] hover:border-white/[0.08] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="text-lg font-bold text-[#c9a962] font-mono w-6">
                  #{entry.rank}
                </div>
                <div className="flex-1">
                  <div className="text-xs font-medium text-white flex items-center gap-1">
                    {entry.displayName}
                    {entry.isOnline && (
                      <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                    <span>{entry.totalTrades} trades</span>
                    <span>•</span>
                    <span>{entry.rating.toFixed(2)} ⭐</span>
                  </div>
                </div>
                {entry.rank <= 3 && (
                  <Crown className="w-4 h-4 text-[#c9a962]" />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Step 6: Create InProgressPanel Component

Create `src/components/merchant/InProgressPanel.tsx`:

```tsx
'use client';

import { Clock, Shield, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export function InProgressPanel({
  orders,
  onSelectOrder,
  onNextAction,
}: any) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#c9a962]" />
            <h2 className="text-xs font-bold text-white/90 font-mono tracking-wider">
              IN PROGRESS
            </h2>
          </div>
          <span className="text-xs border border-white/20 text-white/70 px-2 py-0.5 rounded-full font-medium">
            {orders.length}
          </span>
        </div>
      </div>

      {/* Orders List - Scrollable */}
      <div className="flex-1 overflow-y-auto p-2">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Shield className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-xs">No orders in progress</p>
          </div>
        ) : (
          <div className="space-y-2">
            {orders.map((order: any, index: number) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.02 }}
                onClick={() => onSelectOrder(order)}
                className="p-3 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-[#c9a962]/30 hover:bg-[#1d1d1d] transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="text-xs font-medium text-white mb-1">
                      {order.user}
                    </div>
                    <div className="text-sm font-bold text-white">
                      {order.amount.toFixed(2)} USDT
                    </div>
                  </div>
                  <div className="px-2 py-1 bg-yellow-500/20 border border-yellow-500/30 rounded text-[10px] text-yellow-400 font-medium">
                    {order.status.toUpperCase()}
                  </div>
                </div>

                {/* Countdown Timer */}
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-xs text-gray-500 font-mono">
                    {Math.floor(order.expiresIn / 60)}m {order.expiresIn % 60}s left
                  </span>
                </div>

                {/* Next Action */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNextAction(order);
                  }}
                  className="w-full py-1.5 bg-[#c9a962]/20 border border-[#c9a962]/30 rounded-lg text-xs text-[#c9a962] font-medium hover:bg-[#c9a962]/30 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Zap className="w-3 h-3" />
                  Next Action
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 7: Create ActivityPanel Component with Transactions Tab

Create `src/components/merchant/ActivityPanel.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { CheckCircle2, History, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { TransactionsTab } from './TransactionsTab';

export function ActivityPanel({
  merchantId,
  completedOrders,
  onRateOrder,
}: any) {
  const [activeTab, setActiveTab] = useState<'completed' | 'transactions'>('completed');

  return (
    <div className="flex flex-col h-full">
      {/* Header with Tabs */}
      <div className="px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-gray-500" />
            <h2 className="text-xs font-bold text-white/90 font-mono tracking-wider">
              ACTIVITY
            </h2>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('completed')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                activeTab === 'completed'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Completed
            </button>
            <button
              onClick={() => setActiveTab('transactions')}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                activeTab === 'transactions'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Transactions
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content - Scrollable */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'completed' ? (
          <div className="h-full overflow-y-auto p-2">
            {completedOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <CheckCircle2 className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs">No completed orders</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completedOrders.map((order: any, index: number) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="p-2.5 bg-[#1a1a1a] rounded-lg border border-white/[0.06] hover:border-white/[0.12] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-xs font-medium text-white">
                        {order.user}
                      </div>
                      <div className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                        <span className="text-[10px] text-green-500 font-medium">
                          +{order.amount.toFixed(2)} USDT
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500 font-mono">
                        {new Date(order.timestamp).toLocaleDateString()}
                      </span>
                      {!order.dbOrder?.merchant_rated_at && (
                        <button
                          onClick={() => onRateOrder(order)}
                          className="text-[10px] text-[#c9a962] hover:text-[#d4b76e] font-medium"
                        >
                          Rate
                        </button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <TransactionsTab merchantId={merchantId} />
        )}
      </div>
    </div>
  );
}
```

### Step 8: Update the Database

Run the migration to create the ledger_entries table:

```bash
psql -d your_database -f database/migrations/022_ledger_entries.sql
```

For Railway (if using Railway migration script):
```bash
# Add the contents of 022_ledger_entries.sql to database/railway-migration.sql
```

### Step 9: Add Keyboard Shortcuts (Optional)

In `src/app/merchant/page.tsx`, add keyboard shortcuts:

```tsx
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // "/" to focus search
    if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
      e.preventDefault();
      // Focus your search input
      document.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
    }

    // "A" to accept selected order
    if (e.key === 'a' || e.key === 'A') {
      if (selectedOrder && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        handleAcceptOrder(selectedOrder);
      }
    }

    // "R" to refresh
    if (e.key === 'r' || e.key === 'R') {
      if (e.metaKey || e.ctrlKey) return; // Don't interfere with browser refresh
      if (!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        fetchOrders();
      }
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, [selectedOrder, handleAcceptOrder, fetchOrders]);
```

### Step 10: Add Compact Mode Toggle (Optional)

Add state for compact mode:

```tsx
const [compactMode, setCompactMode] = useState(false);

// Pass to components as a prop to reduce padding/spacing
```

## 🎨 Styling Notes

- All panels use `overflow-y-auto` for their list areas only
- Heights are fixed: `h-[60%]`, `h-[40%]`, `h-[35%]`, `h-[65%]`
- Main grid uses `h-screen` and `overflow-hidden`
- Console theme maintained: `#0a0a0a`, `#141414`, `#1a1a1a`, `#c9a962`
- Font mono for all numeric/technical displays
- Border colors: `border-white/[0.06]` and `border-white/[0.04]`

## ✅ Testing Checklist

- [ ] Page never scrolls (body has `overflow: hidden`)
- [ ] Left column scrolls internally (config panel)
- [ ] Center top (Pending) scrolls internally
- [ ] Center bottom (Leaderboard) scrolls internally
- [ ] Right top (In Progress) scrolls internally
- [ ] Right bottom (Activity) scrolls internally
- [ ] Tabs switch properly (Pending/All, Completed/Transactions)
- [ ] Transactions tab loads ledger entries
- [ ] Keyboard shortcuts work
- [ ] Sound toggle works
- [ ] Refresh updates data
- [ ] All existing functionality preserved

## 📝 Migration Path

Due to the massive size of the current `page.tsx` (8071 lines), implement this incrementally:

1. Start with the database migration and API routes ✅ (Done)
2. Create one component at a time (ConfigPanel, then PendingOrdersPanel, etc.)
3. Test each component in isolation
4. Replace sections of the main page one at a time
5. Gradually move logic from page.tsx into the new components
6. Keep mobile view separate and unchanged until desktop is stable

## 🚀 Next Steps

After basic implementation works:

- Add search functionality to Pending panel
- Add filters to Transactions tab (by type, date range)
- Add profit calculations to Pending orders
- Add estimated earnings badges
- Implement the "Mineable" indicator properly
- Add real-time updates via WebSocket to all panels
- Add loading skeletons for better UX
- Add empty state illustrations
