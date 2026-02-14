/**
 * Status Resolver - Single Source of Truth for Order Status
 *
 * This utility ensures we always use the authoritative 8-state minimal_status
 * instead of legacy 12-state status values.
 */

export type MinimalStatus =
  | 'open'
  | 'accepted'
  | 'escrowed'
  | 'payment_sent'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'disputed';

export type LegacyStatus =
  | 'pending'
  | 'accepted'
  | 'escrow_pending'
  | 'escrowed'
  | 'payment_pending'
  | 'payment_sent'
  | 'payment_confirmed'
  | 'releasing'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'disputed';

/**
 * Get the authoritative status for an order.
 * ALWAYS prefer minimal_status over status field.
 */
export function getAuthoritativeStatus(order: any): MinimalStatus {
  // Priority 1: Use minimal_status if available (authoritative 8-state)
  if (order.minimal_status || order.minimalStatus) {
    const status = order.minimal_status || order.minimalStatus;
    return normalizeToMinimalStatus(status);
  }

  // Priority 2: Use dbOrder.minimal_status if available
  if (order.dbOrder?.minimal_status) {
    return normalizeToMinimalStatus(order.dbOrder.minimal_status);
  }

  // Priority 3: Use status field (might be legacy)
  if (order.status) {
    return normalizeLegacyStatus(order.status);
  }

  // Priority 4: Use dbOrder.status (might be legacy)
  if (order.dbOrder?.status) {
    return normalizeLegacyStatus(order.dbOrder.status);
  }

  // Default fallback
  return 'open';
}

/**
 * Normalize legacy 12-state status to minimal 8-state status
 */
export function normalizeLegacyStatus(legacyStatus: string): MinimalStatus {
  const mapping: Record<string, MinimalStatus> = {
    'pending': 'open',
    'escrow_pending': 'accepted',
    'payment_pending': 'escrowed',
    'payment_confirmed': 'payment_sent',
    'releasing': 'completed',
    // Direct mappings
    'open': 'open',
    'accepted': 'accepted',
    'escrowed': 'escrowed',
    'payment_sent': 'payment_sent',
    'completed': 'completed',
    'cancelled': 'cancelled',
    'expired': 'expired',
    'disputed': 'disputed',
  };

  return mapping[legacyStatus] || 'open';
}

/**
 * Ensure a status string is a valid minimal status
 */
export function normalizeToMinimalStatus(status: string): MinimalStatus {
  const validStatuses: MinimalStatus[] = [
    'open', 'accepted', 'escrowed', 'payment_sent',
    'completed', 'cancelled', 'expired', 'disputed'
  ];

  if (validStatuses.includes(status as MinimalStatus)) {
    return status as MinimalStatus;
  }

  // If not a valid minimal status, try to normalize as legacy
  return normalizeLegacyStatus(status);
}

/**
 * Check if an order version is newer than another
 */
export function isNewerVersion(incoming: number | undefined, current: number | undefined): boolean {
  // If either version is missing, can't determine - assume incoming is newer
  if (incoming === undefined || current === undefined) {
    return true;
  }

  return incoming > current;
}

/**
 * Check if we should accept a websocket update based on version
 */
export function shouldAcceptUpdate(
  incomingVersion: number | undefined,
  currentVersion: number | undefined
): { accept: boolean; reason: string } {
  // No version info - accept but warn
  if (incomingVersion === undefined) {
    return {
      accept: true,
      reason: 'No incoming version - accepting update but should add version to websocket events'
    };
  }

  if (currentVersion === undefined) {
    return {
      accept: true,
      reason: 'No current version - accepting update'
    };
  }

  // Reject stale updates
  if (incomingVersion < currentVersion) {
    return {
      accept: false,
      reason: `Stale update rejected: incoming version ${incomingVersion} < current version ${currentVersion}`
    };
  }

  // Same version - idempotent, accept but don't trigger effects
  if (incomingVersion === currentVersion) {
    return {
      accept: true,
      reason: 'Same version - idempotent update'
    };
  }

  // Newer version - accept
  return {
    accept: true,
    reason: `Accepting newer version: ${incomingVersion} > ${currentVersion}`
  };
}

/**
 * Map minimal status to UI status (for display purposes)
 */
export function mapMinimalStatusToUIStatus(
  minimalStatus: MinimalStatus,
  isMyOrder?: boolean
): 'pending' | 'active' | 'escrow' | 'completed' | 'disputed' | 'cancelled' {
  // CRITICAL: If minimal_status is "completed", ALWAYS show as completed
  if (minimalStatus === 'completed') {
    return 'completed';
  }

  switch (minimalStatus) {
    case 'open':
      return 'pending'; // New Orders
    case 'accepted':
      return 'escrow'; // Accepted orders go to In Progress
    case 'escrowed':
      // If it's MY order and I locked escrow: show in Ongoing
      // If it's SOMEONE ELSE's order: show in New Orders (I can accept it)
      if (isMyOrder) {
        return 'escrow'; // Ongoing - I locked escrow, waiting for acceptor
      }
      return 'pending'; // Available for me to accept
    case 'payment_sent':
      return 'escrow'; // In Progress - payment sent
    case 'cancelled':
      return 'cancelled';
    case 'disputed':
      return 'disputed';
    case 'expired':
      return 'cancelled'; // Show expired as cancelled
    default:
      console.warn(`[UI] Unknown minimal_status: ${minimalStatus}, defaulting to pending`);
      return 'pending';
  }
}

