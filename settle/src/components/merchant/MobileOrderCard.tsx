"use client";

import { motion } from "framer-motion";
import {
  ArrowRightLeft,
  MessageCircle,
  Check,
  Lock,
  Send,
  AlertTriangle,
  X,
  Loader2,
} from "lucide-react";
import { UserBadge } from "@/components/merchant/UserBadge";
import { formatCrypto, formatFiat, formatRate } from "@/lib/format";
import type { Order } from "@/types/merchant";

// Unified merchant order card. Replaces the two divergent cards in
// MobileOrdersView and MobileEscrowView so the merchant sees one card
// design throughout an order's lifecycle — only the primary action
// button swaps as the status progresses.
//
// Status → primary action mapping (mirrors ACTION_RULES in core-api):
//   pending / open (mine)    → Cancel
//   pending / open (other)   → Accept
//   accepted (seller)        → Lock Escrow
//   accepted (buyer)         → (waiting on seller)
//   escrowed (buyer)         → Mark Payment Sent
//   escrowed (seller)        → (waiting on buyer)
//   payment_sent (seller)    → Confirm Payment
//   payment_sent (buyer)     → (waiting on seller)
//   disputed                 → Resolve / View
//   anything terminal        → no action (won't be in the active list)

function getStatus(order: Order): string {
  return (
    order.dbOrder?.minimal_status ||
    order.dbOrder?.status ||
    order.status ||
    "pending"
  );
}

// What role I'd play in this trade.
// • For active orders, trust the enriched `myRole` populated upstream.
// • For pending orders (no acceptor yet), I'd be the SELLER on a BUY
//   order (because the acceptor of a buy supplies the crypto) and the
//   BUYER on a SELL order.
function getMyRole(order: Order, myId: string | null | undefined): "seller" | "buyer" | "observer" {
  if (order.myRole) return order.myRole;
  const db = order.dbOrder;
  if (myId && db?.merchant_id === myId) {
    // We're the order's assigned merchant — role flips from order type
    // (BUY order → merchant is the seller of crypto).
    return order.orderType === "buy" ? "seller" : "buyer";
  }
  if (myId && db?.buyer_merchant_id === myId) return "buyer";
  // Pending broadcast — derive from order type as if we were to accept.
  return order.orderType === "buy" ? "seller" : "buyer";
}

interface StatusPill { label: string; cls: string; }
function pillFor(status: string, isMyOrder?: boolean): StatusPill {
  switch (status) {
    case "pending":
    case "open":
      return isMyOrder
        ? { label: "Waiting", cls: "bg-amber-500/10 border-amber-500/25 text-amber-300" }
        : { label: "New", cls: "bg-foreground/[0.06] border-foreground/[0.10] text-foreground/70" };
    case "accepted":
      return { label: "Awaiting Lock", cls: "bg-amber-500/10 border-amber-500/25 text-amber-300" };
    case "escrowed":
    case "escrow":
      return { label: "Locked", cls: "bg-primary/10 border-primary/25 text-primary" };
    case "payment_sent":
      return { label: "Payment Sent", cls: "bg-sky-500/10 border-sky-500/25 text-sky-300" };
    case "payment_confirmed":
      return { label: "Confirming", cls: "bg-emerald-500/10 border-emerald-500/25 text-emerald-300" };
    case "disputed":
      return { label: "Disputed", cls: "bg-red-500/10 border-red-500/25 text-red-400" };
    default:
      return { label: status.toUpperCase(), cls: "bg-foreground/[0.04] border-foreground/[0.08] text-foreground/50" };
  }
}

interface PrimaryAction {
  kind: "accept" | "cancel_pending" | "lock_escrow" | "mark_paid" | "confirm_payment" | "resolve_dispute";
  label: string;
  icon: typeof Check;
  busy: boolean;
  disabled?: boolean;
  tone: "primary" | "danger" | "warning";
  onClick: () => void;
}

interface WaitingState {
  label: string;
}

export interface MobileOrderCardProps {
  order: Order;
  merchantId: string | null;

  // Loading flags
  acceptingOrderId?: string | null;
  cancellingOrderId?: string | null;
  markingDone?: boolean;

