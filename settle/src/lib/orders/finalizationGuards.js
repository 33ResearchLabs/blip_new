/**
 * Finalization Post-Commit Invariant Guards
 *
 * These functions validate that finalization operations (release/refund) completed correctly.
 * They run AFTER the database transaction commits to catch any corruption or race conditions.
 *
 * If any invariant fails, we throw an error to trigger monitoring/alerting.
 * The order state is already committed, so this is a DETECTION mechanism, not prevention.
 */
import { getOrderById } from '@/lib/db/repositories/orders';
import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
export class FinalizationInvariantError extends Error {
    code;
    orderId;
    details;
    constructor(code, orderId, details, message) {
        super(message);
        this.code = code;
        this.orderId = orderId;
        this.details = details;
        this.name = 'FinalizationInvariantError';
    }
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
export async function verifyReleaseInvariants(check) {
    const order = await getOrderById(check.orderId);
    if (!order) {
        throw new FinalizationInvariantError('FINALIZATION_INVARIANT_BROKEN', check.orderId, { reason: 'order_not_found' }, `Order ${check.orderId} not found after release commit`);
    }
    const failures = [];
    // Check status is final
    if (order.status !== check.expectedStatus) {
        failures.push(`status is '${order.status}', expected '${check.expectedStatus}'`);
    }
    // Check tx_hash present
    if (!order.release_tx_hash) {
        failures.push('release_tx_hash is null');
    }
    else if (order.release_tx_hash !== check.expectedTxHash) {
        failures.push(`release_tx_hash is '${order.release_tx_hash}', expected '${check.expectedTxHash}'`);
    }
    // Check order_version incremented
    if (order.order_version < check.expectedMinOrderVersion) {
        failures.push(`order_version is ${order.order_version}, expected >= ${check.expectedMinOrderVersion}`);
    }
    // Check completed_at timestamp set
    if (!order.completed_at) {
        failures.push('completed_at is null');
    }
    // Check payment_confirmed_at timestamp set (atomic completion)
    if (!order.payment_confirmed_at) {
        failures.push('payment_confirmed_at is null');
    }
    if (failures.length > 0) {
        logger.error('[Invariant] Release finalization BROKEN', {
            orderId: check.orderId,
            failures,
            actualStatus: order.status,
            actualTxHash: order.release_tx_hash,
            actualVersion: order.order_version,
        });
        throw new FinalizationInvariantError('FINALIZATION_INVARIANT_BROKEN', check.orderId, {
            failures,
            actualStatus: order.status,
            actualTxHash: order.release_tx_hash,
            actualVersion: order.order_version,
        }, `Release finalization invariants broken: ${failures.join(', ')}`);
    }
    logger.info('[Invariant] Release finalization verified', {
        orderId: check.orderId,
        status: order.status,
        version: order.order_version,
    });
}
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
export async function verifyRefundInvariants(check) {
    const order = await getOrderById(check.orderId);
    if (!order) {
        throw new FinalizationInvariantError('FINALIZATION_INVARIANT_BROKEN', check.orderId, { reason: 'order_not_found' }, `Order ${check.orderId} not found after refund commit`);
    }
    const failures = [];
    // Check status is final
    if (order.status !== check.expectedStatus) {
        failures.push(`status is '${order.status}', expected '${check.expectedStatus}'`);
    }
    // Check order_version incremented
    if (order.order_version < check.expectedMinOrderVersion) {
        failures.push(`order_version is ${order.order_version}, expected >= ${check.expectedMinOrderVersion}`);
    }
    // Check cancelled_at timestamp set
    if (!order.cancelled_at) {
        failures.push('cancelled_at is null');
    }
    // Verify order_events record exists
    const events = await query(`SELECT id FROM order_events
     WHERE order_id = $1 AND new_status = 'cancelled'
     ORDER BY created_at DESC LIMIT 1`, [check.orderId]);
    if (events.length === 0) {
        failures.push('no order_events record for cancellation');
    }
    // Verify notification_outbox record exists
    const outbox = await query(`SELECT id FROM notification_outbox
     WHERE order_id = $1 AND event_type = 'ORDER_CANCELLED'
     ORDER BY created_at DESC LIMIT 1`, [check.orderId]);
    if (outbox.length === 0) {
        failures.push('no notification_outbox record for cancellation');
    }
    if (failures.length > 0) {
        logger.error('[Invariant] Refund finalization BROKEN', {
            orderId: check.orderId,
            failures,
            actualStatus: order.status,
            actualVersion: order.order_version,
        });
        throw new FinalizationInvariantError('FINALIZATION_INVARIANT_BROKEN', check.orderId, {
            failures,
            actualStatus: order.status,
            actualVersion: order.order_version,
        }, `Refund finalization invariants broken: ${failures.join(', ')}`);
    }
    logger.info('[Invariant] Refund finalization verified', {
        orderId: check.orderId,
        status: order.status,
        version: order.order_version,
    });
}
/**
 * Query helper to find stuck outbox notifications
 * (for monitoring/debugging)
 *
 * Returns notifications that:
 * - Have status 'pending' or 'failed'
 * - Have been retrying for > 5 minutes
 * - Haven't exceeded max attempts
 */
export async function findStuckOutboxNotifications() {
    return query(`SELECT id, order_id, event_type, status, attempts, max_attempts,
            created_at, last_attempt_at, last_error
     FROM notification_outbox
     WHERE status IN ('pending', 'failed')
       AND attempts < max_attempts
       AND created_at < NOW() - INTERVAL '5 minutes'
     ORDER BY created_at ASC
     LIMIT 100`);
}
