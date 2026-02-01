/**
 * Order State Machine
 *
 * Defines all valid order statuses and allowed transitions.
 * This is the single source of truth for order state management.
 */

import { OrderStatus, ActorType } from '../types/database';

// All valid order statuses
export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'completed',
  'cancelled',
  'disputed',
  'expired',
] as const;

// Timeout durations in minutes
export const STATUS_TIMEOUTS: Partial<Record<OrderStatus, number>> = {
  pending: 15,
  accepted: 30,
  escrowed: 120,
  payment_sent: 240,
  disputed: 4320, // 72 hours
};

// Define allowed transitions: from -> to[]
// Key insight: transitions depend on who is performing the action
interface TransitionRule {
  to: OrderStatus;
  allowedActors: ActorType[];
}

export const ALLOWED_TRANSITIONS: Record<OrderStatus, TransitionRule[]> = {
  pending: [
    { to: 'accepted', allowedActors: ['merchant'] },
    { to: 'escrowed', allowedActors: ['user', 'merchant', 'system'] }, // User can escrow directly (for sell orders), merchant can escrow (for buy orders)
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  accepted: [
    { to: 'escrow_pending', allowedActors: ['merchant', 'system'] },
    { to: 'escrowed', allowedActors: ['user', 'merchant', 'system'] }, // User can also escrow from accepted
    { to: 'payment_sent', allowedActors: ['merchant'] }, // For sell orders: merchant sends fiat after accepting (escrow already locked by user)
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  escrow_pending: [
    { to: 'escrowed', allowedActors: ['system'] },
    { to: 'cancelled', allowedActors: ['system'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  escrowed: [
    { to: 'accepted', allowedActors: ['merchant'] }, // For sell orders: merchant accepts after user locks escrow
    { to: 'payment_pending', allowedActors: ['user', 'merchant', 'system'] },
    { to: 'payment_sent', allowedActors: ['user', 'merchant'] }, // Merchant sends fiat for buy orders, user sends for sell orders
    { to: 'completed', allowedActors: ['user', 'merchant', 'system'] }, // Allow direct completion after escrow release (for buy orders)
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'] },
    { to: 'disputed', allowedActors: ['user', 'merchant'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  payment_pending: [
    { to: 'payment_sent', allowedActors: ['user', 'merchant'] }, // Either party can mark payment as sent
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'] },
    { to: 'disputed', allowedActors: ['user', 'merchant'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  payment_sent: [
    { to: 'payment_confirmed', allowedActors: ['user', 'merchant'] }, // Receiver confirms payment (merchant for sell, user for buy)
    { to: 'completed', allowedActors: ['user', 'merchant', 'system'] }, // For sell orders: user can complete directly after releasing escrow
    { to: 'disputed', allowedActors: ['user', 'merchant'] },
    { to: 'expired', allowedActors: ['system'] },
  ],
  payment_confirmed: [
    { to: 'releasing', allowedActors: ['system'] },
    { to: 'completed', allowedActors: ['user', 'merchant', 'system'] }, // User can complete (releases escrow for sell orders)
    { to: 'disputed', allowedActors: ['user', 'merchant'] },
  ],
  releasing: [
    { to: 'completed', allowedActors: ['system'] },
    { to: 'disputed', allowedActors: ['user', 'merchant'] },
  ],
  completed: [], // Terminal state - no transitions allowed
  cancelled: [], // Terminal state - no transitions allowed
  disputed: [
    { to: 'completed', allowedActors: ['system'] }, // Resolved in favor of user (release)
    { to: 'cancelled', allowedActors: ['system'] }, // Resolved in favor of merchant (refund)
  ],
  expired: [], // Terminal state - no transitions allowed
};

// Terminal states that cannot transition
export const TERMINAL_STATUSES: readonly OrderStatus[] = [
  'completed',
  'cancelled',
  'expired',
];

// Statuses where liquidity should be restored on exit
export const RESTORE_LIQUIDITY_ON_EXIT: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'escrow_pending',
];

// Statuses where the order is considered "active" (not terminal)
export const ACTIVE_STATUSES: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'disputed',
];

export interface TransitionValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate if a status transition is allowed
 */
export function validateTransition(
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
  actorType: ActorType
): TransitionValidation {
  // Same status is always invalid (no-op)
  if (currentStatus === newStatus) {
    return {
      valid: false,
      error: `Order is already in '${currentStatus}' status`,
    };
  }

  // Check if current status is terminal
  if (TERMINAL_STATUSES.includes(currentStatus)) {
    return {
      valid: false,
      error: `Cannot transition from terminal status '${currentStatus}'`,
    };
  }

  // Get allowed transitions from current status
  const allowedTransitions = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowedTransitions || allowedTransitions.length === 0) {
    return {
      valid: false,
      error: `No transitions allowed from status '${currentStatus}'`,
    };
  }

  // Find the specific transition rule
  const transitionRule = allowedTransitions.find(t => t.to === newStatus);
  if (!transitionRule) {
    const allowedTargets = allowedTransitions.map(t => t.to).join(', ');
    return {
      valid: false,
      error: `Transition from '${currentStatus}' to '${newStatus}' is not allowed. Allowed targets: ${allowedTargets}`,
    };
  }

  // Check if actor is allowed to perform this transition
  if (!transitionRule.allowedActors.includes(actorType)) {
    return {
      valid: false,
      error: `Actor type '${actorType}' is not allowed to transition from '${currentStatus}' to '${newStatus}'`,
    };
  }

  return { valid: true };
}

/**
 * Check if a status is terminal (no further transitions possible)
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Check if an order is active (not in terminal state)
 */
export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Get timeout for a status in milliseconds
 */
export function getStatusTimeout(status: OrderStatus): number | null {
  const minutes = STATUS_TIMEOUTS[status];
  return minutes ? minutes * 60 * 1000 : null;
}

/**
 * Check if liquidity should be restored when transitioning from a status
 */
export function shouldRestoreLiquidity(
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): boolean {
  // Restore liquidity when going to cancelled or expired from early stages
  if (toStatus === 'cancelled' || toStatus === 'expired') {
    return RESTORE_LIQUIDITY_ON_EXIT.includes(fromStatus);
  }
  return false;
}

/**
 * Get the event type string for a transition
 */
export function getTransitionEventType(
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): string {
  return `status_changed_to_${toStatus}`;
}

/**
 * Get the timestamp field to update for a given status
 */
export function getTimestampField(status: OrderStatus): string | null {
  const timestampFields: Partial<Record<OrderStatus, string>> = {
    accepted: 'accepted_at',
    escrowed: 'escrowed_at',
    payment_sent: 'payment_sent_at',
    payment_confirmed: 'payment_confirmed_at',
    completed: 'completed_at',
    cancelled: 'cancelled_at',
  };
  return timestampFields[status] || null;
}

/**
 * Get next expiry interval for a given status
 */
export function getNextExpiryInterval(status: OrderStatus): string | null {
  const intervals: Partial<Record<OrderStatus, string>> = {
    pending: "INTERVAL '15 minutes'",
    accepted: "INTERVAL '30 minutes'",
    escrowed: "INTERVAL '2 hours'",
    payment_sent: "INTERVAL '4 hours'",
  };
  return intervals[status] || null;
}

// =====================
// EXTENSION SYSTEM
// =====================

// Maximum number of extensions allowed per order
export const MAX_EXTENSIONS = 3;

// Extension duration in minutes per status
export const EXTENSION_DURATIONS: Partial<Record<OrderStatus, number>> = {
  pending: 15,      // +15 minutes for pending
  accepted: 30,     // +30 minutes for accepted
  escrowed: 60,     // +1 hour for escrowed (waiting for fiat payment)
  payment_sent: 120, // +2 hours for payment_sent (waiting for confirmation)
};

// Statuses that allow extensions
export const EXTENDABLE_STATUSES: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'escrowed',
  'payment_sent',
];

/**
 * Check if a status allows extension requests
 */
export function canRequestExtension(status: OrderStatus): boolean {
  return EXTENDABLE_STATUSES.includes(status);
}

/**
 * Check if an order can be extended (has remaining extensions)
 */
export function canExtendOrder(
  status: OrderStatus,
  currentExtensionCount: number,
  maxExtensions: number = MAX_EXTENSIONS
): { canExtend: boolean; reason?: string } {
  if (!canRequestExtension(status)) {
    return {
      canExtend: false,
      reason: `Extensions not allowed in '${status}' status`
    };
  }

  if (currentExtensionCount >= maxExtensions) {
    return {
      canExtend: false,
      reason: `Maximum extensions (${maxExtensions}) reached`
    };
  }

  return { canExtend: true };
}

/**
 * Get extension duration for a status in minutes
 */
export function getExtensionDuration(status: OrderStatus): number {
  return EXTENSION_DURATIONS[status] || 30; // Default 30 minutes
}

/**
 * Determine what happens when an order expires without extension
 * - If max extensions reached -> disputed
 * - If extension declined -> cancelled
 * - If no response -> cancelled
 */
export function getExpiryOutcome(
  status: OrderStatus,
  extensionCount: number,
  maxExtensions: number = MAX_EXTENSIONS
): 'disputed' | 'cancelled' {
  // After escrowed status and max extensions reached, go to dispute
  // This protects both parties when money is in escrow
  if (
    extensionCount >= maxExtensions &&
    ['escrowed', 'payment_sent', 'payment_confirmed'].includes(status)
  ) {
    return 'disputed';
  }

  // Before escrow or if extensions remain, just cancel
  return 'cancelled';
}
