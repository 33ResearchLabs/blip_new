"use client";

/**
 * ActiveOrderReviewScreen
 * ───────────────────────
 * PHASE 2 — the "Under Review" (disputed) state on the new foundation, for both
 * directions. This is the agreed UNIFIED treatment: appeals + formal disputes
 * present as one calm "under review, funds protected" screen.
 *
 * Per the agreed design:
 *   • The 5-step progress is HIDDEN here (a dispute is an off-ramp, not a step)
 *     and replaced with a neutral "Under review" banner via the shell's
 *     progressReplacement slot.
 *   • Colour stays neutral monochrome — NOT alarming red (user-app-no-red).
 *   • Primary action is "Message seller"; the auto-refund timer is folded in as
 *     reassurance; the time-extension control is tucked into Order Details.
 *
 * Pure presentation. Money/realtime/dispute logic stays in OrderDetailScreen.
 */

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  MessageCircle,
  HelpCircle,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import type { Order } from "@/components/user/screens/types";
import { formatCrypto } from "@/lib/format";
import { fiatSymbol } from "@/lib/orders/paymentRows";
import { resolveActiveOrderView } from "@/lib/orders/resolveActiveOrderView";
import { ActiveOrderShell } from "./ActiveOrderShell";
import { CurrentStepHero } from "./CurrentStepHero";
import { MerchantCard } from "./MerchantCard";

const CARD = "bg-surface-card border border-border-subtle";

export interface ActiveOrderReviewScreenProps {
  order: Order;
  displayId: string;
  onClose: () => void;
  onOpenOverview: () => void;
  onOpenChat: () => void;
  onViewProfile: () => void;
  onNeedHelp: () => void;
  // Time-extension control (kept in Order Details, per the agreed design).
  requestExtension: (durationMinutes?: number) => void;
  requestingExtension: boolean;
  extensionRequest: {
    orderId: string;
    requestedBy: string;
    extensionMinutes: number;
    extensionCount: number;
    maxExtensions: number;
  } | null;
}

/** "23h 23m" / "45m" until the dispute auto-resolves (refund). Null if unknown/past. */
function fmtAutoRefund(target: Date | null | undefined, nowMs: number): string | null {
  if (!target) return null;
  const ms = new Date(target).getTime() - nowMs;
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function ActiveOrderReviewScreen({
  order,
  displayId,
  onClose,
  onOpenOverview,
  onOpenChat,
  onViewProfile,
  onNeedHelp,
  requestExtension,
  requestingExtension,
  extensionRequest,
}: ActiveOrderReviewScreenProps) {
  const dbStatus = String(order.dbStatus || order.status || "").toLowerCase();
  const sym = fiatSymbol(order.fiatCode);
  const cryptoStr = formatCrypto(parseFloat(order.cryptoAmount));
  const fiatStr = `${sym}${formatCrypto(parseFloat(order.fiatAmount))}`;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const autoRefundIn = fmtAutoRefund(order.disputeAutoResolveAt, now);

  const [detailsOpen, setDetailsOpen] = useState(false);

  const view = resolveActiveOrderView({
    type: order.type,
    dbStatus,
    fiatLabel: fiatStr,
    cryptoLabel: cryptoStr,
  });

  const extPending = !!extensionRequest && extensionRequest.requestedBy === "user";

  return (
    <ActiveOrderShell
      title={`${order.type === "buy" ? "Buy" : "Sell"} ${cryptoStr} USDT`}
      subtitle={`Order #${displayId}`}
      onBack={onClose}
      onInfo={onOpenOverview}
      milestones={view.milestones}
      currentIndex={view.currentIndex}
      // Hide the lifecycle progress; show a calm "Under review" banner instead.
      progressReplacement={
        <div className={`rounded-2xl px-4 py-3.5 flex items-center gap-3 ${CARD}`}>
          <div className="w-9 h-9 rounded-xl bg-surface-active flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary">Under review</p>
            <p className="text-[12px] text-text-tertiary leading-snug">
              Our team is reviewing this trade — your funds are protected.
            </p>
          </div>
        </div>
      }
      hero={<CurrentStepHero hero={view.hero} />}
      // Primary action: reach the seller (resolution proposals live in chat).
      primaryAction={
        <button
          onClick={onOpenChat}
          className="w-full py-4 rounded-2xl text-[16px] font-semibold bg-text-primary text-surface-base flex items-center justify-center gap-2"
        >
          <MessageCircle className="w-5 h-5" />
          Message seller
          {!!order.unreadCount && order.unreadCount > 0 && (
            <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-surface-base/20 text-[11px] font-semibold leading-[18px] text-center tabular-nums">
              {order.unreadCount > 99 ? "99+" : order.unreadCount}
            </span>
          )}
        </button>
      }
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
      // Reassurance — funds protected, with the auto-refund fallback timer.
      escrowProtection={
        <div className={`rounded-2xl p-3.5 flex items-start gap-3 ${CARD}`}>
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-surface-active">
            <ShieldCheck className="w-5 h-5 text-text-secondary" />
          </div>
          <p className="text-[13px] text-text-secondary leading-snug">
            Your {cryptoStr} USDT stays locked and protected while this is reviewed.
            {autoRefundIn
              ? ` If it isn't resolved, it's automatically refunded in about ${autoRefundIn}.`
              : ""}
          </p>
        </div>
      }
      help={
        <button
          onClick={onNeedHelp}
          className="w-full py-3 rounded-2xl text-[14px] font-medium text-text-secondary hover:bg-surface-hover transition-colors flex items-center justify-center gap-2"
        >
          <HelpCircle className="w-4 h-4" />
          Need help
        </button>
      }
      // Order Details (collapsed) — also holds the time-extension control.
      details={
        <div className={`rounded-2xl overflow-hidden ${CARD}`}>
          <button
            type="button"
            onClick={() => setDetailsOpen((o) => !o)}
            aria-expanded={detailsOpen}
            className="w-full flex items-center gap-2.5 p-4 text-left"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-text-primary">Order details &amp; options</p>
              <p className="text-[11px] text-text-tertiary">Reference and time extension</p>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-text-tertiary shrink-0 transition-transform ${
                detailsOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <div className="px-4 pb-4 pt-3 space-y-3 border-t border-border-subtle">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] text-text-tertiary">Order reference</span>
                    <span className="text-[12px] font-medium text-text-secondary">#{displayId}</span>
                  </div>
                  <button
                    onClick={onOpenOverview}
                    className="w-full flex items-center justify-between gap-3 py-2 text-left"
                  >
                    <span className="text-[13px] font-medium text-text-primary">View full order</span>
                    <ChevronRight className="w-4 h-4 text-text-tertiary" />
                  </button>

                  <div className="pt-1">
                    <p className="text-[12px] text-text-tertiary mb-2">
                      Need more time before auto-resolution?
                    </p>
                    {extPending ? (
                      <div className="flex items-center gap-2 text-[12px] text-text-secondary">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Extension requested — waiting for a response.
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { m: 15, l: "15 min" },
                          { m: 60, l: "1 hour" },
                          { m: 720, l: "12 hours" },
                        ].map((o) => (
                          <button
                            key={o.m}
                            disabled={requestingExtension}
                            onClick={() => requestExtension(o.m)}
                            className="py-2.5 rounded-xl border border-border-medium text-[13px] font-medium text-text-primary disabled:opacity-50 hover:bg-surface-hover transition-colors flex items-center justify-center gap-1.5"
                          >
                            {requestingExtension && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            {o.l}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      }
    />
  );
}
