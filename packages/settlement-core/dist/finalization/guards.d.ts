/**
 * Finalization Post-Commit Invariant Guards
 *
 * These functions validate that finalization operations (release/refund) completed correctly.
 * They run AFTER the database transaction commits to catch any corruption or race conditions.
 *
 * If any invariant fails, we throw an error to trigger monitoring/alerting.
 * The order state is already committed, so this is a DETECTION mechanism, not prevention.
 */
export declare class FinalizationInvariantError extends Error {
    code: string;
    orderId: string;
    details: Record<string, unknown>;
    constructor(code: string, orderId: string, details: Record<string, unknown>, message: string);
}
interface ReleaseInvariantCheck {
    orderId: string;
    expectedStatus: 'completed';
    expectedTxHash: string;
    expectedMinOrderVersion: number;
}
interface RefundInvariantCheck {
    orderId: string;
    expectedStatus: 'cancelled';
    expectedMinOrderVersion: number;
}
/**
 * Verify order finalization invariants after release transaction commits
 *
 * MUST assert:
 * - status = 'completed'
 * - minimal_status = 'completed'
 * - release_tx_hash present and matches expected
 * - order_version incremented
 */
export declare function verifyReleaseInvariants(check: ReleaseInvariantCheck): Promise<void>;
/**
 * Verify order finalization invariants after refund transaction commits
 *
 * MUST assert:
 * - status = 'cancelled'
 * - minimal_status = 'cancelled'
 * - order_version incremented
 * - order_events record exists for cancellation
 * - notification_outbox record exists for cancellation
 */
export declare function verifyRefundInvariants(check: RefundInvariantCheck): Promise<void>;
/**
 * Query helper to find stuck outbox notifications
 * (for monitoring/debugging)
 *
 * Returns notifications that:
 * - Have status 'pending' or 'failed'
 * - Have been retrying for > 5 minutes
 * - Haven't exceeded max attempts
 */
export declare function findStuckOutboxNotifications(): Promise<unknown[]>;
export {};
//# sourceMappingURL=guards.d.ts.map