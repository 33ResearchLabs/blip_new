"use client";

import { useEffect, useState } from "react";
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
import type {
  Screen,
  TradeType,
  TradePreference,
  PaymentMethod,
} from "./types";
import {
  PaymentMethodSelector,
  type PaymentMethodItem,
} from "../PaymentMethodSelector";
import { BottomNav } from "./BottomNav";
import { FilterDropdown } from "./ui/FilterDropdown";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

type RatePair = "usdt_aed" | "usdt_inr";

interface PriceData {
  pair: string;
  price: number;
  mode: string;
  currency: string;
}

const CARD = "bg-surface-card border border-border-subtle";
const SECTION_LABEL =
  "text-[10px] font-bold tracking-[0.22em] text-text-tertiary uppercase";

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
  selectedPair?: "usdt_aed" | "usdt_inr";
  onPairChange?: (pair: "usdt_aed" | "usdt_inr") => void;
  setCurrentRate?: (rate: number) => void;
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
  const w = 120,
    h = 36;
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
  // SVG attributes can't take Tailwind classes — use the CSS variable directly
  // so the color flips with the theme.
  const color = positive ? "var(--color-success)" : "var(--color-error)";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="rs-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rs-fill)" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
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
  selectedPair,
  onPairChange,
  setCurrentRate,
}: TradeCreationScreenProps) => {
  const ratePositive = true;
  const hasAmount = !!amount && parseFloat(amount) > 0;

  // ── AED / INR display toggle ──
  const [ratePair, setRatePairLocal] = useState<RatePair>(
    selectedPair || "usdt_inr",
  );
  const setRatePair = (p: RatePair) => {
    setRatePairLocal(p);
    onPairChange?.(p);
  };
  const [rateData, setRateData] = useState<PriceData | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    // Clear previous pair's value immediately so it can't flash through.
    setRateData(null);
    setRateLoading(true);
    fetchWithAuth(`/api/prices/current?pair=${ratePair}`)
      .then((res) => res.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.success && j.data) {
          setRateData(j.data as PriceData);
          if ((j.data as PriceData).price)
            setCurrentRate?.((j.data as PriceData).price);
        } else setRateData(null);
      })
      .catch(() => {
        if (!cancelled) setRateData(null);
      })
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ratePair]);

  const displayRate = rateData?.price ?? null;
  const rateCurrency = ratePair === "usdt_aed" ? "AED" : "INR";
  const rateSymbol = ratePair === "usdt_inr" ? "₹" : "\u062F.\u0625";
  const rateDecimals = 2;

  return (
    <div className="flex flex-col h-dvh overflow-hidden bg-surface-base">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="relative px-5 pt-10 pb-3 flex items-start gap-3 z-30 shrink-0">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setScreen("home")}
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft
            size={20}
            strokeWidth={2}
            className="text-text-secondary"
          />
        </motion.button>
        <div className="flex-1 min-w-0">
          {/* Top row: small label + corridor selector */}
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <p className="text-[11px] font-bold tracking-[0.22em] text-text-tertiary uppercase truncate">
              P2P Exchange
            </p>
            <FilterDropdown
              className="shrink-0"
              value={ratePair}
              onChange={(p) => setRatePair(p)}
              ariaLabel="Select corridor"
              align="right"
              options={
                [
                  { key: "usdt_aed", label: "AED" },
                  { key: "usdt_inr", label: "INR" },
                ] as const
              }
            />
          </div>
          {/* Big title — full width, no competing element */}
          <p className="text-[22px] font-extrabold tracking-[-0.03em] text-text-primary truncate">
            Trade USDT
          </p>
        </div>
      </header>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-28 z-10 flex flex-col gap-3 overflow-y-auto no-scrollbar">
        {/* ── Buy / Sell — big cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {(
            [
              {
                type: "buy" as const,
                label: "Buy USDT",
                sub: `Pay ${ratePair === "usdt_inr" ? "INR" : "AED"}, get USDT`,
                Icon: ArrowDownLeft,
                activeClass: "border-[1.5px] border-success",
                dotClass: "bg-success",
                iconBgOn: "bg-success/15",
                iconOn: "text-success",
              },
              {
                type: "sell" as const,
                label: "Sell USDT",
                sub: `Send USDT, get ${ratePair === "usdt_inr" ? "INR" : "AED"}`,
                Icon: ArrowUpRight,
                activeClass: "border-[1.5px] border-error",
                dotClass: "bg-error",
                iconBgOn: "bg-error/15",
                iconOn: "text-error",
              },
            ] as const
          ).map(
            ({
              type,
              label,
              sub,
              Icon,
              activeClass,
              dotClass,
              iconBgOn,
              iconOn,
            }) => {
              const on = tradeType === type;
              return (
                <motion.button
                  key={type}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setTradeType(type)}
                  className={`flex items-center justify-between rounded-[20px] py-3 px-3.5 bg-surface-card ${
                    on ? activeClass : "border border-border-subtle"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${
                        on ? iconBgOn : "bg-surface-active"
                      }`}
                    >
                      <Icon
                        size={18}
                        strokeWidth={2.5}
                        className={on ? iconOn : "text-text-tertiary"}
                      />
                    </div>
                    <div className="flex flex-col text-left">
                      <p className="text-[16px] font-bold text-text-primary">
                        {label}
                      </p>
                      <p className="text-[10px] font-medium text-text-tertiary">
                        {sub}
                      </p>
                    </div>
                  </div>
                  {on && <div className={`w-2 h-2 rounded-full ${dotClass}`} />}
                </motion.button>
              );
            },
          )}
        </div>

        {/* ── Market Rate Card ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className={`w-full rounded-[24px] shrink-0 overflow-hidden ${CARD}`}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-[5px]">
                <p className={SECTION_LABEL}>
                  {rateData?.mode === "MANUAL" ? "Rate" : "Live Rate"}{" "}
                  {"\u00B7"} USDT / {rateCurrency}
                </p>
              </div>
              <div className="flex items-baseline gap-2 min-h-[32px]">
                {rateLoading || displayRate === null ? (
                  <span className="flex items-center gap-2 text-text-tertiary">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-[13px] font-semibold">Loading…</span>
                  </span>
                ) : (
                  <>
                    <span className="text-[26px] font-extrabold tracking-[-0.03em] text-text-primary leading-[1.1]">
                      {rateSymbol}
                      {displayRate.toFixed(rateDecimals)}
                    </span>
                    <span className="text-[13px] font-semibold text-text-tertiary">
                      {rateCurrency}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {ratePositive ? (
                  <TrendingUp size={11} className="text-success" />
                ) : (
                  <TrendingDown size={11} className="text-error" />
                )}
                <span
                  className={`text-[11px] font-bold ${ratePositive ? "text-success" : "text-error"}`}
                >
                  {ratePositive ? "+0.24%" : "-0.18%"} today
                </span>
              </div>
            </div>
            <div className="shrink-0 opacity-90">
              <RateSparkline
                rate={displayRate ?? (ratePair === "usdt_aed" ? 3.672 : 92.5)}
                positive={ratePositive}
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-5 py-2.5 border-t border-border-subtle bg-surface-hover">
            <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">
              7D LOW {ratePair === "usdt_aed" ? "3.651" : "92.10"}
            </span>
            <div className="flex-1 mx-4 h-1 rounded-full bg-border-medium overflow-hidden">
              <div className="h-1 rounded-full w-[68%] bg-text-primary/40" />
            </div>
            <span className="text-[10px] font-semibold text-text-tertiary tracking-[0.08em]">
              HIGH {ratePair === "usdt_aed" ? "3.694" : "93.50"}
            </span>
          </div>
        </motion.div>

        {/* ── Amount input ──────────────────────────────────────────────── */}
        <div
          className={`w-full rounded-[28px] mb-3 flex flex-col items-center py-2 px-3 ${CARD}`}
        >
          <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">
            {tradeType === "buy" ? "You Pay (USDT)" : "You Sell (USDT)"}
          </p>

          <div className="flex items-baseline justify-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) =>
                setAmount(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0"
              className={`text-[52px] font-extrabold tracking-[-0.06em] leading-none bg-transparent border-0 outline-none text-right max-w-64 ${
                hasAmount ? "text-text-primary" : "text-text-quaternary"
              }`}
              style={{ width: `${Math.max(38, (amount.length || 1) * 30)}px` }}
            />
            <span className="text-[20px] font-bold text-text-tertiary tracking-[-0.01em]">
              USDT
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1 min-h-[28px]">
            {hasAmount && (rateLoading || displayRate === null) ? (
              <span className="flex items-center gap-2 text-text-tertiary">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[13px] font-semibold">Loading…</span>
              </span>
            ) : (
              <>
                <span
                  className={`text-[24px] font-bold tracking-[-0.02em] ${
                    hasAmount ? "text-text-secondary" : "text-text-quaternary"
                  }`}
                >
                  {rateSymbol}{" "}
                  {hasAmount && displayRate !== null
                    ? (parseFloat(amount) * displayRate).toLocaleString(
                        undefined,
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                      )
                    : "0.00"}
                </span>
                <span className="text-[13px] font-semibold text-text-tertiary">
                  {rateCurrency}
                </span>
              </>
            )}
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
                    : `${"\u062F.\u0625"}${parseFloat(fiatAmount || "0").toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </p>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Payment Method ─────────────────────────────────────────────
            BUY mode  → simple Bank / Cash type toggle (user pays the merchant)
            SELL mode → PaymentMethodSelector below (user picks a specific
                        receiving account, which already covers bank/cash/upi).
            We render only ONE of these to avoid the duplicate-section issue. */}
        {tradeType === "buy" ? (
          <div className="mb-3">
            <p className="text-[10px] font-bold tracking-[0.28em] text-text-tertiary uppercase mb-2">
              Pay via
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  {
                    method: "bank" as const,
                    label: "Bank Transfer",
                    sub: "Wire / IBAN",
                    Icon: Building2,
                  },
                  {
                    method: "cash" as const,
                    label: "Cash",
                    sub: "Meet in person",
                    Icon: Banknote,
                  },
                ] as const
              ).map(({ method, label, sub, Icon }) => {
                const on = paymentMethod === method;
                return (
                  <motion.button
                    key={method}
                    whileTap={{ scale: 0.96 }}
                    onClick={() => setPaymentMethod(method)}
                    className={`flex items-center justify-between rounded-[16px] py-2.5 px-3 bg-surface-card ${
                      on
                        ? "border-[1.5px] border-text-secondary shadow-[0_4px_14px_rgba(0,0,0,0.3)]"
                        : "border border-border-subtle"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-[10px] flex items-center justify-center bg-surface-active">
                        <Icon size={16} className="text-text-secondary" />
                      </div>
                      <div className="flex flex-col">
                        <p className="text-[14px] font-bold text-text-primary">
                          {label}
                        </p>
                        <p className="text-[10px] font-medium text-text-tertiary">
                          {sub}
                        </p>
                      </div>
                    </div>
                    {on && <div className="w-2 h-2 rounded-full bg-accent" />}
                  </motion.button>
                );
              })}
            </div>
          </div>
        ) : (
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
            {(
              [
                // Speed indicators reuse the semantic palette: warning = fastest/most expensive,
                // info = balanced, success = cheapest. Inline-style strings reference the CSS
                // variables so the colors flip with the active theme.
                {
                  key: "fast" as const,
                  label: "Fastest",
                  sub: "~2 min",
                  fee: "3.0%",
                  barHex: "var(--color-warning)",
                },
                {
                  key: "best" as const,
                  label: "Best Rate",
                  sub: "~8 min",
                  fee: "2.5%",
                  barHex: "var(--color-info)",
                },
                {
                  key: "cheap" as const,
                  label: "Cheapest",
                  sub: "~15 min",
                  fee: "1.5%",
                  barHex: "var(--color-success)",
                },
              ] as const
            ).map(({ key, label, sub, fee, barHex }) => {
              const on = tradePreference === key;
              return (
                <motion.button
                  key={key}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setTradePreference(key)}
                  className={`flex-1 rounded-[16px] py-2.5 px-3 bg-surface-card ${
                    on ? "border-[1.5px]" : "border border-border-subtle"
                  }`}
                  style={
                    on
                      ? {
                          borderColor: barHex,
                          boxShadow: `0 2px 10px ${barHex}22`,
                        }
                      : undefined
                  }
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col items-start leading-tight">
                      <p className="text-[12px] font-bold text-text-primary">
                        {label}
                      </p>
                      <p className="text-[10px] font-medium text-text-tertiary">
                        {sub}
                      </p>
                    </div>
                    <div
                      className="flex items-center justify-center h-5 px-1 rounded-full border"
                      style={{
                        background: `${barHex}15`,
                        borderColor: `${barHex}40`,
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold leading-none"
                        style={{ color: barHex }}
                      >
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
              ? "bg-accent text-accent-text border border-border-strong shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
              : "bg-surface-card text-text-quaternary border border-border-subtle"
          }`}
        >
          {isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : hasAmount ? (
            <>
              {tradeType === "buy" ? "Receive" : "Send"} {amount} USDT
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
            Create a custom offer {"\u2192"}
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
