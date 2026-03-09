/**
 * Centralized Order Invariant Checker
 *
 * Two exports:
 *   checkInvariants(order, events, ledgerEntries?)  — read-only audit (9 rules)
 *   checkPreCommit(order, intendedStatus, context?)  — throws if transition must be blocked (4 rules)
 *
 * Pure functions. No DB queries. Used by:
 *   - /ops/orders/:id/debug (always)
 *   - PATCH /orders/:id (pre-commit guard)
 */

// ─── Types (minimal, compatible with existing Order + EventRow) ───

export interface InvariantOrder {
  id: string;
  status: string;
  escrow_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  completed_at: string | Date | null;
  cancelled_at: string | Date | null;
  merchant_id: string;
  buyer_merchant_id: string | null;
  order_version: number;
}

export interface InvariantEvent {
  event_type: string;
  new_status: string | null;
  old_status: string | null;
}

export interface InvariantLedgerEntry {
  entry_type: string;
  amount: number | string;
  idempotency_key: string | null;
}

export interface PreCommitContext {
  hasReleaseTxHash?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────

const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'expired']);

const POST_ESCROW_STATUSES = new Set([
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'completed',
]);

const TRANSIENT_STATUSES = new Set(['escrow_pending', 'releasing']);

// ─── Error class ──────────────────────────────────────────────────

export class PreCommitInvariantError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PreCommitInvariantError';
  }
}

// ─── Post-hoc audit (9 invariants) ───────────────────────────────

export function checkInvariants(
  order: InvariantOrder,
  events: InvariantEvent[],
  ledgerEntries?: InvariantLedgerEntry[]
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];

  // 1. Completed orders must have release_tx_hash
  if (order.status === 'completed' && !order.release_tx_hash) {
    violations.push('Completed order missing release_tx_hash');
  }

  // 2. release_tx_hash implies escrow_tx_hash
  if (order.release_tx_hash && !order.escrow_tx_hash) {
    violations.push('release_tx_hash exists without escrow_tx_hash');
  }

  // 3. Terminal status finality: no non-terminal status after a terminal one
  const chronological = [...events].reverse();
  let hitTerminal = false;
  for (const e of chronological) {
    if (hitTerminal && e.new_status && !TERMINAL_STATUSES.has(e.new_status)) {
      violations.push(
        `Event after terminal status: ${e.event_type} moved to ${e.new_status}`
      );
    }
    if (e.new_status && TERMINAL_STATUSES.has(e.new_status)) {
      hitTerminal = true;
    }
  }

  // 4. Completed orders must have completed_at
  if (order.status === 'completed' && !order.completed_at) {
    violations.push('Completed order missing completed_at');
  }

  // 5. Cancelled orders must have cancelled_at
  if (order.status === 'cancelled' && !order.cancelled_at) {
    violations.push('Cancelled order missing cancelled_at');
  }

  // 6. Post-escrow statuses must have escrow_tx_hash
  if (POST_ESCROW_STATUSES.has(order.status) && !order.escrow_tx_hash) {
    violations.push(`Order in '${order.status}' status missing escrow_tx_hash`);
  }

  // 7. refund_tx_hash implies escrow_tx_hash
  if (order.refund_tx_hash && !order.escrow_tx_hash) {
    violations.push('refund_tx_hash exists without escrow_tx_hash');
  }

  // 8. Ledger: no duplicate non-null idempotency_keys
  if (ledgerEntries && ledgerEntries.length > 0) {
    const keys = ledgerEntries
      .map((e) => e.idempotency_key)
      .filter((k): k is string => k != null);
    const unique = new Set(keys);
    if (keys.length !== unique.size) {
      const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
      violations.push(`Duplicate ledger idempotency_keys: ${[...new Set(dupes)].join(', ')}`);
    }
  }

  // 9. order_version >= 1 for any non-pending order
  if (order.status !== 'pending' && order.order_version < 1) {
    violations.push(`Non-pending order has order_version ${order.order_version}, expected >= 1`);
  }

  return { ok: violations.length === 0, violations };
}

// ─── Pre-commit guard (4 checks) ─────────────────────────────────

export function checkPreCommit(
  order: InvariantOrder,
  intendedStatus: string,
  context?: PreCommitContext
): void {
  // 1. No transition from terminal status
  if (TERMINAL_STATUSES.has(order.status)) {
    throw new PreCommitInvariantError(
      'TERMINAL_STATUS',
      `Cannot transition from terminal status '${order.status}'`
    );
  }

  // 2. No completion with escrow but without release_tx_hash
  if (
    intendedStatus === 'completed' &&
    order.escrow_tx_hash &&
    !order.release_tx_hash &&
    !context?.hasReleaseTxHash
  ) {
    throw new PreCommitInvariantError(
      'COMPLETION_WITHOUT_RELEASE',
      'Cannot complete order with escrow but without release_tx_hash'
    );
  }

  // 3. Self-reference: merchant_id === buyer_merchant_id (except accept/cancel)
  if (
    order.merchant_id &&
    order.buyer_merchant_id &&
    order.merchant_id === order.buyer_merchant_id &&
    intendedStatus !== 'accepted' &&
    intendedStatus !== 'cancelled'
  ) {
    throw new PreCommitInvariantError(
      'SELF_REFERENCE',
      'Order has merchant_id === buyer_merchant_id — blocked for non-accept/cancel transitions'
    );
  }

  // 4. No API writes of transient statuses
  if (TRANSIENT_STATUSES.has(intendedStatus)) {
    throw new PreCommitInvariantError(
      'TRANSIENT_STATUS',
      `Cannot write transient status '${intendedStatus}' via API`
    );
  }
}
