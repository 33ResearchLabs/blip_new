"use client";

import { motion, AnimatePresence } from "framer-motion";
import { UserSearch, Wallet, ArrowDownToLine, Landmark } from "lucide-react";
import { useState } from "react";
import type { Screen } from "./types";
import { fetchWithAuth } from '@/lib/api/fetchWithAuth';
import { orderActionKey } from '@/lib/api/idempotencyKeys';
import { formatCrypto } from '@/lib/format';
import { getDisplayOrderId } from '@/lib/displayOrderId';
import { OrderOverviewScreen } from './OrderOverviewScreen';
import { WaitingTracker, type TrackerBanner } from './WaitingTracker';

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
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
  setActiveOrderId: (id: string | null) => void;
  setPendingTradeData: (d: any) => void;
  toast: any;
  maxW: string;
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
}: MatchingScreenProps) => {
  // Capture creation time once on mount — used for the "Order created" timestamp
  // and the BM-YYMMDD display reference.
  const [createdAt] = useState(() => new Date());
  const [showOverview, setShowOverview] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
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

  async function handleCancel() {
    if (activeOrderId && userId) {
      setIsCancelling(true);
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
          // Mark the order cancelled (not just filter it out) so a poll/refetch
          // can't re-add it looking active.
          setOrders((prev: any[]) =>
            prev.map((o: any) =>
              o.id === activeOrderId
                ? { ...o, status: "cancelled", dbStatus: "cancelled" }
                : o,
            ),
          );
          toast.showOrderCancelled('You cancelled the order');
        } else {
          console.error('Failed to cancel order:', data.error);
          toast.showWarning(data.error || 'Failed to cancel order');
        }
      } catch (err) {
        console.error('Failed to cancel order:', err);
        toast.showWarning('Failed to cancel order');
      } finally {
        setIsCancelling(false);
      }
    }
    // Clear the active order BEFORE leaving so the realtime watcher stops
    // tracking it and can't fire a conflicting navigation (it would otherwise
    // route the just-cancelled order back to the order/tracking screen, which
    // reuses this same waiting-for-merchant layout).
    setActiveOrderId(null);
    setPendingTradeData(null);
    setScreen("home");
  }

  const banner: TrackerBanner = {
    title: "Waiting for a merchant",
    sub: "We're matching you with verified merchants.",
    icon: UserSearch,
    tone: "accent",
    live: true,
  };

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
        countdown={{ remainingSec: Math.max(0, matchingTimeLeft), totalSec: MATCHING_WINDOW_SECONDS }}
        // Buyer hasn't escrowed anything yet — no escrow card on the buy flow.
        escrow={isBuy ? null : {
          sub: `Your ${cryptoStr} USDT is locked securely in escrow. You'll be notified once a merchant is matched.`,
          txHref: null,
        }}
        activeStepIndex={1}
        createdTime={createdTime}
        progressSubtitle="Matching merchant · In progress"
        tiles={tiles}
        onOpenOverview={() => setShowOverview(true)}
        onCancel={handleCancel}
        isCancelling={isCancelling}
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
              onCancel={handleCancel}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
