"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Lock,
  MessageCircle,
  ArrowRightLeft,
  AlertTriangle,
  Clock,
  RotateCcw,
  Loader2,
  Check,
  Send,
} from "lucide-react";
import { UserBadge } from "@/components/merchant/UserBadge";
import { ActionPulse } from "@/components/NotificationToast";
import type { Order } from "@/types/merchant";
import { FilterDropdown } from "@/components/user/screens/ui/FilterDropdown";
import { useMerchantStore } from "@/stores/merchantStore";
import { formatCrypto, formatRate } from "@/lib/format";

// Mirrors `getViewerSide` in InProgressPanel.tsx so the mobile escrow card
// resolves YOU PAY / YOU RECEIVE the same way the desktop in-progress
// panel does (prefers enriched `myRole`, falls back to DB shape).
function getViewerSide(
  db: any,
  order: any,
  myId: string | null | undefined,
): "seller" | "buyer" {
  const myRole = order?.myRole || order?.my_role || db?.my_role;
  if (myRole === "seller") return "seller";
  if (myRole === "buyer") return "buyer";
  if (!db) return "seller";
  if (myId && db.merchant_id === myId) return "seller";
  if (myId && db.buyer_merchant_id === myId) return "buyer";
  if (db.merchant_id && !db.buyer_merchant_id) return "buyer";
  if (!db.merchant_id && db.buyer_merchant_id) return "seller";
  const orderType = String(db.type || "").toLowerCase();
  return orderType === "buy" ? "seller" : "buyer";
}

// Status pill copy + colour for the in-progress card.
function statusPill(s: string | undefined): { label: string; cls: string } {
  switch (s) {
    case "accepted":
      return {
        label: "Awaiting Lock",
        cls: "bg-amber-500/10 border-amber-500/25 text-amber-300",
      };
    case "escrowed":
    case "escrow":
      return {
        label: "Locked",
        cls: "bg-primary/10 border-primary/25 text-primary",
      };
    case "payment_sent":
      return {
        label: "Payment Sent",
        cls: "bg-sky-500/10 border-sky-500/25 text-sky-300",
      };
    case "payment_confirmed":
      return {
        label: "Confirming",
        cls: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300",
      };
    case "disputed":
      return {
        label: "Disputed",
        cls: "bg-red-500/10 border-red-500/25 text-red-400",
      };
    default:
      return {
        label: (s || "—").toUpperCase(),
        cls: "bg-foreground/[0.04] border-foreground/[0.08] text-foreground/50",
      };
  }
}

// Status options match the live escrow workflow steps the merchant cares about.
// Values are matched against dbOrder.minimal_status / dbOrder.status.
type EscrowStatusFilter =
  | "all"
  | "accepted"
  | "escrowed"
  | "payment_sent"
  | "disputed";

const ESCROW_STATUS_OPTIONS: ReadonlyArray<{
  key: EscrowStatusFilter;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "accepted", label: "Awaiting Lock" },
  { key: "escrowed", label: "Locked" },
  { key: "payment_sent", label: "Payment Sent" },
  { key: "disputed", label: "Disputed" },
];

export interface MobileEscrowViewProps {
  ongoingOrders: Order[];
  markingDone: boolean;
  onOpenEscrowModal: (order: Order) => void;
  onMarkFiatPaymentSent: (order: Order) => void;
  onConfirmPayment: (order: Order) => void;
  onOpenDisputeModal: (orderId: string) => void;
  onOpenCancelModal: (order: Order) => void;
  onOpenChat: (order: Order) => void;
  setMobileView: (view: 'orders' | 'escrow' | 'chat' | 'history' | 'marketplace') => void;
}

