"use client";

import { motion, AnimatePresence } from "framer-motion";
import { UserSearch, Wallet, ArrowDownToLine, Landmark, Check } from "lucide-react";
import { useState } from "react";
import type { Screen, Order } from "./types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { orderActionKey } from '@/lib/api/idempotencyKeys';
import { formatCrypto } from '@/lib/format';
import { getDisplayOrderId } from '@/lib/displayOrderId';
import { OrderOverviewScreen } from './OrderOverviewScreen';
import { WaitingTracker, type TrackerBanner } from './WaitingTracker';
import { useCancelOrderSheet } from '@/hooks/useCancelOrderSheet';

// Total matching window (mirrors the 15-min default expiry on order creation).
const MATCHING_WINDOW_SECONDS = 15 * 60;

export interface MatchingScreenProps {
  setScreen: (s: Screen) => void;
  pendingTradeData: { amount: string; fiatAmount: string; type: "buy" | "sell"; paymentMethod: "bank" | "cash"; paymentTypes?: string[] };
  matchingTimeLeft: number;
  formatTimeLeft: (s: number) => string;
  currentRate: number;
  /** Fiat currency for the active corridor — drives the ₹ / AED symbols. */
  currency: "INR" | "AED";
  activeOrderId: string | null;
  /** Live status of the active order — drives the Order Overview badge so it
   *  reflects cancelled/accepted/etc. instead of being frozen at "pending". */
  orderStatus?: string;
  userId: string | null;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  setActiveOrderId: (id: string | null) => void;
  setPendingTradeData: React.Dispatch<
    React.SetStateAction<{
      amount: string;
      fiatAmount: string;
      type: "buy" | "sell";
      paymentMethod: "bank" | "cash";
      paymentTypes?: string[];
    } | null>
  >;
  toast: { showOrderCancelled: (m: string) => void; showWarning?: (m: string) => void };
  maxW: string;
  /** When set, a merchant just accepted — show the brief matched celebration. */
  matched?: { merchantName?: string } | null;
}

