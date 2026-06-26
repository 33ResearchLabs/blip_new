"use client";

/**
 * ActiveOrderAcceptedScreen
 * ─────────────────────────
 * PHASE 2 — the BUY "Merchant accepted, securing the funds" state
 * (accepted / escrow_pending) on the new foundation.
 *
 * A WAITING state: the merchant is locking the crypto, the buyer has no action
 * yet, and payment details stay hidden until escrow is confirmed. So there's no
 * primary button — a calm WaitingIndicator sits in its place, and there is no
 * countdown (the time pressure is on the merchant, not the user).
 *
 * Pure presentation. Props are a subset of the buyer-payment prop bundle so the
 * parent can spread the same object it already builds. Once escrow locks, the
 * parent swaps in ActiveOrderPaymentScreen.
 */

import { ChevronRight, HelpCircle, AlertCircle, Wallet, ArrowDownToLine, Landmark, Banknote } from "lucide-react";
import type { Order } from "@/components/user/screens/types";
import { formatCrypto } from "@/lib/format";
import { fiatSymbol } from "@/lib/orders/paymentRows";
import { resolveActiveOrderView } from "@/lib/orders/resolveActiveOrderView";
import { ActiveOrderShell } from "./ActiveOrderShell";
import { CurrentStepHero } from "./CurrentStepHero";
import { WaitingIndicator } from "./WaitingIndicator";
import { MerchantCard } from "./MerchantCard";
import { SummaryTile } from "./SummaryTile";

const CARD = "bg-surface-card border border-border-subtle";

export interface ActiveOrderAcceptedScreenProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  onOpenOverview: () => void;
  onViewOverview: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  onNeedHelp: () => void;
  onAppeal: () => void;
  appealBanner?: React.ReactNode;
  appealActive?: boolean;
}

export function ActiveOrderAcceptedScreen({
  order,
  displayId,
  onClose,
  onOpenOverview,
  onViewOverview,
  onOpenChat,
  onViewProfile,
  onNeedHelp,
  onAppeal,
  appealBanner,
  appealActive,
}: ActiveOrderAcceptedScreenProps) {
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;
  const isCash =
    (order.merchantPaymentMethod?.type ??
      order.lockedPaymentMethod?.type ??
      order.merchant.paymentMethod) === "cash";

  const view = resolveActiveOrderView({
    type: order.type,
    dbStatus,
    fiatLabel: fiatStr,
    cryptoLabel: cryptoStr,
    paymentMethod: isCash ? "cash" : "bank",
  });

  return (
    <ActiveOrderShell
      title={`Buy ${cryptoStr} USDT`}
      subtitle={`Order #${displayId}`}
      onBack={onClose}
      onInfo={onOpenOverview}
      milestones={view.milestones}
      currentIndex={view.currentIndex}
      banner={appealBanner}
      hero={<CurrentStepHero hero={view.hero} />}
      primaryAction={view.waitingLabel ? <WaitingIndicator label={view.waitingLabel} /> : undefined}
      merchant={
        <MerchantCard
          name={order.merchant.name}
          avatarUrl={order.merchant.avatarUrl}
          rating={order.merchant.rating}
          trades={order.merchant.trades}
          isOnline={order.merchant.isOnline}
          unreadCount={order.unreadCount}
          onViewProfile={onViewProfile}
          onOpenChat={onOpenChat}
        />
      }
      paymentSummary={
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile icon={<Wallet className="w-4 h-4" />} label="You pay" value={fiatStr} />
          <SummaryTile
            icon={<ArrowDownToLine className="w-4 h-4" />}
            label="You get"
            value={cryptoStr}
            sub="USDT"
          />
          <SummaryTile
            icon={isCash ? <Banknote className="w-4 h-4" /> : <Landmark className="w-4 h-4" />}
            label="Method"
            value={isCash ? "Cash" : "Bank"}
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
            {!appealActive && (
              <button
                onClick={onAppeal}
                className="flex-1 py-3 rounded-2xl text-[14px] font-semibold text-text-secondary border border-border-medium hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
              >
                <AlertCircle className="w-4 h-4" />
                Report a problem
              </button>
            )}
            <button
              onClick={onNeedHelp}
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
