'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Trophy,
  Activity,
  Clock,
  Wallet,
  Loader2,
  Plus,
  Banknote,
  Minus,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface StatusCardProps {
  // Balance
  balance: number;
  lockedInEscrow: number;

  // Performance
  todayEarnings: number;
  completedOrders: number;
  cancelledOrders: number;
  rank: number;

  // Status
  isOnline: boolean;
}

interface CorridorData {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  avg_fill_time_sec: number;
  active_merchants_count: number;
  updated_at: string;
}

export function StatusCard({
  balance,
  lockedInEscrow,
  todayEarnings,
  completedOrders,
  cancelledOrders,
  rank,
  isOnline,
}: StatusCardProps) {
  const [corridor, setCorridor] = useState<CorridorData | null>(null);
  const [prevPrice, setPrevPrice] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [showCashInput, setShowCashInput] = useState(false);
  const [cashInputValue, setCashInputValue] = useState('');
  const [customRefPrice, setCustomRefPrice] = useState<number | null>(null);
  const [showRefPriceInput, setShowRefPriceInput] = useState(false);
  const [refPriceInputValue, setRefPriceInputValue] = useState('');

  useEffect(() => {
    fetchCorridorData();
    const interval = setInterval(fetchCorridorData, 30000); // Update every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchCorridorData = async () => {
    try {
      const res = await fetch('/api/mempool?type=corridor&corridor_id=USDT_AED');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data.corridor) {
          setPrevPrice(corridor?.ref_price || null);
          setCorridor(data.data.corridor);
        }
      }
    } catch (error) {
      console.error('Failed to fetch corridor data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Calculations
  const totalTrades = completedOrders + cancelledOrders;
  const winRate = totalTrades > 0 ? (completedOrders / totalTrades) * 100 : 0;
  const netLiquidity = balance - lockedInEscrow;

  const priceChange = prevPrice && prevPrice > 0 && corridor
    ? ((corridor.ref_price - prevPrice) / prevPrice) * 100
    : 0;
  const isPositive = priceChange >= 0;

  if (isLoading) {
    return (
      <div className="bg-black border border-[#c9a962]/20 rounded-lg p-6 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-[#c9a962] animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-black border border-[#c9a962]/20 rounded-lg overflow-hidden">
      {/* Compact Stacked Status */}
      <div className="p-4 space-y-3">
        {/* Balance - Hero */}
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet className="w-4 h-4 text-white/50" />
            <span className="text-[10px] text-white/50 font-mono uppercase tracking-wider">Balance</span>
          </div>
          <div className="text-5xl font-bold text-white font-mono leading-none mb-2">
            ${balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-white/40 font-mono">
              USDT {lockedInEscrow > 0 && `· ${lockedInEscrow.toFixed(0)} locked`}
            </span>
          </div>

          {/* Profit Today Indicator */}
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-[9px] text-white/30 font-mono">today</span>
            {todayEarnings > 0 ? (
              <>
                <ArrowUp className="w-3.5 h-3.5 text-green-500" />
                <span className="text-sm text-green-500 font-mono font-bold">
                  +${todayEarnings.toFixed(0)}
                </span>
              </>
            ) : todayEarnings < 0 ? (
              <>
                <ArrowDown className="w-3.5 h-3.5 text-red-500" />
                <span className="text-sm text-red-500 font-mono font-bold">
                  ${todayEarnings.toFixed(0)}
                </span>
              </>
            ) : (
              <>
                <Minus className="w-3.5 h-3.5 text-white/40" />
                <span className="text-sm text-white/40 font-mono font-bold">
                  $0
                </span>
              </>
            )}
          </div>
        </div>

        {/* Liquidity Meter */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] text-white/40 font-mono uppercase">Liquidity</span>
            <span className="text-[10px] text-white/60 font-mono font-bold">
              {balance > 0 ? ((lockedInEscrow / balance) * 100).toFixed(1) : '0.0'}%
            </span>
          </div>
          <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#c9a962]/60 rounded-full transition-all"
              style={{ width: `${balance > 0 ? Math.min((lockedInEscrow / balance) * 100, 100) : 0}%` }}
            />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] pt-3" />

        {/* USDT → AED Rate - Prominent with controls */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-white/50 font-mono uppercase">USDT → AED Rate</span>
            </div>
            {!showRefPriceInput && (
              <button
                onClick={() => setShowRefPriceInput(true)}
                className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                <Plus className="w-3 h-3 text-white/60" />
              </button>
            )}
          </div>

          {showRefPriceInput ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={refPriceInputValue}
                onChange={(e) => setRefPriceInputValue(e.target.value)}
                placeholder="3.6730"
                step="0.0001"
                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono outline-none focus:border-[#c9a962]/50"
                autoFocus
              />
              <button
                onClick={() => {
                  const price = parseFloat(refPriceInputValue);
                  if (!isNaN(price)) {
                    setCustomRefPrice(price);
                    setRefPriceInputValue('');
                    setShowRefPriceInput(false);
                  }
                }}
                className="px-2 py-1.5 bg-[#c9a962]/20 hover:bg-[#c9a962]/30 border border-[#c9a962]/30 rounded text-[10px] text-[#c9a962] font-medium"
              >
                Set
              </button>
              <button
                onClick={() => {
                  setCustomRefPrice(null);
                  setRefPriceInputValue('');
                  setShowRefPriceInput(false);
                }}
                className="px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded text-[10px] text-red-400 font-medium"
              >
                Reset
              </button>
            </div>
          ) : (
            <div className="text-3xl font-bold text-white font-mono leading-none">
              {customRefPrice
                ? customRefPrice.toFixed(4)
                : corridor
                  ? Number(corridor.ref_price).toFixed(4)
                  : '—'}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.06] pt-3" />

        {/* Compact Metrics Stack */}
        <div className="space-y-2">

          {/* Rank */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50 font-mono uppercase">Rank</span>
            <span className="text-sm text-white font-mono font-bold">
              {rank > 0 ? `#${rank}` : '—'}
            </span>
          </div>

          {/* Win Rate */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50 font-mono uppercase">Win Rate</span>
            <span className="text-sm text-white font-mono font-bold">
              {winRate > 0 ? `${winRate.toFixed(0)}%` : '—'}
            </span>
          </div>

          {/* Avg Fill */}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/50 font-mono uppercase">Avg Fill</span>
            <span className="text-sm text-white font-mono font-bold">
              {corridor?.avg_fill_time_sec ? `${corridor.avg_fill_time_sec}s` : '—'}
            </span>
          </div>
        </div>

        {/* Mineable Orders */}
        <div className="pt-3 border-t border-white/[0.06]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#c9a962]/70 font-mono uppercase tracking-wide">Mineable Orders</span>
            <span className="text-base text-[#c9a962] font-mono font-bold">
              {Math.floor((balance - lockedInEscrow) / 100)}
            </span>
          </div>
        </div>

        {/* Cash Balance */}
        <div className="pt-3 border-t border-white/[0.06]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-white/50 font-mono uppercase">Cash Balance</span>
            {!showCashInput && (
              <button
                onClick={() => setShowCashInput(true)}
                className="p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                <Plus className="w-3 h-3 text-white/60" />
              </button>
            )}
          </div>

          {showCashInput ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={cashInputValue}
                onChange={(e) => setCashInputValue(e.target.value)}
                placeholder="AED"
                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm text-white font-mono outline-none focus:border-[#c9a962]/50"
                autoFocus
              />
              <button
                onClick={() => {
                  const amount = parseFloat(cashInputValue);
                  if (!isNaN(amount)) {
                    setCashBalance(amount);
                    setCashInputValue('');
                    setShowCashInput(false);
                  }
                }}
                className="px-2 py-1.5 bg-[#c9a962]/20 hover:bg-[#c9a962]/30 border border-[#c9a962]/30 rounded text-[10px] text-[#c9a962] font-medium"
              >
                Set
              </button>
            </div>
          ) : (
            <div className="text-2xl font-bold text-white font-mono">
              {cashBalance.toFixed(0)} <span className="text-xs text-white/40">AED</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
