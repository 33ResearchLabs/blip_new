"use client";

import { motion } from "framer-motion";
import {
  ChevronLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Banknote,
  Loader2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import type { Screen, TradeType, TradePreference, PaymentMethod } from "./types";
import { PaymentMethodSelector, type PaymentMethodItem } from "../PaymentMethodSelector";
import { BottomNav } from "./BottomNav";

const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL = "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

export interface TradeCreationScreenProps {
  screen: Screen;
  setScreen: (s: Screen) => void;
  tradeType: TradeType;
  setTradeType: (t: TradeType) => void;
  tradePreference: TradePreference;
  setTradePreference: (p: TradePreference) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (m: PaymentMethod) => void;
  amount: string;
  setAmount: (a: string) => void;
  fiatAmount: string;
  currentFees: { totalFee: number; traderCut: number };
  isLoading: boolean;
  userId: string | null;
  startTrade: () => void;
  solanaWallet: { connected: boolean; usdtBalance: number | null };
  selectedPaymentMethodId: string | null;
  onSelectPaymentMethod: (method: PaymentMethodItem | null) => void;
}

// ─── Mini sparkline for the rate card ─────────────────────────────────────
const RATE_OFFSETS = [
  -0.012, -0.006, 0.003, -0.009, 0.008, 0.014, 0.011, 0.019, 0.016, 0.024,
];

function RateSparkline({
  rate,
  positive,
}: {
  rate: number;
  positive: boolean;
}) {
  const data = RATE_OFFSETS.map((o) => rate + o);
  const w = 120, h = 36;
  const min = Math.min(...data),
    max = Math.max(...data),
    rng = max - min || 0.01;
  const pts = data.map((v, i) => ({
    x: (i / (data.length - 1)) * w,
    y: h - 4 - ((v - min) / rng) * (h - 8),
  }));
  let line = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const cp = (pts[i - 1].x + pts[i].x) / 2;
    line += ` C${cp.toFixed(1)},${pts[i - 1].y.toFixed(1)} ${cp.toFixed(1)},${pts[i].y.toFixed(1)} ${pts[i].x.toFixed(1)},${pts[i].y.toFixed(1)}`;
  }
  const area = `${line} L${w},${h} L0,${h} Z`;
  const color = positive ? "#10B981" : "#EF4444";

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="rs-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rs-fill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  );
}

