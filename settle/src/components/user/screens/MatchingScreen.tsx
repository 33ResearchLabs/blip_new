"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  HelpCircle,
  UserSearch,
  FileText,
  Lightbulb,
  Wallet,
  ArrowDownToLine,
  Tag,
  Landmark,
} from "lucide-react";
import { useState } from "react";
import type { Screen, OrderStatus, OrderStep } from "./types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { orderActionKey } from '@/lib/api/idempotencyKeys';
import { formatCrypto, formatFiat, formatRate } from '@/lib/format';
import { getDisplayOrderId } from '@/lib/displayOrderId';
import { OrderOverviewScreen } from './OrderOverviewScreen';

const CARD = "bg-surface-card border border-border-subtle";

// Total matching window (mirrors the 15-min default expiry on order creation).
const MATCHING_WINDOW_SECONDS = 15 * 60;

type StepState = "done" | "active" | "upcoming";

interface TimelineStep {
  label: string;
  sub?: string;
}

// The full buyer journey. During matching the screen sits at step 2 ("Matching
// merchant"); later steps render as upcoming. This is the VISUAL timeline only —
// once a merchant accepts, the parent hands off to OrderDetailScreen which owns
// the live payment flow.
const TIMELINE: TimelineStep[] = [
  { label: "Order created" },
  { label: "Matching merchant", sub: "Searching for the best match" },
  { label: "Merchant accepted" },
  { label: "Ready to pay" },
  { label: "Payment confirmed" },
  { label: "USDT released" },
];

// The matching screen is always at the "Matching merchant" step.
const ACTIVE_STEP_INDEX = 1;

export interface MatchingScreenProps {
  setScreen: (s: Screen) => void;
  pendingTradeData: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash" };
  matchingTimeLeft: number;
  formatTimeLeft: (s: number) => string;
  currentRate: number;
  /** Fiat currency for the active corridor — drives the ₹ / AED symbols. */
  currency: "INR" | "AED";
  activeOrderId: string | null;
  userId: string | null;
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
  setPendingTradeData: (d: any) => void;
  toast: any;
  maxW: string;
}

