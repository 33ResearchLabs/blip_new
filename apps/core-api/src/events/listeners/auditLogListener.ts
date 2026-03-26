/**
 * Immutable Audit Log Listener
 *
 * Logs every financial action to the `financial_audit_log` table.
 * This table is INSERT-only — no UPDATE or DELETE is ever performed.
 *
 * Covers:
 *   - order created
 *   - payment_sent
 *   - escrow locked (escrowed)
 *   - escrow released (completed)
 *   - order cancelled (with refund tracking)
 *   - dispute opened
 *   - dispute resolved
 *
 * Design:
 *   - Attached to the ORDER_EVENT.STATUS_CHANGED catch-all event
 *   - Fire-and-forget: errors are logged but never block the main flow
 *   - Captures actor, timestamps, order snapshot, and transition metadata
 */

import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../orderEvents';
import { query as dbQuery, logger } from 'settlement-core';

/**
 * Map an order event to an audit action string.
 * Returns null for events that don't need financial audit logging.
 */
function toAuditAction(payload: OrderEventPayload): string | null {
  switch (payload.event) {
    case ORDER_EVENT.CREATED:      return 'order_created';
    case ORDER_EVENT.ESCROWED:     return 'escrow_locked';
    case ORDER_EVENT.PAYMENT_SENT: return 'payment_sent';
    case ORDER_EVENT.COMPLETED:    return 'escrow_released';
    case ORDER_EVENT.CANCELLED:    return 'order_cancelled';
    case ORDER_EVENT.DISPUTED:     return 'dispute_opened';
    case ORDER_EVENT.EXPIRED:      return 'order_expired';
    default:                       return null;
  }
}

async function handleAuditEvent(payload: OrderEventPayload): Promise<void> {
  const action = toAuditAction(payload);
  if (!action) return; // Skip non-financial status changes (e.g. accepted, generic)

  try {
    await dbQuery(
      `INSERT INTO financial_audit_log
       (order_id, actor_type, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        payload.orderId,
        payload.actorType,
        payload.actorId,
        action,
        payload.previousStatus || null,
        payload.newStatus,
        JSON.stringify({
          order_version: payload.orderVersion,
          tx_hash: payload.txHash || null,
          refund_tx_hash: payload.refundTxHash || null,
          buyer_merchant_id: payload.buyerMerchantId || null,
          user_id: payload.userId,
          merchant_id: payload.merchantId,
          ...(payload.metadata || {}),
        }),
      ]
    );
  } catch (err) {
    // Fail-safe: never block the main flow
    logger.error('[AuditLog] Failed to write audit entry (non-fatal)', {
      action,
      orderId: payload.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Also handle dispute resolution events which come through STATUS_CHANGED
 * when a disputed order transitions to completed or cancelled via dispute confirm.
 */
async function handleDisputeResolution(payload: OrderEventPayload): Promise<void> {
  // Only log dispute resolutions — when an order transitions FROM 'disputed'
  if (payload.previousStatus !== 'disputed') return;

  const action = payload.newStatus === 'completed' ? 'dispute_resolved_merchant'
    : payload.newStatus === 'cancelled' ? 'dispute_resolved_user'
    : null;
  if (!action) return;

  try {
    await dbQuery(
      `INSERT INTO financial_audit_log
       (order_id, actor_type, actor_id, action, previous_status, new_status, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        payload.orderId,
        payload.actorType,
        payload.actorId,
        action,
        'disputed',
        payload.newStatus,
        JSON.stringify({
          order_version: payload.orderVersion,
          resolution: payload.metadata?.resolution || null,
          user_id: payload.userId,
          merchant_id: payload.merchantId,
        }),
      ]
    );
  } catch (err) {
    logger.error('[AuditLog] Failed to write dispute resolution audit (non-fatal)', {
      orderId: payload.orderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function registerAuditLogListener(): void {
  // Listen to specific financial events
  orderBus.safeOn(ORDER_EVENT.CREATED, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.ESCROWED, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.PAYMENT_SENT, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.COMPLETED, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.CANCELLED, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.DISPUTED, handleAuditEvent);
  orderBus.safeOn(ORDER_EVENT.EXPIRED, handleAuditEvent);

  // Dispute resolution goes through STATUS_CHANGED
  orderBus.safeOn(ORDER_EVENT.STATUS_CHANGED, handleDisputeResolution);

  logger.info('[AuditLog] Immutable financial audit log listener registered');
}