/**
 * Get status badge configuration for UI display
 */
export function getStatusBadgeConfig(minimalStatus: MinimalStatus): {
  color: string;
  label: string;
  bg: string;
  border: string;
} {
  const configs = {
    open: {
      color: 'text-blue-400',
      label: 'OPEN',
      bg: 'bg-blue-500/20',
      border: 'border-blue-500/30',
    },
    accepted: {
      color: 'text-yellow-400',
      label: 'ACCEPTED',
      bg: 'bg-yellow-500/20',
      border: 'border-yellow-500/30',
    },
    escrowed: {
      color: 'text-purple-400',
      label: 'ESCROWED',
      bg: 'bg-purple-500/20',
      border: 'border-purple-500/30',
    },
    payment_sent: {
      color: 'text-orange-400',
      label: 'PAYMENT SENT',
      bg: 'bg-orange-500/20',
      border: 'border-orange-500/30',
    },
    completed: {
      color: 'text-green-400',
      label: 'COMPLETED',
      bg: 'bg-green-500/20',
      border: 'border-green-500/30',
    },
    cancelled: {
      color: 'text-red-400',
      label: 'CANCELLED',
      bg: 'bg-red-500/20',
      border: 'border-red-500/30',
    },
    expired: {
      color: 'text-gray-400',
      label: 'EXPIRED',
      bg: 'bg-gray-500/20',
      border: 'border-gray-500/30',
    },
    disputed: {
      color: 'text-red-400',
      label: 'DISPUTED',
      bg: 'bg-red-500/20',
      border: 'border-red-500/30',
    },
  };

  return configs[minimalStatus] || configs.open;
}

/**
 * Get next action for an order based on its minimal status
 */
export function getNextAction(
  order: any,
  orderType?: 'buy' | 'sell'
): string {
  const status = getAuthoritativeStatus(order);
  const type = orderType || order.orderType || order.type;
  const hasEscrow = !!(order.escrowTxHash || order.escrow_tx_hash || order.dbOrder?.escrow_tx_hash);

  switch (status) {
    case 'open':
      return 'Accept Order';

    case 'accepted':
      if (!hasEscrow) {
        return 'Lock Escrow';
      }
      return 'Wait for Payment';

    case 'escrowed':
      // If it's my order (I created it), wait for someone to accept
      if (order.isMyOrder) {
        return 'Wait for Acceptance';
      }
      // If it's someone else's order, I can accept it
      return 'Accept Order';

    case 'payment_sent':
      // Buy order (merchant selling): User paid → Merchant confirms and releases
      // Sell order (merchant buying): Merchant paid → User confirms and releases (merchant waits)
      return type === 'buy' ? 'Confirm Receipt' : 'Wait for Confirmation';

    case 'completed':
      return 'View Details';

    case 'cancelled':
      return 'View Details';

    case 'expired':
      return 'View Details';

    case 'disputed':
      return 'View Dispute';

    default:
      return 'View Order';
  }
}

/**
 * Handler identifiers for order actions. Maps to actual handler functions in page.tsx.
 */
export type OrderActionHandler =
  | 'acceptOrder'
  | 'lockEscrow'
  | 'signAndProceed'
  | 'signToClaimOrder'
  | 'markFiatPaymentSent'
  | 'confirmPayment'
  | 'openReleaseModal'
  | 'cancelOrder'
  | 'cancelOrderWithoutEscrow'
  | 'openCancelModal'
  | 'openDisputeModal'
  | 'viewDetails'
  | 'none';

/**
 * Derived UI state for a single order. Replaces scattered conditionals
 * across page.tsx and OrderDetailsPanel.tsx.
 */
export interface OrderUIState {
  /** Authoritative minimal status */
  minimalStatus: MinimalStatus;
  /** Human-readable status label */
  statusLabel: string;
  /** Status badge config */
  badge: { color: string; bg: string; border: string };
  /** Primary CTA button */
  primaryAction: {
    label: string;
    handler: OrderActionHandler;
    variant: 'green' | 'blue' | 'red' | 'gold';
    disabled: boolean;
    disabledReason?: string;
  } | null;
  /** Secondary action (e.g. cancel) */
  secondaryAction: {
    label: string;
    handler: OrderActionHandler;
  } | null;
  /** Next step text to display */
  nextStepText: string;
  /** Whether the order is in a terminal state */
  isTerminal: boolean;
  /** Whether to show chat button */
  showChat: boolean;
}

/**
 * deriveOrderUI - Single source of truth for order UI state.
 *
 * Given an order and the current merchant's ID, returns all the UI state
 * needed: status label, action buttons, disabled reasons, next step text.
 */
