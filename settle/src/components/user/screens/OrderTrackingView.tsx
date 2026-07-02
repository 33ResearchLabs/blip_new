"use client";

/**
 * OrderTrackingView
 * ─────────────────
 * Thin, status-aware adapter around the shared <WaitingTracker>. Reopened from
 * Activity ("View full receipt"), it maps the order's real DB status onto the
 * shared tracker's inputs — banner copy/icon/tone, the active step in the
 * 7-step timeline, the countdown, whether the escrow card shows, and the
 * summary tiles. All presentation + theme tokens live in WaitingTracker; this
 * file is pure mapping. Financial actions (cancel) are delegated to the parent.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Clock,
  UserSearch,
  Wallet,
  ArrowDownToLine,
  Landmark,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
} from "lucide-react";
import type { Order } from "./types";
import { formatCrypto } from "@/lib/format";
import { OrderOverviewScreen } from "./OrderOverviewScreen";
import { WaitingTracker, TIMELINE, type TrackerBanner, type Tone } from "./WaitingTracker";
import { paymentMethodLabel } from "./helpers";

const TERMINAL = new Set(["cancelled", "expired", "disputed"]);
// Pre-escrow states: nothing is locked, so the user can cancel unilaterally
// and instantly. Once escrow is locked against a matched counterparty there is
// no cancel button — the exit is Appeal (see canCancel below).
const CANCELLABLE = new Set(["pending", "accepted", "escrow_pending"]);
/** Sell-order states where the USER's own USDT is sitting in escrow. */
const USER_ESCROWED = new Set(["escrowed", "payment_pending", "payment_sent", "payment_confirmed", "releasing"]);

/** True once a real merchant is attached (broadcast sell orders start unmatched). */
function merchantMatched(order: Order): boolean {
  const name = order.merchant?.name || "";
  return !!order.merchant?.id && !!name && !/^(open_order_|m2m_)/i.test(name);
}

/** Maps the raw DB status onto the active index in the 7-step timeline. */
function activeStepIndex(type: string, dbStatus: string, matched: boolean): number {
  switch (dbStatus) {
    case "pending": return 1;
    case "accepted":
    case "escrow_pending": return 2;
    case "escrowed":
    case "payment_pending":
      // A locked-but-unmatched sell order is still "matching a merchant".
      return type === "sell" && !matched ? 1 : 3;
    case "payment_sent": return 4;
    case "payment_confirmed":
    case "releasing": return 5;
    case "completed": return TIMELINE.length; // all steps done
    default: return -1; // terminal / unknown — nothing actively pulsing
  }
}

function bannerFor(type: string, dbStatus: string, merchantName: string, matched: boolean): TrackerBanner {
  const waiting: TrackerBanner = {
    title: "Waiting for a merchant",
    sub: "We're matching you with verified merchants.",
    icon: UserSearch,
    tone: "accent",
    live: true,
  };
  switch (dbStatus) {
    case "pending":
      return waiting;
    case "accepted":
    case "escrow_pending":
      return { title: "Merchant matched", sub: `${merchantName || "A merchant"} is securing your funds.`, icon: ShieldCheck, tone: "accent", live: true };
    case "escrowed":
    case "payment_pending":
      if (type === "sell") {
        return matched
          ? { title: "Waiting for payment", sub: `${merchantName || "The buyer"} will send your payment.`, icon: Clock, tone: "accent", live: true }
          : waiting;
      }
      return { title: "Ready to pay", sub: "Funds secured — complete your payment.", icon: Wallet, tone: "accent", live: true };
    case "payment_sent":
      return type === "sell"
        ? { title: "Payment sent", sub: "Confirm once the funds arrive in your account.", icon: Clock, tone: "accent", live: true }
        : { title: "Payment sent", sub: "Waiting for the merchant to confirm.", icon: Clock, tone: "accent", live: true };
    case "payment_confirmed":
    case "releasing":
      return { title: "Releasing USDT", sub: "Your USDT is on the way.", icon: Loader2, tone: "accent", live: true, spin: true };
    case "completed":
      return { title: "Order complete", sub: "USDT released.", icon: CheckCircle2, tone: "success", live: false };
    case "cancelled":
      return { title: "Order cancelled", sub: "This order was cancelled.", icon: XCircle, tone: "error", live: false };
    case "expired":
      // Expiry only happens pre-escrow (a locked order times out to cancelled +
      // refund instead), so nothing was ever charged or locked here.
      return { title: "No merchant available", sub: "No one accepted in time — you weren't charged.", icon: XCircle, tone: "error", live: false };
    case "disputed":
      return { title: "Under review", sub: "Our team is reviewing this order.", icon: AlertCircle, tone: "warning" as Tone, live: false };
    default:
      return { title: "Order in progress", sub: "Tracking your order.", icon: Clock, tone: "accent", live: true };
  }
}

function fiatSymbol(code: string | undefined | null): string {
  switch ((code || "").toUpperCase()) {
    case "INR": return "₹";
    case "USD": return "$";
    case "AED": return "AED ";
    default: return `${(code || "AED").toUpperCase()} `;
  }
}

