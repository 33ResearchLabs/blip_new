"use client";

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
  const ratePositive = true;
  const hasAmount = !!amount && parseFloat(amount) > 0;

  return (
    <div
      className="flex flex-col h-dvh overflow-hidden"
      style={{ background: "#ffffff" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="px-5 pt-10 pb-3 flex items-center gap-4 z-10 shrink-0">
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setScreen("home")}
          className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <ChevronLeft
            size={20}
            strokeWidth={2}
            style={{ color: "rgba(255,255,255,0.6)" }}
          />
        </motion.button>
        <div>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: "rgba(0,0,0,0.4)",
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
              color: "#000",
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
            { type: 'buy' as const, label: 'Buy USDT', sub: 'Pay AED, get USDT', Icon: ArrowDownLeft, activeColor: '#10b981' },
            { type: 'sell' as const, label: 'Sell USDT', sub: 'Send USDT, get AED', Icon: ArrowUpRight, activeColor: '#ef4444' },
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
                  background: "#111111",
                  border: on ? `1.5px solid ${activeColor}` : "1px solid rgba(255,255,255,0.08)",
                  boxShadow: on ? `0 4px 16px ${activeColor}22` : "none",
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center"
                    style={{
                      background: on ? `${activeColor}15` : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Icon
                      size={18}
                      strokeWidth={2.5}
                      style={{
                        color: on ? activeColor : "rgba(255,255,255,0.35)",
                      }}
                    />
                  </div>
                  <div className="flex flex-col text-left">
                    <p style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{label}</p>
                    <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{sub}</p>
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
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <div className="flex-1 min-w-0">
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.22em",
                  color: "rgba(255,255,255,0.35)",
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Live Rate {'\u00B7'} USDT / AED
              </p>
              <div className="flex items-baseline gap-2">
                <span
                  style={{
                    fontSize: 26,
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    color: "#fff",
                    lineHeight: 1.1,
                  }}
                >
                  {fiatAmount &&
                  parseFloat(fiatAmount) > 0 &&
                  amount &&
                  parseFloat(amount) > 0
                    ? (parseFloat(fiatAmount) / parseFloat(amount)).toFixed(3)
                    : "3.672"}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "rgba(255,255,255,0.35)",
                  }}
                >
                  AED
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
                  {ratePositive ? "+0.24%" : "-0.18%"} today
                </span>
              </div>
            </div>
            <div className="shrink-0" style={{ opacity: 0.9 }}>
              <RateSparkline rate={3.672} positive={ratePositive} />
            </div>
          </div>
          <div
            className="flex items-center justify-between px-5 py-2.5"
            style={{
              borderTop: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "0.08em",
              }}
            >
              7D LOW 3.651
            </span>
            <div
              className="flex-1 mx-4 h-1 rounded-full"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <div
                className="h-1 rounded-full"
                style={{
                  width: "68%",
                  background:
                    "linear-gradient(90deg, rgba(255,255,255,0.2), rgba(255,255,255,0.5))",
                }}
              />
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "0.08em",
              }}
            >
              HIGH 3.694
            </span>
          </div>
        </motion.div>

        {/* ── Amount input ──────────────────────────────────────────────── */}
        <div
          className="w-full rounded-[28px] mb-3 flex flex-col items-center py-2 px-3"
          style={{
            background: "#111111",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(255,255,255,0.35)",
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
                color: hasAmount ? "#fff" : "rgba(255,255,255,0.15)",
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
                color: "rgba(255,255,255,0.25)",
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
                color: hasAmount ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.15)",
              }}
            >
              {'\u062F.\u0625'}{" "}
              {hasAmount
                ? parseFloat(fiatAmount).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })
                : '0'}
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "rgba(255,255,255,0.25)",
              }}
            >
              AED
            </span>
          </div>

          {solanaWallet.connected && (
            <div
              className="mt-2 px-3 py-1 rounded-full"
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "rgba(255,255,255,0.35)",
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
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(255,255,255,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  Fee
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>
                  {(currentFees.totalFee * 100).toFixed(1)}%
                </p>
              </div>
              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(255,255,255,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  Trader Earns
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>
                  {(currentFees.traderCut * 100).toFixed(2)}%
                </p>
              </div>
              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)" }} />
              <div className="flex-1 text-center">
                <p
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.18em",
                    color: "rgba(255,255,255,0.3)",
                    textTransform: "uppercase",
                    marginBottom: 3,
                  }}
                >
                  You Get
                </p>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>
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
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(0,0,0,0.4)",
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
                    background: "#111111",
                    border: on ? "1.5px solid rgba(255,255,255,0.5)" : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: on ? "0 4px 14px rgba(0,0,0,0.3)" : "none",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-7 h-7 rounded-[10px] flex items-center justify-center"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      <Icon size={16} style={{ color: "rgba(255,255,255,0.55)" }} />
                    </div>
                    <div className="flex flex-col">
                      <p style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{label}</p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{sub}</p>
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
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: "rgba(0,0,0,0.4)",
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
                    background: "#111111",
                    border: on
                      ? `1.5px solid ${barColor}`
                      : "1px solid rgba(255,255,255,0.08)",
                    boxShadow: on ? `0 2px 10px ${barColor}22` : "none",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col items-start leading-tight">
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>{label}</p>
                      <p style={{ fontSize: 10, fontWeight: 500, color: "rgba(255,255,255,0.4)" }}>{sub}</p>
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
                  background: "#111111",
                  color: "#ffffff",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }
              : {
                  background: "rgba(0,0,0,0.04)",
                  color: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(0,0,0,0.08)",
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
            color: "rgba(0,0,0,0.3)",
          }}
        >
          Large amount?{" "}
          <span style={{ color: "rgba(0,0,0,0.55)", fontWeight: 700 }}>
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