export const TradeCreationScreen = ({
  screen,
  setScreen,
  tradeType,
  setTradeType,
  tradePreference,
  setTradePreference,
  paymentMethod,
  setPaymentMethod,
  amount,
  setAmount,
  fiatAmount,
  currentFees,
  isLoading,
  userId,
  startTrade,
  solanaWallet,
  selectedPaymentMethodId,
  onSelectPaymentMethod,
}: TradeCreationScreenProps) => {
  const ratePositive = true;
  const hasAmount = !!amount && parseFloat(amount) > 0;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="px-5 pt-10 pb-3 flex items-center gap-4 z-10 shrink-0">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setScreen("home")}
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft size={20} strokeWidth={2} className="text-text-secondary" />
        </motion.button>
        <div>
          <p className="text-[11px] font-bold tracking-[0.22em] text-text-tertiary uppercase mb-0.5">
            P2P Exchange
          </p>
          <p className="text-[22px] font-extrabold tracking-[-0.03em] text-text-primary">
            Trade USDT
          </p>
        </div>
      </header>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-28 z-10 flex flex-col gap-3 overflow-y-auto no-scrollbar">
        {/* ── Buy / Sell — big cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {([
            { type: 'buy' as const, label: 'Buy USDT', sub: 'Pay AED, get USDT', Icon: ArrowDownLeft, activeClass: 'border-[1.5px] border-[#10B981]', dotClass: 'bg-[#10B981]', iconBgOn: 'bg-[#10B981]/15', iconOn: 'text-[#10B981]' },
            { type: 'sell' as const, label: 'Sell USDT', sub: 'Send USDT, get AED', Icon: ArrowUpRight, activeClass: 'border-[1.5px] border-[#EF4444]', dotClass: 'bg-[#EF4444]', iconBgOn: 'bg-[#EF4444]/15', iconOn: 'text-[#EF4444]' },
          ] as const).map(({ type, label, sub, Icon, activeClass, dotClass, iconBgOn, iconOn }) => {
            const on = tradeType === type;
            return (
              <motion.button
                key={type}
                whileTap={{ scale: 0.96 }}
                onClick={() => setTradeType(type)}
                className={`flex items-center justify-between rounded-[20px] py-3 px-3.5 bg-surface-card ${
                  on ? activeClass : 'border border-border-subtle'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${
                    on ? iconBgOn : 'bg-surface-active'
                  }`}>
                    <Icon size={18} strokeWidth={2.5} className={on ? iconOn : 'text-text-tertiary'} />
                  </div>
                  <div className="flex flex-col text-left">
                    <p className="text-[16px] font-bold text-text-primary">{label}</p>
                    <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                  </div>
                </div>
                {on && (
                  <div className={`w-2 h-2 rounded-full ${dotClass}`} />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* ── Market Rate Card ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={`w-full rounded-[24px] shrink-0 ${CARD}`}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex-1 min-w-0">
              <p className={`${SECTION_LABEL} mb-[5px]`}>
                Live Rate {'\u00B7'} USDT / AED
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-[1.1]">
                  {fiatAmount && parseFloat(fiatAmount) > 0 && amount && parseFloat(amount) > 0
                    ? (parseFloat(fiatAmount) / parseFloat(amount)).toFixed(3)
                    : "3.672"}
                </span>
                <span className="text-[13px] font-semibold text-text-tertiary">AED</span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                {ratePositive ? (
                  <TrendingUp size={11} className="text-[#059669]" />
                ) : (
                  <TrendingDown size={11} className="text-[#dc2626]" />
                )}
                <span className={`text-[11px] font-bold ${ratePositive ? 'text-[#059669]' : 'text-[#dc2626]'}`}>
                  {ratePositive ? "+0.24%" : "-0.18%"} today
                </span>
              </div>
            </div>
            <div className="shrink-0 opacity-90">
              <RateSparkline rate={3.672} positive={ratePositive} />
            </div>
          </div>
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-subtle bg-white/[0.03]">
            <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">7D LOW 3.651</span>
            <div className="flex-1 mx-4 h-1 rounded-full bg-border-medium">
              <div
                className="h-1 rounded-full w-[68%]"
                style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0.5))' }}
              />
            </div>
            <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">HIGH 3.694</span>
          </div>
        </motion.div>

        {/* ── Amount input ──────────────────────────────────────────────── */}
        <div className={`w-full rounded-[28px] mb-3 flex flex-col items-center py-2 px-3 ${CARD}`}>
          <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">
            {tradeType === 'buy' ? 'You Pay (USDT)' : 'You Sell (USDT)'}
          </p>

          <div className="flex items-center justify-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              className={`text-[52px] font-extrabold tracking-[-0.04em] leading-none bg-transparent border-0 outline-none text-center min-w-[72px] max-w-[240px] ${
                hasAmount ? 'text-text-primary' : 'text-text-quaternary'
              }`}
              style={{ width: amount ? `${Math.max(72, amount.length * 44)}px` : '72px' }}
            />
            <span className="text-[20px] font-bold text-text-tertiary tracking-[-0.01em]">
              USDT
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[24px] font-bold tracking-[-0.02em] ${
              hasAmount ? 'text-text-secondary' : 'text-text-quaternary'
            }`}>
              {'\u062F.\u0625'}{" "}
              {hasAmount
                ? parseFloat(fiatAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })
                : '0'}
            </span>
            <span className="text-[13px] font-semibold text-text-tertiary">AED</span>
          </div>

          {solanaWallet.connected && (
            <div className="mt-2 px-3 py-1 rounded-full bg-surface-hover border border-border-subtle">
              <span className="text-[11px] font-bold text-text-tertiary tracking-[0.08em]">
                BAL{" "}
                {solanaWallet.usdtBalance !== null
                  ? solanaWallet.usdtBalance.toFixed(2)
                  : "\u2014"}{" "}
                USDT
              </span>
            </div>
          )}

          {/* Fee breakdown — appears when amount entered */}
          {hasAmount && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-4 mt-2 pt-2 w-full border-t border-border-subtle"
            >
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">
                  Fee
                </p>
                <p className="text-[15px] font-extrabold text-text-secondary">
                  {(currentFees.totalFee * 100).toFixed(1)}%
                </p>
              </div>
              <div className="w-px h-7 bg-border-medium" />
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">
                  Trader Earns
                </p>
                <p className="text-[15px] font-extrabold text-text-secondary">
                  {(currentFees.traderCut * 100).toFixed(2)}%
                </p>
              </div>
              <div className="w-px h-7 bg-border-medium" />
              <div className="flex-1 text-center">
                <p className="text-[9px] font-bold tracking-[0.18em] text-text-tertiary uppercase mb-[3px]">
                  You Get
                </p>
                <p className="text-[15px] font-extrabold text-text-primary">
                  {tradeType === "buy"
                    ? `${parseFloat(amount || "0").toFixed(2)} USDT`
                    : `${'\u062F.\u0625'}${parseFloat(fiatAmount || "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </p>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Payment Method ───────────────────────────────────────────── */}
        <div className="mb-3">
          <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">
            Pay via
          </p>
          <div className="grid grid-cols-2 gap-3">
            {([
              { method: 'bank' as const, label: 'Bank Transfer', sub: 'Wire / IBAN', Icon: Building2 },
              { method: 'cash' as const, label: 'Cash', sub: 'Meet in person', Icon: Banknote },
            ] as const).map(({ method, label, sub, Icon }) => {
              const on = paymentMethod === method;
              return (
                <motion.button
                  key={method}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setPaymentMethod(method)}
                  className={`flex items-center justify-between rounded-[16px] py-2.5 px-3 bg-surface-card ${
                    on ? 'border-[1.5px] border-text-secondary shadow-[0_4px_14px_rgba(0,0,0,0.3)]' : 'border border-border-subtle'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-[10px] flex items-center justify-center bg-surface-active">
                      <Icon size={16} className="text-text-secondary" />
                    </div>
                    <div className="flex flex-col">
                      <p className="text-[14px] font-bold text-text-primary">{label}</p>
                      <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                    </div>
                  </div>
                  {on && <div className="w-2 h-2 rounded-full bg-white" />}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Payment Method Selector — shown when selling crypto (user receives fiat) */}
        {tradeType === 'sell' && (
          <div className="mb-3">
            <PaymentMethodSelector
              userId={userId}
              selectedId={selectedPaymentMethodId}
              onSelect={onSelectPaymentMethod}
            />
          </div>
        )}

        {/* ── Priority ─────────────────────────────────────────────────── */}
        <div className="mb-3">
          <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-3">
            Priority
          </p>
          <div className="flex gap-2.5">
            {([
              { key: 'fast' as const, label: 'Fastest', sub: '~2 min', fee: '3.0%', barHex: '#d97706' },
              { key: 'best' as const, label: 'Best Rate', sub: '~8 min', fee: '2.5%', barHex: '#3b82f6' },
              { key: 'cheap' as const, label: 'Cheapest', sub: '~15 min', fee: '1.5%', barHex: '#059669' },
            ] as const).map(({ key, label, sub, fee, barHex }) => {
              const on = tradePreference === key;
              return (
                <motion.button
                  key={key}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setTradePreference(key)}
                  className={`flex-1 rounded-[16px] py-2.5 px-3 bg-surface-card ${
                    on ? 'border-[1.5px]' : 'border border-border-subtle'
                  }`}
                  style={on ? { borderColor: barHex, boxShadow: `0 2px 10px ${barHex}22` } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col items-start leading-tight">
                      <p className="text-[12px] font-bold text-text-primary">{label}</p>
                      <p className="text-[10px] font-medium text-text-tertiary">{sub}</p>
                    </div>
                    <div
                      className="flex items-center justify-center h-5 px-1 rounded-full border"
                      style={{ background: `${barHex}15`, borderColor: `${barHex}40` }}
                    >
                      <span className="text-[11px] font-semibold leading-none" style={{ color: barHex }}>
                        {fee}
                      </span>
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={startTrade}
          disabled={!hasAmount || isLoading || !userId}
          className={`w-full flex items-center justify-center gap-2 shrink-0 min-h-12 rounded-[14px] text-[14px] font-bold tracking-[-0.01em] ${
            hasAmount && !isLoading
              ? 'bg-accent text-accent-text border border-white/15 shadow-[0_4px_16px_rgba(0,0,0,0.2)]'
              : 'bg-surface-card text-text-quaternary border border-border-subtle'
          }`}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : hasAmount ? (
            <>
              {tradeType === 'buy' ? 'Receive' : 'Send'} {amount} USDT
              <ArrowUpRight size={16} strokeWidth={2} />
            </>
          ) : (
            "Enter Amount"
          )}
        </motion.button>

        {/* ── Large order link ──────────────────────────────────────────── */}
        <button
          onClick={() => setScreen("create-offer")}
          className="w-full mt-1 py-2 text-center text-[13px] font-semibold text-text-tertiary"
        >
          Large amount?{" "}
          <span className="text-text-secondary font-bold">
            Create a custom offer {'\u2192'}
          </span>
        </button>
      </div>

      <BottomNav
        screen={screen}
        setScreen={setScreen}
        maxW="max-w-[440px] mx-auto"
      />
    </div>
  );
};
