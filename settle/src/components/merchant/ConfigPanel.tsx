"use client";

import { useState, useEffect, useMemo, memo, lazy, Suspense } from "react";
import {
  Zap,
  Target,
  TrendingDown,
  ChevronUp,
  ChevronDown,
  Loader2,
  Flame,
  ArrowRightLeft,
  Plus,
  X,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { MyOffers } from "@/components/merchant/MyOffers";
import { ChevronRight, Package } from "lucide-react";

interface MerchantPaymentMethod {
  id: string;
  type: 'bank' | 'cash' | 'crypto' | 'card' | 'mobile';
  name: string;
  details?: string;
  is_default?: boolean;
}

interface ConfigPanelProps {
  merchantId: string | null;
  merchantInfo: any;
  effectiveBalance: number | null;
  openTradeForm: {
    tradeType: "buy" | "sell";
    cryptoAmount: string;
    paymentMethod: "bank" | "cash";
    spreadPreference: "best" | "fastest" | "cheap";
  };
  setOpenTradeForm: (form: any) => void;
  isCreatingTrade: boolean;
  onCreateOrder: (tradeType?: "buy" | "sell", priorityFee?: number, pair?: "usdt_aed" | "usdt_inr") => void;
  refreshBalance: () => void;
}

const PRICING_TIERS = {
  fastest: { label: "Fast", base: 2.5, range: 5, icon: Zap },
  best: { label: "Best", base: 2.0, range: 3, icon: Target },
  cheap: { label: "Cheap", base: 1.5, range: 2, icon: TrendingDown },
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
  const linePath = `M${points.join(" L")}`;
  const firstPoint = `${padL},${padT + chartH}`;
  const lastPoint = `${padL + chartW},${padT + chartH}`;
  const fillPath = `M${firstPoint} L${points.join(" L")} L${lastPoint} Z`;

  return (
    <svg
      width={w}
      height={h}
      className="w-full"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="rgba(255,255,255,0.04)"
        strokeWidth="0.5"
      />
      <line
        x1={padL + (15 / 60) * chartW}
        y1={padT}
        x2={padL + (15 / 60) * chartW}
        y2={padT + chartH}
        stroke="rgba(255,255,255,0.06)"
        strokeWidth="0.5"
        strokeDasharray="2,2"
      />
      <path d={fillPath} fill="url(#decayGrad)" />
      <path
        d={linePath}
        fill="none"
        stroke="rgb(249,115,22)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <text
        x={padL}
        y={h - 1}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        0s
      </text>
      <text
        x={padL + (15 / 60) * chartW - 3}
        y={h - 1}
        fill="rgba(255,255,255,0.25)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        15s
      </text>
      <text
        x={padL + chartW - 10}
        y={h - 1}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        60s
      </text>
      <text
        x={1}
        y={padT + 5}
        fill="rgba(255,255,255,0.2)"
        fontSize="5.5"
        fontFamily="monospace"
      >
        {maxFee}%
      </text>
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
  // Local AED/INR toggle — flips which corridor rate ConfigPanel reads and
  // which currency labels render. Purely a price-display toggle; does NOT
  // touch order roles, state machine, or business logic.
  const [pair, setPair] = useState<"usdt_aed" | "usdt_inr">("usdt_aed");

  // Merchant payment methods (replaces the static Bank/Cash buttons).
  const [paymentMethods, setPaymentMethods] = useState<MerchantPaymentMethod[]>([]);
  const [showAddPm, setShowAddPm] = useState(false);
  const [newPm, setNewPm] = useState<{ type: 'bank' | 'cash' | 'card' | 'mobile' | 'crypto'; name: string; details: string }>({ type: 'bank', name: '', details: '' });
  const [savingPm, setSavingPm] = useState(false);

  const fetchPaymentMethods = async () => {
    if (!merchantId) return;
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.data)) {
        setPaymentMethods(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch payment methods:", err);
    }
  };

  useEffect(() => {
    fetchPaymentMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  const handleAddPaymentMethod = async () => {
    if (!merchantId || !newPm.name.trim()) return;
    setSavingPm(true);
    try {
      const res = await fetchWithAuth(`/api/merchant/${merchantId}/payment-methods`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newPm.type,
          name: newPm.name.trim(),
          details: newPm.details.trim(),
          is_default: paymentMethods.length === 0,
        }),
      });
      if (res.ok) {
        await fetchPaymentMethods();
        setShowAddPm(false);
        setNewPm({ type: 'bank', name: '', details: '' });
      }
    } catch (err) {
      console.error("Failed to add payment method:", err);
    } finally {
      setSavingPm(false);
    }
  };
  const [currentRate, setCurrentRate] = useState<number>(3.67);
  const [priorityFee, setPriorityFee] = useState<number>(0);
  const [showPriorityInput, setShowPriorityInput] = useState(false);
  const [showOffers, setShowOffers] = useState(false);

  // Currency labels derived from the selected pair.
  const fiatLabel = pair === "usdt_inr" ? "INR" : "AED";
  const fiatSymbol = pair === "usdt_inr" ? "₹" : "";
  const fiatSuffix = pair === "usdt_aed" ? " AED" : "";

  useEffect(() => {
    const fetchRate = async () => {
      try {
        const res = await fetchWithAuth(`/api/corridor/dynamic-rate?pair=${pair}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data.ref_price) {
            setCurrentRate(data.data.ref_price);
          }
        }
      } catch (err) {
        console.error("Failed to fetch rate:", err);
      }
    };

    fetchRate();
    const interval = setInterval(fetchRate, 30000);
    return () => clearInterval(interval);
  }, [pair]);

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

  const isDisabled =
    isCreatingTrade ||
    !openTradeForm.cryptoAmount ||
    parseFloat(openTradeForm.cryptoAmount) <= 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Hero amount input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <ArrowRightLeft className="w-3.5 h-3.5 text-primary/60" />
              <span className="text-[11px] font-bold text-foreground/50 uppercase tracking-wider">
                Amount
              </span>
              {/* AED / INR currency toggle */}
              <div className="flex items-center gap-0.5 ml-2 p-0.5 rounded-md bg-foreground/[0.04] border border-foreground/[0.08]">
                <button
                  type="button"
                  onClick={() => setPair("usdt_aed")}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono tracking-wider transition-colors ${
                    pair === "usdt_aed"
                      ? "bg-primary/20 text-primary"
                      : "text-foreground/40 hover:text-foreground/60"
                  }`}
                >
                  AED
                </button>
                <button
                  type="button"
                  onClick={() => setPair("usdt_inr")}
                  className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono tracking-wider transition-colors ${
                    pair === "usdt_inr"
                      ? "bg-primary/20 text-primary"
                      : "text-foreground/40 hover:text-foreground/60"
                  }`}
                >
                  INR
                </button>
              </div>
            </div>
            <button
              onClick={() =>
                setOpenTradeForm({
                  ...openTradeForm,
                  cryptoAmount: maxAmount.toFixed(0),
                })
              }
              className="text-[10px] text-primary/70 hover:text-primary font-mono font-bold transition-colors px-1.5 py-0.5 rounded bg-primary/[0.06] hover:bg-primary/10"
            >
              MAX{" "}
              {maxAmount.toLocaleString(undefined, {
                maximumFractionDigits: 0,
              })}
            </button>
          </div>
          <div className="relative">
            <input
              type="number"
              min={0}
              step="any"
              value={openTradeForm.cryptoAmount}
              onChange={(e) => {
                const raw = e.target.value;
                // Block negatives and stray "-" characters; allow empty string
                // so the user can clear the field while typing.
                if (raw === "" || (parseFloat(raw) >= 0 && !raw.includes("-"))) {
                  setOpenTradeForm({ ...openTradeForm, cryptoAmount: raw });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "-" || e.key === "e" || e.key === "E") e.preventDefault();
              }}
              placeholder="0"
              className="w-full bg-foreground/[0.03] border border-foreground/[0.08] rounded-xl px-4 py-3 text-xl font-bold text-foreground placeholder:text-foreground/10 outline-none focus:border-primary/30 focus:bg-foreground/[0.04] transition-all font-mono tabular-nums"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-bold text-foreground/25 font-mono">
              USDT
            </span>
          </div>
          {cryptoAmount > 0 && (
            <div className="flex items-center justify-between mt-1.5 px-1 text-[10px] font-mono">
              <span className="text-foreground/30">
                ≈ {fiatSymbol}
                {(cryptoAmount * currentRate).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                {fiatSuffix}
              </span>
              <span className="text-foreground/20">
                @ {currentRate.toFixed(4)}
              </span>
            </div>
          )}
        </div>

        {/* Payment Methods — dynamic from merchant's saved methods */}
        <div>
          <div className="flex flex-wrap gap-1.5">
            {paymentMethods.length === 0 && !showAddPm && (
              <span className="text-[10px] text-foreground/30 font-mono py-1.5 px-1">
                No payment methods yet
              </span>
            )}
            {paymentMethods.map((pm) => {
              const isSelected = openTradeForm.paymentMethod === pm.type;
              return (
                <button
                  key={pm.id}
                  onClick={() =>
                    setOpenTradeForm({ ...openTradeForm, paymentMethod: pm.type as 'bank' | 'cash' })
                  }
                  className={`py-1.5 px-2.5 rounded-lg text-[11px] font-bold transition-all border flex items-center gap-1 ${
                    isSelected
                      ? "bg-foreground/[0.08] text-foreground/90 border-foreground/[0.12]"
                      : "bg-foreground/[0.02] text-foreground/40 hover:bg-foreground/[0.05] border-foreground/[0.04]"
                  }`}
                  title={pm.details}
                >
                  <span className="text-[10px]">
                    {pm.type === 'bank' ? '🏦' : pm.type === 'cash' ? '💵' : pm.type === 'card' ? '💳' : pm.type === 'mobile' ? '📱' : '💰'}
                  </span>
                  <span className="truncate max-w-[100px]">{pm.name}</span>
                </button>
              );
            })}
            <button
              onClick={() => setShowAddPm(true)}
              className="py-1.5 px-2 rounded-lg text-[11px] font-bold bg-foreground/[0.02] text-foreground/40 hover:bg-foreground/[0.05] border border-foreground/[0.04] flex items-center gap-1"
              title="Add payment method"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          </div>

          {/* Inline add-payment-method form */}
          {showAddPm && (
            <div className="mt-2 p-2.5 rounded-lg border border-foreground/[0.08] bg-foreground/[0.02] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-foreground/60 font-mono uppercase tracking-wider">
                  Add Payment Method
                </span>
                <button
                  onClick={() => { setShowAddPm(false); setNewPm({ type: 'bank', name: '', details: '' }); }}
                  className="p-0.5 rounded hover:bg-foreground/[0.06] text-foreground/40"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              <div className="flex gap-1">
                {(['bank', 'cash', 'card', 'mobile', 'crypto'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewPm({ ...newPm, type: t })}
                    className={`flex-1 py-1 rounded text-[9px] font-bold uppercase border ${
                      newPm.type === t
                        ? 'bg-primary/15 text-primary border-primary/30'
                        : 'bg-foreground/[0.02] text-foreground/40 border-foreground/[0.06]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={newPm.name}
                onChange={(e) => setNewPm({ ...newPm, name: e.target.value })}
                placeholder="Name (e.g. Emirates NBD)"
                className="w-full px-2 py-1.5 text-[11px] bg-foreground/[0.03] border border-foreground/[0.08] rounded text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
              />
              <input
                type="text"
                value={newPm.details}
                onChange={(e) => setNewPm({ ...newPm, details: e.target.value })}
                placeholder="Details (account/IBAN/UPI — optional)"
                className="w-full px-2 py-1.5 text-[11px] bg-foreground/[0.03] border border-foreground/[0.08] rounded text-foreground placeholder:text-foreground/20 outline-none focus:border-primary/30"
              />
              <button
                onClick={handleAddPaymentMethod}
                disabled={!newPm.name.trim() || savingPm}
                className="w-full py-1.5 rounded text-[11px] font-bold bg-primary text-background hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1"
              >
                {savingPm ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Save
              </button>
            </div>
          )}
        </div>

        {/* Spread Tier */}
        <div>
          <label className="text-[10px] text-foreground/30 mb-1.5 block font-mono uppercase tracking-wider font-bold">
            Spread
          </label>
          <div className="flex gap-1.5">
            {(
              Object.entries(PRICING_TIERS) as [
                keyof typeof PRICING_TIERS,
                (typeof PRICING_TIERS)[keyof typeof PRICING_TIERS],
              ][]
            ).map(([key, t]) => {
              const isSelected = openTradeForm.spreadPreference === key;
              const TierIcon = t.icon;
              return (
                <button
                  key={key}
                  onClick={() =>
                    setOpenTradeForm({
                      ...openTradeForm,
                      spreadPreference: key,
                    })
                  }
                  className={`flex-1 py-2 px-1.5 rounded-xl transition-all border text-center ${
                    isSelected
                      ? "bg-primary/[0.08] border-primary/20"
                      : "bg-foreground/[0.02] hover:bg-foreground/[0.04] border-foreground/[0.04]"
                  }`}
                >
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <TierIcon
                      className={`w-3 h-3 ${isSelected ? "text-primary" : "text-foreground/20"}`}
                    />
                    <span
                      className={`text-[10px] font-bold ${isSelected ? "text-foreground" : "text-foreground/35"}`}
                    >
                      {t.label}
                    </span>
                  </div>
                  <div
                    className={`text-[11px] font-black font-mono tabular-nums ${isSelected ? "text-primary" : "text-white/25"}`}
                  >
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
            <label className="text-[10px] text-foreground/30 font-mono uppercase tracking-wider font-bold flex items-center gap-1">
              <Flame className="w-3 h-3 text-primary/40" />
              Boost
            </label>
            <button
              onClick={() => setShowPriorityInput(!showPriorityInput)}
              className="text-[9px] text-primary/50 hover:text-primary font-mono font-bold transition-colors"
            >
              {showPriorityInput ? "hide" : "manual"}
            </button>
          </div>
          <div className="flex gap-1.5">
            {[0, 5, 10, 15].map((val) => (
              <button
                key={val}
                onClick={() => setPriorityFee(val)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all border ${
                  priorityFee === val
                    ? "bg-foreground/[0.08] text-foreground/90 border-foreground/[0.12]"
                    : "bg-foreground/[0.02] text-foreground/25 hover:bg-foreground/[0.05] border-foreground/[0.04]"
                }`}
              >
                {val === 0 ? "0" : `${val}%`}
              </button>
            ))}
          </div>

          {showPriorityInput && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <button
                onClick={() => handlePriorityChange(priorityFee - 0.5)}
                className="p-1 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.06] text-foreground/30"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                value={priorityFee}
                onChange={(e) =>
                  handlePriorityChange(parseFloat(e.target.value) || 0)
                }
                min={0}
                max={50}
                step={0.5}
                className="flex-1 bg-foreground/[0.03] border border-foreground/[0.06] rounded-lg px-2 py-1 text-[11px] text-foreground font-mono text-center outline-none focus:border-foreground/15"
              />
              <button
                onClick={() => handlePriorityChange(priorityFee + 0.5)}
                className="p-1 rounded-lg bg-foreground/[0.04] hover:bg-foreground/[0.08] border border-foreground/[0.06] text-foreground/30"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] text-foreground/20 font-mono font-bold">
                %
              </span>
            </div>
          )}

          {priorityFee > 0 && (
            <div className="mt-1.5 rounded-xl bg-foreground/[0.02] border border-foreground/[0.04] p-1.5">
              <div className="flex items-center justify-between px-1 mb-0.5">
                <span className="text-[9px] text-foreground/15 font-mono font-bold">
                  DECAY
                </span>
                <span className="text-[9px] text-primary/50 font-mono font-bold">
                  {priorityFee}% → 0%
                </span>
              </div>
              <DecayChart maxFee={priorityFee} />
            </div>
          )}
        </div>

        {/* BUY / SELL Buttons */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: "buy" });
              onCreateOrder("buy", priorityFee, pair);
            }}
            disabled={isDisabled}
            className="flex-1 py-3 rounded-xl text-white font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed press-effect flex flex-col items-center justify-center gap-0.5"
            style={{
              backgroundColor: "var(--primary)",
              boxShadow: "0 2px 12px var(--primary-dim)",
            }}
          >
            {isCreatingTrade && openTradeForm.tradeType === "buy" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm font-black tracking-wide">BUY</span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] font-mono font-bold opacity-60">
                    {fiatSymbol}{pricing.buyAed.toFixed(2)}{fiatSuffix || ` ${fiatLabel}`}
                  </span>
                )}
              </>
            )}
          </button>
          <button
            onClick={() => {
              setOpenTradeForm({ ...openTradeForm, tradeType: "sell" });
              onCreateOrder("sell", priorityFee, pair);
            }}
            disabled={isDisabled}
            className="flex-1 py-3 rounded-xl bg-foreground/[0.06] text-foreground font-bold hover:bg-foreground/[0.10] transition-all disabled:opacity-30 disabled:cursor-not-allowed press-effect border border-foreground/[0.08] flex flex-col items-center justify-center gap-0.5"
          >
            {isCreatingTrade && openTradeForm.tradeType === "sell" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span className="text-sm font-black tracking-wide">SELL</span>
                {cryptoAmount > 0 && (
                  <span className="text-[10px] font-mono font-bold text-foreground/40">
                    {fiatSymbol}{pricing.sellAed.toFixed(2)}{fiatSuffix || ` ${fiatLabel}`}
                  </span>
                )}
              </>
            )}
          </button>
        </div>

        {/* Spread summary */}
        {cryptoAmount > 0 && (
          <div className="flex items-center justify-between px-1 text-[9px] font-mono text-foreground/20">
            <span>+{pricing.totalSpread.toFixed(1)}% spread</span>
            <span className="tabular-nums">
              B {pricing.buyRate.toFixed(4)} · S {pricing.sellRate.toFixed(4)}
            </span>
          </div>
        )}

        {/* My Offers Toggle */}
        {/* <button
          onClick={() => setShowOffers(!showOffers)}
          className="w-full flex items-center justify-between px-3 py-2.5 mt-1 rounded-xl bg-foreground/[0.03] hover:bg-foreground/[0.06] border border-foreground/[0.06] transition-all"
        >
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-primary/60" />
            <span className="text-[11px] font-semibold text-foreground/70">My Offers</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-foreground/30 transition-transform duration-200 ${showOffers ? 'rotate-90' : ''}`} />
        </button> */}

        {/* My Offers Panel (inline) */}
        {/* {showOffers && merchantId && (
          <div className="mt-1 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-2 overflow-y-auto max-h-[400px]">
            <MyOffers merchantId={merchantId} />
          </div>
        )} */}
      </div>
    </div>
  );
});
