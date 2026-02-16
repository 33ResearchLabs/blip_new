'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import {
  Zap,
  Target,
  TrendingDown,
  ChevronUp,
  ChevronDown,
  Loader2,
  Flame,
  ArrowRightLeft,
} from 'lucide-react';

interface ConfigPanelProps {
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  openTradeForm: {
    tradeType: 'buy' | 'sell';
    cryptoAmount: string;
    paymentMethod: 'bank' | 'cash';
    spreadPreference: 'best' | 'fastest' | 'cheap';
  };
  setOpenTradeForm: (form: any) => void;
  isCreatingTrade: boolean;
  onCreateOrder: (tradeType?: 'buy' | 'sell', priorityFee?: number) => void;
  refreshBalance: () => void;
}

const PRICING_TIERS = {
  fastest: { label: 'Fast', base: 2.5, range: 5, icon: Zap },
  best: { label: 'Best', base: 2.0, range: 3, icon: Target },
  cheap: { label: 'Cheap', base: 1.5, range: 2, icon: TrendingDown },
} as const;

// Priority fee decay: full for first 15s, linear decay 15s→60s, 0 after 60s
function getDecayedFee(maxFee: number, elapsedSec: number): number {
  if (elapsedSec <= 15) return maxFee;
  if (elapsedSec >= 60) return 0;
  return maxFee * (1 - (elapsedSec - 15) / 45);
}

