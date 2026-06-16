"use client";

/**
 * OrderTrackingView
 * ─────────────────
 * Full-screen, consumer-friendly order tracker — the rich layout used on the
 * post-order matching screen, reused here as the "View full receipt" view on
 * OrderDetailScreen.
 *
 * Same visual language everywhere (6-step timeline → countdown → summary tiles
 * → tip), but it ADAPTS to the order's real status: the active step, banner
 * copy/icon, the LIVE pill, the countdown visibility and the bottom action all
 * derive from `order.dbStatus`. Pure presentation — financial actions (cancel)
 * are delegated to the parent via callbacks so we never duplicate state-machine
 * logic here.
 */

import { useEffect, useState } from "react";
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
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { Order } from "./types";
import { formatCrypto, formatRate } from "@/lib/format";
import { OrderOverviewScreen } from "./OrderOverviewScreen";

const CARD = "bg-surface-card border border-border-subtle";

interface TimelineStep {
  label: string;
  sub?: string;
}

const TIMELINE: TimelineStep[] = [
  { label: "Order created" },
  { label: "Matching merchant", sub: "Searching for the best match" },
  { label: "Merchant accepted", sub: "Securing your funds in escrow" },
  { label: "Ready to pay", sub: "Send payment to the merchant" },
  { label: "Payment confirmed", sub: "Merchant is confirming your payment" },
  { label: "USDT released" },
];

type StepState = "done" | "active" | "upcoming";
type Tone = "accent" | "success" | "error" | "warning";

const TERMINAL = new Set(["cancelled", "expired", "disputed"]);
const CANCELLABLE = new Set(["pending", "accepted", "escrowed"]);

/** Maps the raw DB status onto the active index in the 6-step timeline. */
function activeStepIndex(dbStatus: string): number {
  switch (dbStatus) {
    case "pending": return 1;
    case "accepted":
    case "escrow_pending": return 2;
    case "escrowed":
    case "payment_pending": return 3;
    case "payment_sent": return 4;
    case "payment_confirmed":
    case "releasing": return 5;
    case "completed": return 6;
    default: return -1; // terminal / unknown — nothing actively pulsing
  }
}

interface Banner {
  title: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  live: boolean;
  spin?: boolean;
}

function bannerFor(dbStatus: string, merchantName: string): Banner {
  switch (dbStatus) {
    case "pending":
      return { title: "Finding the best merchant", sub: "We're matching you with verified merchants.", icon: UserSearch, tone: "accent", live: true };
    case "accepted":
    case "escrow_pending":
      return { title: "Merchant matched", sub: `${merchantName || "A merchant"} is securing your funds.`, icon: ShieldCheck, tone: "accent", live: true };
    case "escrowed":
    case "payment_pending":
      return { title: "Ready to pay", sub: "Funds secured — complete your payment.", icon: Wallet, tone: "accent", live: true };
    case "payment_sent":
      return { title: "Payment sent", sub: "Waiting for the merchant to confirm.", icon: Clock, tone: "accent", live: true };
    case "payment_confirmed":
    case "releasing":
      return { title: "Releasing USDT", sub: "Your USDT is on the way.", icon: Loader2, tone: "accent", live: true, spin: true };
    case "completed":
      return { title: "Order complete", sub: "USDT released to your wallet.", icon: CheckCircle2, tone: "success", live: false };
    case "cancelled":
      return { title: "Order cancelled", sub: "This order was cancelled.", icon: XCircle, tone: "error", live: false };
    case "expired":
      return { title: "Order expired", sub: "No merchant accepted in time.", icon: XCircle, tone: "error", live: false };
    case "disputed":
      return { title: "Under review", sub: "Our team is reviewing this order.", icon: AlertCircle, tone: "warning", live: false };
    default:
      return { title: "Order in progress", sub: "Tracking your order.", icon: Clock, tone: "accent", live: true };
  }
}

