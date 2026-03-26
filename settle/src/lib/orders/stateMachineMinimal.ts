/**
 * Minimal Order State Machine (8 States)
 *
 * Defines all valid order statuses and allowed transitions for the minimal API.
 * This is the NEW source of truth for order state management.
 *
 * ARCHITECTURE:
 * - 8 statuses: open, accepted, escrowed, payment_sent, completed, cancelled, expired, disputed
 * - ~24 transitions (simplified from 40+ in legacy 12-status machine)
 * - Maps to/from 12-status DB layer via statusNormalizer
 *
 * KEY DIFFERENCES FROM LEGACY STATE MACHINE:
 * - No transient states (escrow_pending, payment_pending, payment_confirmed, releasing)
 * - Cleaner transition graph
 * - All new code should use this machine
 * - Legacy machine kept for backwards compatibility only
 */

import { ActorType, MinimalOrderStatus, OrderStatus } from '../types/database';
import { normalizeStatus } from './statusNormalizer';

// All valid minimal order statuses
export const MINIMAL_ORDER_STATUSES: readonly MinimalOrderStatus[] = [
  'open',
  'accepted',
  'escrowed',
  'payment_sent',
  'completed',
  'cancelled',
  'disputed',
  'expired',
] as const;

// Timeout durations
export const MINIMAL_GLOBAL_ORDER_TIMEOUT_MINUTES = 15; // Open orders timeout
export const MINIMAL_ACCEPTED_ORDER_TIMEOUT_MINUTES = 120; // Accepted+ orders timeout

// Define allowed transitions: from -> to[]
interface MinimalTransitionRule {
  to: MinimalOrderStatus;
  allowedActors: ActorType[];
  description?: string;
}

export const MINIMAL_ALLOWED_TRANSITIONS: Record<MinimalOrderStatus, MinimalTransitionRule[]> = {
  open: [
    { to: 'accepted', allowedActors: ['merchant'], description: 'Merchant accepts order' },
    { to: 'escrowed', allowedActors: ['user', 'merchant', 'system'], description: 'Direct escrow (sell orders)' },
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'], description: 'Cancel before acceptance' },
    { to: 'expired', allowedActors: ['system'], description: 'No one accepted within 15 min' },
  ],
  accepted: [
    { to: 'escrowed', allowedActors: ['user', 'merchant', 'system'], description: 'Lock escrow after acceptance' },
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'], description: 'Cancel after acceptance' },
    { to: 'expired', allowedActors: ['system'], description: 'Timeout after acceptance' },
  ],
  escrowed: [
    { to: 'accepted', allowedActors: ['merchant'], description: 'Merchant accepts escrowed order (M2M/sell)' },
    { to: 'payment_sent', allowedActors: ['user', 'merchant'], description: 'Mark fiat payment as sent' },
    { to: 'completed', allowedActors: ['user', 'merchant', 'system'], description: 'Direct completion after release' },
    { to: 'cancelled', allowedActors: ['user', 'merchant', 'system'], description: 'Cancel with refund' },
    { to: 'disputed', allowedActors: ['user', 'merchant'], description: 'Raise dispute' },
    { to: 'expired', allowedActors: ['system'], description: 'Timeout with escrow locked' },
  ],
  payment_sent: [
    { to: 'completed', allowedActors: ['user', 'merchant', 'system'], description: 'Confirm payment and release' },
    { to: 'disputed', allowedActors: ['user', 'merchant'], description: 'Payment dispute' },
    // No expiry — once fiat is paid, order can only be completed or disputed
  ],
  completed: [], // Terminal state - no transitions allowed
  cancelled: [], // Terminal state - no transitions allowed
  disputed: [
    { to: 'completed', allowedActors: ['system'], description: 'Dispute resolved - release' },
    { to: 'cancelled', allowedActors: ['system'], description: 'Dispute resolved - refund' },
  ],
  expired: [], // Terminal state - no transitions allowed
};

