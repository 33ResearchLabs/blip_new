"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";
import {
  ChevronLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Banknote,
  Loader2,
  ChevronDown,
  Check,
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
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import { clampDecimal, DECIMAL_PRESETS } from "@/lib/input/sanitize";
import { formatCrypto, formatFiat, formatPercentage } from "@/lib/format";

type RatePair = "usdt_aed" | "usdt_inr";

interface PriceData {
  pair: string;
  price: number;
  mode: string;
  currency: string;
}

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

// iOS 26 spring physics — snappy
const SPRING = { type: "spring" as const, stiffness: 420, damping: 32, mass: 0.8 };
const SOFT_SPRING = { type: "spring" as const, stiffness: 260, damping: 30 };

function formatAmountInput(value: string): string {
  if (!value) return value;
  const [intPart, decPart] = value.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${withCommas}.${decPart}` : withCommas;
}

const QUICK_AMOUNTS = ["100", "500", "1000", "5000"];

const T = {
  hi: "rgba(255,255,255,0.96)",
  md: "rgba(255,255,255,0.55)",
  lo: "rgba(255,255,255,0.32)",
  xl: "rgba(255,255,255,0.16)",
};

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
  const hasAmount = !!amount && parseFloat(amount) > 0;
  const isBuy = tradeType === "buy";
  const accent = isBuy ? "#34D399" : "#F87171";

  const [ratePair, setRatePairLocal] = useState<RatePair>(
    selectedPair || "usdt_inr",
  );
  const setRatePair = (p: RatePair) => {
    setRatePairLocal(p);
    onPairChange?.(p);
  };
  const [rateData, setRateData] = useState<PriceData | null>(null);
  const [rateLoading, setRateLoading] = useState(true);
  const [pairOpen, setPairOpen] = useState(false);

  // ── Saved bank accounts (for BUY mode bank-transfer selection) ──
  type SavedBank = {
    id: string;
    bank?: string;
    bank_name?: string;
    name?: string;
    account_name?: string;
    iban?: string;
    is_default?: boolean;
    isDefault?: boolean;
  };
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchWithAuth(`/api/users/${userId}/bank-accounts`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const list: SavedBank[] = j?.data || j?.banks || j || [];
        if (!Array.isArray(list)) return;
        setSavedBanks(list);
        if (list.length > 0 && !selectedBankId) {
          const def = list.find((b) => b.is_default || b.isDefault) || list[0];
          setSelectedBankId(def.id);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);


  useEffect(() => {
    let cancelled = false;
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
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRateLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ratePair]);

  const displayRate = rateData?.price ?? null;
  const rateCurrency = ratePair === "usdt_aed" ? "AED" : "INR";
  const rateSymbol = ratePair === "usdt_inr" ? "₹" : "د.إ";
  const fiatValue =
    hasAmount && displayRate !== null
      ? formatCrypto(parseFloat(amount) * displayRate)
      : "0.00";

  return (
    <div
      className="relative flex flex-col min-h-[100dvh] overflow-y-auto"
      style={{ background: "#07090F" }}
    >
      {/* ── Ambient color glow that follows Buy / Sell ── */}
      <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        initial={false}
        animate={{
          background: isBuy
            ? "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(16,185,129,0.28) 0%, rgba(16,185,129,0.10) 28%, transparent 60%)"
            : "radial-gradient(ellipse 90% 60% at 50% -10%, rgba(239,68,68,0.26) 0%, rgba(239,68,68,0.10) 28%, transparent 60%)",
        }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      />

      {/* ── Header ── */}
      <header className="relative z-10 max-w-[440px] mx-auto w-full px-5 pt-5">
        <div className="flex items-center justify-end">
          {/* <motion.button
            whileTap={{ scale: 0.92 }}
            onClick={() => setScreen("home")}
            className="flex items-center justify-center"
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.08)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <ChevronLeft
              size={18}
              strokeWidth={2.2}
              style={{ color: T.hi }}
            />
          </motion.button> */}

          {/* Corridor selector — animated dropdown */}
          <div className="relative">
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={() => setPairOpen((v) => !v)}
              className="flex items-center"
              style={{
                gap: 6,
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  color: T.hi,
                }}
              >
                {rateCurrency}
              </span>
              <motion.span
                animate={{ rotate: pairOpen ? 180 : 0 }}
                transition={SPRING}
                style={{ display: "inline-flex" }}
              >
                <ChevronDown size={11} strokeWidth={2.4} style={{ color: T.md }} />
              </motion.span>
            </motion.button>

            <AnimatePresence>
              {pairOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={SPRING}
                  className="absolute right-0 mt-2 z-30"
                  style={{
                    minWidth: 110,
                    padding: 4,
                    borderRadius: 14,
                    background: "rgba(20,24,32,0.85)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    boxShadow:
                      "0 18px 32px -16px rgba(0,0,0,0.55), 0 4px 10px -4px rgba(0,0,0,0.30)",
                  }}
                >
                  {(["usdt_aed", "usdt_inr"] as const).map((p) => {
                    const label = p === "usdt_aed" ? "AED" : "INR";
                    const on = p === ratePair;
                    return (
                      <button
                        key={p}
                        onClick={() => {
                          setRatePair(p);
                          setPairOpen(false);
                        }}
                        className="w-full flex items-center justify-between"
                        style={{
                          padding: "8px 12px",
                          borderRadius: 10,
                          background: on
                            ? "rgba(255,255,255,0.08)"
                            : "transparent",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: T.hi,
                          }}
                        >
                          {label}
                        </span>
                        {on && (
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 999,
                              background: accent,
                              boxShadow: `0 0 6px ${accent}`,
                            }}
                          />
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      {/* ── Hero amount stack ── */}
      <div className="relative z-10 max-w-[440px] mx-auto w-full px-5 flex flex-col items-center justify-start pt-6">
        {/* Animated You Buy / You Sell label */}
        <AnimatePresence mode="wait">
          <motion.p
            key={tradeType}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.25 }}
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.26em",
              textTransform: "uppercase",
              color: T.lo,
              marginBottom: 10,
            }}
          >
            {isBuy ? "You're Buying" : "You're Selling"}
          </motion.p>
        </AnimatePresence>

        {/* Giant amount with USDT trailing — auto-shrinks to fit */}
        {(() => {
          const formatted = formatAmountInput(amount);
          const len = formatted.length || 1;
          // SF Mono char width ≈ 0.60 × fontSize. Step down as the number grows
          // so the row never overflows the column width.
          const fontSize =
            len <= 4 ? 76 :
            len <= 6 ? 64 :
            len <= 8 ? 52 :
            len <= 10 ? 42 :
            len <= 12 ? 34 : 28;
          const inputWidth = Math.max(48, Math.ceil(len * fontSize * 0.60));
          const symbolSize = Math.max(12, Math.round(fontSize * 0.24));
          return (
            <div
              className="flex items-baseline justify-center w-full"
              style={{ gap: 10, maxWidth: "100%" }}
            >
              <input
                type="text"
                inputMode="decimal"
                maxLength={18}
                value={formatted}
                onChange={(e) =>
                  setAmount(
                    clampDecimal(
                      e.target.value.replace(/,/g, ""),
                      DECIMAL_PRESETS.amount,
                    ),
                  )
                }
                placeholder="0"
                className="bg-transparent border-0 outline-none text-center"
                style={{
                  fontSize,
                  fontWeight: 800,
                  letterSpacing: "-0.05em",
                  lineHeight: 1,
                  color: hasAmount ? T.hi : T.xl,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                  width: `${inputWidth}px`,
                  maxWidth: "100%",
                  caretColor: accent,
                  padding: 0,
                  transition: "font-size 180ms cubic-bezier(0.22,1,0.36,1)",
                }}
              />
              <span
                style={{
                  fontSize: symbolSize,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  color: T.lo,
                  transition: "font-size 180ms cubic-bezier(0.22,1,0.36,1)",
                  flexShrink: 0,
                }}
              >
                USDT
              </span>
            </div>
          );
        })()}

        {/* Animated conversion ticker */}
        <div style={{ marginTop: 10, minHeight: 22 }}>
          <AnimatePresence mode="wait">
            <motion.p
              key={`${fiatValue}-${rateCurrency}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.22 }}
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: T.md,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {rateLoading ? (
                <span className="inline-flex items-center" style={{ gap: 6 }}>
                  <Loader2 size={12} className="animate-spin" />
                  Loading…
                </span>
              ) : (
                <>≈ {rateSymbol}{fiatValue} {rateCurrency}</>
              )}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Quick-amount chips with spring snap */}
        <div className="flex items-center" style={{ gap: 8, marginTop: 18 }}>
          {QUICK_AMOUNTS.map((v) => (
            <motion.button
              key={v}
              whileTap={{ scale: 0.88 }}
              onClick={() =>
                setAmount(clampDecimal(v, DECIMAL_PRESETS.amount))
              }
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "-0.005em",
                  color: T.md,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {parseFloat(v) >= 1000
                  ? `${parseFloat(v) / 1000}K`
                  : v}
              </span>
            </motion.button>
          ))}
          {solanaWallet.connected &&
            solanaWallet.usdtBalance !== null &&
            solanaWallet.usdtBalance > 0 && (
              <motion.button
                whileTap={{ scale: 0.88 }}
                onClick={() =>
                  setAmount(
                    clampDecimal(
                      String(solanaWallet.usdtBalance),
                      DECIMAL_PRESETS.amount,
                    ),
                  )
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: 999,
                  background: "#FFFFFF",
                  border: "1px solid rgba(255,255,255,0.6)",
                  boxShadow:
                    "0 6px 14px -6px rgba(255,255,255,0.30), inset 0 1px 0 rgba(255,255,255,0.85)",
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.10em",
                    color: "#0B0F14",
                  }}
                >
                  MAX
                </span>
              </motion.button>
            )}
        </div>

        {/* Buy/Sell — active = white tile */}
        <div className="grid grid-cols-2 w-full" style={{ gap: 10, marginTop: 28 }}>
          {(
            [
              {
                type: "buy" as const,
                label: "Buy",
                Icon: ArrowDownLeft,
                color: "#10B981", // emerald-500 — slightly darker for legibility on white
              },
              {
                type: "sell" as const,
                label: "Sell",
                Icon: ArrowUpRight,
                color: "#EF4444", // red-500
              },
            ] as const
          ).map((opt) => {
            const on = tradeType === opt.type;
            return (
              <motion.button
                key={opt.type}
                onClick={() => setTradeType(opt.type)}
                whileTap={{ scale: 0.97 }}
                animate={{
                  background: on
                    ? "#FFFFFF"
                    : "rgba(255,255,255,0.04)",
                  borderColor: "rgba(255,255,255,0.08)",
                  boxShadow: "none",
                }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex items-center justify-center"
                style={{
                  padding: "12px 0",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderStyle: "solid",
                  backdropFilter: on ? undefined : "blur(14px)",
                  WebkitBackdropFilter: on ? undefined : "blur(14px)",
                  gap: 8,
                }}
              >
                <motion.span
                  animate={{ color: on ? opt.color : T.lo }}
                  transition={{ duration: 0.25 }}
                  style={{ display: "inline-flex" }}
                >
                  <opt.Icon size={16} strokeWidth={2.6} />
                </motion.span>
                <motion.span
                  animate={{ color: on ? "#0B0F14" : T.md }}
                  transition={{ duration: 0.25 }}
                  style={{
                    fontSize: 14,
                    fontWeight: 800,
                    letterSpacing: "-0.005em",
                  }}
                >
                  {opt.label}
                </motion.span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* ── Bottom liquid-glass sheet ── */}
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ ...SOFT_SPRING, delay: 0.1 }}
        className="relative z-10 max-w-[440px] mx-auto w-full"
        style={{
          marginTop: 24,
          padding: "18px 18px calc(env(safe-area-inset-bottom, 12px) + 90px)",
          borderTopLeftRadius: 32,
          borderTopRightRadius: 32,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(28px) saturate(1.4)",
          WebkitBackdropFilter: "blur(28px) saturate(1.4)",
          boxShadow:
            "0 -16px 36px -16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        {/* Pulled-handle pip */}
        <div className="flex justify-center mb-3">
          <span
            style={{
              width: 36,
              height: 4,
              borderRadius: 999,
              background: "rgba(255,255,255,0.14)",
            }}
          />
        </div>

        {/* Fee row — only when amount entered */}
        <AnimatePresence>
          {hasAmount && (
            <motion.div
              key="fees"
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: "auto", marginBottom: 14 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={SPRING}
              style={{ overflow: "hidden" }}
            >
              <div
                className="flex items-center"
                style={{
                  padding: "11px 14px",
                  borderRadius: 14,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  gap: 12,
                }}
              >
                {[
                  {
                    label: "Fee",
                    value: formatPercentage(currentFees.totalFee * 100),
                  },
                  {
                    label: "Earns",
                    value: formatPercentage(currentFees.traderCut * 100),
                  },
                  {
                    label: "You Get",
                    value: isBuy
                      ? `${formatCrypto(parseFloat(amount || "0"))} USDT`
                      : formatFiat(
                          parseFloat(fiatAmount || "0"),
                          rateCurrency,
                        ),
                  },
                ].map((row, i, arr) => (
                  <div key={row.label} className="flex-1 text-center flex items-center" style={{ gap: 12 }}>
                    <div className="flex-1 text-center">
                      <p
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          letterSpacing: "0.18em",
                          color: T.lo,
                          textTransform: "uppercase",
                          marginBottom: 3,
                        }}
                      >
                        {row.label}
                      </p>
                      <p
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: i === arr.length - 1 ? T.hi : T.md,
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {row.value}
                      </p>
                    </div>
                    {i < arr.length - 1 && (
                      <span
                        style={{
                          width: 1,
                          height: 26,
                          background: "rgba(255,255,255,0.10)",
                        }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Payment method header — label + inline "Add payment method" link */}
        <div className="flex items-center justify-between mb-2">
          <p
            style={{
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.22em",
              color: T.lo,
              textTransform: "uppercase",
            }}
          >
            {isBuy ? "Pay With" : "Receive To"}
          </p>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setScreen("profile")}
            className="flex items-center"
            style={{ gap: 4 }}
          >
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "-0.005em",
                color: T.md,
              }}
            >
              Add payment method
            </span>
            <ArrowUpRight size={11} strokeWidth={2.4} style={{ color: T.lo }} />
          </motion.button>
        </div>

        {isBuy ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-3">
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
                    sub: "In-person",
                    Icon: Banknote,
                  },
                ] as const
              ).map(({ method, label, sub, Icon }) => {
                const on = paymentMethod === method;
                return (
                  <motion.button
                    key={method}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setPaymentMethod(method)}
                    className="flex items-center"
                    style={{
                      padding: "11px 12px",
                      borderRadius: 14,
                      gap: 10,
                      background: on
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(255,255,255,0.03)",
                      border: on
                        ? "1px solid rgba(255,255,255,0.32)"
                        : "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <div
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 9,
                        background: on
                          ? "#FFFFFF"
                          : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <Icon
                        size={14}
                        strokeWidth={2.4}
                        style={{ color: on ? "#0B0F14" : T.md }}
                      />
                    </div>
                    <div className="flex flex-col text-left min-w-0">
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          letterSpacing: "-0.005em",
                          color: T.hi,
                        }}
                      >
                        {label}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: T.lo,
                          marginTop: 1,
                        }}
                      >
                        {sub}
                      </span>
                    </div>
                  </motion.button>
                );
              })}
            </div>

            {/* Saved bank accounts — only when Bank Transfer is the active method */}
            <AnimatePresence initial={false}>
              {paymentMethod === "bank" && savedBanks.length > 0 && (
                <motion.div
                  key="saved-banks"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  style={{ overflow: "hidden", marginBottom: 16 }}
                >
                  <div className="flex flex-col" style={{ gap: 6, paddingTop: 4 }}>
                    {savedBanks.map((b) => {
                      const on = selectedBankId === b.id;
                      const bankName = b.bank_name || b.bank || "Bank";
                      const acctName = b.account_name || b.name || "";
                      const last4 = (b.iban || "").slice(-4);
                      const initial = bankName.charAt(0).toUpperCase();
                      return (
                        <motion.button
                          key={b.id}
                          whileTap={{ scale: 0.985 }}
                          onClick={() => setSelectedBankId(b.id)}
                          className="flex items-center"
                          style={{
                            gap: 12,
                            padding: "10px 12px",
                            borderRadius: 14,
                            background: on
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(255,255,255,0.03)",
                            border: on
                              ? "1px solid rgba(255,255,255,0.28)"
                              : "1px solid rgba(255,255,255,0.06)",
                          }}
                        >
                          <div
                            className="flex items-center justify-center shrink-0"
                            style={{
                              width: 30,
                              height: 30,
                              borderRadius: 10,
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 800, color: T.hi }}>
                              {initial}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0 text-left">
                            <div className="flex items-center" style={{ gap: 6 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 800,
                                  letterSpacing: "-0.005em",
                                  color: T.hi,
                                }}
                              >
                                {bankName}
                              </span>
                              {(b.is_default || b.isDefault) && (
                                <span
                                  style={{
                                    fontSize: 8,
                                    fontWeight: 800,
                                    letterSpacing: "0.10em",
                                    textTransform: "uppercase",
                                    color: T.lo,
                                    padding: "1px 5px",
                                    borderRadius: 999,
                                    background: "rgba(255,255,255,0.06)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                  }}
                                >
                                  Default
                                </span>
                              )}
                            </div>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: T.lo,
                                fontFamily:
                                  "ui-monospace, SFMono-Regular, Menlo, monospace",
                                marginTop: 1,
                                display: "block",
                              }}
                            >
                              {acctName}
                              {last4 ? ` · •••${last4}` : ""}
                            </span>
                          </div>
                          {on && (
                            <div
                              className="flex items-center justify-center shrink-0"
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 999,
                                background: "#FFFFFF",
                              }}
                            >
                              <Check size={12} strokeWidth={2.8} style={{ color: "#0B0F14" }} />
                            </div>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="mb-4">
            <PaymentMethodSelector
              userId={userId}
              selectedId={selectedPaymentMethodId}
              onSelect={onSelectPaymentMethod}
            />
          </div>
        )}

        {/* Priority — sliding segmented */}
        <p
          style={{
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: "0.22em",
            color: T.lo,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          Priority
        </p>
        <LayoutGroup>
          <div
            className="relative grid grid-cols-3 mb-5"
            style={{
              gap: 4,
              padding: 4,
              borderRadius: 16,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {(
              [
                { key: "fast" as const, label: "Fastest", fee: "2.9%", color: "#FBBF24" },
                { key: "best" as const, label: "Best Rate", fee: "2.5%", color: "#60A5FA" },
                { key: "cheap" as const, label: "Cheapest", fee: "1.5%", color: "#34D399" },
              ] as const
            ).map(({ key, label, fee, color }) => {
              const on = tradePreference === key;
              return (
                <motion.button
                  key={key}
                  onClick={() => setTradePreference(key)}
                  whileTap={{ scale: 0.97 }}
                  className="relative flex flex-col items-center justify-center"
                  style={{ padding: "9px 4px", borderRadius: 12 }}
                >
                  {on && (
                    <motion.span
                      layoutId="prio-pill"
                      className="absolute inset-0"
                      style={{
                        borderRadius: 12,
                        background: `${color}1A`,
                        border: `1px solid ${color}55`,
                        boxShadow: `0 6px 14px -8px ${color}88`,
                      }}
                      transition={SPRING}
                    />
                  )}
                  <span
                    className="relative"
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "-0.005em",
                      color: on ? T.hi : T.md,
                    }}
                  >
                    {label}
                  </span>
                  <span
                    className="relative"
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: on ? color : T.lo,
                      marginTop: 2,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {fee}
                  </span>
                </motion.button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* CTA — Buy/Sell action, in flow after Priority */}
        <motion.button
          onClick={startTrade}
          disabled={!hasAmount || isLoading || !userId}
          whileTap={hasAmount ? { scale: 0.985 } : undefined}
          animate={{
            background:
              hasAmount && !isLoading
                ? "#FFFFFF"
                : "rgba(255,255,255,0.05)",
            color: hasAmount && !isLoading ? "#0B0F14" : T.md,
            borderColor:
              hasAmount && !isLoading
                ? "rgba(255,255,255,0.30)"
                : "rgba(255,255,255,0.08)",
            boxShadow:
              hasAmount && !isLoading
                ? "0 16px 36px -14px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.6)"
                : "none",
          }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full flex items-center justify-center"
          style={{
            gap: 8,
            minHeight: 56,
            borderRadius: 18,
            borderWidth: 1,
            borderStyle: "solid",
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "-0.01em",
          }}
        >
          {isLoading ? (
            <Loader2 size={18} className="animate-spin" />
          ) : hasAmount ? (
            <>
              {isBuy ? (
                <ArrowDownLeft size={16} strokeWidth={2.6} />
              ) : (
                <ArrowUpRight size={16} strokeWidth={2.6} />
              )}
              {isBuy ? "Buy" : "Sell"} {amount} USDT
            </>
          ) : (
            "Enter Amount"
          )}
        </motion.button>
      </motion.div>

      <BottomNav
        screen={screen}
        setScreen={setScreen}
        maxW="max-w-[440px] mx-auto"
      />
    </div>
  );
};