const TONE_CLASSES: Record<Tone, { bg: string; text: string }> = {
  accent: { bg: "bg-accent/15", text: "text-accent" },
  success: { bg: "bg-success/15", text: "text-success" },
  error: { bg: "bg-error/15", text: "text-error" },
  warning: { bg: "bg-warning/15", text: "text-warning" },
};

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

export interface OrderTrackingViewProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  /** Reuses the parent's cancel handler — no state-machine logic lives here. */
  onCancel: () => void;
  isCancelling: boolean;
}

export function OrderTrackingView({
  order,
  displayId,
  onClose,
  onCancel,
  isCancelling,
}: OrderTrackingViewProps) {
  const [showOverview, setShowOverview] = useState(false);
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const isTerminal = TERMINAL.has(dbStatus);
  const isComplete = dbStatus === "completed";
  const activeIdx = activeStepIndex(dbStatus);
  const banner = bannerFor(dbStatus, order.merchant?.name || "");
  const tone = TONE_CLASSES[banner.tone];

  // Live countdown — only meaningful while the order is still running.
  const showTimer = !isTerminal && !isComplete && !!order.expiresAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!showTimer) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [showTimer]);

  const expiresMs = order.expiresAt ? new Date(order.expiresAt).getTime() : null;
  const createdMs = order.createdAt ? new Date(order.createdAt).getTime() : null;
  const remainingSec = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : 0;
  const totalSec = expiresMs && createdMs ? Math.max(1, (expiresMs - createdMs) / 1000) : 1;
  const fraction = Math.max(0, Math.min(1, remainingSec / totalSec));
  const isUrgent = remainingSec < 60;

  const createdTime = order.createdAt
    ? new Date(order.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  const typeLabel = order.type === "buy" ? "Buy" : "Sell";
  const sym = fiatSymbol(order.fiatCode);
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const cryptoStr = `${formatCrypto(parseFloat(order.cryptoAmount))}`;
  const canCancel = CANCELLABLE.has(dbStatus) && !order.cancelRequest;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
      <div className="h-[max(env(safe-area-inset-top),1rem)]" />

      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <div className="text-center flex-1 min-w-0">
          <h1 className="text-[17px] font-semibold text-text-primary truncate">
            {typeLabel} {cryptoStr} USDT
          </h1>
          <p className="text-[12px] text-text-tertiary truncate">Order #{displayId}</p>
        </div>
        <button
          onClick={() => setShowOverview(true)}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-raised border border-border-subtle"
          aria-label="Order info"
        >
          <HelpCircle className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      <div className="px-5 pb-10 space-y-4">
        {/* Status banner */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`rounded-2xl p-4 flex items-center gap-3 ${CARD}`}
        >
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 relative ${tone.bg}`}>
            {banner.live && (
              <motion.div
                className={`absolute inset-0 rounded-2xl border-2 ${tone.text} opacity-30`}
                animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            )}
            <banner.icon className={`w-6 h-6 ${tone.text} ${banner.spin ? "animate-spin" : ""}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-semibold text-text-primary">{banner.title}</p>
            <p className="text-[13px] text-text-secondary leading-snug">{banner.sub}</p>
          </div>
          {banner.live && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-success/15 shrink-0">
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-success"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.4, repeat: Infinity }}
              />
              <span className="text-[11px] font-semibold text-success">LIVE</span>
            </div>
          )}
        </motion.div>

        {/* Timeline */}
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
          className={`rounded-2xl p-4 ${CARD}`}
        >
          {TIMELINE.map((step, i) => {
            const state: StepState =
              isComplete || i < activeIdx || i === 0
                ? i === activeIdx
                  ? "active"
                  : "done"
                : i === activeIdx
                  ? "active"
                  : "upcoming";
            const isLast = i === TIMELINE.length - 1;
            return (
              <div key={step.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StepDot state={state} />
                  {!isLast && (
                    <div className={`w-0.5 flex-1 min-h-[18px] ${state === "done" ? "bg-accent" : "bg-border-medium"}`} />
                  )}
                </div>
                <div className={`flex-1 flex items-start justify-between gap-2 ${isLast ? "" : "pb-4"}`}>
                  <div className="min-w-0">
                    <p className={`text-[15px] font-medium ${state === "upcoming" ? "text-text-tertiary" : "text-text-primary"}`}>
                      {step.label}
                    </p>
                    {step.sub && state === "active" && (
                      <p className="text-[13px] text-text-tertiary leading-snug">{step.sub}</p>
                    )}
                  </div>
                  {i === 0 && createdTime && (
                    <span className="text-[13px] text-text-tertiary shrink-0">{createdTime}</span>
                  )}
                  {state === "active" && i !== 0 && (
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
          {showTimer && (
            <div className="p-5 text-center">
              <p className="text-[11px] uppercase tracking-wide mb-2 text-text-tertiary">Time remaining</p>
              <div className="flex items-center justify-center gap-2">
                <Clock className={`w-5 h-5 ${isUrgent ? "text-error" : "text-text-secondary"}`} />
                <p className={`text-[34px] font-bold tracking-tight tabular-nums ${isUrgent ? "text-error" : "text-text-primary"}`}>
                  {fmtCountdown(remainingSec)}
                </p>
              </div>
              <div className="w-full h-1.5 rounded-full mt-3 overflow-hidden bg-surface-active">
                <motion.div
                  className={`h-full rounded-full ${isUrgent ? "bg-error" : "bg-accent"}`}
                  animate={{ width: `${fraction * 100}%` }}
                  transition={{ duration: 0.5 }}
                />
              </div>
              <p className={`text-[13px] mt-3 ${isUrgent ? "text-error" : "text-text-tertiary"}`}>
                {dbStatus === "pending"
                  ? isUrgent ? "Order will expire soon!" : "Most orders are matched within 1 minute."
                  : isUrgent ? "Complete this step soon!" : "Keep this order moving to avoid timeout."}
              </p>
            </div>
          )}

          <button
            onClick={() => setShowOverview(true)}
            className={`w-full flex items-center gap-3 px-5 py-4 text-left active:bg-surface-hover ${showTimer ? "border-t border-border-subtle" : ""}`}
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
          <SummaryTile icon={<Wallet className="w-4 h-4" />} label={order.type === "buy" ? "You pay" : "You sell"} value={order.type === "buy" ? fiatStr : `${cryptoStr}`} sub={order.type === "buy" ? undefined : "USDT"} />
          <SummaryTile icon={<ArrowDownToLine className="w-4 h-4" />} label="You get" value={order.type === "buy" ? `${cryptoStr}` : fiatStr} sub={order.type === "buy" ? "USDT" : undefined} />
          <SummaryTile icon={<Tag className="w-4 h-4" />} label="Rate" value={`${sym}${formatRate(order.merchant?.rate)}`} />
          <SummaryTile icon={<Landmark className="w-4 h-4" />} label="Method" value={order.merchant?.paymentMethod === "cash" ? "Cash" : "Bank"} />
        </motion.div>

        {/* Tip */}
        <div className="rounded-2xl p-4 flex gap-3 bg-warning-dim border border-warning-border">
          <Lightbulb className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary mb-0.5">Order tip</p>
            <p className="text-[13px] text-text-secondary leading-snug">
              {dbStatus === "pending"
                ? "A verified merchant will be assigned automatically. You'll receive an instant notification once a merchant accepts your order."
                : "Keep this screen handy — it updates automatically as your order progresses. You'll be notified at every step."}
            </p>
          </div>
        </div>

        {/* Bottom action */}
        {canCancel ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={isCancelling}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-error-dim text-error border border-error-border disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCancelling && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel Order
          </motion.button>
        ) : (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onClose}
            className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-surface-active text-text-primary border border-border-subtle"
          >
            Back to order
          </motion.button>
        )}
      </div>
      </div>

      {/* Itemised overview — slides in over the tracker */}
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
              onCancel={onCancel}
              isCancelling={isCancelling}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