  // Action callbacks. The card decides which one to surface.
  onAccept: (order: Order) => void;
  onCancelPending?: (order: Order) => void;
  onLockEscrow: (order: Order) => void;
  onMarkPaymentSent: (order: Order) => void;
  onConfirmPayment: (order: Order) => void;
  onOpenDispute: (orderId: string) => void;
  onOpenCancel: (order: Order) => void;
  onOpenChat: (order: Order) => void;
  setMobileView: (view: "orders" | "escrow" | "chat" | "history" | "marketplace") => void;
}

export function MobileOrderCard({
  order,
  merchantId,
  acceptingOrderId,
  cancellingOrderId,
  markingDone,
  onAccept,
  onCancelPending,
  onLockEscrow,
  onMarkPaymentSent,
  onConfirmPayment,
  onOpenDispute,
  onOpenCancel,
  onOpenChat,
  setMobileView,
}: MobileOrderCardProps) {
  const status = getStatus(order);
  const role = getMyRole(order, merchantId);
  const isMyOrder = !!order.isMyOrder;
  const hasEscrow = !!order.escrowTxHash;

  // Derive the primary action and any waiting copy. Exactly one of
  // `action` / `waiting` will be set; the footer renders accordingly.
  let action: PrimaryAction | null = null;
  let waiting: WaitingState | null = null;

  if (status === "pending" || status === "open") {
    if (isMyOrder) {
      if (onCancelPending) {
        action = {
          kind: "cancel_pending",
          label: "Cancel",
          icon: X,
          busy: cancellingOrderId === order.id,
          tone: "danger",
          onClick: () => onCancelPending(order),
        };
      } else {
        waiting = { label: "Waiting for a counterparty" };
      }
    } else {
      action = {
        kind: "accept",
        label: "Accept",
        icon: Check,
        busy: acceptingOrderId === order.id,
        tone: "primary",
        onClick: () => onAccept(order),
      };
    }
  } else if (status === "accepted") {
    if (role === "seller" && !hasEscrow) {
      action = {
        kind: "lock_escrow",
        label: "Lock Escrow",
        icon: Lock,
        busy: false,
        tone: "primary",
        onClick: () => onLockEscrow(order),
      };
    } else {
      waiting = { label: "Waiting for seller to lock escrow" };
    }
  } else if (status === "escrowed" || status === "escrow") {
    if (role === "buyer") {
      action = {
        kind: "mark_paid",
        label: "Mark Payment Sent",
        icon: Send,
        busy: !!markingDone,
        disabled: !hasEscrow,
        tone: "primary",
        onClick: () => onMarkPaymentSent(order),
      };
    } else {
      waiting = { label: "Waiting for buyer payment" };
    }
  } else if (status === "payment_sent") {
    if (role === "seller") {
      action = {
        kind: "confirm_payment",
        label: "Confirm Payment",
        icon: Check,
        busy: !!markingDone,
        tone: "primary",
        onClick: () => onConfirmPayment(order),
      };
    } else {
      waiting = { label: "Waiting for seller to confirm" };
    }
  } else if (status === "disputed") {
    action = {
      kind: "resolve_dispute",
      label: "View Dispute",
      icon: AlertTriangle,
      busy: false,
      tone: "warning",
      onClick: () => onOpenDispute(order.id),
    };
  }

  // YOU PAY / YOU RECEIVE panel — same gradient treatment from the
  // pending + escrow cards, just consolidated here.
  const viewerSide: "seller" | "buyer" =
    role === "seller" || role === "buyer" ? role : "seller";
  const crypto = {
    amount: formatCrypto(order.amount),
    currency: order.fromCurrency || "USDT",
  };
  const fiat = {
    amount: formatFiat(order.total),
    currency: order.toCurrency || "INR",
  };
  const left =
    viewerSide === "seller"
      ? { label: "YOU PAY", ...crypto, isReceive: false }
      : { label: "YOU RECEIVE", ...crypto, isReceive: true };
  const right =
    viewerSide === "seller"
      ? { label: "YOU RECEIVE", ...fiat, isReceive: true }
      : { label: "YOU PAY", ...fiat, isReceive: false };

  // Timer/age. Pending orders count down to expiry; active orders show
  // their escrow status pill instead, so the countdown only renders for
  // pending.
  const isPending = status === "pending" || status === "open";
  const isExpired = order.expiresIn <= 0;
  const expiringSoon = !isExpired && order.expiresIn <= 120;
  const timeLabel = isPending
    ? isExpired
      ? "Expired"
      : order.expiresIn >= 3600
        ? `${Math.floor(order.expiresIn / 3600)}h ${Math.floor((order.expiresIn % 3600) / 60)}m`
        : order.expiresIn >= 60
          ? `${Math.floor(order.expiresIn / 60)}m ${order.expiresIn % 60}s`
          : `${order.expiresIn}s`
    : null;

  const pill = pillFor(status, isMyOrder);

  // Secondary icon buttons. Dispute is only meaningful once escrow is
  // locked; cancel-with-refund is for the seller after lock (the page
  // wrapper decides which cancel modal to open).
  const canDispute = status === "escrowed" || status === "escrow" || status === "payment_sent";
  const canCancelActive =
    (status === "accepted" || status === "escrowed" || status === "escrow") &&
    role === "seller";

  const toneClasses = (tone: PrimaryAction["tone"]) =>
    tone === "danger"
      ? "bg-red-500/10 border-red-500/25 text-red-400 hover:bg-red-500/15"
      : tone === "warning"
        ? "bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/15"
        : "bg-primary text-white border-primary hover:bg-primary/90";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative p-3 rounded-xl border bg-foreground/[0.02] border-foreground/[0.06] hover:border-foreground/[0.10] transition-colors"
    >
      {/* Header — counterparty + status pill (and pending timer) */}
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
              {isMyOrder ? "Your offer" : order.user}
            </span>
            {isMyOrder && (
              <span className="px-1.5 py-0.5 bg-foreground/[0.04] border border-foreground/[0.06] rounded text-[9px] font-bold text-foreground/40">
                YOURS
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isPending && timeLabel && !isMyOrder && (
            <span
              className={`text-[11px] font-mono font-bold tabular-nums ${
                expiringSoon ? "text-red-400" : "text-primary"
              }`}
            >
              {timeLabel}
            </span>
          )}
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border ${pill.cls}`}
          >
            {pill.label}
          </span>
        </div>
      </div>

      {/* You Pay ⇄ You Receive */}
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
              <ArrowRightLeft className="w-3 h-3 text-foreground/60" strokeWidth={2.5} />
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

      {/* Footer — rate + primary action / waiting + secondary icons */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-foreground/40 font-mono shrink-0">
          @ {formatRate(order.rate)}
        </span>
        <div className="flex-1" />

        {action ? (
          <motion.button
            whileTap={{ scale: 0.98 }}
            disabled={action.busy || action.disabled}
            onClick={action.onClick}
            className={`h-9 px-3 border rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 ${toneClasses(action.tone)}`}
          >
            {action.busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <action.icon className="w-3.5 h-3.5" />
            )}
            <span>{action.label}</span>
          </motion.button>
        ) : waiting ? (
          <span className="text-[11px] text-foreground/40 italic">
            {waiting.label}
          </span>
        ) : null}

        {canCancelActive && (
          <button
            onClick={() => onOpenCancel(order)}
            className="h-9 w-9 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
            aria-label="Cancel order"
          >
            <X className="w-4 h-4 text-foreground/40" />
          </button>
        )}
        {canDispute && (
          <button
            onClick={() => onOpenDispute(order.id)}
            className="h-9 w-9 border border-amber-500/20 hover:border-amber-500/40 rounded-lg flex items-center justify-center transition-colors"
            aria-label="Open dispute"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400/80" />
          </button>
        )}
        <button
          onClick={() => {
            onOpenChat(order);
            setMobileView("chat");
          }}
          className="h-9 w-9 border border-white/10 hover:border-border-strong rounded-lg flex items-center justify-center transition-colors"
          aria-label="Open chat"
        >
          <MessageCircle className="w-4 h-4 text-foreground/40" />
        </button>
      </div>
    </motion.div>
  );
}
