/**
 * enrichOrderResponse - Backend-Driven Order Response Enricher
 *
 * SINGLE SOURCE OF TRUTH for what the frontend renders.
 *
 * CRITICAL INVARIANTS:
 *   1. primaryAction is ALWAYS present (never null/undefined).
 *      When no action is available, type=null + enabled=false.
 *   2. secondaryAction is explicitly null when absent.
 *   3. Actions are SYNCED with handleOrderAction guards — if the backend
 *      guard would reject an action, it MUST NOT appear as enabled.
 *   4. Terminal states (completed/cancelled/expired) lock ALL actions.
 *   5. Observer can only ACCEPT (open) or CLAIM (escrowed+unclaimed).
 *   6. nextStepText is ALWAYS present and role-aware.
 *   7. No combined/ambiguous actions (no CLAIM+PAY, no RELEASE_CRYPTO).
 *
 * The frontend MUST NOT compute roles, derive actions, or determine state transitions.
 * It renders exactly what this function returns.
 */

import { normalizeStatus, type MinimalOrderStatus } from './statusNormalizer';
import {
  resolveTradeRole,
  handleOrderAction,
  type TradeRole,
  type OrderAction,
} from './handleOrderAction';
import type { OrderStatus as DbOrderStatus } from '../types/database';

// ── Types ─────────────────────────────────────────────────────────────

export type ActionType =
  | 'ACCEPT'
  | 'CLAIM'
  | 'LOCK_ESCROW'
  | 'SEND_PAYMENT'
  | 'CONFIRM_PAYMENT'
  | 'CANCEL'
  | 'DISPUTE';

export interface PrimaryAction {
  /** Action type to send to POST /orders/{id}/action. null = informational only. */
  type: ActionType | null;
  /** Button label */
  label: string;
  /** Whether the button is clickable */
  enabled: boolean;
  /** Shown when disabled */
  disabledReason?: string;
}

export interface SecondaryAction {
  /** Action type to send. null = informational only. */
  type: ActionType | null;
  /** Button label */
  label: string;
}

export interface EnrichedOrderResponse {
  /** Caller's role in this order */
  my_role: 'buyer' | 'seller' | 'observer';
  /** Normalized 8-state status */
  status: MinimalOrderStatus;
  /** Human-readable status label */
  statusLabel: string;
  /** Primary CTA button. ALWAYS present, never null. */
  primaryAction: PrimaryAction;
  /** Secondary action (Cancel/Dispute). Explicitly null when absent. */
  secondaryAction: SecondaryAction | null;
  /** User guidance text. ALWAYS present. */
  nextStepText: string;
  /** Whether order is in terminal state */
  isTerminal: boolean;
  /** Whether chat UI should be shown */
  showChat: boolean;
}

// ── Order shape required by enricher ──────────────────────────────────

interface OrderForEnrichment {
  id: string;
  status: string;
  type: 'buy' | 'sell';
  user_id: string;
  merchant_id: string;
  buyer_merchant_id?: string | null;
  escrow_debited_entity_id?: string | null;
  escrow_tx_hash?: string | null;
  refund_tx_hash?: string | null;
  order_version?: number;
}

// ── Enricher ──────────────────────────────────────────────────────────

/**
 * Enrich an order with frontend-ready fields.
 *
 * @param order - Raw order from DB (with relations)
 * @param actorId - The current user/merchant ID making the request
 * @returns EnrichedOrderResponse — strict, complete, never undefined fields
 */
