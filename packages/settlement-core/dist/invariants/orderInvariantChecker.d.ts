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
export declare class PreCommitInvariantError extends Error {
    code: string;
    constructor(code: string, message: string);
}
export declare function checkInvariants(order: InvariantOrder, events: InvariantEvent[], ledgerEntries?: InvariantLedgerEntry[]): {
    ok: boolean;
    violations: string[];
};
export declare function checkPreCommit(order: InvariantOrder, intendedStatus: string, context?: PreCommitContext): void;
//# sourceMappingURL=orderInvariantChecker.d.ts.map