export interface OrderTrackingViewProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  /** Reuses the parent's cancel handler — no state-machine logic lives here. */
  onCancel: () => void;
  isCancelling: boolean;
  /** Opens the support/help flow — wired to the header help (?) button. */
  onOpenSupport: () => void;
  /** Start a fresh order — shown as the recovery action on the expired state. */
  onRetry?: () => void;
}

export function OrderTrackingView({
  order,
  displayId,
  onClose,
  onCancel,
  isCancelling,
  onOpenSupport,
  onRetry,
}: OrderTrackingViewProps) {
  const [showOverview, setShowOverview] = useState(false);
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const isTerminal = TERMINAL.has(dbStatus);
  const isComplete = dbStatus === "completed";
  const matched = merchantMatched(order);
  const activeIdx = activeStepIndex(order.type, dbStatus, matched);
  const banner = bannerFor(order.type, dbStatus, order.merchant?.name || "", matched);

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

  const createdTime = order.createdAt
    ? new Date(order.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  const typeLabel = order.type === "buy" ? "Buy" : "Sell";
  const sym = fiatSymbol(order.fiatCode);
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const cryptoStr = `${formatCrypto(parseFloat(order.cryptoAmount))}`;
  const fiatCode = (order.fiatCode || "").toUpperCase();
  // BUY (Way-1): the buyer may accept several rails. Show them all (short
  // labels for the compact tile); fall back to the merchant's coarse method.
  const buyerPayTypes = order.type === "buy" ? (order.buyerPaymentTypes || []) : [];
  const methodLabel =
    buyerPayTypes.length > 0
      ? buyerPayTypes.map((t) => (t === "cash" ? "Cash" : t === "upi" ? "UPI" : "Bank")).join(" · ")
      : paymentMethodLabel(order.merchant?.paymentMethod);
  // Cancel is offered while funds are NOT locked (pre-escrow), OR for an
  // UNMATCHED sell offer whose escrow is locked but no merchant has claimed it
  // yet (the seller is alone, so they can withdraw + self-refund). A matched,
  // escrowed order does NOT get a cancel button — the user raises an Appeal.
  const canCancel =
    !order.cancelRequest &&
    (CANCELLABLE.has(dbStatus) || (dbStatus === "escrowed" && !matched));

  // Escrow card only when the USER's own funds are locked (sell orders).
  const showEscrow = order.type === "sell" && USER_ESCROWED.has(dbStatus);
  const escrow = showEscrow
    ? {
        sub: matched
          ? `Your ${cryptoStr} USDT is locked securely in escrow until the trade completes.`
          : `Your ${cryptoStr} USDT is locked securely in escrow.`,
        txHref: null,
      }
    : null;

  const tiles =
    order.type === "buy"
      ? [
          { icon: <Wallet className="w-4 h-4" />, label: "You will pay", value: fiatStr, sub: fiatCode },
          { icon: <ArrowDownToLine className="w-4 h-4" />, label: "You will get", value: cryptoStr, sub: "USDT" },
          { icon: <Landmark className="w-4 h-4" />, label: "Method", value: methodLabel },
        ]
      : [
          { icon: <Wallet className="w-4 h-4" />, label: "You will get", value: fiatStr, sub: fiatCode },
          { icon: <ArrowDownToLine className="w-4 h-4" />, label: "You are selling", value: cryptoStr, sub: "USDT" },
          { icon: <Landmark className="w-4 h-4" />, label: "Method", value: methodLabel },
        ];

  const progressSubtitle =
    activeIdx >= 0 && activeIdx < TIMELINE.length
      ? `${TIMELINE[activeIdx].label}${banner.live ? " · In progress" : ""}`
      : banner.title;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <WaitingTracker
        title={`${typeLabel} ${cryptoStr} USDT`}
        orderRef={`Order #${displayId}`}
        onBack={onClose}
        onOpenSupport={onOpenSupport}
        banner={banner}
        countdown={showTimer ? { remainingSec, totalSec } : null}
        escrow={escrow}
        activeStepIndex={activeIdx}
        createdTime={createdTime}
        progressSubtitle={progressSubtitle}
        tiles={tiles}
        onOpenOverview={() => setShowOverview(true)}
        onCancel={canCancel ? onCancel : undefined}
        isCancelling={isCancelling}
        secondaryAction={
          dbStatus === "expired" && onRetry ? (
            // Expired = no merchant accepted. Offer an honest recovery: start a
            // new order (primary) or step back (secondary). No funds were locked.
            <div className="space-y-2.5">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onRetry}
                className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent"
              >
                Try again
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={onClose}
                className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent"
              >
                Back to order
              </motion.button>
            </div>
          ) : (
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={onClose}
              className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-accent text-accent-text border border-transparent"
            >
              Back to order
            </motion.button>
          )
        }
      />

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
              paymentMethod={order.merchant?.paymentMethod ?? "bank"}
              paymentMethods={buyerPayTypes}
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