export function enrichOrderResponse(
  order: OrderForEnrichment,
  actorId: string
): EnrichedOrderResponse {
  const minimalStatus = normalizeStatus(order.status as any);
  const role = resolveRole(order, actorId);
  const hasEscrow = !!order.escrow_tx_hash;
  const hasRefund = !!order.refund_tx_hash;

  // Terminal state: completed/cancelled/expired — unless seller has unreturned escrow
  const hasUnreturnedEscrow = hasEscrow && !hasRefund && role === 'seller';
  const isTerminal =
    ['completed', 'cancelled', 'expired'].includes(minimalStatus) &&
    !hasUnreturnedEscrow;

  // ── Build result with strict defaults ──────────────────────────────
  const result: EnrichedOrderResponse = {
    my_role: role,
    status: minimalStatus,
    statusLabel: STATUS_LABELS[minimalStatus] || 'UNKNOWN',
    primaryAction: DISABLED_PRIMARY('No action available', 'No actions available for this order.'),
    secondaryAction: null,
    nextStepText: 'No further actions required.',
    isTerminal,
    showChat: !isTerminal && minimalStatus !== 'open',
  };

  // ── Terminal states: lock everything ────────────────────────────────
  if (isTerminal) {
    switch (minimalStatus) {
      case 'completed':
        result.nextStepText = 'This trade has been completed successfully.';
        break;
      case 'cancelled':
        result.nextStepText = 'This order was cancelled.';
        break;
      case 'expired':
        result.nextStepText = 'This order has expired.';
        break;
    }
    return result;
  }

  // ── Unreturned escrow on cancelled/expired (non-terminal seller) ───
  if (['cancelled', 'expired'].includes(minimalStatus) && hasUnreturnedEscrow) {
    result.primaryAction = guardedAction(order, actorId, 'CANCEL', 'Withdraw Escrow');
    result.nextStepText = minimalStatus === 'cancelled'
      ? 'Order cancelled. Withdraw your USDC from escrow.'
      : 'Order expired. Withdraw your USDC from escrow.';
    return result;
  }

  // ── Active states ──────────────────────────────────────────────────
  switch (minimalStatus) {
    case 'open':
      deriveOpen(result, order, actorId, role);
      break;
    case 'accepted':
      deriveAccepted(result, order, actorId, role, hasEscrow);
      break;
    case 'escrowed':
      deriveEscrowed(result, order, actorId, role);
      break;
    case 'payment_sent':
      derivePaymentSent(result, order, actorId, role);
      break;
    case 'disputed':
      deriveDisputed(result, order, actorId, role);
      break;
  }

  return result;
}

// ── Per-status derivation ─────────────────────────────────────────────

function deriveOpen(
  result: EnrichedOrderResponse,
  order: OrderForEnrichment,
  actorId: string,
  role: 'buyer' | 'seller' | 'observer',
) {
  if (role === 'observer') {
    // Mine = escrow already locked (just send fiat after accepting)
    // Accept = no escrow yet (you'll lock escrow after accepting)
    const hasEscrow = !!order.escrow_tx_hash;
    const label = hasEscrow ? 'Mine' : 'Accept';
    const hint = hasEscrow
      ? 'Mine this order to send fiat payment.'
      : 'Accept this order to lock escrow.';
    result.primaryAction = guardedAction(order, actorId, 'ACCEPT', label);
    result.nextStepText = hint;
  } else {
    result.primaryAction = DISABLED_PRIMARY(
      'Waiting for Acceptor',
      'Waiting for a counterparty to accept this order.',
    );
    result.nextStepText = 'Waiting for a counterparty to accept.';
    result.secondaryAction = guardedSecondary(order, actorId, 'CANCEL', 'Cancel Order');
  }
}

