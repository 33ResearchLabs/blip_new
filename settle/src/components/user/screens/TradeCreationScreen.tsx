"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ArrowDownUp,
  ArrowUpRight,
  ArrowDownLeft,
  Building2,
  Banknote,
  Loader2,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";
import type { Screen, TradeType, TradePreference, PaymentMethod } from "./types";
import { PaymentMethodSelector, type PaymentMethodItem } from "../PaymentMethodSelector";
import { BottomNav } from "./BottomNav";

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
  const color = positive ? "#10b981" : "#ef4444";

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
}: TradeCreationScreenProps) => {
  const [ratePair, setRatePair] = useState<'usdt_aed' | 'usdt_inr'>('usdt_aed');
  const [rateData, setRateData] = useState<{ price: number; mode: string } | null>(null);
  const [prevRate, setPrevRate] = useState<number | null>(null);

  const fetchRate = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/prices/current?pair=${ratePair}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setRateData(prev => {
            if (prev) setPrevRate(prev.price);
            return { price: json.data.price, mode: json.data.mode };
          });
        }
      }
    } catch { /* silent */ }
  }, [ratePair]);

  useEffect(() => {
    setRateData(null);
    fetchRate();
    const id = setInterval(fetchRate, 25_000);
    return () => clearInterval(id);
  }, [fetchRate]);

  const displayRate = rateData?.price ?? (ratePair === 'usdt_aed' ? 3.67 : 92.5);
  const ratePositive = prevRate !== null ? displayRate >= prevRate : true;
  const rateCurrency = ratePair === 'usdt_aed' ? 'AED' : 'INR';
  const rateSymbol = ratePair === 'usdt_inr' ? '₹' : '';
  const rateDecimals = ratePair === 'usdt_aed' ? 3 : 2;
  const hasAmount = !!amount && parseFloat(amount) > 0;

  return (
    <div
      className="flex flex-col h-dvh overflow-hidden"
      style={{ background: "#060606" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="px-5 pt-10 pb-3 flex items-center gap-4 z-10 shrink-0">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setScreen("home")}
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <ChevronLeft
            size={20}
            strokeWidth={2}
            style={{ color: "rgba(0,0,0,0.6)" }}
          />
        </motion.button>
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: "rgba(255,255,255,0.3)",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            P2P Exchange
          </p>
          <p
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              color: "#fff",
            }}
          >
            Trade USDT
          </p>
        </div>
      </header>

      {/* ── Scrollable body ─────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pb-28 z-10 flex flex-col gap-3 overflow-y-auto no-scrollbar">
        {/* ── Buy / Sell — big cards ───────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 shrink-0">
          {([
            { type: 'buy' as const, label: 'Buy USDT', sub: `Pay ${rateCurrency}, get USDT`, Icon: ArrowDownLeft, activeColor: '#10b981' },
            { type: 'sell' as const, label: 'Sell USDT', sub: `Send USDT, get ${rateCurrency}`, Icon: ArrowUpRight, activeColor: '#ef4444' },
          ] as const).map(({ type, label, sub, Icon, activeColor }) => {
            const on = tradeType === type;
            return (
              <motion.button
                key={type}
                whileTap={{ scale: 0.96 }}
                onClick={() => setTradeType(type)}
                className="flex items-center justify-between rounded-[20px]"
                style={{
                  padding: "12px 14px",
                  background: "#ffffff",
                  border: on ? `1.5px solid ${activeColor}` : "1px solid rgba(0,0,0,0.06)",
                  boxShadow: on ? `0 4px 16px ${activeColor}22` : "none",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center"
                    style={{
                      background: on ? `${activeColor}15` : "rgba(0,0,0,0.05)",
                    }}
                  >
                    <Icon
                      size={18}
                      strokeWidth={2.5}
                      style={{
                        color: on ? activeColor : "rgba(0,0,0,0.35)",
                      }}
                    />
                  </div>
                  <div className="flex flex-col text-left">
                    <p style={{ fontSize: 16, fontWeight: 700, color: "#000" }}>{label}</p>
                    <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(0,0,0,0.4)" }}>{sub}</p>
                  </div>
                </div>
                {on && (
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: activeColor }}
                  />
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
          className="w-full rounded-[24px] shrink-0"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex-1 min-w-0">
              {/* Pair toggle + label */}
              <div className="flex items-center gap-2 mb-1.5">
                <p
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.22em",
                    color: "rgba(0,0,0,0.35)",
                    textTransform: "uppercase",
                  }}
                >
                  {rateData?.mode === 'MANUAL' ? 'Rate' : 'Live Rate'}
                </p>
                <div className="flex rounded-full overflow-hidden" style={{ border: '1px solid rgba(0,0,0,0.08)' }}>
                  {(['usdt_aed', 'usdt_inr'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setRatePair(p)}
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        letterSpacing: '0.1em',
                        padding: '2px 8px',
                        background: ratePair === p ? 'rgba(0,0,0,0.08)' : 'transparent',
                        color: ratePair === p ? '#000' : 'rgba(0,0,0,0.3)',
                        transition: 'all 0.15s',
                      }}
                    >
                      {p === 'usdt_aed' ? 'AED' : 'INR'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    color: "#000",
                    lineHeight: 1.1,
                  }}
                >
                  {rateSymbol}{displayRate.toFixed(rateDecimals)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "rgba(0,0,0,0.35)",
                  }}
                >
                  {rateCurrency}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                {ratePositive ? (
                  <TrendingUp size={11} style={{ color: "#059669" }} />
                ) : (
                  <TrendingDown size={11} style={{ color: "#dc2626" }} />
                )}
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: ratePositive ? "#059669" : "#dc2626",
                  }}
                >
                  {ratePositive ? "+" : ""}{prevRate !== null ? (((displayRate - prevRate) / prevRate) * 100).toFixed(2) : "0.00"}%
                </span>
              </div>
            </div>
            <div className="shrink-0" style={{ opacity: 0.9 }}>
              <RateSparkline rate={displayRate} positive={ratePositive} />
            </div>
          </div>
          <div
            className="flex items-center justify-between px-5 py-2.5"
            style={{
              borderTop: "1px solid rgba(0,0,0,0.06)",
              background: "rgba(0,0,0,0.02)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(0,0,0,0.3)",
                letterSpacing: "0.08em",
              }}
            >
              7D LOW {ratePair === 'usdt_aed' ? '3.651' : '92.10'}
            </span>
            <div
              className="flex-1 mx-4 h-1 rounded-full"
              style={{ background: "rgba(0,0,0,0.08)" }}
            >
              <div
                className="h-1 rounded-full"
                style={{
                  width: "68%",
                  background:
                    "linear-gradient(90deg, rgba(0,0,0,0.15), rgba(0,0,0,0.45))",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(0,0,0,0.3)",
                letterSpacing: "0.08em",
              }}
            >
              HIGH {ratePair === 'usdt_aed' ? '3.694' : '93.50'}
            </span>
          </div>
        </motion.div>

        {/* ── Amount input ──────────────────────────────────────────────── */}
        <div
          className="w-full rounded-[28px] mb-3 flex flex-col items-center py-2 px-3"
          style={{
            background: "#ffffff",
            border: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(0,0,0,0.35)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            {tradeType === 'buy' ? 'You Pay (USDT)' : 'You Sell (USDT)'}
          </p>

          <div className="flex items-center justify-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              style={{
                fontSize: 52,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: hasAmount ? "#000" : "rgba(0,0,0,0.15)",
                width: amount
                  ? `${Math.max(72, amount.length * 44)}px`
                  : "72px",
                textAlign: "center",
                minWidth: 72,
                maxWidth: 240,
              }}
            />
            <span
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "rgba(0,0,0,0.25)",
                letterSpacing: "-0.01em",
              }}
            >
              USDT
            </span>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: hasAmount ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.15)",
              }}
            >
              {ratePair === 'usdt_inr' ? '₹' : '\u062F.\u0625'}{" "}
              {hasAmount
                ? (parseFloat(amount) * displayRate).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : '0'}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(0,0,0,0.25)",
              }}
            >
              {rateCurrency}
            </span>
          </div>

          {solanaWallet.connected && (
            <div
              className="mt-2 px-3 py-1 rounded-full"
              style={{
                background: "rgba(0,0,0,0.04)",
                border: "1px solid rgba(0,0,0,0.06)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "rgba(0,0,0,0.35)",
                  letterSpacing: "0.08em",
                }}
              >
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
              className="flex items-center gap-4 mt-2 pt-2 w-full"
              style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}
            >
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(0,0,0,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  Fee
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "rgba(0,0,0,0.7)" }}>
                  {(currentFees.totalFee * 100).toFixed(1)}%
                </p>
              </div>
              <div style={{ width: 1, height: 28, background: "rgba(0,0,0,0.08)" }} />
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(0,0,0,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  Trader Earns
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "rgba(0,0,0,0.7)" }}>
                  {(currentFees.traderCut * 100).toFixed(2)}%
                </p>
              </div>
              <div style={{ width: 1, height: 28, background: "rgba(0,0,0,0.08)" }} />
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(0,0,0,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  You Get
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#000" }}>
                  {tradeType === "buy"
                    ? `${parseFloat(amount || "0").toFixed(2)} USDT`
                    : `${ratePair === 'usdt_inr' ? '₹' : '\u062F.\u0625'}${(parseFloat(amount || "0") * displayRate).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                </p>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Payment Method ───────────────────────────────────────────── */}
        <div className="mb-3">
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(255,255,255,0.25)",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
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
                  className="flex items-center justify-between rounded-[16px]"
                  style={{
                    padding: "10px 12px",
                    background: "#ffffff",
                    border: on ? "1.5px solid rgba(0,0,0,0.5)" : "1px solid rgba(0,0,0,0.06)",
                    boxShadow: on ? "0 4px 14px rgba(0,0,0,0.12)" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-[10px] flex items-center justify-center"
                      style={{ background: "rgba(0,0,0,0.06)" }}
                    >
                      <Icon size={16} style={{ color: "rgba(0,0,0,0.55)" }} />
                    </div>
                    <div className="flex flex-col">
                      <p style={{ fontSize: 14, fontWeight: 700, color: "#000" }}>{label}</p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(0,0,0,0.4)" }}>{sub}</p>
                    </div>
                  </div>
                  {on && <div className="w-2 h-2 rounded-full bg-black" />}
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
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(255,255,255,0.25)",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Priority
          </p>
          <div className="flex gap-2.5">
            {([
              { key: 'fast' as const, label: 'Fastest', sub: '~2 min', fee: '3.0%', barColor: '#d97706' },
              { key: 'best' as const, label: 'Best Rate', sub: '~8 min', fee: '2.5%', barColor: '#3b82f6' },
              { key: 'cheap' as const, label: 'Cheapest', sub: '~15 min', fee: '1.5%', barColor: '#059669' },
            ] as const).map(({ key, label, sub, fee, barColor }) => {
              const on = tradePreference === key;
              return (
                <motion.button
                  key={key}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setTradePreference(key)}
                  className="flex-1 rounded-[16px]"
                  style={{
                    padding: "10px 12px",
                    background: "#ffffff",
                    border: on
                      ? `1.5px solid ${barColor}`
                      : "1px solid rgba(0,0,0,0.06)",
                    boxShadow: on ? `0 2px 10px ${barColor}22` : "none",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col items-start leading-tight">
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#000" }}>{label}</p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(0,0,0,0.4)" }}>{sub}</p>
                    </div>
                    <div
                      className="flex items-center justify-center h-5 px-1 rounded-full"
                      style={{
                        background: `${barColor}15`,
                        border: `1px solid ${barColor}40`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: barColor,
                          lineHeight: 1,
                        }}
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
          className="w-full flex items-center justify-center gap-2 shrink-0"
          style={{
            minHeight: 48,
            borderRadius: 14,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            ...(hasAmount && !isLoading
              ? {
                  background: "#ffffff",
                  color: "#000000",
                  boxShadow: "0 4px 16px rgba(255,255,255,0.12)",
                  border: "1px solid rgba(255,255,255,0.2)",
                }
              : {
                  background: "rgba(255,255,255,0.06)",
                  color: "rgba(255,255,255,0.25)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }),
          }}
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
          className="w-full mt-1 py-2 text-center"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(255,255,255,0.28)",
          }}
        >
          Large amount?{" "}
          <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 700 }}>
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
