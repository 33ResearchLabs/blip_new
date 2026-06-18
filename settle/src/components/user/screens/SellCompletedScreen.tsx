"use client";

/**
 * SellCompletedScreen
 * ───────────────────
 * Seller-side completion / receipt view for a finished SELL order. Replaces the
 * step-body on OrderDetailScreen once a sell order is `completed` (the buy side
 * keeps its own OrderCompletedScreen with the rating UI).
 *
 * "Payment verified!" banner → You→Escrow→Buyer route (all done) → totals tiles
 * → itemised receipt → thank-you → Order Overview → Need help.
 *
 * Pure presentation. Colours are 100% theme tokens (success / accent / error /
 * surface) — no hardcoded hex, no `text-white`, including buttons.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  ShieldCheck,
  CheckCircle2,
  PartyPopper,
  FileText,
  Headphones,
  Wallet,
  ArrowUpRight,
  Landmark,
} from "lucide-react";
import type { Order } from "./types";
import { formatCrypto } from "@/lib/format";
import { networkLabel } from "@/lib/solana/networkLabel";
import { OrderOverviewScreen } from "./OrderOverviewScreen";

const CARD = "bg-surface-card border border-border-subtle";

function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

function fmtDateTime(d: Date): string {
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const date = d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
  return `${time}, ${date}`;
}

export interface SellCompletedScreenProps {
  order: Order;
  displayId: string;
  onBack: () => void;
  onHelp: () => void;
}

export function SellCompletedScreen({ order, displayId, onBack, onHelp }: SellCompletedScreenProps) {
  const [showOverview, setShowOverview] = useState(false);
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const fiatCode = (order.fiatCode || "").toUpperCase();
  const methodLabel = order.merchant?.paymentMethod === "cash" ? "Cash" : "Bank Transfer";
  const completedStr = order.completedAt ? fmtDateTime(order.completedAt) : "—";

  const routeNodes = [
    { icon: Wallet, label: "You" },
    { icon: ShieldCheck, label: "Escrow" },
    { icon: Landmark, label: "Buyer" },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="h-[max(env(safe-area-inset-top),1rem)]" />

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle" aria-label="Back">
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <div className="text-center flex-1 min-w-0">
            <h1 className="text-[17px] font-semibold text-text-primary truncate">Sell {cryptoStr} USDT</h1>
            <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
          </div>
          <button onClick={onHelp} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle" aria-label="Help">
            <HelpCircle className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="px-5 pb-10 space-y-4">
          {/* Banner */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-success/15">
              <ShieldCheck className="w-6 h-6 text-success" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">Payment verified!</p>
              <p className="text-[13px] text-text-secondary leading-snug">
                The payment has been verified and the USDT has been released to the buyer.
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15 shrink-0 self-start">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              <span className="text-[11px] font-semibold text-success">COMPLETED</span>
            </div>
          </motion.div>

          {/* Trade route — You → Escrow → Buyer, all done */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.03 }}
            className={`rounded-2xl p-4 ${CARD}`}
          >
            <div className="flex items-start">
              {routeNodes.map((n, i) => {
                const isLast = i === routeNodes.length - 1;
                return (
                  <div key={n.label} className={`flex flex-col items-center ${isLast ? "" : "flex-1"}`}>
                    <div className="flex items-center w-full">
                      <div className="relative shrink-0 mx-auto">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center bg-success/15">
                          <n.icon className="w-5 h-5 text-success" />
                        </div>
                        <CheckCircle2 className="absolute -top-1 -right-1 w-4 h-4 text-success bg-surface-card rounded-full" />
                      </div>
                      {!isLast && (
                        <div className="flex-1 mx-1 border-t-2 border-dashed border-success/40" />
                      )}
                    </div>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-tertiary mt-1.5">
                      {n.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-border-subtle flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary truncate">
                  {networkLabel()}
                </span>
              </div>
              {order.escrowTxHash && (
                <span className="text-[11px] font-medium text-text-tertiary tabular-nums shrink-0">
                  {order.escrowTxHash.slice(0, 4)}…{order.escrowTxHash.slice(-4)}
                </span>
              )}
            </div>
          </motion.div>

          {/* Totals tiles */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.06 }}
            className="grid grid-cols-3 gap-2"
          >
            <CompletedTile icon={<ArrowUpRight className="w-4 h-4 text-success" />} label="You sold" value={cryptoStr} sub="USDT" />
            <CompletedTile icon={<Wallet className="w-4 h-4 text-success" />} label="You received" value={fiatStr} sub={fiatCode} valueClass="text-success" />
            <CompletedTile icon={<Landmark className="w-4 h-4 text-success" />} label="Method" value={methodLabel} />
          </motion.div>

          {/* Itemised receipt */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.09 }}
            className={`rounded-2xl ${CARD}`}
          >
            <div className="flex items-center gap-3 px-4 pt-4 pb-1">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-success/15">
                <PartyPopper className="w-5 h-5 text-success" />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-text-primary">Order completed</p>
                <p className="text-[13px] text-text-secondary leading-snug">
                  You have successfully sold {cryptoStr} USDT. The payment has been verified and the USDT released to the buyer.
                </p>
              </div>
            </div>
            <div className="divide-y divide-border-subtle px-4 mt-1">
              <Row label="Amount sold" value={`${cryptoStr} USDT`} />
              <Row label="Amount received" value={fiatStr} valueClass="text-success" />
              <Row label="Payment method" value={methodLabel} />
              <Row label="Completed on" value={completedStr} />
              <Row label="Order ID" value={displayId} />
            </div>
          </motion.div>

          {/* Thank you */}
          <div className="rounded-2xl p-4 flex gap-3 bg-success-dim border border-success-border">
            <PartyPopper className="w-5 h-5 text-success shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-text-primary mb-0.5">Thank you!</p>
              <p className="text-[13px] text-text-secondary leading-snug">
                Thank you for using Blip. You&apos;ll receive an email and in-app notification with the order details.
              </p>
            </div>
          </div>

          {/* Order Overview */}
          <div className={`rounded-2xl overflow-hidden ${CARD}`}>
            <button
              onClick={() => setShowOverview(true)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left active:bg-surface-hover"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-accent/15">
                <FileText className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text-primary">Order Overview</p>
                <p className="text-[13px] text-text-tertiary">View order details</p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />
            </button>
          </div>

          {/* Need help */}
          <div className="rounded-2xl overflow-hidden bg-error-dim border border-error-border">
            <button onClick={onHelp} className="w-full flex items-center gap-3 px-5 py-4 text-left">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-error/15">
                <Headphones className="w-5 h-5 text-error" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-error">Need Help?</p>
                <p className="text-[13px] text-text-secondary">Contact support if you need any help.</p>
              </div>
              <ChevronRight className="w-5 h-5 text-error shrink-0" />
            </button>
          </div>
        </div>
      </div>

      {/* Itemised overview — in-place overlay */}
      <AnimatePresence>
        {showOverview && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320, mass: 0.8 }}
            className="absolute inset-0 z-10 flex flex-col bg-surface-base"
          >
            <OrderOverviewScreen
              displayId={displayId}
              status={dbStatus}
              type={order.type}
              cryptoAmount={parseFloat(order.cryptoAmount)}
              fiatAmount={parseFloat(order.fiatAmount)}
              rate={Number(order.merchant?.rate)}
              fiatCode={order.fiatCode}
              paymentMethod={order.merchant?.paymentMethod === "cash" ? "cash" : "bank"}
              createdAt={order.createdAt ? new Date(order.createdAt) : new Date()}
              onClose={() => setShowOverview(false)}
              onCancel={onHelp}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CompletedTile({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${CARD}`}>
      <div className="flex items-center justify-center mb-1">
        <span className="w-7 h-7 rounded-full bg-success/15 flex items-center justify-center">{icon}</span>
      </div>
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className={`text-[13px] font-semibold leading-tight truncate ${valueClass || "text-text-primary"}`}>{value}</p>
      {sub && <p className="text-[10px] text-text-tertiary leading-tight">{sub}</p>}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      <span className={`text-[14px] font-semibold text-right ${valueClass || "text-text-primary"}`}>{value}</span>
    </div>
  );
}