export function deriveOrderUI(
  order: any,
  myMerchantId: string
): OrderUIState {
  const status = getAuthoritativeStatus(order);
  const badge = getStatusBadgeConfig(status);
  const orderType: 'buy' | 'sell' = order.type || order.orderType || 'buy';
  const isMyOrder = !!(order.is_my_order || order.isMyOrder ||
    order.merchant_id === myMerchantId || order.orderMerchantId === myMerchantId);
  const hasEscrow = !!(order.escrowTxHash || order.escrow_tx_hash ||
    order.dbOrder?.escrow_tx_hash || order.escrow_tx_hash);
  const isM2M = !!(order.isM2M || order.buyer_merchant_id || order.dbOrder?.buyer_merchant_id);
  const isTerminal = ['completed', 'cancelled', 'expired'].includes(status);

  // Base state
  const result: OrderUIState = {
    minimalStatus: status,
    statusLabel: badge.label,
    badge: { color: badge.color, bg: badge.bg, border: badge.border },
    primaryAction: null,
    secondaryAction: null,
    nextStepText: '',
    isTerminal,
    showChat: !isTerminal && status !== 'open',
  };

  switch (status) {
    case 'open':
      result.primaryAction = {
        label: 'Accept Order',
        handler: 'acceptOrder',
        variant: 'green',
        disabled: false,
      };
      result.nextStepText = 'Accept this order to start the trade.';
      break;

    case 'accepted':
      if (!hasEscrow) {
        // Need to lock escrow
        if (orderType === 'buy' || (orderType === 'sell' && isMyOrder)) {
          result.primaryAction = {
            label: 'Lock Escrow',
            handler: 'lockEscrow',
            variant: 'blue',
            disabled: false,
          };
          result.nextStepText = 'Lock USDC in escrow to proceed.';
        } else {
          // Sell order where I'm the buyer - I need to sign
          result.primaryAction = {
            label: 'Sign & Proceed',
            handler: 'signAndProceed',
            variant: 'blue',
            disabled: false,
          };
          result.nextStepText = 'Sign to confirm and proceed with the trade.';
        }
      } else {
        // Escrow already locked, waiting for payment
        result.primaryAction = {
          label: "I've Paid",
          handler: 'markFiatPaymentSent',
          variant: 'blue',
          disabled: false,
        };
        result.nextStepText = 'Send the fiat payment, then click "I\'ve Paid".';
      }
      result.secondaryAction = {
        label: 'Cancel Order',
        handler: hasEscrow ? 'openCancelModal' : 'cancelOrderWithoutEscrow',
      };
      result.showChat = true;
      break;

    case 'escrowed':
      if (isMyOrder) {
        // I locked escrow, waiting for someone to accept
        result.primaryAction = {
          label: 'Waiting for Acceptor',
          handler: 'none',
          variant: 'blue',
          disabled: true,
          disabledReason: 'Waiting for another merchant or user to accept this order.',
        };
        result.nextStepText = 'Your USDC is locked. Waiting for a counterparty.';
        result.secondaryAction = {
          label: 'Cancel & Refund',
          handler: 'openCancelModal',
        };
      } else {
        // Someone else's escrowed order - I can claim/accept it
        result.primaryAction = {
          label: 'Claim Order',
          handler: 'signToClaimOrder',
          variant: 'green',
          disabled: false,
        };
        result.nextStepText = 'Claim this order and send fiat payment.';
      }
      result.showChat = true;
      break;

    case 'payment_sent':
      if (orderType === 'buy') {
        // Buy order: user paid, merchant confirms receipt and releases
        result.primaryAction = {
          label: 'Confirm Receipt & Release',
          handler: hasEscrow ? 'openReleaseModal' : 'confirmPayment',
          variant: 'green',
          disabled: false,
        };
        result.nextStepText = 'Verify the fiat payment, then release the escrow.';
      } else {
        // Sell order: merchant paid, waiting for user to confirm
        result.primaryAction = {
          label: 'Waiting for Confirmation',
          handler: 'none',
          variant: 'blue',
          disabled: true,
          disabledReason: 'The buyer will confirm receipt of your fiat payment.',
        };
        result.nextStepText = 'Waiting for the buyer to confirm payment receipt.';
      }
      result.secondaryAction = {
        label: 'Open Dispute',
        handler: 'openDisputeModal',
      };
      result.showChat = true;
      break;

    case 'disputed':
      result.primaryAction = {
        label: 'View Dispute',
        handler: 'openDisputeModal',
        variant: 'red',
        disabled: false,
      };
      result.nextStepText = 'A dispute is in progress. Check the dispute details.';
      result.showChat = true;
      break;

    case 'completed':
      result.statusLabel = 'COMPLETED';
      result.nextStepText = 'This trade has been completed successfully.';
      break;

    case 'cancelled':
      result.statusLabel = 'CANCELLED';
      result.nextStepText = 'This order was cancelled.';
      break;

    case 'expired':
      result.statusLabel = 'EXPIRED';
      result.nextStepText = 'This order has expired.';
      break;
  }

  return result;
}
