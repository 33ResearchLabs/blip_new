"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Wallet,
  TrendingUp,
  Clock,
  Lock,
  Unlock,
  ArrowDownRight,
  ArrowUpRight,
  History,
  Plus,
  Minus,
  ChevronDown,
  Check,
  X,
} from "lucide-react";
import type { Order } from "@/types/merchant";

interface MobileHomeViewProps {
  effectiveBalance: number | null;
  totalTradedVolume: number;
  todayEarnings: number;
  pendingEarnings: number;
  merchantInfo: any;
  pendingOrders: Order[];
  ongoingOrders: Order[];
  completedOrders: Order[];

  // Navigation
  setMobileView: (v: any) => void;
  onShowWalletModal: () => void;
  // Opens the full wallet overlay (where the unlock / setup UI lives).
  // Falls back to onShowWalletModal when not provided.
  onOpenWallet?: () => void;

  // Embedded wallet lock state — gates the balance display + reveals an unlock CTA
  embeddedWalletState?: "initializing" | "none" | "locked" | "unlocked";

  // Quick-action handlers wired into the balance-card button row.
  // Buy/Sell preselect the trade side and open the create-trade modal.
  onStartTrade?: (side: "buy" | "sell") => void;
}

export function MobileHomeView({
  effectiveBalance,
  totalTradedVolume,
  todayEarnings,
  pendingEarnings,
  merchantInfo,
  pendingOrders,
  ongoingOrders,
  completedOrders,
  setMobileView,
  onShowWalletModal,
  onOpenWallet,
  embeddedWalletState,
  onStartTrade,
}: MobileHomeViewProps) {
  const openWallet = onOpenWallet ?? onShowWalletModal;

  // ─── INR cash (off-chain physical cash the merchant holds) ─────────
  // Persisted per merchant in localStorage — same key the desktop
  // StatusCard uses, so the value stays in sync across viewports.
  const merchantId: string | undefined = merchantInfo?.id;
  const [inrBalance, setInrBalance] = useState<number>(0);
  const [showInrPanel, setShowInrPanel] = useState(false);
  const [inrInputValue, setInrInputValue] = useState("");
  const [inrInputMode, setInrInputMode] = useState<"add" | "subtract">("add");

  useEffect(() => {
    if (typeof window === "undefined" || !merchantId) return;
    const saved = localStorage.getItem(`inr_cash_${merchantId}`);
    setInrBalance(saved ? parseFloat(saved) || 0 : 0);
  }, [merchantId]);

  useEffect(() => {
    if (typeof window === "undefined" || !merchantId) return;
    localStorage.setItem(`inr_cash_${merchantId}`, inrBalance.toString());
  }, [merchantId, inrBalance]);

  const handleInrSubmit = () => {
    const amount = parseFloat(inrInputValue);
    if (Number.isNaN(amount) || amount <= 0) return;
    setInrBalance((prev) =>
      inrInputMode === "add" ? prev + amount : Math.max(0, prev - amount),
    );
    setInrInputValue("");
    setShowInrPanel(false);
  };

  // Recent activity — merge pending + ongoing + recent completed
  const recentOrders = [
    ...pendingOrders.slice(0, 5),
    ...ongoingOrders.slice(0, 5),
    ...completedOrders.slice(0, 6),
  ].slice(0, 6);

  return (
    <div className="space-y-4">
      {/* ── Balance Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-foreground/[0.03] border border-foreground/[0.06] rounded-2xl p-5"
      >
        <div className="flex items-center justify-between mb-1 gap-2">
          <span className="text-[11px] text-foreground/40 uppercase tracking-wider font-medium">
            Available Balance
          </span>
          <button
            onClick={onShowWalletModal}
            className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            <Wallet className="w-4 h-4 text-primary" />
          </button>
        </div>
        {/* Locked / no wallet → hide the misleading "0.00" and surface a CTA */}
        {embeddedWalletState === "locked" ? (
          <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-foreground/40" />
              <span className="text-base font-semibold text-foreground/60">
                Wallet Locked
              </span>
            </div>
            <p className="text-[12px] text-foreground/40">
              Unlock your wallet to view your balance and start trading.
            </p>
            <button
              onClick={openWallet}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Unlock className="w-4 h-4" />
              Unlock Wallet
            </button>
          </div>
        ) : embeddedWalletState === "none" ? (
          <div className="mt-2 space-y-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-foreground/40" />
              <span className="text-base font-semibold text-foreground/60">
                No Wallet
              </span>
            </div>
            <p className="text-[12px] text-foreground/40">
              Create or import a wallet to view your balance.
            </p>
            <button
              onClick={openWallet}
              className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <Wallet className="w-4 h-4" />
              Set Up Wallet
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground tracking-tight">
                {effectiveBalance !== null
                  ? effectiveBalance.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })
                  : "0.00"}
              </span>
              <span className="text-sm text-foreground/40 font-medium">
                USDT
              </span>
            </div>
            {todayEarnings !== 0 && (
              <div className="flex items-center gap-1 mt-2">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[12px] text-emerald-400 font-medium">
                  +{todayEarnings.toFixed(2)} USDT (24h)
                </span>
              </div>
            )}

            {/* Quick actions — Buy / Sell / Wallet / History */}
            <div className="grid grid-cols-4 gap-2 mt-4">
              <button
                onClick={() => onStartTrade?.("buy")}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/15 transition-colors"
              >
                <ArrowDownRight className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Buy
                </span>
              </button>
              <button
                onClick={() => onStartTrade?.("sell")}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-primary/10 border border-primary/25 text-primary hover:bg-primary/15 transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Sell
                </span>
              </button>
              <button
                onClick={openWallet}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/70 hover:bg-foreground/[0.08] transition-colors"
              >
                <Wallet className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  Wallet
                </span>
              </button>
              <button
                onClick={() => setMobileView("history")}
                className="flex flex-col items-center gap-1 py-2.5 rounded-xl bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/70 hover:bg-foreground/[0.08] transition-colors"
              >
                <History className="w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-wide">
                  History
                </span>
              </button>
            </div>

            {/* INR cash — collapsed pill, expands into an add / subtract input */}
            <div className="mt-4">
              <button
                onClick={() => setShowInrPanel((v) => !v)}
                aria-expanded={showInrPanel}
                className="w-full flex items-center justify-between bg-foreground/[0.03] rounded-xl px-3 py-2.5 border border-foreground/[0.04] hover:bg-foreground/[0.05] transition-colors"
              >
                <span className="text-[10px] text-foreground/30 uppercase tracking-wide font-medium">
                  INR Cash
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    ₹{inrBalance.toLocaleString()}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-foreground/40 transition-transform ${showInrPanel ? "rotate-180" : ""}`}
                  />
                </span>
              </button>

              {showInrPanel && (
                <div className="mt-2 bg-foreground/[0.03] border border-foreground/[0.06] rounded-xl p-3 space-y-2.5">
                  {/* Add / subtract toggle */}
                  <div className="flex bg-foreground/[0.04] rounded-lg p-0.5">
                    <button
                      onClick={() => setInrInputMode("add")}
                      className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                        inrInputMode === "add"
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "text-foreground/40"
                      }`}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                    <button
                      onClick={() => setInrInputMode("subtract")}
                      className={`flex-1 py-1.5 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 transition-colors ${
                        inrInputMode === "subtract"
                          ? "bg-rose-500/15 text-rose-400"
                          : "text-foreground/40"
                      }`}
                    >
                      <Minus className="w-3 h-3" />
                      Subtract
                    </button>
                  </div>

                  {/* Amount input */}
                  <div className="flex items-center bg-foreground/[0.04] border border-foreground/[0.08] rounded-lg px-3 py-2 focus-within:border-primary/30 transition-colors">
                    <span className="text-sm text-foreground/40 mr-1">₹</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      value={inrInputValue}
                      onChange={(e) => setInrInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleInrSubmit();
                        if (e.key === "Escape") setShowInrPanel(false);
                      }}
                      placeholder="0"
                      maxLength={14}
                      className="flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-foreground/20 tabular-nums"
                      autoFocus
                    />
                  </div>

                  {/* Submit / cancel */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setShowInrPanel(false);
                        setInrInputValue("");
                      }}
                      className="flex-1 py-2 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[12px] font-semibold text-foreground/60 hover:bg-foreground/[0.06] transition-colors flex items-center justify-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Cancel
                    </button>
                    <button
                      onClick={handleInrSubmit}
                      disabled={
                        !inrInputValue || parseFloat(inrInputValue) <= 0
                      }
                      className="flex-1 py-2 rounded-lg bg-primary text-white text-[12px] font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center justify-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      {inrInputMode === "add" ? "Add INR Cash" : "Subtract"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>

      {/* Quick Trade card removed — the floating + FAB at the bottom-right
          opens the full trade modal. */}

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
            <span className="text-sm font-semibold text-foreground">
              Active Market
            </span>
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
            <p className="text-[11px] text-foreground/20 mt-1">
              Your trades will appear here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentOrders.map((order) => {
              const isBuy =
                order.orderType === "buy" || order.dbOrder?.type === "buy";
              const status = order.dbOrder?.status || order.status;
              const statusLabel =
                status === "completed"
                  ? "COMPLETED"
                  : status === "cancelled"
                    ? "CANCELLED"
                    : status === "escrowed" || status === "escrow"
                      ? "IN PROGRESS"
                      : status === "payment_sent"
                        ? "PAYMENT SENT"
                        : "PENDING";
              const statusColor =
                status === "completed"
                  ? "text-emerald-400"
                  : status === "cancelled"
                    ? "text-red-400"
                    : "text-primary";

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
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-bold ${
                      isBuy
                        ? "bg-emerald-500/10 text-emerald-400"
                        : "bg-primary/10 text-primary"
                    }`}
                  >
                    {isBuy ? "BUY" : "SELL"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {order.user}
                    </p>
                    <p className="text-[11px] text-foreground/40">
                      {order.dbOrder?.order_number || `${order.amount} USDT`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-foreground">
                      {order.amount} USDT
                      <span className="text-foreground/30 mx-1">→</span>
                      <span className="text-primary">
                        {Math.round(order.total)} AED
                      </span>
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
