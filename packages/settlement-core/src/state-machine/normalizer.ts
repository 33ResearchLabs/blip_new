/**
 * Status Normalization Layer
 *
 * Maps between 12-status database layer and 8-status minimal API layer.
 * This provides backwards compatibility while exposing a simpler API.
 *
 * ARCHITECTURE:
 * - Database: 12 statuses (pending, accepted, escrow_pending, escrowed, payment_pending,
 *             payment_sent, payment_confirmed, releasing, completed, cancelled, disputed, expired)
 * - API: 8 statuses (open, accepted, escrowed, payment_sent, completed, cancelled, disputed, expired)
 *
 * MAPPING RULES:
 * - pending → open
 * - accepted → accepted
 * - escrow_pending → accepted (transient state collapsed)
 * - escrowed → escrowed
 * - payment_pending → escrowed (transient state collapsed)
 * - payment_sent → payment_sent
 * - payment_confirmed → payment_sent (transient state collapsed)
 * - releasing → completed (atomic completion)
 * - completed → completed
 * - cancelled → cancelled
 * - disputed → disputed
 * - expired → expired
 */

import { OrderStatus, MinimalOrderStatus } from '../types/index';

/**
 * Map DB status (12 statuses) to API status (8 statuses)
 *
 * This function normalizes database statuses to the minimal API surface.
 */
export function normalizeStatus(dbStatus: OrderStatus): MinimalOrderStatus {
  const mapping: Record<OrderStatus, MinimalOrderStatus> = {
    pending: 'open',
    accepted: 'accepted',
    escrow_pending: 'accepted', // Transient state - collapse to accepted
    escrowed: 'escrowed',
    payment_pending: 'escrowed', // Transient state - collapse to escrowed
    payment_sent: 'payment_sent',
    payment_confirmed: 'payment_sent', // Transient state - collapse to payment_sent
    releasing: 'completed', // Atomic completion - show as completed
    completed: 'completed',
    cancelled: 'cancelled',
    disputed: 'disputed',
    expired: 'expired',
  };

  return mapping[dbStatus];
}

/**
 * Expand minimal API status to possible DB statuses
 *
 * Used for queries: when filtering by minimal status, we need to include
 * all possible DB statuses that map to it.
 *
 * Example: filtering by 'open' should include 'pending'
 *          filtering by 'accepted' should include 'accepted' and 'escrow_pending'
 */
export function expandStatus(minimalStatus: MinimalOrderStatus): OrderStatus[] {
  const expansion: Record<MinimalOrderStatus, OrderStatus[]> = {
    open: ['pending'],
    accepted: ['accepted', 'escrow_pending'],
    escrowed: ['escrowed', 'payment_pending'],
    payment_sent: ['payment_sent', 'payment_confirmed'],
    completed: ['completed', 'releasing'],
    cancelled: ['cancelled'],
    disputed: ['disputed'],
    expired: ['expired'],
  };

  return expansion[minimalStatus];
}

/**
 * Map API action string to minimal status
 *
 * This normalizes public action names to minimal statuses.
 * Used when clients send actions like "accept", "lock_escrow", etc.
 */
export function normalizeAction(action: string): MinimalOrderStatus | null {
  const actionMapping: Record<string, MinimalOrderStatus> = {
    accept: 'accepted',
    lock_escrow: 'escrowed',
    mark_paid: 'payment_sent',
    confirm_and_release: 'completed',
    cancel: 'cancelled',
    dispute: 'disputed',
  };

  return actionMapping[action] || null;
}

/**
 * Map minimal status to DB status for writes
 *
 * When creating new orders or updating statuses, map from minimal to DB.
 * This prevents new writes from using micro-statuses.
 *
 * NOTE: For most transitions, minimal status maps 1:1 to a canonical DB status.
 * Transient states (escrow_pending, payment_pending, payment_confirmed, releasing)
 * should NOT be written by new code.
 */
export function denormalizeStatus(minimalStatus: MinimalOrderStatus): OrderStatus {
  const mapping: Record<MinimalOrderStatus, OrderStatus> = {
    open: 'pending',
    accepted: 'accepted',
    escrowed: 'escrowed',
    payment_sent: 'payment_sent',
    completed: 'completed',
    cancelled: 'cancelled',
    disputed: 'disputed',
    expired: 'expired',
  };

  return mapping[minimalStatus];
}

/**
 * Check if a DB status is a transient micro-status
 *
 * These statuses should NOT be used in new writes.
 * They exist only for backwards compatibility with historical data.
 */
export function isTransientStatus(dbStatus: OrderStatus): boolean {
  const transientStatuses: OrderStatus[] = [
    'escrow_pending',
    'payment_pending',
    'payment_confirmed',
    'releasing',
  ];

  return transientStatuses.includes(dbStatus);
}

/**
 * Validate that a status write doesn't use transient statuses
 *
 * Throws an error if attempting to write a transient status.
 */
export function validateStatusWrite(status: OrderStatus): void {
  if (isTransientStatus(status)) {
    throw new Error(
      `Cannot write transient status '${status}'. Use minimal status instead: ${normalizeStatus(status)}`
    );
  }
}

/**
 * Get the canonical DB status for a minimal status
 *
 * This is the preferred DB status to write when updating to a minimal status.
 * Excludes transient statuses.
 */
export function getCanonicalStatus(minimalStatus: MinimalOrderStatus): OrderStatus {
  return denormalizeStatus(minimalStatus);
}

/**
 * Check if two statuses are equivalent (normalize to same minimal status)
 */
export function areStatusesEquivalent(status1: OrderStatus, status2: OrderStatus): boolean {
  return normalizeStatus(status1) === normalizeStatus(status2);
}

/**
 * Get display name for minimal status
 *
 * Human-readable status names for UI.
 */
export function getMinimalStatusDisplay(status: MinimalOrderStatus): string {
  const displayNames: Record<MinimalOrderStatus, string> = {
    open: 'Open',
    accepted: 'Accepted',
    escrowed: 'Escrowed',
    payment_sent: 'Payment Sent',
    completed: 'Completed',
    cancelled: 'Cancelled',
    disputed: 'Disputed',
    expired: 'Expired',
  };

  return displayNames[status];
}

/**
 * Get status emoji for minimal status
 */
export function getMinimalStatusEmoji(status: MinimalOrderStatus): string {
  const emojis: Record<MinimalOrderStatus, string> = {
    open: '📋',
    accepted: '✓',
    escrowed: '🔒',
    payment_sent: '💸',
    completed: '✅',
    cancelled: '❌',
    disputed: '⚠️',
    expired: '⏰',
  };

  return emojis[status];
}
