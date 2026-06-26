/**
 * Shared appeal → dispute escalation.
 *
 * Used by:
 *   - the appeal "reject" endpoint   (actor = the rejecting counterparty)
 *   - the appeal-timeout worker       (actor = system, after the deadline)
 *
 * MUST run inside an existing transaction in which BOTH the appeal row and the
 * order row are already locked FOR UPDATE by the caller. Performs, atomically:
 *   appeal → 'escalated'
 *   dispute row created (idempotent — one dispute per order)
 *   order   → 'disputed' (version + status guarded)
 *   order_events + notification_outbox + system chat message + outbox event
 *
 * It NEVER touches escrow — funds stay locked for compliance to resolve. The
 * 24h auto-resolve safety net is only armed when escrow is actually locked;
 * no-escrow disputes are left for compliance (dispute_auto_resolve_at = NULL).
 *
 * A single source of truth so the endpoint and worker can never drift.
 */
import { normalizeStatus, logger } from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEvent } from '../outbox';

type TxClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export interface EscalateAppealArgs {
  appeal: { id: string; issue_key: string };
  order: {
    id: string;
    status: string;
    user_id: string;
    merchant_id: string | null;
    order_version: number;
  };
  /** The actor driving the escalation. `system` (with id null) for the worker. */
  actor: { type: 'user' | 'merchant' | 'system'; id: string | null };
  reason: 'appeal_rejected' | 'appeal_timeout';
}

export interface EscalateAppealResult {
  order: Record<string, unknown>;
  chatMessage: { id: string; sender_id: string | null; content: string; created_at: string } | null;
}

export async function escalateAppealToDispute(
  client: TxClient,
  { appeal, order, actor, reason }: EscalateAppealArgs,
): Promise<EscalateAppealResult> {
  // 1. Mark the appeal escalated (guard: only an active appeal can escalate).
  await client.query(
    `UPDATE appeals
        SET status = 'escalated'::appeal_status, escalated_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status IN ('open', 'proposed')`,
    [appeal.id],
  );

  // 2. Create the dispute (idempotent — unique_dispute_per_order is the backstop).
  const disputeDescription =
    reason === 'appeal_timeout'
      ? `Auto-escalated: mutual-cancellation appeal timed out with no response (issue: ${appeal.issue_key}).`
      : `Mutual-cancellation appeal rejected by ${actor.type} — escalated to dispute (issue: ${appeal.issue_key}).`;
  await client.query(
    `INSERT INTO disputes (
        order_id, reason, description, raised_by, raiser_id, status,
        user_confirmed, merchant_confirmed, initiated_by, created_at
     )
     VALUES ($1, 'other'::dispute_reason, $2, $3::actor_type, $4, 'open'::dispute_status,
             false, false, 'appeal_escalation', NOW())
     ON CONFLICT (order_id) DO NOTHING`,
    [order.id, disputeDescription, actor.type, actor.id],
  );

  // 3. Move the order to disputed. Version + status guard preserves the
  //    optimistic-concurrency contract. dispute_auto_resolve_at is armed ONLY
  //    when escrow is locked (no-escrow disputes are compliance-only).
  const upd = await client.query(
    `UPDATE orders
        SET status = 'disputed'::order_status,
            disputed_at = NOW(),
            disputed_by = $2,
            disputed_by_id = $3,
            dispute_auto_resolve_at = CASE WHEN escrow_tx_hash IS NOT NULL
                                           THEN NOW() + INTERVAL '24 hours'
                                           ELSE NULL END,
            appeal_status = NULL,
            appeal_deadline = NULL,
            last_activity_at = NOW(),
            order_version = order_version + 1
      WHERE id = $1
        AND order_version = $4
        AND status IN ('accepted'::order_status, 'escrowed'::order_status, 'payment_sent'::order_status)
      RETURNING *`,
    [order.id, actor.type, actor.id, order.order_version],
  );
  if (upd.rows.length === 0) {
    // Someone moved the order between the caller's lock and here, or it was not
    // in an escalatable status. Roll the whole transaction back.
    throw new Error('ORDER_VERSION_CONFLICT');
  }
  const updatedOrder = upd.rows[0] as Record<string, unknown> & { order_version: number };

  // 4. Audit event (actor_id may be NULL for the system/worker path).
  await client.query(
    `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
     VALUES ($1, 'appeal_escalated', $2::actor_type, $3, $4, 'disputed', $5)`,
    [
      order.id,
      actor.type,
      actor.id,
      order.status,
      JSON.stringify({ appeal_id: appeal.id, issue_key: appeal.issue_key, reason }),
    ],
  );

  // 5. Notify both parties.
  await client.query(
    `INSERT INTO notification_outbox (order_id, event_type, payload, status)
     VALUES ($1, 'ORDER_DISPUTED', $2, 'pending')`,
    [
      order.id,
      JSON.stringify({
        orderId: order.id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        status: 'disputed',
        previousStatus: order.status,
        reason,
        updatedAt: new Date().toISOString(),
      }),
    ],
  );

  // 6. System chat message (human-readable; renders as a centered system pill).
  //    message_type 'text' (not 'system') so it shows inline in the thread — see
  //    the note in appeal.ts open handler for why system-sender 'text' is used.
  const chatContent =
    reason === 'appeal_timeout'
      ? '⚖️ The appeal timed out with no agreement and was sent to a moderator for review. The crypto stays locked until the moderator makes a decision — no action is needed from either party right now.'
      : '⚖️ The appeal was sent to a moderator for review. The crypto stays locked until the moderator makes a decision — no action is needed from either party right now.';
  const chatInsert = await client.query(
    `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
     VALUES ($1, 'system', $1, $2, 'text')
     RETURNING id, sender_id, content, created_at`,
    [order.id, chatContent],
  );

  // 7. Outbox event — committed atomically with the mutation. Drives realtime
  //    broadcast + all existing listeners. actorId is a required string, so the
  //    system/worker path reports 'system'.
  await insertOutboxEvent(client, {
    event: ORDER_EVENT.DISPUTED,
    orderId: order.id,
    previousStatus: order.status,
    newStatus: 'disputed',
    actorType: actor.type,
    actorId: actor.id ?? 'system',
    userId: order.user_id,
    merchantId: order.merchant_id,
    order: updatedOrder,
    orderVersion: updatedOrder.order_version,
    minimalStatus: normalizeStatus('disputed'),
    metadata: { appeal_id: appeal.id, reason },
  });

  logger.info('[Appeal] Escalated to dispute', {
    orderId: order.id,
    appealId: appeal.id,
    reason,
    actor: actor.type,
  });

  return { order: updatedOrder, chatMessage: chatInsert.rows[0] ?? null };
}