function deriveAccepted(
  result: EnrichedOrderResponse,
  order: OrderForEnrichment,
  actorId: string,
  role: 'buyer' | 'seller' | 'observer',
  hasEscrow: boolean,
) {
  if (!hasEscrow) {
    if (role === 'seller') {
      result.primaryAction = guardedAction(order, actorId, 'LOCK_ESCROW', 'Lock Escrow');
      result.nextStepText = 'Lock USDC in escrow to proceed.';
    } else if (role === 'buyer') {
      result.primaryAction = DISABLED_PRIMARY(
        'Waiting for Escrow',
        'Waiting for the seller to lock USDC in escrow.',
      );
      result.nextStepText = 'Waiting for the seller to lock USDC in escrow.';
    } else {
      // Observer in accepted state — no valid actions
      result.primaryAction = DISABLED_PRIMARY(
        'Order Accepted',
        'This order has been accepted by another participant.',
      );
      result.nextStepText = 'This order has been accepted. Waiting for escrow.';
    }
  } else {
    // Escrow already locked in accepted state (race condition edge case)
    if (role === 'buyer') {
      result.primaryAction = guardedAction(order, actorId, 'SEND_PAYMENT', "I've Paid");
      result.nextStepText = 'Send the fiat payment, then click "I\'ve Paid".';
    } else if (role === 'seller') {
      result.primaryAction = DISABLED_PRIMARY(
        'Wait for Payment',
        'Waiting for the buyer to send fiat payment.',
      );
      result.nextStepText = 'Escrow locked. Waiting for the buyer to send payment.';
    } else {
      result.primaryAction = DISABLED_PRIMARY(
        'Order In Progress',
        'This order is being processed by the participants.',
      );
      result.nextStepText = 'This order is in progress.';
    }
  }
  result.secondaryAction = guardedSecondary(order, actorId, 'CANCEL', 'Cancel Order');
  result.showChat = true;
}

function deriveEscrowed(
  result: EnrichedOrderResponse,
  order: OrderForEnrichment,
  actorId: string,
  role: 'buyer' | 'seller' | 'observer',
) {
  const buyerMerchantId = order.buyer_merchant_id;

  if (role === 'seller') {
    const hasBuyer = !!(buyerMerchantId && buyerMerchantId !== actorId);
    if (hasBuyer) {
      result.primaryAction = DISABLED_PRIMARY(
        'Waiting for Payment',
        'Waiting for the buyer to send fiat payment.',
      );
      result.nextStepText = 'Your USDC is locked. Waiting for fiat payment.';
    } else {
      result.primaryAction = DISABLED_PRIMARY(
        'Waiting for Acceptor',
        'Waiting for another merchant or user to accept this order.',
      );
      result.nextStepText = 'Your USDC is locked. Waiting for a counterparty.';
    }
    result.secondaryAction = guardedSecondary(order, actorId, 'CANCEL', 'Cancel & Refund');
  } else if (role === 'buyer') {
    result.primaryAction = guardedAction(order, actorId, 'SEND_PAYMENT', "I've Paid");
    result.nextStepText = 'Escrow is locked. Send fiat payment, then click "I\'ve Paid".';
  } else {
    // Observer
    const isUnclaimed = !buyerMerchantId;
    if (isUnclaimed) {
      result.primaryAction = guardedAction(order, actorId, 'CLAIM', 'Accept & Mine');
      result.nextStepText = 'Claim this order and send fiat payment.';
    } else {
      result.primaryAction = DISABLED_PRIMARY(
        'Already Claimed',
        'This order has been claimed by another merchant.',
      );
      result.nextStepText = 'This order was claimed by another merchant.';
    }
  }
  result.showChat = role !== 'observer';
}

function derivePaymentSent(
  result: EnrichedOrderResponse,
  order: OrderForEnrichment,
  actorId: string,
  role: 'buyer' | 'seller' | 'observer',
) {
  if (role === 'seller') {
    result.primaryAction = guardedAction(order, actorId, 'CONFIRM_PAYMENT', 'Confirm Payment');
    result.nextStepText = 'Verify you received the fiat payment, then confirm.';
  } else if (role === 'buyer') {
    result.primaryAction = DISABLED_PRIMARY(
      'Waiting for Confirmation',
      'Waiting for the seller to confirm your fiat payment.',
    );
    result.nextStepText = 'Waiting for the seller to confirm payment receipt.';
  } else {
    // Observer should not see payment_sent orders, but handle gracefully
    result.primaryAction = DISABLED_PRIMARY(
      'Trade In Progress',
      'This trade is being completed by the participants.',
    );
    result.nextStepText = 'Payment has been sent. Awaiting seller confirmation.';
  }
  result.secondaryAction = guardedSecondary(order, actorId, 'DISPUTE', 'Open Dispute');
  result.showChat = true;
}