// Terminal states that cannot transition
export const MINIMAL_TERMINAL_STATUSES: readonly MinimalOrderStatus[] = [
  'completed',
  'cancelled',
  'expired',
];

// Active statuses (not terminal)
export const MINIMAL_ACTIVE_STATUSES: readonly MinimalOrderStatus[] = [
  'open',
  'accepted',
  'escrowed',
  'payment_sent',
  'disputed',
];

// Statuses where liquidity should be restored on exit
export const MINIMAL_RESTORE_LIQUIDITY_ON_EXIT: readonly MinimalOrderStatus[] = [
  'open',
  'accepted',
];

export interface MinimalTransitionValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validate if a minimal status transition is allowed
 */
export function validateMinimalTransition(
  currentStatus: MinimalOrderStatus,
  newStatus: MinimalOrderStatus,
  actorType: ActorType
): MinimalTransitionValidation {
  // Same status is always invalid (no-op)
  if (currentStatus === newStatus) {
    return {
      valid: false,
      error: `Order is already in '${currentStatus}' status`,
    };
  }

  // Check if current status is terminal
  if (MINIMAL_TERMINAL_STATUSES.includes(currentStatus)) {
    return {
      valid: false,
      error: `Cannot transition from terminal status '${currentStatus}'`,
    };
  }

  // Get allowed transitions from current status
  const allowedTransitions = MINIMAL_ALLOWED_TRANSITIONS[currentStatus];
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
 * Check if a minimal status is terminal (no further transitions possible)
 */
export function isMinimalTerminalStatus(status: MinimalOrderStatus): boolean {
  return MINIMAL_TERMINAL_STATUSES.includes(status);
}

/**
 * Check if an order is active (not in terminal state)
 */
export function isMinimalActiveStatus(status: MinimalOrderStatus): boolean {
  return MINIMAL_ACTIVE_STATUSES.includes(status);
}

/**
 * Check if liquidity should be restored when transitioning from a minimal status
 */
export function shouldRestoreMinimalLiquidity(
  fromStatus: MinimalOrderStatus,
  toStatus: MinimalOrderStatus
): boolean {
  // Restore liquidity when going to cancelled or expired from early stages
  if (toStatus === 'cancelled' || toStatus === 'expired') {
    return MINIMAL_RESTORE_LIQUIDITY_ON_EXIT.includes(fromStatus);
  }
  return false;
}

/**
 * Get the event type string for a minimal transition
 */
export function getMinimalTransitionEventType(
  fromStatus: MinimalOrderStatus,
  toStatus: MinimalOrderStatus
): string {
  return `status_changed_to_${toStatus}`;
}

/**
 * Get next expiry timeout based on minimal status
 */
export function getMinimalExpiryTimeout(status: MinimalOrderStatus): number | null {
  // Open orders: 15 minutes
  if (status === 'open') {
    return MINIMAL_GLOBAL_ORDER_TIMEOUT_MINUTES;
  }

  // Accepted/escrowed orders: 120 minutes
  if (['accepted', 'escrowed'].includes(status)) {
    return MINIMAL_ACCEPTED_ORDER_TIMEOUT_MINUTES;
  }

  // payment_sent: no expiry — fiat is already sent
  if (status === 'payment_sent') {
    return null;
  }

  // Disputed: 72 hours
  if (status === 'disputed') {
    return 4320; // 72 hours
  }

  return null;
}

/**
 * Get allowed actions for a given minimal status
 *
 * Returns user-friendly action names that can be used in UI.
 */
export function getAllowedActionsForStatus(
  status: MinimalOrderStatus,
  actorType: ActorType
): string[] {
  const transitions = MINIMAL_ALLOWED_TRANSITIONS[status];
  if (!transitions) return [];

  // Filter transitions by actor type
  const allowedTransitions = transitions.filter(t => t.allowedActors.includes(actorType));

  // Map to action names
  const actionMap: Record<MinimalOrderStatus, string> = {
    open: 'create',
    accepted: 'accept',
    escrowed: 'lock_escrow',
    payment_sent: 'mark_paid',
    completed: 'confirm_and_release',
    cancelled: 'cancel',
    disputed: 'dispute',
    expired: 'expire',
  };

  return allowedTransitions.map(t => actionMap[t.to]).filter(Boolean);
}

/**
 * Get timeout outcome for minimal statuses
 *
 * - Open orders → expired (no one accepted)
 * - Accepted (no escrow) → cancelled
 * - Escrowed+ → disputed (escrow locked, needs manual resolution)
 */
export function getMinimalExpiryOutcome(status: MinimalOrderStatus): 'expired' | 'cancelled' | 'disputed' {
  if (status === 'open') {
    return 'expired'; // No one accepted within 15 min
  }

  if (status === 'accepted') {
    return 'cancelled'; // Accepted but no escrow locked
  }

  // Escrowed, payment_sent → disputed (escrow locked, needs manual resolution)
  return 'disputed';
}

/**
 * Check if payment can be marked as sent for an order.
 * Enforces the financial invariant: escrow MUST be locked before payment_sent.
 */
export function canMarkPaymentSent(order: { status: MinimalOrderStatus; escrow_debited_entity_id?: string | null }): boolean {
  return order.status === 'escrowed' && order.escrow_debited_entity_id != null;
}

/**
 * Check if a status requires escrow to be locked
 */
export function requiresEscrow(status: MinimalOrderStatus): boolean {
  return ['escrowed', 'payment_sent'].includes(status);
}

/**
 * Check if a status can transition to completed without escrow release
 */
export function canCompleteWithoutRelease(status: MinimalOrderStatus): boolean {
  // Only payment_sent can complete without explicit release (auto-release)
  return false; // For safety, always require explicit release
}

/**
 * Get user-facing description of what happens in this status
 */
export function getMinimalStatusDescription(status: MinimalOrderStatus): string {
  const descriptions: Record<MinimalOrderStatus, string> = {
    open: 'Order created, waiting for merchant to accept',
    accepted: 'Merchant accepted, waiting for escrow lock',
    escrowed: 'Crypto locked in escrow, waiting for fiat payment',
    payment_sent: 'Fiat payment sent, waiting for confirmation',
    completed: 'Trade completed successfully',
    cancelled: 'Order cancelled',
    disputed: 'Order in dispute, awaiting resolution',
    expired: 'Order expired due to timeout',
  };

  return descriptions[status];
}

/**
 * Get next expected action for a given status
 */
export function getNextExpectedAction(
  status: MinimalOrderStatus,
  orderType: 'buy' | 'sell'
): string {
  if (status === 'open') {
    return 'Waiting for merchant to accept';
  }

  if (status === 'accepted') {
    return orderType === 'buy'
      ? 'Merchant should lock escrow'
      : 'User should lock escrow';
  }

  if (status === 'escrowed') {
    return orderType === 'buy'
      ? 'User should send fiat payment'
      : 'Merchant should send fiat payment';
  }

  if (status === 'payment_sent') {
    return 'Waiting for payment confirmation and escrow release';
  }

  if (status === 'completed') {
    return 'Trade completed';
  }

  if (status === 'cancelled') {
    return 'Order cancelled';
  }

  if (status === 'disputed') {
    return 'Under dispute - awaiting admin resolution';
  }

  if (status === 'expired') {
    return 'Order expired';
  }

  return 'Unknown';
}

export type { MinimalTransitionValidation as TransitionValidation };

export function validateTransition(
  currentStatus: OrderStatus,
  newStatus: OrderStatus,
  actorType: ActorType
): MinimalTransitionValidation {
  const from = normalizeStatus(currentStatus);
  const to = normalizeStatus(newStatus);
  return validateMinimalTransition(from, to, actorType);
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return isMinimalTerminalStatus(normalizeStatus(status));
}

export function isActiveStatus(status: OrderStatus): boolean {
  return isMinimalActiveStatus(normalizeStatus(status));
}

export function shouldRestoreLiquidity(
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): boolean {
  return shouldRestoreMinimalLiquidity(
    normalizeStatus(fromStatus),
    normalizeStatus(toStatus)
  );
}

export function getTransitionEventType(
  fromStatus: OrderStatus,
  toStatus: OrderStatus
): string {
  return getMinimalTransitionEventType(
    normalizeStatus(fromStatus),
    normalizeStatus(toStatus)
  );
}

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

export const GLOBAL_ORDER_TIMEOUT_MINUTES = MINIMAL_GLOBAL_ORDER_TIMEOUT_MINUTES;

export const STATUS_TIMEOUTS: Partial<Record<OrderStatus, number>> = {
  pending: 15,
  accepted: 15,
  escrowed: 15,
  // payment_sent: no expiry — fiat already sent, only completed or disputed
  disputed: 1440,
};

export const INACTIVITY_WARNING_MINUTES = 15;
export const INACTIVITY_ESCALATION_MINUTES = 60;
export const DISPUTE_AUTO_RESOLVE_HOURS = 24;

export const MAX_EXTENSIONS = 3;

export const EXTENSION_DURATIONS: Partial<Record<OrderStatus, number>> = {
  pending: 15,
  accepted: 30,
  escrowed: 60,
  payment_sent: 60, // default; fiat sender can pick from 15, 60, 720 (12hr)
};

// Selectable extension durations for payment_sent (fiat sender picks)
export const PAYMENT_SENT_EXTENSION_OPTIONS = [15, 60, 720] as const; // minutes

export const EXTENDABLE_STATUSES: readonly OrderStatus[] = [
  'pending',
  'accepted',
  'escrowed',
  'payment_sent',
];

export function canRequestExtension(status: OrderStatus): boolean {
  return EXTENDABLE_STATUSES.includes(status);
}

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

export function getExtensionDuration(status: OrderStatus): number {
  return EXTENSION_DURATIONS[status] || 30;
}

export function getExpiryOutcome(
  status: OrderStatus,
  extensionCount: number,
  maxExtensions: number = MAX_EXTENSIONS
): 'disputed' | 'cancelled' {
  if (
    extensionCount >= maxExtensions &&
    ['escrowed', 'payment_sent', 'payment_confirmed'].includes(status)
  ) {
    return 'disputed';
  }
  return 'cancelled';
}

export function canRequestCancel(status: OrderStatus): boolean {
  return ['accepted', 'escrowed', 'payment_pending', 'payment_sent'].includes(status);
}

export function canUnilateralCancel(status: OrderStatus): boolean {
  return status === 'pending' || status === 'escrow_pending';
}

export function isInactivityTracked(status: OrderStatus): boolean {
  return ['accepted', 'escrowed', 'payment_pending', 'payment_sent'].includes(status);
}

export function getInactivityOutcome(
  status: OrderStatus,
  hasEscrow: boolean,
): 'disputed' | 'cancelled' {
  if (hasEscrow && ['escrowed', 'payment_pending', 'payment_sent'].includes(status)) {
    return 'disputed';
  }
  return 'cancelled';
}

export function getStatusTimeout(status: OrderStatus): number | null {
  const minutes = STATUS_TIMEOUTS[status];
  return minutes ? minutes * 60 * 1000 : null;
}

export function getNextExpiryInterval(status: OrderStatus): string | null {
  const intervals: Partial<Record<OrderStatus, string>> = {
    pending: "INTERVAL '15 minutes'",
    accepted: "INTERVAL '15 minutes'",
    escrowed: "INTERVAL '15 minutes'",
    // payment_sent: no expiry interval — fiat already sent
  };
  return intervals[status] || null;
}
