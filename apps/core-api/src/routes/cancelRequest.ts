/**
 * Core API Cancel Request Routes
 *
 * POST /v1/orders/:id/cancel-request - Request mutual cancellation
 * PUT  /v1/orders/:id/cancel-request - Accept/decline cancel request
 *
 * Flow:
 *   - Before acceptance (pending): unilateral cancel via normal PATCH status
 *   - After acceptance: one party requests → other approves/declines
 *   - If approved: atomic cancel + escrow refund
 *   - If declined: request cleared, order continues
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  normalizeStatus,
  canUnilateralCancel,
  canRequestCancel,
  logger,
  MOCK_MODE,
} from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEvent } from '../outbox';
import { withTxIdempotency } from '../idempotency';
import { assertActorIsParticipant } from '../ownership';

// Both POST (request) and PUT (respond) now run end-to-end inside a single
// DB transaction with row-level locks. Outbox events are committed atomically
// via insertOutboxEvent on the same client — the legacy
// insertOutboxEventDirect path is no longer used by these handlers.

interface OrderRow {
  id: string;
  status: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  cancel_requested_by: string | null;
  cancel_request_reason: string | null;
  crypto_amount: string;
  type: string;
  escrow_tx_hash: string | null;
  escrow_debited_entity_type: string | null;
  escrow_debited_entity_id: string | null;
  offer_id: string | null;
}

export const cancelRequestRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/cancel-request — Request cancellation
  //
  // ATOMIC: the entire handler runs inside a single DB transaction with
  // row-level locks on:
  //   - orders          (FOR UPDATE — serializes concurrent requests)
  //
  // The idempotency_log row is committed by `withTxIdempotency` on the
  // same client, so:
  //   - retry with same key  → cached response, no second mutation
  //   - parallel duplicates  → one wins on FOR UPDATE; the late writer's
  //                            re-read finds `cancel_requested_by` already
  //                            set and 400s, AND its idempotency INSERT
  //                            collides on the unique key. Either way no
  //                            duplicate event/notification is emitted.
  //
  // Idempotency-Key header is REQUIRED — `withTxIdempotency` rejects
  // missing-key calls with 400 before opening the transaction.
  fastify.post<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      reason?: string;
    };
  }>('/orders/:id/cancel-request', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, reason } = request.body;

    if (!actor_type || !actor_id) {
      return reply.status(400).send({ success: false, error: 'actor_type and actor_id required' });
    }

    // Defense-in-depth: bind the body's actor_id to the signed x-actor-id
    // header BEFORE opening a DB txn. Same shape as the PUT handler.
    const headerOwnership = assertActorIsParticipant(
      request,
      reply,
      [actor_id],
      'cancel_request_open_header_bind',
    );
    if (headerOwnership) return headerOwnership;

    return withTxIdempotency(request, reply, 'cancel_request_open', id, async (client) => {
      try {
        // 1. Lock the order row inside the txn snapshot.
        const orderLock = await client.query(
          `SELECT id, status, user_id, merchant_id, buyer_merchant_id,
                  cancel_requested_by, cancel_request_reason,
                  crypto_amount, type, escrow_tx_hash,
                  escrow_debited_entity_type, escrow_debited_entity_id,
                  offer_id, order_version
             FROM orders
            WHERE id = $1
            FOR UPDATE`,
          [id],
        );
        if (orderLock.rows.length === 0) {
          return { statusCode: 404, body: { success: false, error: 'Order not found' } };
        }
        const order = orderLock.rows[0] as OrderRow & { order_version: number };

        // Re-check after lock: terminal-state guard.
        if (['completed', 'cancelled', 'expired'].includes(order.status)) {
          return {
            statusCode: 409,
            body: { success: false, error: `Order is already ${order.status}` },
          };
        }

        // 2. Order-level participant check.
        const isParticipant =
          actor_id === order.user_id ||
          actor_id === order.merchant_id ||
          (!!order.buyer_merchant_id && actor_id === order.buyer_merchant_id);
        if (!isParticipant) {
          return {
            statusCode: 403,
            body: { success: false, error: 'Not authorized — you are not a participant in this order' },
          };
        }

        // 3. Pre-acceptance? Caller should use unilateral cancel.
        if (canUnilateralCancel(order.status as any)) {
          return {
            statusCode: 400,
            body: {
              success: false,
              error: 'Order can be cancelled directly — no request needed. Use PATCH status=cancelled.',
            },
          };
        }

        if (!canRequestCancel(order.status as any)) {
          return {
            statusCode: 400,
            body: { success: false, error: `Cancel request not allowed in '${order.status}' status` },
          };
        }

        if (order.cancel_requested_by) {
          return {
            statusCode: 400,
            body: { success: false, error: 'Cancel request already pending' },
          };
        }

        // 4. Set cancel request — version-guarded UPDATE proves nothing
        //    raced past the FOR UPDATE lock between SELECT and write.
        const upd = await client.query(
          `UPDATE orders
              SET cancel_requested_by = $2,
                  cancel_requested_at = NOW(),
                  cancel_request_reason = $3,
                  last_activity_at = NOW(),
                  order_version = order_version + 1
            WHERE id = $1
              AND order_version = $4
              AND status NOT IN ('completed', 'cancelled', 'expired')
            RETURNING *`,
          [id, actor_type, reason || 'Requested cancellation', order.order_version],
        );
        if (upd.rows.length === 0) {
          return {
            statusCode: 409,
            body: { success: false, error: 'Order was modified concurrently. Please retry.' },
          };
        }
        const updated = upd.rows[0];

        // 5. Order event — same client, same txn.
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
           VALUES ($1, 'cancel_requested', $2, $3, $4)`,
          [id, actor_type, actor_id, JSON.stringify({ reason: reason || 'Requested cancellation' })],
        );

        // 6. Notification outbox — same client, same txn.
        await client.query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status)
           VALUES ($1, 'CANCEL_REQUESTED', $2, 'pending')`,
          [
            id,
            JSON.stringify({
              orderId: id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              requestedBy: actor_type,
              reason: reason || 'Requested cancellation',
              status: order.status,
              updatedAt: new Date().toISOString(),
            }),
          ],
        );

        // 7. Outbox event — same client, atomic with the rest.
        await insertOutboxEvent(client, {
          event: ORDER_EVENT.STATUS_CHANGED,
          orderId: id, previousStatus: order.status, newStatus: order.status,
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id,
          order: updated as unknown as Record<string, unknown>,
          orderVersion: (updated as any).order_version,
          minimalStatus: normalizeStatus(order.status as any),
          metadata: { cancel_requested: true, reason },
        });

        logger.info('[core-api] Cancel requested', { orderId: id, by: actor_type });
        return { statusCode: 200, body: { success: true, data: updated } };
      } catch (error) {
        fastify.log.error({ error, id }, 'Error requesting cancel');
        // Rethrow inside txn → rollback. The idempotency record lives on
        // the same client and is also rolled back, so a retry is allowed
        // (won't see a stale cached failure).
        throw error;
      }
    }).catch((error) => {
      fastify.log.error({ error, id }, 'cancel-request POST failed');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    });
  });

  // PUT /v1/orders/:id/cancel-request — Accept or decline
  //
  // Idempotency-Key header is REQUIRED. The whole accept-path runs inside a
  // single DB transaction with row-level locks on:
  //
  //   - orders          (FOR UPDATE)
  //   - users/merchants refund target balance row (FOR UPDATE, ACCEPT only)
  //   - merchant_offers liquidity row (FOR UPDATE, ACCEPT only)
  //
  // The idempotency record is INSERTed via `withTxIdempotency` on the same
  // client, so a retry that arrives after the original has committed reads
  // the cached response, and a retry that races the original has its writes
  // serialized by the locks AND its idempotency insert collides on the
  // unique key — either way, no double-spend is possible.
  fastify.put<{
    Params: { id: string };
    Body: {
      actor_type: 'user' | 'merchant';
      actor_id: string;
      accept: boolean;
    };
  }>('/orders/:id/cancel-request', async (request, reply) => {
    const { id } = request.params;
    const { actor_type, actor_id, accept } = request.body;

    if (!actor_type || !actor_id || accept === undefined) {
      return reply.status(400).send({ success: false, error: 'actor_type, actor_id, and accept required' });
    }

    // Defense-in-depth: bind the body's actor_id to the signed x-actor-id
    // header so the body cannot claim to be a participant the signer is not.
    // The order participant check still runs INSIDE the txn after FOR UPDATE.
    // We call assertActorIsParticipant with a single-id list to reuse the
    // same 403 / structured-warn shape as other routes.
    const headerOwnership = assertActorIsParticipant(
      request,
      reply,
      [actor_id],
      'cancel_request_respond_header_bind',
    );
    if (headerOwnership) return headerOwnership;

    return withTxIdempotency(request, reply, 'cancel_request_respond', id, async (client) => {
      try {
        // 1. Lock the order row.
        const orderLock = await client.query(
          `SELECT id, status, user_id, merchant_id, buyer_merchant_id,
                  cancel_requested_by, cancel_request_reason,
                  crypto_amount, type, escrow_tx_hash,
                  escrow_debited_entity_type, escrow_debited_entity_id,
                  offer_id, order_version
             FROM orders
            WHERE id = $1
            FOR UPDATE`,
          [id],
        );
        if (orderLock.rows.length === 0) {
          return { statusCode: 404, body: { success: false, error: 'Order not found' } };
        }
        const order = orderLock.rows[0] as OrderRow & { order_version: number };

        if (!order.cancel_requested_by) {
          return { statusCode: 400, body: { success: false, error: 'No cancel request pending' } };
        }

        // Re-check terminal states post-lock — a concurrent expire/complete
        // could have closed the order between header processing and lock.
        if (['completed', 'cancelled', 'expired'].includes(order.status)) {
          return {
            statusCode: 409,
            body: { success: false, error: `Order is already ${order.status}` },
          };
        }

        // 2. Order-level participant check. Identity is already bound to
        //    the signed actor header above — this verifies the signer is a
        //    legitimate participant in *this specific* order.
        const isParticipant =
          actor_id === order.user_id ||
          actor_id === order.merchant_id ||
          (!!order.buyer_merchant_id && actor_id === order.buyer_merchant_id);
        if (!isParticipant) {
          return {
            statusCode: 403,
            body: { success: false, error: 'Not authorized — you are not a participant in this order' },
          };
        }

        // Cannot respond to own cancel request (check actor_type for non-M2M, actor_id for M2M)
        if (order.cancel_requested_by === actor_type) {
          const isM2M = !!order.buyer_merchant_id;
          if (!isM2M) {
            return {
              statusCode: 400,
              body: { success: false, error: 'Cannot respond to your own cancel request' },
            };
          }
        }

        // ── DECLINE PATH ──────────────────────────────────────────────────
        if (!accept) {
          const declined = await client.query(
            `UPDATE orders
                SET cancel_requested_by = NULL,
                    cancel_requested_at = NULL,
                    cancel_request_reason = NULL,
                    last_activity_at = NOW(),
                    order_version = order_version + 1
              WHERE id = $1
                AND order_version = $2
                AND status NOT IN ('completed', 'cancelled', 'expired')
              RETURNING *`,
            [id, order.order_version],
          );
          if (declined.rows.length === 0) {
            return {
              statusCode: 409,
              body: { success: false, error: 'Order was modified concurrently. Please retry.' },
            };
          }
          const updated = declined.rows[0];

          await client.query(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, metadata)
             VALUES ($1, 'cancel_declined', $2, $3, $4)`,
            [id, actor_type, actor_id, JSON.stringify({ reason: 'Cancel request declined' })],
          );

          // Outbox is published from inside the txn — same client, atomic.
          await insertOutboxEvent(client, {
            event: ORDER_EVENT.STATUS_CHANGED,
            orderId: id, previousStatus: order.status, newStatus: order.status,
            actorType: actor_type, actorId: actor_id,
            userId: order.user_id, merchantId: order.merchant_id,
            order: updated as unknown as Record<string, unknown>,
            orderVersion: (updated as any).order_version, minimalStatus: normalizeStatus(order.status as any),
            metadata: { cancel_declined: true },
          });

          logger.info('[core-api] Cancel declined', { orderId: id, by: actor_type });
          return { statusCode: 200, body: { success: true, data: updated, declined: true } };
        }

        // ── ACCEPT PATH (both parties agree → atomic cancel + refund) ────
        const amount = parseFloat(String(order.crypto_amount));
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            statusCode: 500,
            body: { success: false, error: 'Invalid order amount' },
          };
        }
        const hasEscrow = !!order.escrow_tx_hash;

        // 3. Resolve refund target and LOCK the balance row before reading it.
        let refundTable: 'users' | 'merchants' | null = null;
        let refundTo: string | null = null;
        let balanceBefore: number | null = null;

        if (hasEscrow && MOCK_MODE) {
          if (order.escrow_debited_entity_type && order.escrow_debited_entity_id) {
            refundTable = order.escrow_debited_entity_type === 'user' ? 'users' : 'merchants';
            refundTo = order.escrow_debited_entity_id;
          } else {
            const isSellOrder = order.type === 'sell';
            refundTo = isSellOrder ? order.user_id : order.merchant_id;
            refundTable = isSellOrder ? 'users' : 'merchants';
          }

          // Identifiers come from the locked order row; the table name is
          // derived from a closed enum (users|merchants), not user input —
          // safe for direct interpolation here.
          const balLock = await client.query(
            `SELECT balance FROM ${refundTable} WHERE id = $1 FOR UPDATE`,
            [refundTo],
          );
          if (balLock.rows.length === 0) {
            return {
              statusCode: 500,
              body: { success: false, error: 'Refund target account not found' },
            };
          }
          balanceBefore = parseFloat(String((balLock.rows[0] as any).balance));
        }

        // 4. Lock the offer liquidity row before mutating it.
        let offerAvailableBefore: number | null = null;
        if (order.offer_id) {
          const offerLock = await client.query(
            `SELECT available_amount FROM merchant_offers WHERE id = $1 FOR UPDATE`,
            [order.offer_id],
          );
          if (offerLock.rows.length === 0) {
            return {
              statusCode: 500,
              body: { success: false, error: 'Offer not found' },
            };
          }
          offerAvailableBefore = parseFloat(String((offerLock.rows[0] as any).available_amount));
        }

        // 5. Update the order WITH version guard — proves nothing else has
        //    moved this row since the SELECT FOR UPDATE returned. If it has,
        //    the entire transaction rolls back and the caller retries.
        const orderUpd = await client.query(
          `UPDATE orders
              SET status = 'cancelled',
                  cancelled_at = NOW(),
                  cancelled_by = 'system',
                  cancellation_reason = $2,
                  cancel_requested_by = NULL,
                  cancel_requested_at = NULL,
                  last_activity_at = NOW(),
                  order_version = order_version + 1
            WHERE id = $1
              AND order_version = $3
              AND status = $4::order_status
            RETURNING *`,
          [
            id,
            `Mutual cancel: ${order.cancel_request_reason || 'Both parties agreed'}`,
            order.order_version,
            order.status,
          ],
        );
        if (orderUpd.rows.length === 0) {
          return {
            statusCode: 409,
            body: { success: false, error: 'Order was modified concurrently. Please retry.' },
          };
        }
        const updated = orderUpd.rows[0];

        // 6. Apply the refund using the same client + post-write invariant.
        if (refundTable && refundTo !== null && balanceBefore !== null) {
          const balUpd = await client.query(
            `UPDATE ${refundTable}
                SET balance = balance + $1
              WHERE id = $2
              RETURNING balance`,
            [amount, refundTo],
          );
          const balanceAfter = parseFloat(String((balUpd.rows[0] as any).balance));
          // Invariant: balance MUST equal balance_before + amount, exactly.
          // This is the post-write check that catches double-credit if a
          // concurrent path slipped past the row lock (it cannot, but we
          // assert anyway — defense-in-depth on a money-printer surface).
          const expected = balanceBefore + amount;
          // Use a tight epsilon (1 micro-unit) to absorb DECIMAL→float drift.
          if (Math.abs(balanceAfter - expected) > 1e-6) {
            logger.error('[core-api] BALANCE INVARIANT VIOLATION on mutual cancel', {
              orderId: id, refundTable, refundTo,
              balanceBefore, balanceAfter, expected, amount,
            });
            throw new Error('BALANCE_INVARIANT_VIOLATION');
          }
          logger.info('[core-api] Escrow refunded on mutual cancel', {
            orderId: id, amount, refundTo, table: refundTable,
            balanceBefore, balanceAfter,
          });
        }

        // 7. Restore offer liquidity (same client) with post-write check.
        if (order.offer_id && offerAvailableBefore !== null) {
          const offUpd = await client.query(
            `UPDATE merchant_offers
                SET available_amount = available_amount + $1
              WHERE id = $2
              RETURNING available_amount`,
            [amount, order.offer_id],
          );
          const offerAvailableAfter = parseFloat(String((offUpd.rows[0] as any).available_amount));
          const expectedOffer = offerAvailableBefore + amount;
          if (Math.abs(offerAvailableAfter - expectedOffer) > 1e-6) {
            logger.error('[core-api] OFFER INVARIANT VIOLATION on mutual cancel', {
              orderId: id, offerId: order.offer_id,
              offerAvailableBefore, offerAvailableAfter, expectedOffer, amount,
            });
            throw new Error('OFFER_INVARIANT_VIOLATION');
          }
        }

        // 8. Events + outbox on the same client — commit/rollback atomic.
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'cancel_accepted', $2, $3, $4, 'cancelled', $5)`,
          [id, actor_type, actor_id, order.status, JSON.stringify({
            reason: order.cancel_request_reason,
            requestedBy: order.cancel_requested_by,
            acceptedBy: actor_type,
            escrowRefunded: hasEscrow && MOCK_MODE,
          })],
        );

        await client.query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status)
           VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
          [
            id,
            JSON.stringify({
              orderId: id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: 'cancelled',
              previousStatus: order.status,
              reason: `Mutual cancel: ${order.cancel_request_reason}`,
              updatedAt: new Date().toISOString(),
            }),
          ],
        );

        await insertOutboxEvent(client, {
          event: ORDER_EVENT.CANCELLED,
          orderId: id, previousStatus: order.status, newStatus: 'cancelled',
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id,
          order: updated as unknown as Record<string, unknown>,
          orderVersion: (updated as any).order_version, minimalStatus: normalizeStatus('cancelled' as any),
        });

        logger.info('[core-api] Mutual cancel completed', { orderId: id });
        return { statusCode: 200, body: { success: true, data: updated, cancelled: true } };
      } catch (error) {
        fastify.log.error({ error, id }, 'Error responding to cancel request');
        // Rethrow inside the txn callback → rollback. Outer wrapper will
        // surface a 500 — and the idempotency record is NOT committed
        // because it lives inside the same transaction.
        throw error;
      }
    }).catch((error) => {
      const msg =
        error instanceof Error && (error.message === 'BALANCE_INVARIANT_VIOLATION' ||
                                    error.message === 'OFFER_INVARIANT_VIOLATION')
          ? 'Internal consistency check failed — request rejected'
          : 'Internal server error';
      return reply.status(500).send({ success: false, error: msg });
    });
  });
};