function deriveDisputed(
  result: EnrichedOrderResponse,
  _order: OrderForEnrichment,
  _actorId: string,
  _role: 'buyer' | 'seller' | 'observer',
) {
  // Dispute is a special state — no backend action from this enricher.
  // The dispute resolution flow is handled separately.
  result.primaryAction = {
    type: null,
    label: 'Dispute In Progress',
    enabled: false,
    disabledReason: 'A dispute is being reviewed. No actions available until resolved.',
  };
  result.nextStepText = 'A dispute is in progress. Check the dispute details.';
  result.showChat = true;
}

// ── Guard-synced action builders ──────────────────────────────────────

/**
 * Build a PrimaryAction that is ONLY enabled if handleOrderAction would accept it.
 * This is the critical sync point: if the guard rejects, the button is disabled.
 */
function guardedAction(
  order: OrderForEnrichment,
  actorId: string,
  action: OrderAction,
  label: string,
): PrimaryAction {
  const validation = handleOrderAction(
    {
      id: order.id,
      status: order.status as DbOrderStatus,
      type: order.type,
      user_id: order.user_id,
      merchant_id: order.merchant_id,
      buyer_merchant_id: order.buyer_merchant_id ?? null,
      escrow_debited_entity_id: order.escrow_debited_entity_id ?? null,
      order_version: order.order_version ?? 0,
    },
    action,
    actorId,
  );

  if (validation.success) {
    return { type: action, label, enabled: true };
  }

  // Guard rejected — show disabled with reason
  return {
    type: null,
    label,
    enabled: false,
    disabledReason: validation.error || `Action ${action} is not available.`,
  };
}

/**
 * Build a SecondaryAction only if the guard would accept it.
 * Returns null if the guard rejects (secondary actions are hidden, not disabled).
 */
function guardedSecondary(
  order: OrderForEnrichment,
  actorId: string,
  action: OrderAction,
  label: string,
): SecondaryAction | null {
  const validation = handleOrderAction(
    {
      id: order.id,
      status: order.status as DbOrderStatus,
      type: order.type,
      user_id: order.user_id,
      merchant_id: order.merchant_id,
      buyer_merchant_id: order.buyer_merchant_id ?? null,
      escrow_debited_entity_id: order.escrow_debited_entity_id ?? null,
      order_version: order.order_version ?? 0,
    },
    action,
    actorId,
  );

  if (validation.success) {
    return { type: action, label };
  }

  // Guard rejected — hide the secondary action entirely
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Create a disabled informational primary action (no actionable type) */
function DISABLED_PRIMARY(label: string, disabledReason: string): PrimaryAction {
  return { type: null, label, enabled: false, disabledReason };
}

const STATUS_LABELS: Record<MinimalOrderStatus, string> = {
  open: 'OPEN',
  accepted: 'ACCEPTED',
  escrowed: 'ESCROWED',
  payment_sent: 'PAYMENT SENT',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
  disputed: 'DISPUTED',
};

/**
 * Resolve the caller's role in this order.
 * Uses resolveTradeRole from handleOrderAction for consistency.
 */
function resolveRole(
  order: {
    type: 'buy' | 'sell';
    user_id: string;
    merchant_id: string;
    buyer_merchant_id?: string | null;
  },
  actorId: string,
): 'buyer' | 'seller' | 'observer' {
  const tradeRole = resolveTradeRole(
    {
      type: order.type,
      user_id: order.user_id,
      merchant_id: order.merchant_id,
      buyer_merchant_id: order.buyer_merchant_id ?? null,
    },
    actorId,
  );

  return tradeRole || 'observer';
}
