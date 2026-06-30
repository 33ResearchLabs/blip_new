"use client";

/**
 * SellPaymentTracker
 * ──────────────────
 * Seller-side primary screen for a SELL order once a merchant is MATCHED and we
 * are waiting for the buyer to pay (escrowed / payment_pending) or the buyer
 * has marked payment sent (payment_sent). Same tracker visual language as
 * <WaitingTracker> (the unmatched "Waiting for a merchant" screen), but tuned
 * for the matched state: "Merchant accepted" banner, escrow cards, a
 * "What happens next?" explainer, the merchant card, and the seller's
 * release action.
 *
 * MONEY SAFETY: "I have received the payment" (→ onConfirmReceived /
 * confirmFiatReceived) releases the seller's USDT. It is enabled ONLY once the
 * buyer has marked payment sent (dbStatus === 'payment_sent'); before that the
 * action is disabled and shows "Waiting for buyer to pay". The backend state
 * machine also rejects CONFIRM_PAYMENT before payment_sent — this is the UI
 * belt to that braces.
 *
 * Pure presentation + theme tokens (no hardcoded hex). Financial actions are
 * delegated to the parent (OrderDetailScreen) via callbacks.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  ShieldCheck,
  Lock,
  Clock,
  CheckCircle2,
  CreditCard,
  Bell,
  Store,
  MessageCircle,
  FileText,
  Wallet,
  ArrowDownToLine,
  Landmark,
  Loader2,
  ExternalLink,
  Star,
  AlertTriangle,
} from "lucide-react";
import type { Order } from "./types";
import { formatCrypto } from "@/lib/format";
import { explorerUrl } from "@/lib/solana/networkLabel";
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

function fmtCountdown(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export interface SellPaymentTrackerProps {
  order: Order;
  displayId: string;
  onBack: () => void;
  onOpenSupport: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  /** confirmFiatReceived — releases the USDT. Only fired when payment_sent. */
  onConfirmReceived: () => void;
  onRaiseAppeal: () => void;
  isConfirming: boolean;
  /** Active-appeal banner (rendered at the top of the content when an appeal is live). */
  appealBanner?: React.ReactNode;
  /** When an appeal is already open/proposed, hide the "Raise Appeal" entries. */
  appealActive?: boolean;
}

