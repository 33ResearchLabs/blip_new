"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Zap,
  Target,
  TrendingDown,
  Loader2,
  Clock,
} from "lucide-react";
import type { Order } from "@/types/merchant";
import { fetchWithAuth } from "@/lib/api/fetchWithAuth";

interface MobileHomeViewProps {
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  merchantInfo: any;
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];

  // Trade form
  openTradeForm: {
    tradeType: "buy" | "sell";
    cryptoAmount: string;
    paymentMethod: "bank" | "cash";
    spreadPreference: "best" | "fastest" | "cheap";
    expiryMinutes?: number;
  };
  setOpenTradeForm: (v: any) => void;
  isCreatingTrade: boolean;
  onCreateTrade: () => void;
  setShowOpenTradeModal: (v: boolean) => void;

  // Navigation
  setMobileView: (v: any) => void;
  onShowWalletModal: () => void;
}

const SPREAD_TIERS = {
  fastest: { label: "Fast", base: 2.5, icon: Zap },
  best: { label: "Best", base: 2.0, icon: Target },
  cheap: { label: "Cheap", base: 1.5, icon: TrendingDown },
} as const;

export function MobileHomeView({
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  merchantInfo,
  pendingOrders,
  ongoingOrders,
  completedOrders,
  openTradeForm,
  setOpenTradeForm,
  isCreatingTrade,
  onCreateTrade,
  setShowOpenTradeModal,
  setMobileView,
  onShowWalletModal,
}: MobileHomeViewProps) {
  const [currentRate, setCurrentRate] = useState(3.67);

  // Fetch corridor rate
  useEffect(() => {
    fetchWithAuth("/api/corridor/dynamic-rate")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data?.ref_price) {
          setCurrentRate(parseFloat(data.data.ref_price));
        }
      })
      .catch(() => {});
    const interval = setInterval(() => {
      fetchWithAuth("/api/corridor/dynamic-rate")
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data?.ref_price) {
            setCurrentRate(parseFloat(data.data.ref_price));
          }
        })
        .catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const cryptoAmount = parseFloat(openTradeForm.cryptoAmount) || 0;
  const fiatAmount = cryptoAmount * currentRate;
  const maxAmount = effectiveBalance || 0;

  // Recent activity — merge pending + ongoing + recent completed
  const recentOrders = [
    ...pendingOrders.slice(0, 3),
    ...ongoingOrders.slice(0, 3),
    ...completedOrders.slice(0, 4),
  ].slice(0, 6);

  return (
    <div className="space-y-4">
      {/* ── Balance Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-foreground/40 uppercase tracking-wider font-medium">Available Balance</span>
          <button onClick={onShowWalletModal} className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors">
            <Wallet className="w-4 h-4 text-primary" />
          </button>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold text-foreground tracking-tight">
            {effectiveBalance !== null
              ? effectiveBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : "0.00"}
          </span>
          <span className="text-sm text-foreground/40 font-medium">USDT</span>
        </div>
        {todayEarnings !== 0 && (
          <div className="flex items-center gap-1 mt-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[12px] text-emerald-400 font-medium">
              +{todayEarnings.toFixed(2)} USDT (24h)
            </span>
          </div>
        )}

        {/* Sub-stats */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="bg-foreground/[0.03] rounded-xl p-3 border border-foreground/[0.04]">
            <span className="text-[10px] text-foreground/30 uppercase tracking-wide block mb-1">INR Cash</span>
            <span className="text-sm font-bold text-foreground">₹0</span>
          </div>
          <div className="bg-foreground/[0.03] rounded-xl p-3 border border-foreground/[0.04]">
            <span className="text-[10px] text-foreground/30 uppercase tracking-wide block mb-1">Market Rate</span>
            <span className="text-sm font-bold text-foreground">{currentRate.toFixed(4)}</span>
          </div>
        </div>
      </motion.div>

      {/* ── Quick Trade ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-5 space-y-4"
      >
        {/* Buy / Sell toggle */}
        <div className="flex bg-foreground/[0.04] rounded-xl p-1">
          <button
            onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: "buy" })}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              openTradeForm.tradeType === "buy"
                ? "bg-primary text-white shadow-sm"
                : "text-foreground/40 hover:text-foreground/60"
            }`}
          >
            BUY
          </button>
          <button
            onClick={() => setOpenTradeForm({ ...openTradeForm, tradeType: "sell" })}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              openTradeForm.tradeType === "sell"
                ? "bg-primary text-white shadow-sm"
                : "text-foreground/40 hover:text-foreground/60"
            }`}
          >
            SELL
          </button>
        </div>

        {/* Amount input */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-foreground/40 uppercase tracking-wide">Amount</span>
            {effectiveBalance !== null && (
              <button
                onClick={() => setOpenTradeForm({ ...openTradeForm, cryptoAmount: maxAmount.toFixed(0) })}
                className="text-[10px] text-primary font-semibold hover:text-primary/80 transition-colors"
              >
                MAX {maxAmount.toLocaleString()}
              </button>
            )}
          </div>
          <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-xl px-4 py-3 focus-within:border-primary/30 transition-colors">
            <input
              type="text"
              inputMode="decimal"
              value={openTradeForm.cryptoAmount}
              onChange={(e) => setOpenTradeForm({ ...openTradeForm, cryptoAmount: e.target.value })}
              placeholder="0"
              className="flex-1 bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-foreground/20"
            />
            <span className="text-sm text-foreground/40 font-medium ml-2">USDT</span>
          </div>
          {cryptoAmount > 0 && (
            <p className="text-[11px] text-foreground/30 mt-1.5 ml-1">
              ≈ {fiatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AED
            </p>
          )}
        </div>

        {/* Payment method */}
        <div className="flex gap-2">
          <button
            onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: "bank" })}
            className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all ${
              openTradeForm.paymentMethod === "bank"
                ? "bg-foreground/[0.06] border-foreground/[0.12] text-foreground"
                : "border-foreground/[0.06] text-foreground/40"
            }`}
          >
            Bank Transfer
          </button>
          <button
            onClick={() => setOpenTradeForm({ ...openTradeForm, paymentMethod: "cash" })}
            className={`flex-1 py-2.5 rounded-xl text-xs font-medium border transition-all ${
              openTradeForm.paymentMethod === "cash"
                ? "bg-foreground/[0.06] border-foreground/[0.12] text-foreground"
                : "border-foreground/[0.06] text-foreground/40"
            }`}
          >
            Cash
          </button>
        </div>

        {/* Spread speed */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-foreground/40 uppercase tracking-wide">Spread Speed</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(SPREAD_TIERS) as Array<keyof typeof SPREAD_TIERS>).map((key) => {
              const tier = SPREAD_TIERS[key];
              const Icon = tier.icon;
              const active = openTradeForm.spreadPreference === key;
              return (
                <button
                  key={key}
                  onClick={() => setOpenTradeForm({ ...openTradeForm, spreadPreference: key })}
                  className={`py-2.5 rounded-xl text-center border transition-all ${
                    active
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "border-foreground/[0.06] text-foreground/40 hover:text-foreground/60"
                  }`}
                >
                  <div className="flex items-center justify-center gap-1 mb-0.5">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">{tier.label}</span>
                  </div>
                  <span className="text-[10px] opacity-60">+{tier.base}%</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action button */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            if (cryptoAmount > 0) {
              setShowOpenTradeModal(true);
            }
          }}
          disabled={isCreatingTrade || cryptoAmount <= 0}
          className="w-full py-4 rounded-xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-40 disabled:shadow-none flex items-center justify-center gap-2"
        >
          {isCreatingTrade ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>{openTradeForm.tradeType === "buy" ? "BUY" : "SELL"} ASSET</>
          )}
        </motion.button>
      </motion.div>

      {/* ── Active Market ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="space-y-3"
      >
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Active Market</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMobileView("orders")}
              className="text-[11px] text-foreground/40 hover:text-foreground/60 transition-colors"
            >
              Pending
            </button>
            <button
              onClick={() => setMobileView("history")}
              className="text-[11px] text-foreground/40 hover:text-foreground/60 transition-colors"
            >
              All
            </button>
          </div>
        </div>

        {recentOrders.length === 0 ? (
          <div className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-8 text-center">
            <Clock className="w-8 h-8 text-foreground/15 mx-auto mb-2" />
            <p className="text-sm text-foreground/30">No recent activity</p>
            <p className="text-[11px] text-foreground/20 mt-1">Your trades will appear here</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((order) => {
              const isBuy = order.orderType === "buy" || order.dbOrder?.type === "buy";
              const status = order.dbOrder?.status || order.status;
              const statusLabel =
                status === "completed" ? "COMPLETED" :
                status === "cancelled" ? "CANCELLED" :
                status === "escrowed" || status === "escrow" ? "IN PROGRESS" :
                status === "payment_sent" ? "PAYMENT SENT" :
                "PENDING";
              const statusColor =
                status === "completed" ? "text-emerald-400" :
                status === "cancelled" ? "text-red-400" :
                "text-primary";

              return (
                <button
                  key={order.id}
                  onClick={() => {
                    if (status === "completed" || status === "cancelled") {
                      setMobileView("history");
                    } else if (status === "pending") {
                      setMobileView("orders");
                    } else {
                      setMobileView("escrow");
                    }
                  }}
                  className="w-full flex items-center gap-3 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 hover:bg-foreground/[0.05] transition-colors text-left"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${
                    isBuy ? "bg-emerald-500/10 text-emerald-400" : "bg-primary/10 text-primary"
                  }`}>
                    {isBuy ? "BUY" : "SELL"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{order.user}</p>
                    <p className="text-[11px] text-foreground/40">
                      {order.dbOrder?.order_number || `${order.amount} USDC`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">
                      {order.amount} USDC
                      <span className="text-foreground/30 mx-1">→</span>
                      <span className="text-primary">{Math.round(order.total)} AED</span>
                    </p>
                    <p className={`text-[10px] font-medium ${statusColor}`}>
                      {statusLabel}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </motion.div>
    </div>
  );
}
