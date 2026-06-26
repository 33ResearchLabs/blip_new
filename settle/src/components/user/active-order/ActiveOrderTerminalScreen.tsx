"use client";

/**
 * ActiveOrderTerminalScreen
 * ─────────────────────────
 * PHASE 2 — the ENDED states (expired / cancelled) on the new foundation.
 *
 * Why this exists: the old OrderTrackingView reused the live 7-step ladder for
 * terminal orders with NO step marked done (activeStepIndex = -1), so a dead
 * order rendered a full future checklist with even "Order created" unchecked —
 * reading like a stalled, in-progress order. Here the lifecycle progress is
 * HIDDEN (replaced by a calm "Order closed" banner, like Under Review) and the
 * hero says plainly what happened and that nothing was lost. Neutral monochrome
 * (user-app-no-red) — an ended order is not an error.
 *
 * Pure presentation.
 */

import { XCircle, RotateCcw, HelpCircle, ChevronRight, Wallet, ArrowDownToLine, Landmark, Banknote } from "lucide-react";
import type { Order } from "@/components/user/screens/types";
import { formatCrypto } from "@/lib/format";
import { fiatSymbol } from "@/lib/orders/paymentRows";
import { resolveActiveOrderView } from "@/lib/orders/resolveActiveOrderView";
import { ActiveOrderShell } from "./ActiveOrderShell";
import { CurrentStepHero } from "./CurrentStepHero";
import { MerchantCard } from "./MerchantCard";
import { SummaryTile } from "./SummaryTile";

const CARD = "bg-surface-card border border-border-subtle";

/** True once a real merchant is attached (broadcast orders start unmatched). */
function merchantMatched(order: Order): boolean {
  const name = order.merchant?.name || "";
  return !!order.merchant?.id && !!name && !/^(open_order_|m2m_)/i.test(name);
}

export interface ActiveOrderTerminalScreenProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  onRetry: () => void;
  onOpenSupport: () => void;
  onViewOverview: () => void;
}

export function ActiveOrderTerminalScreen({
  order,
  displayId,
  onClose,
  onRetry,
  onOpenSupport,
  onViewOverview,
}: ActiveOrderTerminalScreenProps) {
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const isBuy = order.type === "buy";
  const matched = merchantMatched(order);
  const escrowRefunded = order.type === "sell" && !!order.escrowTxHash;

  const buyerPayTypes = isBuy ? order.buyerPaymentTypes || [] : [];
  const methodLabel =
    buyerPayTypes.length > 0
      ? buyerPayTypes.map((t) => (t === "cash" ? "Cash" : t === "upi" ? "UPI" : "Bank")).join(" · ")
      : order.merchant?.paymentMethod === "cash"
        ? "Cash"
        : "Bank";

  const view = resolveActiveOrderView({
    type: order.type,
    dbStatus,
    fiatLabel: fiatStr,
    cryptoLabel: cryptoStr,
    escrowRefunded,
  });

  return (
    <ActiveOrderShell
      title={`${isBuy ? "Buy" : "Sell"} ${cryptoStr} USDT`}
      subtitle={`Order #${displayId}`}
      onBack={onClose}
      onInfo={onViewOverview}
      milestones={view.milestones}
      currentIndex={view.currentIndex}
      // Hide the lifecycle ladder — show a calm "closed" banner instead.
      progressReplacement={
        <div className={`rounded-2xl px-4 py-3.5 flex items-center gap-3 ${CARD}`}>
          <div className="w-9 h-9 rounded-xl bg-surface-active flex items-center justify-center shrink-0">
            <XCircle className="w-5 h-5 text-text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary">Order closed</p>
            <p className="text-[12px] text-text-tertiary leading-snug">This order has ended.</p>
          </div>
        </div>
      }
      hero={<CurrentStepHero hero={view.hero} />}
      // Primary recovery: start a fresh order.
      primaryAction={
        <button
          onClick={onRetry}
          className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-text-primary text-surface-base flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-5 h-5" />
          Try again
        </button>
      }
      // Merchant only if one was actually matched (expired orders have none).
      merchant={
        matched ? (
          <MerchantCard
            name={order.merchant.name}
            avatarUrl={order.merchant.avatarUrl}
            rating={order.merchant.rating}
            trades={order.merchant.trades}
            isOnline={order.merchant.isOnline}
            onViewProfile={onViewOverview}
            onOpenChat={onViewOverview}
          />
        ) : undefined
      }
      // Static recap — past/conditional labels (nothing is pending).
      paymentSummary={
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile
            icon={<Wallet className="w-4 h-4" />}
            label={isBuy ? "You'd pay" : "You'd get"}
            value={fiatStr}
          />
          <SummaryTile
            icon={<ArrowDownToLine className="w-4 h-4" />}
            label={isBuy ? "You'd get" : "You'd sell"}
            value={cryptoStr}
            sub="USDT"
          />
          <SummaryTile
            icon={methodLabel === "Cash" ? <Banknote className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
            label="Method"
            value={methodLabel}
          />
        </div>
      }
      help={
        <div className="space-y-2">
          <button
            onClick={onViewOverview}
            className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl text-left active:bg-surface-hover ${CARD}`}
          >
            <span className="text-[14px] font-medium text-text-primary">Order overview</span>
            <ChevronRight className="w-4 h-4 text-text-tertiary" />
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-text-secondary border border-border-medium hover:bg-surface-hover transition-colors"
            >
              Back
            </button>
            <button
              onClick={onOpenSupport}
              className="flex-1 py-3 rounded-2xl text-[14px] font-medium text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
            >
              <HelpCircle className="w-4 h-4" />
              Need help
            </button>
          </div>
        </div>
      }
    />
  );
}
