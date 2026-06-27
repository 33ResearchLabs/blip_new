/**
 * Stage notification copy — concise, role-aware, fact-only.
 *
 * One lifecycle event means OPPOSITE things to the two sides of a trade
 * (the seller locks escrow; the buyer sends fiat). Generic copy like
 * "Funds locked in escrow" or "Payment marked as sent. Please verify." is
 * ambiguous or addressed to the wrong person. `stageMessage` produces a short,
 * factual line tailored to the recipient's role — what happened + amount +
 * counterparty — with NO "do this next" instruction (per product decision).
 *
 * Role is taken from the order's `my_role` (merchant app, computed server-side)
 * or derived from the order type (user app: user is buyer on a BUY, seller on a
 * SELL). When the role is unknown/observer, a neutral actor-named line is used
 * so the text is still unambiguous.
 *
 * Returns null for statuses with no lifecycle milestone, so callers keep their
 * existing (transient) copy.
 */

import { notifMilestone } from './notificationKey';

export type TradeRole = 'buyer' | 'seller' | 'observer';

export interface StageCopyOpts {
  /** Pre-formatted amount including unit, e.g. "10 USDT". */
  amount?: string;
  /** The OTHER party's display name. */
  counterparty?: string;
}

const withAmt = (base: string, amt?: string) => (amt ? `${base} · ${amt}` : base);

/**
 * Concise, role-aware message for an order lifecycle status. `role` is the
 * RECIPIENT's role in this trade. Returns null when the status has no milestone.
 */
export function stageMessage(
  status: string | null | undefined,
  role: TradeRole | null | undefined,
  opts: StageCopyOpts = {},
): string | null {
  const m = notifMilestone(status);
  if (!m) return null;
  const amt = opts.amount?.trim() || undefined;
  const cp = opts.counterparty?.trim() || undefined;
  const isSeller = role === 'seller';
  const isBuyer = role === 'buyer';

  switch (m) {
    case 'created':
      // Only the seller posts a sell order (escrow locked at creation).
      return amt ? `Sell order live · ${amt} secured in escrow` : 'Sell order live · secured in escrow';

    case 'accepted':
      if (isBuyer) return withAmt(cp ? `Order accepted by ${cp}` : 'Order accepted', amt);
      if (isSeller) return withAmt(cp ? `You accepted ${cp}'s order` : 'You accepted an order', amt);
      return withAmt('Order accepted', amt);

    case 'escrowed':
      if (isBuyer) return `${cp || 'Seller'} locked ${amt || 'funds'} in escrow`;
      if (isSeller) return `You locked ${amt || 'funds'} in escrow`;
      return `${amt || 'Funds'} locked in escrow`;

    case 'payment_sent':
      if (isBuyer) return withAmt('You marked payment sent', amt);
      if (isSeller) return withAmt(cp ? `${cp} marked payment sent` : 'Buyer marked payment sent', amt);
      return withAmt('Payment marked as sent', amt);

    case 'payment_confirmed':
      if (isBuyer) return withAmt('Seller confirmed your payment', amt);
      if (isSeller) return withAmt('You confirmed payment', amt);
      return withAmt('Payment confirmed', amt);

    case 'settled':
      if (isBuyer) return `Trade complete · ${amt || 'funds'} received`;
      if (isSeller) return `Trade complete · ${amt || 'funds'} released${cp ? ` to ${cp}` : ''}`;
      return withAmt('Trade complete', amt);

    case 'cancelled':
      // Cancel refunds escrow to the seller (the funder).
      if (isSeller) return `Order cancelled · ${amt || 'funds'} refunded`;
      return withAmt('Order cancelled', amt);

    case 'expired':
      return withAmt('Order expired', amt);

    case 'disputed':
      return `${withAmt('Dispute opened', amt)} · under review`;

    default:
      return null;
  }
}
