"use client";

/**
 * OrderCompletedScreen
 * ────────────────────
 * Completion / receipt + rating view for a finished BUY order. Replaces the
 * step layout on OrderDetailScreen once the order is `completed`.
 *
 * Pure presentation — the rating submission reuses OrderDetailScreen's existing
 * `submitReview` handler and `rating`/`reviewText` state via callbacks.
 */

import { motion } from "framer-motion";
import {
  ChevronLeft,
  HelpCircle,
  Check,
  CheckCircle2,
  Sparkles,
  Clock,
  Star,
  ChevronRight,
  FileText,
  Lightbulb,
  Bot,
} from "lucide-react";
import type { Order } from "./types";
import { formatCrypto, formatRate, formatCount } from "@/lib/format";

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

export interface OrderCompletedScreenProps {
  order: Order;
  displayId: string;
  rating: number;
  reviewText: string;
  onRate: (n: number) => void;
  onReviewTextChange: (s: string) => void;
  onSubmitReview: () => void;
  onViewProfile: () => void;
  onViewOverview: () => void;
  onHelp: () => void;
  onBackHome: () => void;
}

export function OrderCompletedScreen({
  order,
  displayId,
  rating,
  reviewText,
  onRate,
  onReviewTextChange,
  onSubmitReview,
  onViewProfile,
  onViewOverview,
  onHelp,
  onBackHome,
}: OrderCompletedScreenProps) {
  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = `${formatCrypto(parseFloat(order.cryptoAmount))}`;
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const completedStr = order.completedAt ? fmtDateTime(order.completedAt) : "—";
  const alreadyRated = order.userRating != null;
  const displayRating = alreadyRated ? order.userRating! : rating;

  return (
    <div className="bg-surface-base flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),1rem)]" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button onClick={onBackHome} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle" aria-label="Back">
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">Order Completed</h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <button onClick={onHelp} className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle" aria-label="Help">
          <HelpCircle className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Hero */}
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="rounded-2xl p-6 text-center bg-surface-active border border-border-medium"
        >
          <div className="relative inline-flex items-center justify-center mb-4">
            <Sparkles className="w-4 h-4 text-text-tertiary absolute -left-5 -top-1" />
            <Sparkles className="w-3 h-3 text-text-tertiary absolute -right-5 top-1" />
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 12, stiffness: 200, delay: 0.1 }}
              className="w-16 h-16 rounded-full bg-text-primary flex items-center justify-center"
            >
              <Check className="w-8 h-8 text-surface-base" strokeWidth={3} />
            </motion.div>
          </div>
          <p className="text-[24px] font-bold text-text-primary mb-1">{cryptoStr} USDT Released</p>
          <p className="text-[14px] text-text-secondary leading-snug px-2">
            The seller has confirmed the payment and the crypto has been released to you.
          </p>
          <div className="mt-4 pt-4 border-t border-border-medium flex items-center justify-center gap-2 text-[13px] text-text-secondary">
            <Clock className="w-4 h-4 text-text-secondary" />
            Completed at {completedStr.replace(",", " •")}
          </div>
        </motion.div>

        {/* Order Details */}
        <div className={`rounded-2xl ${CARD}`}>
          <div className="flex items-center gap-2 px-4 pt-4 pb-1">
            <div className="w-7 h-7 rounded-lg bg-border-subtle flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-text-secondary" />
            </div>
            <p className="text-[15px] font-semibold text-text-primary">Order Details</p>
          </div>
          <div className="divide-y divide-border-subtle px-4">
            <Row label="You Paid" value={fiatStr} />
            <Row label="You Received" value={`${cryptoStr} USDT`} />
            <Row label="Rate" value={`${sym}${formatRate(order.merchant.rate)}`} />
            <Row label="Payment Method" value={order.merchant.paymentMethod === "cash" ? "Cash" : "Bank Transfer"} />
            <Row label="Completed" value={completedStr} />
          </div>
        </div>

        {/* Merchant */}
        <div className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}>
          <div className="relative shrink-0">
            <div className="w-12 h-12 rounded-full overflow-hidden bg-border-subtle flex items-center justify-center">
              {order.merchant.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={order.merchant.avatarUrl} alt={order.merchant.name} className="w-full h-full object-cover" />
              ) : (
                <Bot className="w-6 h-6 text-text-secondary" />
              )}
            </div>
            {order.merchant.isOnline && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-surface-card" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[15px] font-semibold text-text-primary truncate">{order.merchant.name}</p>
              {order.merchant.rating > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-text-secondary shrink-0">
                  <Star className="w-3.5 h-3.5 text-text-secondary fill-text-secondary" />
                  <Star className="w-3.5 h-3.5 text-text-secondary fill-text-secondary" />
                  {formatCrypto(order.merchant.rating, { decimals: 1 })}
                </span>
              )}
            </div>
            <p className="text-[12px] text-text-tertiary">
              {order.merchant.trades > 0 ? `${formatCount(order.merchant.trades)} trades` : "New merchant"}
              {order.merchant.isOnline ? " · Online" : ""}
            </p>
          </div>
          <button
            onClick={onViewProfile}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-2 rounded-xl text-[13px] font-semibold bg-surface-active text-text-primary border border-border-subtle"
          >
            View Profile
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>
        </div>

        {/* Rating */}
        <div className={`rounded-2xl p-4 ${CARD}`}>
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-surface-active flex items-center justify-center shrink-0">
              <Star className="w-5 h-5 text-text-secondary" />
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold text-text-primary">How was your trading experience?</p>
              <p className="text-[13px] text-text-tertiary">Your feedback helps us improve Blip P2P</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3 mt-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                disabled={alreadyRated}
                onClick={() => onRate(star)}
                className="disabled:cursor-default"
                aria-label={`Rate ${star} star${star === 1 ? "" : "s"}`}
              >
                <Star
                  className={`w-9 h-9 ${star <= displayRating ? "text-text-secondary fill-text-secondary" : "text-border-medium"}`}
                  className={`w-9 h-9 ${star <= displayRating ? "text-text-secondary fill-text-secondary" : "text-border-medium"}`}
                />
              </button>
            ))}
          </div>

          {alreadyRated ? (
            <p className="text-[12px] text-text-tertiary text-center mt-3">
              You rated this trade {order.userRating} star{order.userRating === 1 ? "" : "s"}.
            </p>
          ) : (
            <>
              <textarea
                placeholder="Leave optional feedback…"
                value={reviewText}
                onChange={(e) => onReviewTextChange(e.target.value)}
                maxLength={200}
                rows={2}
                className="w-full mt-4 p-3 rounded-xl text-[13px] text-text-primary bg-surface-active border border-border-medium resize-none outline-none placeholder:text-text-quaternary"
              />
              {/* Explicit submit so the rating + feedback are sent on tap (with a
                  success toast), not silently on "Back to Home". */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="button"
                disabled={displayRating < 1}
                onClick={onSubmitReview}
                className="w-full mt-3 py-3 rounded-xl text-[14px] font-semibold bg-text-primary text-surface-base disabled:opacity-40 disabled:cursor-default"
              >
                Submit Rating
              </motion.button>
            </>
          )}
        </div>

        {/* Tip */}
        <div className="rounded-2xl p-4 flex gap-3 bg-surface-active border border-border-subtle">
          <Lightbulb className="w-5 h-5 text-text-secondary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">Tip</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              Your reputation increases when orders are completed successfully.
            </p>
          </div>
        </div>

        {/* Order Overview — opens the full order detail view. Mirrors the
            card on the matching/tracking/payment screens. */}
        <div className={`rounded-2xl overflow-hidden ${CARD}`}>
          <button
            onClick={onViewOverview}
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
        </div>

        {/* Back to home */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={onBackHome}
          className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-text-primary text-surface-base"
        >
          Back to Home
        </motion.button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-[14px] text-text-secondary shrink-0">{label}</span>
      <span className="text-[14px] font-semibold text-text-primary text-right">{value}</span>
    </div>
  );
}
