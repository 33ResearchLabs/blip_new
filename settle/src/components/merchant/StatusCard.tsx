'use client';

import { useState, useEffect, useCallback, memo } from 'react';
import {
  Wallet,
  Loader2,
  X,
  AlertCircle,
  Check,
  Plus,
  Minus,
  TrendingUp,
  Activity,
  Radio,
  ChevronRight,
  Shield,
} from 'lucide-react';

interface StatusCardProps {
  balance: number;
  lockedInEscrow: number;
  todayEarnings: number;
  completedOrders: number;
  cancelledOrders: number;
  rank: number;
  isOnline: boolean;
  merchantId?: string;
  onToggleOnline?: () => void;
  onOpenCorridor?: () => void;
}

interface CorridorData {
  corridor_id: string;
  ref_price: number;
  volume_5m: number;
  avg_fill_time_sec: number;
  active_merchants_count: number;
  updated_at: string;
  calculation_method?: string;
  orders_analyzed?: number;
  is_fallback?: boolean;
  confidence?: 'low' | 'medium' | 'high';
}

export const StatusCard = memo(function StatusCard({
  balance,
  lockedInEscrow,
  todayEarnings,
  completedOrders,
  cancelledOrders,
  rank,
  isOnline,
  merchantId,
  onToggleOnline,
  onOpenCorridor,
}: StatusCardProps) {
  const [corridor, setCorridor] = useState<CorridorData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [customRefPrice, setCustomRefPrice] = useState<number | null>(null);
  const [showRefPriceInput, setShowRefPriceInput] = useState(false);
  const [refPriceInputValue, setRefPriceInputValue] = useState('');

  const [saedBalance, setSaedBalance] = useState(0);
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [conversionDirection, setConversionDirection] = useState<'usdt_to_saed' | 'saed_to_usdt'>('usdt_to_saed');
  const [conversionAmount, setConversionAmount] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionSuccess, setConversionSuccess] = useState<string | null>(null);

  const [reputationTier, setReputationTier] = useState<{ name: string; tier: string; score: number } | null>(null);

  const [inrBalance, setInrBalance] = useState<number>(() => {
    if (typeof window !== 'undefined' && merchantId) {
      const saved = localStorage.getItem(`inr_cash_${merchantId}`);
      return saved ? parseFloat(saved) : 0;
    }
    return 0;
  });
  const [showInrInput, setShowInrInput] = useState(false);
  const [inrInputValue, setInrInputValue] = useState('');
  const [inrInputMode, setInrInputMode] = useState<'add' | 'subtract'>('add');

  useEffect(() => {
    if (typeof window !== 'undefined' && merchantId) {
      localStorage.setItem(`inr_cash_${merchantId}`, inrBalance.toString());
    }
  }, [inrBalance, merchantId]);

  useEffect(() => {
    fetchCorridorData();
    const interval = setInterval(fetchCorridorData, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!merchantId) return;
    fetch(`/api/reputation?entityId=${merchantId}&entityType=merchant`)
      .then(r => r.json())
      .then(data => {
        if (data.success && data.data?.score) {
          setReputationTier({ name: data.data.tierInfo.name, tier: data.data.score.tier, score: data.data.score.total_score });
        }
      })
      .catch(() => {});
  }, [merchantId]);

  const fetchCorridorData = async () => {
    try {
      const res = await fetch('/api/corridor/dynamic-rate');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data) {
          setCorridor(data.data);
        }
      }
    } catch (error) {
      console.error('Failed to fetch corridor data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSaedBalance = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await fetch(`/api/convert?userId=${merchantId}&type=merchant`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.balances) {
          setSaedBalance(data.balances.saed);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sAED balance:', err);
    }
  }, [merchantId]);

  useEffect(() => {
    if (merchantId) {
      fetchSaedBalance();
      const interval = setInterval(fetchSaedBalance, 30000);
      return () => clearInterval(interval);
    }
  }, [merchantId, fetchSaedBalance]);

  const handleConvert = async () => {
    const amount = parseFloat(conversionAmount);
    if (isNaN(amount) || amount <= 0) {
      setConversionError('Please enter a valid amount');
      return;
    }
    if (conversionDirection === 'usdt_to_saed' && amount > balance) {
      setConversionError('Insufficient USDT balance');
      return;
    }
    if (conversionDirection === 'saed_to_usdt') {
      const saedInAED = saedBalance / 100;
      if (amount > saedInAED) {
        setConversionError('Insufficient sAED balance');
        return;
      }
    }

    setIsConverting(true);
    setConversionError(null);

    try {
      const amountInSmallestUnits = conversionDirection === 'usdt_to_saed'
        ? Math.floor(amount * 1_000_000)
        : Math.floor(amount * 100);

      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: conversionDirection,
          amount: amountInSmallestUnits,
          accountType: 'merchant',
          accountId: merchantId,
          idempotencyKey: `${merchantId}-${Date.now()}-${Math.random()}`,
        }),
      });

      const data = await response.json();

      if (data.success) {
        await fetchSaedBalance();
        const successMsg = conversionDirection === 'usdt_to_saed'
          ? `Converted ${amount.toFixed(6)} USDT to sAED`
          : `Converted ${amount.toFixed(2)} AED to USDT`;
        setConversionSuccess(successMsg);
        setShowConversionModal(false);
        setConversionAmount('');
        setTimeout(() => setConversionSuccess(null), 3000);
      } else {
        setConversionError(data.error || 'Conversion failed');
      }
    } catch (err) {
      console.error('Conversion error:', err);
      setConversionError('Network error. Please try again.');
    } finally {
      setIsConverting(false);
    }
  };

  const handleInrSubmit = () => {
    const amount = parseFloat(inrInputValue);
    if (isNaN(amount) || amount <= 0) return;
    setInrBalance(prev => inrInputMode === 'add' ? prev + amount : Math.max(0, prev - amount));
    setInrInputValue('');
    setShowInrInput(false);
  };

  const totalTrades = completedOrders + cancelledOrders;
  const winRate = totalTrades > 0 ? (completedOrders / totalTrades) * 100 : 0;
  const refPrice = customRefPrice || corridor?.ref_price || 3.67;
  const aedEquivalent = balance * refPrice;

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-white/20 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Live ticker strip */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.06] text-[9px] font-mono relative overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)' }}>
        <div className="flex items-center gap-4 relative z-10">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-live-dot" />
            <span className="text-orange-400/80 font-bold tracking-wide">LIVE</span>
          </div>
          <div className="flex items-center gap-3">
            {reputationTier && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/[0.06] border border-orange-500/10">
                <Shield className="w-2.5 h-2.5 text-orange-400/60" />
                <span className="text-orange-400/70 font-bold uppercase">{reputationTier.name}</span>
              </span>
            )}
            <span className="text-white/30">RNK <span className="text-white/70 font-bold">{rank > 0 ? `#${rank}` : '—'}</span></span>
            <span className="text-white/30">WIN <span className="text-white/70 font-bold">{winRate > 0 ? `${winRate.toFixed(0)}%` : '—'}</span></span>
            <span className="text-white/30">FILL <span className="text-white/70 font-bold">{corridor?.avg_fill_time_sec ? `${corridor.avg_fill_time_sec}s` : '—'}</span></span>
          </div>
        </div>
        {/* Active toggle */}
        <button
          onClick={onToggleOnline}
          className={`relative z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold tracking-wide transition-all border ${
            isOnline
              ? 'bg-orange-500/10 border-orange-500/30 text-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.15)]'
              : 'bg-white/[0.03] border-white/[0.08] text-white/30'
          }`}
        >
          <Radio className={`w-2.5 h-2.5 ${isOnline ? 'animate-live-dot' : ''}`} />
          {isOnline ? 'ACTIVE' : 'OFFLINE'}
        </button>
      </div>

      {/* Main balance hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-4 relative">
        {/* Ambient glow behind amount */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-56 h-28 bg-orange-500/[0.04] rounded-full blur-[80px]" />
        </div>

        {/* USDT Label */}
        <div className="flex items-center gap-1.5 mb-2 relative z-10">
          <Wallet className="w-3.5 h-3.5 text-white/25" />
          <span className="text-[10px] text-white/35 font-mono uppercase tracking-widest">Available Balance</span>
        </div>

        {/* Big USDT Amount */}
        <div className="relative z-10 text-center">
          <div className="text-4xl font-black text-white font-mono tabular-nums tracking-tight leading-none">
            {balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </div>
          <div className="text-[11px] text-white/25 font-mono mt-1.5 tabular-nums">
            ≈ {aedEquivalent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} AED
          </div>
        </div>

        {/* 24h Earnings badge */}
        {todayEarnings !== 0 && (
          <div className="mt-3 flex items-center gap-1.5 px-3 py-1 bg-orange-500/[0.06] border border-orange-500/15 rounded-full relative z-10 shadow-[0_0_12px_rgba(249,115,22,0.08)]">
            <TrendingUp className="w-3 h-3 text-orange-400" />
            <span className="text-[11px] font-bold text-orange-400 font-mono tabular-nums">
              {todayEarnings > 0 ? '+' : ''}{todayEarnings.toFixed(2)} USDT
            </span>
            <span className="text-[9px] text-orange-400/50 font-mono">24h</span>
          </div>
        )}

        {/* Locked escrow indicator */}
        {lockedInEscrow > 0 && (
          <div className="mt-2 text-[9px] text-white/20 font-mono relative z-10 flex items-center gap-1">
            <Shield className="w-2.5 h-2.5 text-white/15" />
            {lockedInEscrow.toFixed(0)} locked in escrow
          </div>
        )}
      </div>

      {/* Bottom section — secondary balances + rate */}
      <div className="px-3 pb-3 space-y-2">
        {/* sAED + INR row */}
        <div className="grid grid-cols-2 gap-2">
          {/* sAED */}
          {merchantId && (
            <div className="glass-card rounded-lg p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-white/25 font-mono">sAED</span>
                <div className="flex gap-0.5">
                  <button
                    onClick={() => { setConversionDirection('usdt_to_saed'); setShowConversionModal(true); setConversionError(null); }}
                    className="px-1 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-orange-500/20 text-[8px] text-orange-400 font-bold transition-all"
                  >
                    BUY
                  </button>
                  <button
                    onClick={() => { setConversionDirection('saed_to_usdt'); setShowConversionModal(true); setConversionError(null); }}
                    className="px-1 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-orange-500/20 text-[8px] text-orange-400 font-bold transition-all"
                  >
                    SELL
                  </button>
                </div>
              </div>
              <span className="text-sm font-bold text-white/80 font-mono tabular-nums">
                {(saedBalance / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* INR */}
          <div className="glass-card rounded-lg p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-white/25 font-mono">INR CASH</span>
              <div className="flex gap-0.5">
                <button
                  onClick={() => { setInrInputMode('add'); setShowInrInput(true); }}
                  className="p-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/25 transition-all"
                >
                  <Plus className="w-2 h-2" />
                </button>
                <button
                  onClick={() => { setInrInputMode('subtract'); setShowInrInput(true); }}
                  className="p-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/25 transition-all"
                >
                  <Minus className="w-2 h-2" />
                </button>
              </div>
            </div>
            {showInrInput ? (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-white/25 font-mono">{inrInputMode === 'add' ? '+' : '-'}</span>
                <input
                  type="number"
                  value={inrInputValue}
                  onChange={(e) => setInrInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleInrSubmit(); if (e.key === 'Escape') setShowInrInput(false); }}
                  placeholder="0"
                  className="w-14 bg-white/[0.03] border border-white/[0.08] rounded px-1 py-0.5 text-[10px] text-white font-mono outline-none focus:border-white/20"
                  autoFocus
                />
                <button onClick={handleInrSubmit} className="px-1 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[8px] text-white/50 font-bold">OK</button>
              </div>
            ) : (
              <span className="text-sm font-bold text-white/70 font-mono tabular-nums">
                {inrBalance > 0 ? `₹${inrBalance.toLocaleString()}` : '₹0'}
              </span>
            )}
          </div>
        </div>

        {/* Success toast */}
        {conversionSuccess && (
          <div className="flex items-center gap-1.5 py-1 px-2 bg-orange-500/[0.06] border border-orange-500/20 rounded">
            <Check className="w-3 h-3 text-orange-400" />
            <span className="text-[9px] text-orange-400">{conversionSuccess}</span>
          </div>
        )}

        {/* Market Rate — prominent display */}
        <div className="glass-card rounded-lg p-2.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">Market Rate</span>
                {corridor?.confidence && (
                  <span className={`text-[8px] font-mono px-1 py-0.5 rounded flex items-center gap-0.5 ${
                    corridor.confidence === 'high' ? 'bg-white/[0.04] text-white/50' :
                    corridor.confidence === 'medium' ? 'bg-white/[0.03] text-white/35' :
                    'bg-white/[0.02] text-white/20'
                  }`}>
                    <span className={`w-1 h-1 rounded-full ${corridor.confidence === 'high' ? 'bg-orange-400 animate-live-dot' : 'bg-white/20'}`} />
                    {corridor.confidence === 'high' ? 'LIVE' : corridor.confidence === 'medium' ? 'CALC' : 'EST'}
                  </span>
                )}
              </div>
              <div className="text-lg font-bold text-white font-mono tabular-nums">
                {corridor ? Number(corridor.ref_price).toFixed(4) : '—'}
              </div>
              <div className="text-[9px] text-white/20 font-mono mt-0.5">USDT/AED</div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {!showRefPriceInput && (
                <button
                  onClick={() => setShowRefPriceInput(true)}
                  className="px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-orange-500/20 text-[9px] text-orange-400 font-bold transition-all"
                >
                  {customRefPrice ? `${customRefPrice.toFixed(4)}` : 'SET PRICE'}
                </button>
              )}
            </div>
          </div>
          {showRefPriceInput && (
            <div className="flex items-center gap-1 mt-2">
              <input
                type="number"
                value={refPriceInputValue}
                onChange={(e) => setRefPriceInputValue(e.target.value)}
                placeholder="3.6730"
                step="0.0001"
                className="flex-1 bg-white/[0.02] border border-white/[0.06] rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-white/15"
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
                className="px-2 py-1 bg-white/[0.04] hover:bg-white/[0.08] border border-orange-500/30 rounded text-[9px] text-orange-400 font-medium"
              >
                Set
              </button>
              <button
                onClick={() => { setCustomRefPrice(null); setRefPriceInputValue(''); setShowRefPriceInput(false); }}
                className="px-1 py-1 text-white/15 hover:text-white/30"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Corridor button */}
        <button
          onClick={onOpenCorridor}
          className="w-full flex items-center justify-between py-1.5 px-2.5 glass-card rounded-lg hover:bg-white/[0.04] transition-all group"
        >
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-white/20" />
            <span className="text-[9px] text-white/30 font-mono uppercase tracking-wider">Corridor</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-white/40 font-mono tabular-nums">
              {corridor?.active_merchants_count || 0} online · vol {corridor?.volume_5m ? corridor.volume_5m.toFixed(0) : '0'}
            </span>
            <ChevronRight className="w-3 h-3 text-white/15 group-hover:text-white/30 transition-colors" />
          </div>
        </button>

        {/* Quick stats row */}
        <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[9px] font-mono text-white/25">
          <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-emerald-500/40" />{completedOrders} done</span>
          <span className="text-white/8">|</span>
          <span className="flex items-center gap-1"><span className="w-1 h-1 rounded-full bg-red-500/40" />{cancelledOrders} cancelled</span>
          <span className="text-white/8">|</span>
          <span>{totalTrades} total</span>
        </div>
      </div>

      {/* Conversion Modal */}
      {showConversionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowConversionModal(false)}>
          <div className="glass-card rounded-xl p-5 w-full max-w-md mx-4 bg-[#0c0c0c]/95 border border-white/[0.08]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold text-white">
                {conversionDirection === 'usdt_to_saed' ? 'Buy sAED with USDT' : 'Sell sAED for USDT'}
              </h3>
              <button
                onClick={() => { setShowConversionModal(false); setConversionAmount(''); setConversionError(null); }}
                className="p-1 rounded hover:bg-white/[0.04] transition-colors"
              >
                <X className="w-4 h-4 text-white/30" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-white/35 mb-1.5 font-mono">
                Amount {conversionDirection === 'usdt_to_saed' ? '(USDT)' : '(AED)'}
              </label>
              <input
                type="number"
                value={conversionAmount}
                onChange={(e) => setConversionAmount(e.target.value)}
                placeholder="0.00"
                step={conversionDirection === 'usdt_to_saed' ? '0.000001' : '0.01'}
                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-3 py-2.5 text-white font-mono text-lg outline-none focus:border-white/20 transition-colors"
                autoFocus
              />
              {conversionDirection === 'usdt_to_saed' && (
                <div className="mt-1 text-[10px] text-white/25 font-mono">Available: ${balance.toFixed(6)} USDT</div>
              )}
              {conversionDirection === 'saed_to_usdt' && (
                <div className="mt-1 text-[10px] text-white/25 font-mono">Available: {(saedBalance / 100).toFixed(2)} AED</div>
              )}
            </div>

            {conversionAmount && parseFloat(conversionAmount) > 0 && (
              <div className="mb-4 py-2.5 px-3 bg-white/[0.02] border border-white/[0.06] rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-white/35">You will receive</span>
                  <span className="text-base font-bold text-orange-400 font-mono tabular-nums">
                    {conversionDirection === 'usdt_to_saed'
                      ? `${(parseFloat(conversionAmount) * refPrice).toFixed(2)} AED`
                      : `${(parseFloat(conversionAmount) / refPrice).toFixed(6)} USDT`}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] text-white/20 font-mono">
                  Rate: 1 USDT = {refPrice.toFixed(4)} AED
                </div>
              </div>
            )}

            {conversionError && (
              <div className="mb-4 flex items-center gap-1.5 py-2 px-3 bg-white/[0.03] border border-white/[0.06] rounded-lg">
                <AlertCircle className="w-3.5 h-3.5 text-white/40" />
                <span className="text-xs text-white/50">{conversionError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowConversionModal(false); setConversionAmount(''); setConversionError(null); }}
                className="flex-1 py-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-white/60 text-sm font-medium transition-all border border-white/[0.06]"
              >
                Cancel
              </button>
              <button
                onClick={handleConvert}
                disabled={isConverting || !conversionAmount || parseFloat(conversionAmount) <= 0}
                className="flex-1 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-black text-sm font-bold transition-all disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-orange-500"
              >
                {isConverting ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Converting...</>
                ) : (
                  'Convert'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