export function SellPaymentTracker({
  order,
  displayId,
  onBack,
  onOpenSupport,
  onOpenChat,
  onViewProfile,
  onConfirmReceived,
  onRaiseAppeal,
  isConfirming,
  appealBanner,
  appealActive,
}: SellPaymentTrackerProps) {
  const [showOverview, setShowOverview] = useState(false);
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const isPaymentSent = dbStatus === "payment_sent";

  // Live countdown from the order's expiry.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
  const remainingSec = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : 0;
  const isUrgent = !!expiresMs && remainingSec < 60;

  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const fiatCode = (order.fiatCode || "").toUpperCase();
  const methodLabel = order.merchant?.paymentMethod === "cash" ? "Cash" : "Bank Transfer";
  const txHref = order.escrowTxHash ? explorerUrl("tx", order.escrowTxHash) : null;

  const merchantName = order.merchant?.name || "Merchant";
  const merchantRating = order.merchant?.rating;
  const merchantOnline = order.merchant?.isOnline;

  // Banner adapts: matched-and-waiting vs buyer-marked-paid.
  const banner = isPaymentSent
    ? {
        title: "Payment marked as sent",
        sub: "Verify the funds landed in your account, then release the USDT.",
        icon: Clock,
        bg: "bg-border-subtle",
        fg: "text-text-secondary",
      }
    : {
        title: "Merchant accepted your order!",
        sub: "Your order has been accepted by the merchant. Please wait for the buyer to complete the payment.",
        icon: ShieldCheck,
        bg: "bg-border-subtle",
        fg: "text-text-secondary",
      };

  const nextSteps = [
    {
      icon: CreditCard,
      title: "Buyer makes payment",
      sub: "The buyer completes the payment using your provided account details.",
      active: !isPaymentSent,
    },
    {
      icon: Bell,
      title: "You'll be notified",
      sub: "You'll get an instant notification once the buyer marks the payment as done.",
      active: isPaymentSent,
    },
    {
      icon: CheckCircle2,
      title: "Verify & release",
      sub: "Verify the payment in your account, then release the USDT to the buyer.",
      active: false,
    },
  ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="h-[max(env(safe-area-inset-top),1rem)]" />

        {/* Header */}
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
            aria-label="Back"
          >
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </button>
          <div className="text-center flex-1 min-w-0">
            <h1 className="text-[17px] font-semibold text-text-primary truncate">Sell {cryptoStr} USDT</h1>
            <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
          </div>
          <button
            onClick={onOpenSupport}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
            aria-label="Help & support"
          >
            <HelpCircle className="w-5 h-5 text-text-secondary" />
          </button>
        </div>

        <div className="px-5 pb-10 space-y-4">
          {/* Active-appeal banner — shown when an appeal is open/proposed. */}
          {appealBanner}

          {/* Status banner */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative ${banner.bg}`}>
              <motion.div
                className={`absolute inset-0 rounded-2xl border-2 ${banner.fg} opacity-30`}
                animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
              <banner.icon className={`w-6 h-6 ${banner.fg}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">{banner.title}</p>
              <p className="text-[13px] text-text-secondary leading-snug">{banner.sub}</p>
            </div>
            <div className="flex flex-col items-end gap-1.5 shrink-0">
              {expiresMs && (
                <div className={`flex items-center gap-1 text-[15px] font-bold tabular-nums ${isUrgent ? "text-error" : "text-text-primary"}`}>
                  <Clock className="w-3.5 h-3.5" />
                  {fmtCountdown(remainingSec)}
                </div>
              )}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15">
                <motion.span
                  className="w-1.5 h-1.5 rounded-full bg-success"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
                <span className="text-[11px] font-semibold text-success">LIVE</span>
              </div>
            </div>
          </motion.div>

          {/* Escrow locked card */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.03 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-border-subtle">
              <ShieldCheck className="w-6 h-6 text-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">Escrow locked</p>
              <p className="text-[13px] text-text-secondary leading-snug">
                Your {cryptoStr} USDT is locked securely in escrow. You will receive the payment once the buyer pays.
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-border-subtle shrink-0 self-start">
              <Lock className="w-3 h-3 text-text-secondary" />
              <span className="text-[11px] font-semibold text-text-secondary">SECURED</span>
            </div>
          </motion.div>

          {/* Escrow details — on-chain proof */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.05 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-border-subtle">
              <ShieldCheck className="w-6 h-6 text-text-secondary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">Escrow details</p>
              <p className="text-[13px] text-text-secondary leading-snug">
                {cryptoStr} USDT has been locked securely into escrow.
              </p>
            </div>
            {txHref && (
              <a
                href={txHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[13px] font-semibold text-text-secondary shrink-0 self-start"
              >
                View details <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </motion.div>

          {/* What happens next? */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.08 }}
            className={`rounded-2xl p-4 ${CARD}`}
          >
            <p className="text-[15px] font-semibold text-text-primary mb-3">What happens next?</p>
            {nextSteps.map((step, i) => {
              const isLast = i === nextSteps.length - 1;
              return (
                <div key={step.title} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                        step.active ? "bg-accent" : "bg-surface-active"
                      }`}
                    >
                      <step.icon className={`w-4 h-4 ${step.active ? "text-accent-text" : "text-text-tertiary"}`} />
                    </div>
                    {!isLast && <div className="w-0.5 flex-1 min-h-[14px] bg-border-medium" />}
                  </div>
                  <div className={`flex-1 min-w-0 ${isLast ? "" : "pb-4"}`}>
                    <p className="text-[14px] font-medium text-text-primary">{step.title}</p>
                    <p className="text-[13px] text-text-tertiary leading-snug">{step.sub}</p>
                  </div>
                </div>
              );
            })}
          </motion.div>

          {/* Merchant card */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1 }}
            className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
          >
            <button onClick={onViewProfile} className="flex items-center gap-3 flex-1 min-w-0 text-left">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-border-subtle relative">
                <Store className="w-5 h-5 text-text-secondary" />
                {merchantOnline && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent border-2 border-surface-card" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-[15px] font-semibold text-text-primary truncate">{merchantName}</p>
                  {typeof merchantRating === "number" && merchantRating > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-[13px] text-text-secondary shrink-0">
                      <Star className="w-3.5 h-3.5 text-warning fill-warning" />
                      {merchantRating.toFixed(1)}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-text-tertiary truncate">
                  Verified merchant{merchantOnline ? " · Online" : ""}
                </p>
              </div>
            </button>
            <button
              onClick={onOpenChat}
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-surface-active border border-border-subtle"
              aria-label="Message merchant"
            >
              <MessageCircle className="w-5 h-5 text-text-secondary" />
            </button>
          </motion.div>

          {/* Order Overview row */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.12 }}
            className={`rounded-2xl overflow-hidden ${CARD}`}
          >
            <button
              onClick={() => setShowOverview(true)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left active:bg-surface-hover"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-border-subtle">
                <FileText className="w-5 h-5 text-text-secondary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-text-primary">Order Overview</p>
                <p className="text-[13px] text-text-tertiary">View order details</p>
              </div>
              <ChevronRight className="w-5 h-5 text-text-tertiary shrink-0" />
            </button>
          </motion.div>

          {/* Summary tiles */}
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.14 }}
            className="grid grid-cols-3 gap-2"
          >
            <SummaryTile icon={<Wallet className="w-4 h-4" />} label="You will get" value={fiatStr} sub={fiatCode} />
            <SummaryTile icon={<ArrowDownToLine className="w-4 h-4" />} label="You are selling" value={cryptoStr} sub="USDT" />
            <SummaryTile icon={<Landmark className="w-4 h-4" />} label="Method" value={methodLabel} />
          </motion.div>

          {/* Bottom actions */}
          {isPaymentSent ? (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onConfirmReceived}
              disabled={isConfirming}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isConfirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {isConfirming ? "Releasing…" : "I have received the payment"}
            </motion.button>
          ) : (
            <button
              disabled
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-surface-active text-text-tertiary border border-border-subtle flex items-center justify-center gap-2 cursor-default"
            >
              <Clock className="w-4 h-4" />
              Waiting for buyer to pay
            </button>
          )}

          {/* Hidden once an appeal is active — the banner above carries the
              resolution actions, and a second appeal can't be raised. */}
          {!appealActive && (
            <button
              onClick={onRaiseAppeal}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-warning-dim text-warning border border-warning-border flex items-center justify-center gap-2"
            >
              <AlertTriangle className="w-4 h-4" />
              Raise Appeal
            </button>
          )}
        </div>
      </div>

      {/* Itemised overview — in-place overlay (no cross-screen nav). */}
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
              onCancel={onRaiseAppeal}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-xl p-2.5 text-center ${CARD}`}>
      <div className="flex items-center justify-center text-text-tertiary mb-1">{icon}</div>
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-text-primary leading-tight truncate">{value}</p>
      {sub && <p className="text-[10px] text-text-tertiary leading-tight">{sub}</p>}
    </div>
  );
}