// SVG decay curve visualization
function DecayChart({ maxFee }: { maxFee: number }) {
  const w = 180;
  const h = 40;
  const padL = 16;
  const padR = 4;
  const padT = 3;
  const padB = 12;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const points: string[] = [];
  for (let t = 0; t <= 60; t += 1) {
    const fee = getDecayedFee(maxFee, t);
    const x = padL + (t / 60) * chartW;
    const y = padT + chartH - (fee / Math.max(maxFee, 1)) * chartH;
    points.push(`${x},${y}`);
  }
  const linePath = `M${points.join(' L')}`;
  const firstPoint = `${padL},${padT + chartH}`;
  const lastPoint = `${padL + chartW},${padT + chartH}`;
  const fillPath = `M${firstPoint} L${points.join(' L')} L${lastPoint} Z`;

  return (
    <svg width={w} height={h} className="w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <line x1={padL} y1={padT + chartH} x2={padL + chartW} y2={padT + chartH} stroke="rgba(255,255,255,0.04)" strokeWidth="0.5" />
      <line x1={padL + (15 / 60) * chartW} y1={padT} x2={padL + (15 / 60) * chartW} y2={padT + chartH} stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" strokeDasharray="2,2" />
      <path d={fillPath} fill="url(#decayGrad)" />
      <path d={linePath} fill="none" stroke="rgb(249,115,22)" strokeWidth="1.5" strokeLinejoin="round" />
      <text x={padL} y={h - 1} fill="rgba(255,255,255,0.2)" fontSize="5.5" fontFamily="monospace">0s</text>
      <text x={padL + (15 / 60) * chartW - 3} y={h - 1} fill="rgba(255,255,255,0.25)" fontSize="5.5" fontFamily="monospace">15s</text>
      <text x={padL + chartW - 10} y={h - 1} fill="rgba(255,255,255,0.2)" fontSize="5.5" fontFamily="monospace">60s</text>
      <text x={1} y={padT + 5} fill="rgba(255,255,255,0.2)" fontSize="5.5" fontFamily="monospace">{maxFee}%</text>
      <defs>
        <linearGradient id="decayGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(249,115,22)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="rgb(249,115,22)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const ConfigPanel = memo(function ConfigPanel({
  merchantId,
  merchantInfo,
  effectiveBalance,
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  onCreateOrder,
  refreshBalance,
}: ConfigPanelProps) {
  const [currentRate, setCurrentRate] = useState<number>(3.67);
  const [priorityFee, setPriorityFee] = useState<number>(0);
  const [showPriorityInput, setShowPriorityInput] = useState(false);

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetch('/api/corridor/dynamic-rate');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data.ref_price) {
            setCurrentRate(data.data.ref_price);
          }
        }
      } catch (err) {
        console.error('Failed to fetch rate:', err);
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 30000);
    return () => clearInterval(interval);
  }, []);

  const tier = PRICING_TIERS[openTradeForm.spreadPreference];
  const cryptoAmount = parseFloat(openTradeForm.cryptoAmount) || 0;
  const maxAmount = effectiveBalance || 0;

  const pricing = useMemo(() => {
    const totalSpread = tier.base + priorityFee;
    const buyRate = currentRate * (1 - totalSpread / 100);
    const sellRate = currentRate * (1 + totalSpread / 100);
    const buyAed = cryptoAmount * buyRate;
    const sellAed = cryptoAmount * sellRate;

    return { totalSpread, buyRate, sellRate, buyAed, sellAed };
  }, [currentRate, tier, priorityFee, cryptoAmount]);

  const handlePriorityChange = (val: number) => {
    setPriorityFee(Math.min(50, Math.max(0, val)));
  };

  const isDisabled = isCreatingTrade || !openTradeForm.cryptoAmount || parseFloat(openTradeForm.cryptoAmount) <= 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Hero amount input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-orange-400/60" />
              <span className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Amount</span>
            </div>
            <button
              onClick={() => setOpenTradeForm({ ...openTradeForm, cryptoAmount: maxAmount.toFixed(0) })}
              className="text-[10px] text-orange-400/70 hover:text-orange-400 font-mono font-bold transition-colors px-1.5 py-0.5 rounded bg-orange-500/[0.06] hover:bg-orange-500/10"
            >
              MAX {maxAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              value={openTradeForm.cryptoAmount}
              onChange={(e) => setOpenTradeForm({ ...openTradeForm, cryptoAmount: e.target.value })}
              placeholder="0"
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-xl font-bold text-white placeholder:text-white/10 outline-none focus:border-orange-500/30 focus:bg-white/[0.04] transition-all font-mono tabular-nums"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-white/25 font-mono">USDT</span>
          </div>
          {cryptoAmount > 0 && (
            <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] font-mono">
              <span className="text-white/30">≈ {(cryptoAmount * currentRate).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED</span>
              <span className="text-white/20">@ {currentRate.toFixed(4)}</span>
            </div>
          )}
        </div>

        {/* Payment Method */}
        <div className="flex gap-1.5">
          {(['bank', 'cash'] as const).map((method) => (
            <button
              key={method}
              onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: method })}
              className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                openTradeForm.paymentMethod === method
                  ? 'bg-white/[0.08] text-white/90 border-white/[0.12]'
                  : 'bg-white/[0.02] text-white/30 hover:bg-white/[0.05] border-white/[0.04]'
              }`}
            >
              {method === 'bank' ? 'Bank Transfer' : 'Cash'}
            </button>
          ))}
        </div>

        {/* Spread Tier */}
        <div>
          <label className="text-[10px] text-white/30 mb-1.5 block font-mono uppercase tracking-wider font-bold">Spread</label>
          <div className="flex gap-1.5">
            {(Object.entries(PRICING_TIERS) as [keyof typeof PRICING_TIERS, typeof PRICING_TIERS[keyof typeof PRICING_TIERS]][]).map(([key, t]) => {
              const isSelected = openTradeForm.spreadPreference === key;
              const TierIcon = t.icon;
              return (
                <button
                  key={key}
                  onClick={() => setOpenTradeForm({ ...openTradeForm, spreadPreference: key })}
                  className={`flex-1 py-2 px-1.5 rounded-xl transition-all border text-center ${
                    isSelected
                      ? 'bg-orange-500/[0.08] border-orange-500/20'
                      : 'bg-white/[0.02] hover:bg-white/[0.04] border-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TierIcon className={`w-3 h-3 ${isSelected ? 'text-orange-400' : 'text-white/20'}`} />
                    <span className={`text-[10px] font-bold ${isSelected ? 'text-white' : 'text-white/35'}`}>{t.label}</span>
                  </div>
                  <div className={`text-[11px] font-black font-mono tabular-nums ${isSelected ? 'text-orange-400' : 'text-white/25'}`}>
                    +{t.base}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Priority Fee / Boost */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] text-white/30 font-mono uppercase tracking-wider font-bold flex items-center gap-1">
              <Flame className="w-3 h-3 text-orange-400/40" />
              Boost
            </label>
            <button
              onClick={() => setShowPriorityInput(!showPriorityInput)}
              className="text-[9px] text-orange-400/50 hover:text-orange-400 font-mono font-bold transition-colors"
            >
              {showPriorityInput ? 'hide' : 'manual'}
            </button>
          </div>
          <div className="flex gap-1.5">
            {[0, 5, 10, 15].map((val) => (
              <button
                key={val}
                onClick={() => setPriorityFee(val)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all border ${
                  priorityFee === val
                    ? 'bg-white/[0.08] text-white/90 border-white/[0.12]'
                    : 'bg-white/[0.02] text-white/25 hover:bg-white/[0.05] border-white/[0.04]'
                }`}
              >
                {val === 0 ? '0' : `${val}%`}
              </button>
            ))}
          </div>

          {showPriorityInput && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <button onClick={() => handlePriorityChange(priorityFee - 0.5)} className="p-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/30">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                value={priorityFee}
                onChange={(e) => handlePriorityChange(parseFloat(e.target.value) || 0)}
                min={0} max={50} step={0.5}
                className="flex-1 bg-white/[0.03] border border-white/[0.06] rounded-lg px-2 py-1 text-[11px] text-white font-mono text-center outline-none focus:border-white/15"
              />
              <button onClick={() => handlePriorityChange(priorityFee + 0.5)} className="p-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-white/30">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-white/20 font-mono font-bold">%</span>
            </div>
          )}

          {priorityFee > 0 && (
            <div className="mt-1.5 rounded-xl bg-white/[0.02] border border-white/[0.04] p-1.5">
              <div className="flex items-center justify-between px-1 mb-0.5">
                <span className="text-[9px] text-white/15 font-mono font-bold">DECAY</span>
                <span className="text-[9px] text-orange-400/50 font-mono font-bold">{priorityFee}% → 0%</span>
              </div>
              <DecayChart maxFee={priorityFee} />
            </div>
          )}
        </div>

        {/* BUY / SELL Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: 'buy' });
              onCreateOrder('buy', priorityFee);
            }}
            disabled={isDisabled}
            className="flex-1 py-3 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 text-black font-bold hover:from-orange-400 hover:to-orange-500 transition-all disabled:opacity-20 disabled:cursor-not-allowed press-effect flex flex-col items-center justify-center gap-0.5 shadow-[0_2px_12px_rgba(249,115,22,0.15)]"
          >
            {isCreatingTrade && openTradeForm.tradeType === 'buy' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm font-black tracking-wide">BUY</span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] font-mono font-bold opacity-60">{pricing.buyAed.toFixed(2)} AED</span>
                )}
              </>
            )}
          </button>
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: 'sell' });
              onCreateOrder('sell', priorityFee);
            }}
            disabled={isDisabled}
            className="flex-1 py-3 rounded-xl bg-white/[0.06] text-white font-bold hover:bg-white/[0.10] transition-all disabled:opacity-20 disabled:cursor-not-allowed press-effect border border-white/[0.08] flex flex-col items-center justify-center gap-0.5"
          >
            {isCreatingTrade && openTradeForm.tradeType === 'sell' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm font-black tracking-wide">SELL</span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] font-mono font-bold text-white/40">{pricing.sellAed.toFixed(2)} AED</span>
                )}
              </>
            )}
          </button>
        </div>

        {/* Spread summary */}
        {cryptoAmount > 0 && (
          <div className="flex items-center justify-between px-1 text-[9px] font-mono text-white/20">
            <span>+{pricing.totalSpread.toFixed(1)}% spread</span>
            <span className="tabular-nums">B {pricing.buyRate.toFixed(4)} · S {pricing.sellRate.toFixed(4)}</span>
          </div>
        )}
      </div>
    </div>
  );
});
