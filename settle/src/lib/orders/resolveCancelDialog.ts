/**
 * resolveCancelDialog
 * ───────────────────
 * Pure, stage-aware resolver for the cancel-order confirmation. Given an order
 * (or an order-like snapshot), it returns the *content* for `CancelOrderSheet`
 * — the single home for every stage's copy and button labels.
 *
 * It does NOT decide what the cancel actually does on the backend — that stays
 * in the existing handlers (`requestCancelOrder` / `cancelOrderDirect` / the
 * `CANCEL` action). It only mirrors the rules those handlers already follow so
 * the user is told the truth before they confirm:
 *
 *   • !acceptedAt          → direct cancel (instant; sell-with-escrow refunds)
 *   • acceptedAt           → mutual-cancel (counterparty must agree, else dispute)
 *   • payment_sent         → blocked (CANCEL is not a legal transition)
 *   • disputed             → blocked (paused until the review resolves)
 *   • completed/cancelled/expired → terminal (nothing to cancel)
 *
 * `kind` tells the sheet how to behave:
 *   direct | mutual → render a destructive confirm button (calls onConfirm)
 *   blocked         → no destructive button; offer a secondary route (help/appeal)
 *   terminal        → informational only (the caller should not even open it)
 */

import { Clock, ShieldCheck, Lock, Flag, type LucideIcon } from "lucide-react";

/** Minimal shape the resolver reads — the full UI `Order` satisfies this, and
 *  transient screens (e.g. matching, pre-persist) can build it by hand. */
export interface CancelOrderLike {
  type: "buy" | "sell";
  status?: string;
  dbStatus?: string;
  acceptedAt?: Date | string | null;
  paymentSentAt?: Date | string | null;
  disputedAt?: Date | string | null;
  cancelRequest?: { requestedBy: string } | null;
  /** Whether crypto is currently locked on-chain. Defaults from dbStatus. */
  escrowLocked?: boolean;
  cryptoAmount?: string;
  cryptoCode?: string;
}

export type CancelDialogKind = "direct" | "mutual" | "blocked" | "terminal";

export interface CancelDialogConfig {
  kind: CancelDialogKind;
  icon: LucideIcon;
  /** What's happening + what happens if I cancel. Kept to ≤3 short lines. */
  title: string;
  description: string;
  note?: string;
  /** Safe action — always closes the sheet (Continue / Keep / Back). */
  primary: { label: string };
  /** Destructive action — present for direct/mutual only; the ONLY red button. */
  destructive?: { label: string };
  /** Alternative route for blocked stages (Get help / View appeal / Open chat). */
  secondary?: { label: string };
}

const TERMINAL = new Set(["completed", "complete", "cancelled", "canceled", "expired"]);

function statusOf(o: CancelOrderLike): string {
  return (o.dbStatus || o.status || "").toLowerCase();
}

export function resolveCancelDialog(
  o: CancelOrderLike,
  opts?: { role?: "buyer" | "seller" },
): CancelDialogConfig {
  const s = statusOf(o);
  const escrowLocked = o.escrowLocked ?? s === "escrowed";
  const amount = o.cryptoAmount ? `${o.cryptoAmount} ${o.cryptoCode || "USDT"}` : "your USDT";

  // Terminal — nothing to cancel.
  if (TERMINAL.has(s)) {
    return {
      kind: "terminal",
      icon: Clock,
      title: "This order is already closed",
      description: "There's nothing to cancel — this trade has already ended.",
      primary: { label: "Back to order" },
    };
  }

  // Under review — cancellation paused.
  if (s === "disputed" || o.disputedAt) {
    return {
      kind: "blocked",
      icon: Flag,
      title: "This trade is under review",
      description:
        "An appeal is open. While it's being reviewed, the trade can't be cancelled.",
      note: "Your funds stay locked and safe until there's a decision.",
      primary: { label: "Back to order" },
      secondary: { label: "View appeal" },
    };
  }

  // A cancel request is already pending — informational.
  if (o.cancelRequest) {
    const mine = o.cancelRequest.requestedBy === "user";
    return {
      kind: "blocked",
      icon: Clock,
      title: mine ? "Cancellation requested" : "Cancellation request received",
      description: mine
        ? "We're waiting for the other person to agree. Your funds stay safe until then."
        : "The other person asked to cancel. You can respond from the order chat.",
      primary: { label: "Back to order" },
      secondary: { label: "Open chat" },
    };
  }

  // Payment sent — high-risk, cancellation disabled.
  if (s === "payment_sent" || o.paymentSentAt) {
    const seller = opts?.role === "seller";
    return {
      kind: "blocked",
      icon: Lock,
      title: seller ? "Payment is on the way" : "You've already sent payment",
      description: seller
        ? "The buyer marked the payment as sent, so this trade can't be cancelled now."
        : "Your payment may already be on its way, so this trade can't be cancelled now.",
      note: seller
        ? "Confirm once it arrives, or get help if something looks wrong."
        : "Give the seller a moment to confirm. If they don't, we'll step in automatically.",
      primary: { label: "Back to order" },
      secondary: { label: "Get help" },
    };
  }

  // Merchant engaged — needs counterparty agreement.
  if (o.acceptedAt) {
    return {
      kind: "mutual",
      icon: ShieldCheck,
      title: "Ask to cancel this trade?",
      description:
        "A merchant is already involved, so cancelling needs both sides to agree.",
      note: escrowLocked
        ? "The locked funds stay safe until you both agree or our team decides."
        : "You haven't paid anything yet — nothing will be charged.",
      primary: { label: "Continue trade" },
      destructive: { label: "Ask to cancel" },
    };
  }

  // Direct cancel, sell with escrow locked — refund path.
  if (o.type === "sell" && escrowLocked) {
    return {
      kind: "direct",
      icon: ShieldCheck,
      title: "Cancel and get your USDT back?",
      description: "No merchant has accepted yet. We'll end the offer and return your funds.",
      note: `Your locked ${amount} goes straight back to your wallet.`,
      primary: { label: "Keep offer live" },
      destructive: { label: "Cancel & refund" },
    };
  }

  // Direct cancel, nothing locked.
  return {
    kind: "direct",
    icon: Clock,
    title: "Cancel this order?",
    description: "No merchant has accepted yet and nothing has been charged.",
    note: "You can start a new order anytime.",
    primary: { label: "Continue waiting" },
    destructive: { label: "Cancel order" },
  };
}