export function MobileEscrowView({
  ongoingOrders,
  markingDone,
  onOpenEscrowModal,
  onMarkFiatPaymentSent,
  onConfirmPayment,
  onOpenDisputeModal,
  onOpenCancelModal,
  onOpenChat,
  setMobileView,
}: MobileEscrowViewProps) {
  const [statusFilter, setStatusFilter] = useState<EscrowStatusFilter>("all");
  // Merchant identity for YOU PAY / YOU RECEIVE perspective in the gradient panel.
  const merchantId = useMerchantStore((s) => s.merchantId);

  // Match against the most specific status the order exposes.
  const filteredOngoingOrders = useMemo(() => {
    if (statusFilter === "all") return ongoingOrders;
    return ongoingOrders.filter((order) => {
      const dbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
      return dbStatus === statusFilter;
    });
  }, [ongoingOrders, statusFilter]);

  return (
    <div className="space-y-1">
      {/* Toolbar — filter by escrow status */}
      <div className="sticky top-0 z-20 -mx-3 px-3 py-2 bg-background/95 backdrop-blur-sm border-b border-foreground/[0.04] flex items-center justify-between gap-2">
        <span className="text-[11px] text-foreground/40 uppercase tracking-wide">
          Status
        </span>
        <FilterDropdown<EscrowStatusFilter>
          value={statusFilter}
          onChange={setStatusFilter}
          ariaLabel="Filter escrow by status"
          align="right"
          options={ESCROW_STATUS_OPTIONS}
        />
      </div>

      {/* Header Row */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 text-white/70" />
          <span className="text-xs font-mono text-foreground/40 uppercase tracking-wide">Escrow</span>
        </div>
        <span className="text-xs font-mono text-white/70">
          {filteredOngoingOrders.length}
          {filteredOngoingOrders.length !== ongoingOrders.length && (
            <span className="text-foreground/30"> / {ongoingOrders.length}</span>
          )}
        </span>
      </div>

      {filteredOngoingOrders.length > 0 ? (
        <div className="space-y-2 py-1">
          {filteredOngoingOrders.map((order) => {
            const dbStatus = order.dbOrder?.minimal_status || order.dbOrder?.status;
            const role = order.myRole || "observer";
            const hasBeenAccepted = !!order.dbOrder?.accepted_at;
            const needsLockEscrow =
              dbStatus === "accepted" && !order.escrowTxHash && role === "seller";
            const canMarkPaid =
              role === "buyer" &&
              dbStatus === "escrowed" &&
              hasBeenAccepted &&
              !!order.escrowTxHash;
            const canConfirmPayment =
              dbStatus === "payment_sent" && role === "seller";
            const canComplete = dbStatus === "payment_confirmed";
            // What's the merchant waiting on when there's no primary action?
            // Surfaced as a small pill in the footer so the card never looks
            // "stuck" with only chat / dispute / cancel icons visible.
            const hasPrimaryAction =
              needsLockEscrow || canMarkPaid || canConfirmPayment || canComplete;
            let waitingFor: string | null = null;
            if (!hasPrimaryAction) {
              if (role === "seller") {
                if (dbStatus === "accepted") waitingFor = "Waiting for escrow lock";
                else if (dbStatus === "escrowed")
                  waitingFor = "Waiting for buyer payment";
                else if (dbStatus === "disputed") waitingFor = "Awaiting resolution";
              } else if (role === "buyer") {
                if (dbStatus === "accepted")
                  waitingFor = "Waiting for seller to lock escrow";
                else if (dbStatus === "payment_sent")
                  waitingFor = "Waiting for seller to confirm";
                else if (dbStatus === "disputed") waitingFor = "Awaiting resolution";
              }
            }

            // YOU PAY / YOU RECEIVE perspective for the gradient panel.
            const viewerSide = getViewerSide(order.dbOrder, order, merchantId);
            const crypto = {
              amount: formatCrypto(order.amount),
              currency: order.fromCurrency || "USDT",
            };
            const fiat = {
              amount: formatCrypto(order.total),
              currency: order.toCurrency || "AED",
            };
            const left =
              viewerSide === "seller"
                ? { label: "YOU PAY", ...crypto, isReceive: false }
                : { label: "YOU RECEIVE", ...crypto, isReceive: true };
            const right =
              viewerSide === "seller"
                ? { label: "YOU RECEIVE", ...fiat, isReceive: true }
                : { label: "YOU PAY", ...fiat, isReceive: false };

            const status = statusPill(dbStatus);
            const mins = Math.floor(order.expiresIn / 60);
            const secs = (order.expiresIn % 60).toString().padStart(2, "0");

            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="relative p-3 rounded-xl border bg-foreground/[0.02] border-foreground/[0.06] hover:border-foreground/[0.10] transition-colors"
              >
                {/* Header — avatar + name + spread dot + status pill */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <UserBadge
                      name={order.user}
                      emoji={order.emoji}
                      size="md"
                      showName={false}
                    />
                    <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-semibold text-white truncate">
                        {order.user}
                      </span>
                      {order.spreadPreference && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            order.spreadPreference === "fastest"
                              ? "bg-red-400"
                              : "bg-primary"
                          }`}
                          title={order.spreadPreference}
                        />
                      )}
                      {role !== "observer" && (
                        <span className="px-1.5 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] font-bold text-foreground/40">
                          {role === "seller" ? "YOU SEND" : "YOU RECEIVE"}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Status pill */}
                  <span
                    className={`shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-mono font-bold tracking-wide ${status.cls}`}
                  >
                    {canMarkPaid && <ActionPulse size="sm" />}
                    {status.label}
                  </span>
                </div>

                {/* Action banner — surface the next required action prominently */}
                {needsLockEscrow && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/20 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
                    <span className="text-[10px] font-bold text-primary">
                      Lock escrow to start the trade
                    </span>
                  </div>
                )}
                {canMarkPaid && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center gap-2">
                    <Send className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span className="text-[10px] font-bold text-amber-200">
                      Send fiat payment to the seller
                    </span>
                  </div>
                )}
                {canConfirmPayment && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-[10px] font-bold text-emerald-300">
                      Buyer says paid — confirm to release escrow
                    </span>
                  </div>
                )}

                {/* You Pay ⇄ You Receive — gradient panel (mirrors desktop) */}
                <div className="relative mb-2 rounded-xl overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-foreground/[0.05] via-foreground/[0.02] to-transparent" />
                  <div
                    className={`absolute inset-y-0 ${right.isReceive ? "right-0" : "left-0"} w-1/2 bg-gradient-to-${right.isReceive ? "l" : "r"} from-emerald-500/[0.08] via-emerald-500/[0.03] to-transparent`}
                  />
                  <div className="absolute inset-0 rounded-xl border border-foreground/[0.08]" />
                  <div className="relative flex items-stretch">
                    <div className="flex-1 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${left.isReceive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-foreground/30"}`}
                        />
                        <span
                          className={`text-[9px] font-bold font-mono tracking-[0.15em] ${left.isReceive ? "text-emerald-400" : "text-foreground/50"}`}
                        >
                          {left.label}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className={`text-[16px] font-extrabold tabular-nums leading-none tracking-tight ${left.isReceive ? "text-emerald-400" : "text-white"}`}
                        >
                          {left.amount}
                        </span>
                        <span className="text-[10px] font-bold text-foreground/50 tracking-wide">
                          {left.currency}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center shrink-0">
                      <div className="w-px h-10 bg-gradient-to-b from-transparent via-foreground/[0.12] to-transparent" />
                      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-foreground/[0.08] to-background border border-foreground/[0.12] flex items-center justify-center -mx-3.5 z-10">
                        <ArrowRightLeft
                          className="w-3 h-3 text-foreground/60"
                          strokeWidth={2.5}
                        />
                      </div>
                      <div className="w-px h-10 bg-gradient-to-b from-transparent via-foreground/[0.12] to-transparent" />
                    </div>
                    <div className="flex-1 px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5 mb-1">
                        <span
                          className={`text-[9px] font-bold font-mono tracking-[0.15em] ${right.isReceive ? "text-emerald-400" : "text-foreground/50"}`}
                        >
                          {right.label}
                        </span>
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${right.isReceive ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" : "bg-foreground/30"}`}
                        />
                      </div>
                      <div className="flex items-baseline justify-end gap-1.5">
                        <span
                          className={`text-[16px] font-extrabold tabular-nums leading-none tracking-tight ${right.isReceive ? "text-emerald-400" : "text-white"}`}
                        >
                          {right.amount}
                        </span>
                        <span className="text-[10px] font-bold text-foreground/50 tracking-wide">
                          {right.currency}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bank / payment-method details — surfaced only when buyer must pay */}
                {canMarkPaid && (() => {
                  if (order.lockedPaymentMethod) {
                    const lpm = order.lockedPaymentMethod;
                    return (
                      <div className="mb-2 px-2.5 py-1.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] text-[10px] font-mono space-y-0.5">
                        <div className="truncate text-primary">
                          &rarr; {lpm.label} ({lpm.type.toUpperCase()})
                        </div>
                        {lpm.type === "bank" && lpm.details.iban && (
                          <div className="truncate text-white/50">{lpm.details.iban}</div>
                        )}
                        {lpm.type === "upi" && lpm.details.upi_id && (
                          <div className="truncate text-white/50">{lpm.details.upi_id}</div>
                        )}
                      </div>
                    );
                  }
                  const bankDetails =
                    order.sellerBankDetails || order.userBankDetails;
                  if (bankDetails) {
                    return (
                      <div className="mb-2 px-2.5 py-1.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] text-[10px] font-mono space-y-0.5 text-white/50">
                        <div className="truncate">&rarr; {bankDetails.bank_name}</div>
                        <div className="truncate">{bankDetails.account_name}</div>
                        <div className="truncate">{bankDetails.iban}</div>
                      </div>
                    );
                  }
                  if (order.userBankAccount) {
                    return (
                      <div className="mb-2 px-2.5 py-1.5 rounded-md bg-foreground/[0.03] border border-foreground/[0.06] text-[10px] font-mono truncate text-white/50">
                        &rarr; {order.userBankAccount}
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Last human message preview — subtle, opens chat on tap */}
                {order.lastHumanMessage && (
                  <div
                    className="flex items-center gap-1.5 mb-2 cursor-pointer"
                    onClick={() => {
                      onOpenChat(order);
                      setMobileView("chat");
                    }}
                  >
                    <MessageCircle className="w-3 h-3 text-foreground/35 shrink-0" />
                    <span className="text-[10px] text-foreground/40 truncate flex-1">
                      {order.lastHumanMessageSender === "merchant" ? "You: " : ""}
                      {order.lastHumanMessage.length > 60
                        ? order.lastHumanMessage.slice(0, 60) + "…"
                        : order.lastHumanMessage}
                    </span>
                    {(order.unreadCount || 0) > 0 && (
                      <span className="w-4 h-4 bg-primary rounded-full text-[9px] font-bold flex items-center justify-center text-background shrink-0">
                        {order.unreadCount! > 9 ? "9+" : order.unreadCount}
                      </span>
                    )}
                  </div>
                )}

                {/* Footer — rate + countdown + action buttons */}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-foreground/40 font-mono shrink-0">
                    @ {formatRate(order.rate)}
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-foreground/50 font-mono shrink-0">
                    <Clock className="w-3 h-3" />
                    {mins}:{secs}
                  </span>
                  <div className="flex-1" />
                  {/* When the merchant has nothing to do right now, surface a
                      "Waiting for X" pill so the card doesn't look unfinished
                      / stuck with only icons in the action row. */}
                  {waitingFor && (
                    <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] text-[11px] font-medium text-foreground/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                      {waitingFor}
                    </span>
                  )}
                  {/* Primary action — mutually exclusive based on state */}
                  {needsLockEscrow ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onOpenEscrowModal(order)}
                      className="h-9 px-3 bg-primary/15 hover:bg-primary/25 border border-primary/30 rounded-lg text-xs font-semibold text-primary flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Lock className="w-3.5 h-3.5" /> Lock
                    </motion.button>
                  ) : canMarkPaid ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onMarkFiatPaymentSent(order)}
                      disabled={markingDone}
                      className="h-9 px-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 rounded-lg text-xs font-semibold text-amber-200 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {markingDone ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <>
                          <Send className="w-3.5 h-3.5" /> I&apos;ve Paid
                        </>
                      )}
                    </motion.button>
                  ) : canConfirmPayment || canComplete ? (
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => onConfirmPayment(order)}
                      className="h-9 px-3 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-xs font-semibold text-emerald-300 flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" /> Confirm
                    </motion.button>
                  ) : null}
                  <button
                    onClick={() => {
                      onOpenChat(order);
                      setMobileView("chat");
                    }}
                    className="relative h-9 w-9 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
                    aria-label="Open chat"
                  >
                    <MessageCircle className="w-4 h-4 text-foreground/40" />
                    {(order.unreadCount || 0) > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary rounded-full text-[9px] font-bold flex items-center justify-center text-background">
                        {order.unreadCount! > 9 ? "9+" : order.unreadCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => onOpenDisputeModal(order.id)}
                    className="h-9 w-9 border border-white/10 hover:border-[var(--color-error)]/30 rounded-lg flex items-center justify-center transition-colors group"
                    aria-label="Dispute"
                  >
                    <AlertTriangle className="w-4 h-4 text-foreground/40 group-hover:text-[var(--color-error)]" />
                  </button>
                  {order.dbOrder?.status === "escrowed" &&
                    order.orderType === "buy" &&
                    order.escrowCreatorWallet && (
                      <button
                        onClick={() => onOpenCancelModal(order)}
                        className="h-9 w-9 border border-white/10 hover:border-border rounded-lg flex items-center justify-center transition-colors group"
                        title="Cancel & Withdraw"
                        aria-label="Cancel & Withdraw"
                      >
                        <RotateCcw className="w-4 h-4 text-foreground/40 group-hover:text-foreground/70" />
                      </button>
                    )}
                </div>
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-gray-600">
          <Lock className="w-8 h-8 mb-2 opacity-20" />
          <p className="text-xs text-foreground/35 font-mono">
            {ongoingOrders.length === 0
              ? "No active escrows"
              : "No escrows match this status"}
          </p>
          {ongoingOrders.length > 0 && statusFilter !== "all" && (
            <button
              onClick={() => setStatusFilter("all")}
              className="mt-3 text-[11px] text-primary/70 hover:text-primary font-mono"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