export const MatchingScreen = ({
  setScreen,
  pendingTradeData,
  matchingTimeLeft,
  formatTimeLeft,
  currentRate,
  currency,
  activeOrderId,
  userId,
  setOrders,
  setPendingTradeData,
  toast,
}: MatchingScreenProps) => {
  // Capture creation time once on mount — used for the "Order created" timestamp
  // and the BM-YYMMDD display reference.
  const [createdAt] = useState(() => new Date());
  const [showOverview, setShowOverview] = useState(false);
  const displayId = getDisplayOrderId(activeOrderId, createdAt);
  const createdTime = createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const isUrgent = matchingTimeLeft < 60;
  const fiatSymbol = currency === "INR" ? "₹" : "AED ";
  const typeLabel = pendingTradeData.type === "buy" ? "Buy" : "Sell";

  async function handleCancel() {
    if (activeOrderId && userId) {
      try {
        // CANCEL action — backend resolves the target status. Financial
        // transitions require an Idempotency-Key per CLAUDE.md.
        const res = await fetchWithAuth(`/api/orders/${activeOrderId}/action`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': orderActionKey(activeOrderId, 'CANCEL'),
          },
          body: JSON.stringify({
            action: 'CANCEL',
            actor_type: 'user',
            actor_id: userId,
            reason: 'User cancelled order',
          }),
        });
        const data = await res.json();
        if (res.ok && data.success) {
          setOrders((prev: any[]) => prev.filter((o: any) => o.id !== activeOrderId));
          toast.showOrderCancelled('You cancelled the order');
        } else {
          console.error('Failed to cancel order:', data.error);
          toast.showWarning(data.error || 'Failed to cancel order');
        }
      } catch (err) {
        console.error('Failed to cancel order:', err);
        toast.showWarning('Failed to cancel order');
      }
    }
    setPendingTradeData(null);
    setScreen("home");
  }

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),1rem)]" />

      {/* Header — title + branded order reference */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">
            {typeLabel} {formatCrypto(pendingTradeData.amount)} USDT
          </h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <button
          onClick={() => setScreen("home")}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Help"
        >
          <HelpCircle className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Finding the best merchant — live banner */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
        >
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-accent/15 relative">
            <motion.div
              className="absolute inset-0 rounded-2xl border-2 border-accent/40"
              animate={{ scale: [1, 1.18, 1], opacity: [0.6, 0, 0.6] }}
              transition={{ duration: 2, repeat: Infinity }}
            />
            <UserSearch className="w-6 h-6 text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-text-primary">Finding the best merchant</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              We&apos;re matching you with verified merchants.
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15 shrink-0">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-success"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.4, repeat: Infinity }}
            />
            <span className="text-[11px] font-semibold text-success">LIVE</span>
          </div>
        </motion.div>

        {/* Status timeline — full buyer journey */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
          className={`rounded-2xl p-4 ${CARD}`}
        >
          {TIMELINE.map((step, i) => {
            const state: StepState =
              i < ACTIVE_STEP_INDEX ? "done" : i === ACTIVE_STEP_INDEX ? "active" : "upcoming";
            const isLast = i === TIMELINE.length - 1;
            return (
              <div key={step.label} className="flex gap-3">
                {/* Left rail: dot + connector */}
                <div className="flex flex-col items-center">
                  <StepDot state={state} />
                  {!isLast && (
                    <div
                      className={`w-0.5 flex-1 min-h-[18px] ${
                        state === "done" ? "bg-accent" : "bg-border-medium"
                      }`}
                    />
                  )}
                </div>
                {/* Content */}
                <div className={`flex-1 flex items-start justify-between gap-2 ${isLast ? "" : "pb-4"}`}>
                  <div className="min-w-0">
                    <p
                      className={`text-[15px] font-medium ${
                        state === "upcoming" ? "text-text-tertiary" : "text-text-primary"
                      }`}
                    >
                      {step.label}
                    </p>
                    {step.sub && state === "active" && (
                      <p className="text-[13px] text-text-tertiary leading-snug">{step.sub}</p>
                    )}
                  </div>
                  {state === "done" && i === 0 && (
                    <span className="text-[13px] text-text-tertiary shrink-0">{createdTime}</span>
                  )}
                  {state === "active" && (
                    <span className="text-[13px] font-medium text-accent shrink-0">In progress</span>
                  )}
                </div>
              </div>
            );
          })}
        </motion.div>

        {/* Time remaining + order overview */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className={`rounded-2xl overflow-hidden ${CARD}`}
        >
          <div className="p-5 text-center">
            <p className="text-[11px] uppercase tracking-wide mb-2 text-text-tertiary">Time remaining</p>
            <div className="flex items-center justify-center gap-2">
              <Clock className={`w-5 h-5 ${isUrgent ? "text-error" : "text-text-secondary"}`} />
              <p
                className={`text-[34px] font-bold tracking-tight tabular-nums ${
                  isUrgent ? "text-error" : "text-text-primary"
                }`}
              >
                {formatTimeLeft(matchingTimeLeft)}
              </p>
            </div>
            <div className="w-full h-1.5 rounded-full mt-3 overflow-hidden bg-surface-active">
              <motion.div
                className={`h-full rounded-full ${isUrgent ? "bg-error" : "bg-accent"}`}
                initial={{ width: "100%" }}
                animate={{ width: `${Math.max(0, (matchingTimeLeft / MATCHING_WINDOW_SECONDS) * 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className={`text-[13px] mt-3 ${isUrgent ? "text-error" : "text-text-tertiary"}`}>
              {isUrgent ? "Order will expire soon!" : "Most orders are matched within 1 minute."}
            </p>
          </div>

          {/* Order Overview — opens the full order detail view */}
          <button
            onClick={() => setShowOverview(true)}
            className="w-full flex items-center gap-3 px-5 py-4 border-t border-border-subtle text-left active:bg-surface-hover"
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
        </motion.div>

        {/* Summary tiles */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="grid grid-cols-4 gap-2"
        >
          <SummaryTile icon={<Wallet className="w-4 h-4" />} label="You pay" value={`${fiatSymbol}${formatFiat(pendingTradeData.fiatAmount)}`} />
          <SummaryTile icon={<ArrowDownToLine className="w-4 h-4" />} label="You get" value={`${formatCrypto(pendingTradeData.amount)}`} sub="USDT" />
          <SummaryTile icon={<Tag className="w-4 h-4" />} label="Rate" value={`${fiatSymbol}${formatRate(currentRate)}`} />
          <SummaryTile icon={<Landmark className="w-4 h-4" />} label="Method" value={pendingTradeData.paymentMethod === "bank" ? "Bank" : "Cash"} />
        </motion.div>

        {/* Order tip */}
        <div className="rounded-2xl p-4 flex gap-3 bg-warning-dim border border-warning-border">
          <Lightbulb className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">Order tip</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              A verified merchant will be assigned automatically. You&apos;ll receive an instant
              notification once a merchant accepts your order.
            </p>
          </div>
        </div>

        {/* Cancel */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handleCancel}
          className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-error-dim text-error border border-error-border"
        >
          Cancel Order
        </motion.button>

        {/* Dev convenience — simulate a merchant accepting (kept from prior flow). */}
        {activeOrderId && (
          <button
            onClick={() => {
              setOrders((prev: any[]) => prev.map((o: any) =>
                o.id === activeOrderId ? { ...o, status: "payment" as OrderStatus, step: 2 as OrderStep } : o
              ));
              setPendingTradeData(null);
              setScreen("order");
            }}
            className="w-full py-2 text-[12px] font-medium text-text-tertiary"
          >
            Demo: simulate merchant accept
          </button>
        )}
      </div>
      </div>

      {/* Itemised order overview — slides in over the matching screen */}
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
              status="pending"
              type={pendingTradeData.type}
              cryptoAmount={parseFloat(pendingTradeData.amount)}
              fiatAmount={parseFloat(pendingTradeData.fiatAmount)}
              rate={currentRate}
              fiatCode={currency}
              paymentMethod={pendingTradeData.paymentMethod}
              createdAt={createdAt}
              onClose={() => setShowOverview(false)}
              onCancel={handleCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center shrink-0">
        <Check className="w-3.5 h-3.5 text-accent-text" strokeWidth={3} />
      </div>
    );
  }
  if (state === "active") {
    return (
      <motion.div
        className="w-6 h-6 rounded-full bg-accent shrink-0"
        animate={{ scale: [1, 1.15, 1], opacity: [1, 0.8, 1] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }
  return <div className="w-6 h-6 rounded-full border-2 border-border-medium bg-transparent shrink-0" />;
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