export const MatchingScreen = ({
  setScreen,
  pendingTradeData,
  matchingTimeLeft,
  currentRate,
  currency,
  activeOrderId,
  orderStatus,
  userId,
  setOrders,
  setActiveOrderId,
  setPendingTradeData,
  toast,
  matched,
}: MatchingScreenProps) => {
  // Capture creation time once on mount — used for the "Order created" timestamp
  // and the BM-YYMMDD display reference.
  const [createdAt] = useState(() => new Date());
  const [showOverview, setShowOverview] = useState(false);
  const cancel = useCancelOrderSheet();
  const displayId = getDisplayOrderId(activeOrderId, createdAt);
  const createdTime = createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  const fiatSymbol = currency === "INR" ? "₹" : "AED ";
  const typeLabel = pendingTradeData.type === "buy" ? "Buy" : "Sell";
  const isBuy = pendingTradeData.type === "buy";
  const fiatStr = `${fiatSymbol}${formatCrypto(parseFloat(pendingTradeData.fiatAmount))}`;
  const cryptoStr = `${formatCrypto(parseFloat(pendingTradeData.amount))}`;
  // BUY (Way-1): the buyer may accept several rails. Show them all (short
  // labels for the compact tile); fall back to the single coarse method.
  const payTypes = isBuy ? (pendingTradeData.paymentTypes || []) : [];
  const methodLabel =
    payTypes.length > 0
      ? payTypes.map((t) => (t === "cash" ? "Cash" : t === "upi" ? "UPI" : "Bank")).join(" · ")
      : pendingTradeData.paymentMethod === "cash" ? "Cash" : "Bank Transfer";

  // The CANCEL itself. Unchanged backend contract (CANCEL action + per-order
  // Idempotency-Key). Throws on failure so CancelOrderSheet keeps itself open
  // and shows an inline error instead of navigating away on a failed cancel.
  async function doCancel() {
    if (!activeOrderId || !userId) return; // nothing persisted yet — just leave
    // Abort a hung request so the sheet never sits on an infinite spinner —
    // the timeout surfaces the same inline error path as any other failure.
    // The fixed per-order Idempotency-Key keeps a later retry safe on the backend.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18_000);
    let res: Response;
    try {
      res = await fetchWithAuth(`/api/orders/${activeOrderId}/action`, {
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
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error("This is taking longer than expected. Your order is unchanged — please try again.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      console.error('Failed to cancel order:', data.error);
      throw new Error(data.error || 'Failed to cancel order');
    }
    // Mark the order cancelled (not just filter it out) so a poll/refetch
    // can't re-add it looking active.
    setOrders((prev) =>
      prev.map((o) =>
        o.id === activeOrderId
          ? { ...o, status: "cancelled" as const, dbStatus: "cancelled" }
          : o,
      ),
    );
    toast.showOrderCancelled('You cancelled the order');
  }

  // Runs only after a successful cancel. Clear the active order BEFORE leaving
  // so the realtime watcher stops tracking it and can't fire a conflicting
  // navigation (it would otherwise route the just-cancelled order back to the
  // order/tracking screen, which reuses this same waiting-for-merchant layout).
  function finishCancel() {
    setActiveOrderId(null);
    setPendingTradeData(null);
    setScreen("home");
  }

  // Stage-aware confirm: buy waiting = safe direct cancel; sell waiting = escrow
  // is already locked, so the resolver shows the "Cancel & refund" copy.
  function openCancel() {
    cancel.request(
      {
        type: pendingTradeData.type,
        dbStatus: isBuy ? "pending" : "escrowed",
        escrowLocked: !isBuy,
        cryptoAmount: cryptoStr,
        cryptoCode: "USDT",
      },
      {
        role: isBuy ? "buyer" : "seller",
        onConfirm: doCancel,
        onSuccess: finishCancel,
      },
    );
  }

  const banner: TrackerBanner = {
    title: "Finding you a merchant",
    sub: "We're matching you with a trusted, verified merchant.",
    icon: UserSearch,
    tone: "accent",
    live: true,
  };

  // Honest, window-based framing (no fabricated ETA). The caption states what
  // happens at zero; the rotating lines are factual reassurances only.
  const countdownCaption = isBuy
    ? "Auto-cancels if no one accepts — nothing charged"
    : "Auto-refund if no one accepts";
  const searchLines = [
    "Your order is live with available merchants.",
    "You'll be notified the moment one accepts.",
    isBuy ? "Nothing is charged until you confirm." : "Your USDT stays safely in escrow.",
  ];

  const tiles = isBuy
    ? [
        { icon: <Wallet className="w-4 h-4" />, label: "You will pay", value: fiatStr, sub: currency },
        { icon: <ArrowDownToLine className="w-4 h-4" />, label: "You will get", value: cryptoStr, sub: "USDT" },
        { icon: <Landmark className="w-4 h-4" />, label: "Method", value: methodLabel },
      ]
    : [
        { icon: <Wallet className="w-4 h-4" />, label: "You will get", value: fiatStr, sub: currency },
        { icon: <ArrowDownToLine className="w-4 h-4" />, label: "You are selling", value: cryptoStr, sub: "USDT" },
        { icon: <Landmark className="w-4 h-4" />, label: "Method", value: methodLabel },
      ];

  return (
    <div className="relative flex-1 min-h-0 flex flex-col bg-surface-base">
      <WaitingTracker
        title={`${typeLabel} ${cryptoStr} USDT`}
        orderRef={`Order #${displayId}`}
        onBack={() => setScreen("home")}
        onOpenSupport={() => setScreen("support")}
        banner={banner}
        countdown={{
          remainingSec: Math.max(0, matchingTimeLeft),
          totalSec: MATCHING_WINDOW_SECONDS,
          caption: countdownCaption,
          tone: "neutral",
        }}
        searchHint={{ lines: searchLines }}
        // Buyer hasn't escrowed anything yet — no escrow card on the buy flow.
        escrow={isBuy ? null : {
          sub: `Your ${cryptoStr} USDT is locked securely in escrow.`,
          txHref: null,
        }}
        activeStepIndex={1}
        createdTime={createdTime}
        progressSubtitle="Matching merchant · In progress"
        tiles={tiles}
        onOpenOverview={() => setShowOverview(true)}
        onCancel={openCancel}
      />

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
              status={orderStatus || "pending"}
              type={pendingTradeData.type}
              cryptoAmount={parseFloat(pendingTradeData.amount)}
              fiatAmount={parseFloat(pendingTradeData.fiatAmount)}
              rate={currentRate}
              fiatCode={currency}
              paymentMethod={pendingTradeData.paymentMethod}
              paymentMethods={payTypes}
              createdAt={createdAt}
              onClose={() => setShowOverview(false)}
              onCancel={openCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Merchant-matched celebration — brief hand-off before the parent
          navigates to the order/payment view (~1.4s, set in useUserEffects). */}
      <AnimatePresence>
        {matched && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center bg-surface-base"
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", damping: 14, stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-accent flex items-center justify-center mb-5"
            >
              <Check className="w-10 h-10 text-accent-text" strokeWidth={3} />
            </motion.div>
            <h2 className="text-[22px] font-bold text-text-primary">Merchant matched</h2>
            <p className="text-[14px] text-text-secondary leading-snug mt-1.5 max-w-[280px]">
              {matched.merchantName
                ? `${matched.merchantName} accepted your order.`
                : "A merchant accepted your order."}{" "}
              Taking you to payment…
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stage-aware cancel confirmation (portaled — renders above the overlay). */}
      {cancel.sheet}
    </div>
  );
};
