/**
 * Core API Dispute Routes
 *
 * POST /v1/orders/:id/dispute - Open a dispute
 * POST /v1/orders/:id/dispute/confirm - Confirm/reject dispute resolution
 */
import type { FastifyPluginAsync } from 'fastify';
import {
  query as dbQuery,
  queryOne,
  transaction,
  normalizeStatus,
  logger,
} from 'settlement-core';
import { ORDER_EVENT } from '../events';
import { insertOutboxEventDirect, insertOutboxEvent } from '../outbox';
import { withIdempotency } from '../idempotency';
import { checkFinancialRateLimit } from '../rateLimit';
import { assertActorOwnership } from '../ownership';

export const disputeRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/dispute - Open dispute
  // Idempotency-protected: same key returns same response, no duplicate dispute creation
  fastify.post<{
    Params: { id: string };
    Body: {
      reason: string;
      description?: string;
      initiated_by: 'user' | 'merchant';
      actor_id: string;
    };
  }>('/orders/:id/dispute', async (request, reply) => {
    const { id } = request.params;
    const { reason, description, initiated_by, actor_id } = request.body;

    if (!reason || !initiated_by || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'reason, initiated_by, and actor_id are required',
      });
    }

    // Bind body.actor_id to the signed x-actor-id header. Rejects requests
    // where a logged-in user supplies someone else's id in the body.
    const ownershipFail = assertActorOwnership(request, reply, {
      expectedActorId: actor_id,
      expectedActorType: initiated_by,
      context: 'dispute_open',
    });
    if (ownershipFail) return ownershipFail;

    const rl = checkFinancialRateLimit(request, 'open_dispute');
    if (rl) return reply.status(rl.statusCode).send(rl.body);

    return withIdempotency(request, reply, 'open_dispute', id, async () => {
      try {
        // Check order exists (include order_version for safe update)
        const order = await queryOne<{ id: string; status: string; order_version: number; user_id: string; merchant_id: string }>(
          'SELECT id, status, order_version, user_id, merchant_id FROM orders WHERE id = $1',
          [id]
        );

        if (!order) {
          return { statusCode: 404, body: { success: false, error: 'Order not found' } };
        }

        if (order.status === 'disputed') {
          return { statusCode: 400, body: { success: false, error: 'Order is already disputed' } };
        }

        // Check if dispute already exists
        const existing = await dbQuery('SELECT id FROM disputes WHERE order_id = $1', [id]);
        if (existing.length > 0) {
          return { statusCode: 400, body: { success: false, error: 'Dispute already exists' } };
        }

        // Ensure disputes table has confirmation columns
        try {
          await dbQuery(`
            ALTER TABLE disputes
            ADD COLUMN IF NOT EXISTS proposed_resolution VARCHAR(50),
            ADD COLUMN IF NOT EXISTS proposed_by UUID,
            ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS resolution_notes TEXT,
            ADD COLUMN IF NOT EXISTS user_confirmed BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS merchant_confirmed BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS split_percentage JSONB,
            ADD COLUMN IF NOT EXISTS assigned_to UUID
          `);
        } catch (alterErr) {
          // Columns may already exist
        }

        // Insert dispute
        const disputeResult = await dbQuery(
          `INSERT INTO disputes (
            order_id, reason, description, raised_by, raiser_id, status,
            user_confirmed, merchant_confirmed, created_at
          )
           VALUES ($1, $2::dispute_reason, $3, $4::actor_type, $5, 'open'::dispute_status, false, false, NOW())
           RETURNING *`,
          [id, reason, description || '', initiated_by, actor_id]
        );

        // Update order status with version + status guard
        const disputeUpdate = await dbQuery(
          `UPDATE orders SET status = 'disputed'::order_status, order_version = order_version + 1
           WHERE id = $1 AND order_version = $2 AND status = $3::order_status
           RETURNING id`,
          [id, order.order_version, order.status]
        );
        if (disputeUpdate.length === 0) {
          return { statusCode: 409, body: { success: false, error: 'Order was modified concurrently. Please retry.' } };
        }

        // Event
        await dbQuery(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'status_changed_to_disputed', $2, $3, $4, 'disputed', $5)`,
          [id, initiated_by, actor_id, order.status, JSON.stringify({ reason, description })]
        );

        // Notification outbox
        await dbQuery(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status) VALUES ($1, 'ORDER_DISPUTED', $2, 'pending')`,
          [
            id,
            JSON.stringify({
              orderId: id,
              userId: order.user_id,
              merchantId: order.merchant_id,
              status: 'disputed',
              previousStatus: order.status,
              updatedAt: new Date().toISOString(),
            }),
          ]
        );

        logger.info('[core-api] Dispute created', { orderId: id, reason });

        await insertOutboxEventDirect({
          event: ORDER_EVENT.DISPUTED,
          orderId: id, previousStatus: order.status, newStatus: 'disputed',
          actorType: initiated_by, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id,
          order: order as unknown as Record<string, unknown>,
          orderVersion: 0, minimalStatus: normalizeStatus('disputed' as any),
          metadata: { reason, description },
        });

        return { statusCode: 200, body: { success: true, data: disputeResult[0] } };
      } catch (error) {
        fastify.log.error({ error, id }, 'Error creating dispute');
        return { statusCode: 500, body: { success: false, error: 'Internal server error' } };
      }
    });
  });

  // POST /v1/orders/:id/dispute/confirm - Confirm/reject resolution
  // Idempotency-protected: same key returns same response, no duplicate confirmations
  fastify.post<{
    Params: { id: string };
    Body: {
      party: 'user' | 'merchant';
      action: 'accept' | 'reject';
      partyId: string;
    };
  }>('/orders/:id/dispute/confirm', async (request, reply) => {
    const { id } = request.params;
    const { party, action, partyId } = request.body;

    if (!party || !action || !partyId) {
      return reply.status(400).send({ success: false, error: 'party, action, and partyId required' });
    }

    // Bind partyId to the signed x-actor-id header before doing any DB work.
    // The post-lock check inside the txn additionally verifies partyId matches
    // the order's user_id / merchant_id; this header check fails fast and
    // closes the IDOR even if the body field accidentally happens to land on
    // a real participant id (e.g. attacker is a participant but spoofs the
    // counterparty's role).
    const ownershipFail = assertActorOwnership(request, reply, {
      expectedActorId: partyId,
      expectedActorType: party,
      context: 'dispute_confirm',
    });
    if (ownershipFail) return ownershipFail;

    return withIdempotency(request, reply, 'confirm_dispute', id, async () => {
      try {
        // Entire confirm/finalize flow runs in a single transaction with row-level
        // locks on (orders, disputes). FOR UPDATE serializes concurrent confirms,
        // closing the read-modify-write race that allowed double-credit. Lock order
        // matches the open-dispute path (orders → disputes) to avoid deadlocks.
        const result = await transaction(async (client) => {
          const orderLock = await client.query(
            `SELECT id, user_id, merchant_id, status, order_version, crypto_amount
             FROM orders
             WHERE id = $1
             FOR UPDATE`,
            [id]
          );
          if (orderLock.rows.length === 0) {
            throw new Error('ORDER_NOT_FOUND');
          }
          const order = orderLock.rows[0] as any;

          const disputeLock = await client.query(
            `SELECT * FROM disputes WHERE order_id = $1 FOR UPDATE`,
            [id]
          );
          if (disputeLock.rows.length === 0) {
            throw new Error('DISPUTE_NOT_FOUND');
          }
          const dispute = disputeLock.rows[0] as any;

          // Verify party identity against the (now locked) order row
          if (party === 'user' && partyId !== order.user_id) {
            throw new Error('UNAUTHORIZED');
          }
          if (party === 'merchant' && partyId !== order.merchant_id) {
            throw new Error('UNAUTHORIZED');
          }

          // Re-check post-lock: dispute must still be awaiting confirmation.
          // If a parallel tx already finalized, status is 'resolved' here and we
          // bail out before any balance write.
          if (dispute.status !== 'pending_confirmation') {
            throw new Error('NO_PENDING_RESOLUTION');
          }

          // Reject path — clear confirmations, return to investigating
          if (action === 'reject') {
            await client.query(
              `UPDATE disputes
               SET status = 'investigating'::dispute_status,
                   proposed_resolution = NULL,
                   user_confirmed = false,
                   merchant_confirmed = false
               WHERE order_id = $1`,
              [id]
            );

            logger.info('[core-api] Dispute resolution rejected', {
              orderId: id, party, partyId,
            });

            return {
              kind: 'rejected' as const,
            };
          }

          // Accept path — flip flag, re-read under lock to get authoritative state
          const updateField = party === 'user' ? 'user_confirmed' : 'merchant_confirmed';
          const flipResult = await client.query(
            `UPDATE disputes
             SET ${updateField} = true
             WHERE order_id = $1
             RETURNING user_confirmed, merchant_confirmed, proposed_resolution, status`,
            [id]
          );
          const updated = flipResult.rows[0] as any;

          // Only one party confirmed so far — return progress, no finalize
          if (!updated.user_confirmed || !updated.merchant_confirmed) {
            return {
              kind: 'pending' as const,
              userConfirmed: !!updated.user_confirmed,
              merchantConfirmed: !!updated.merchant_confirmed,
            };
          }

          // Both confirmed — finalize once, atomically.
          const resolution = updated.proposed_resolution;
          const amount = parseFloat(String(order.crypto_amount));
          const splitPct = dispute.split_percentage
            ? (typeof dispute.split_percentage === 'string'
                ? JSON.parse(dispute.split_percentage)
                : dispute.split_percentage)
            : { user: 50, merchant: 50 };

          let userAmount = 0;
          let merchantAmount = 0;
          let orderStatus: 'completed' | 'cancelled' = 'completed';

          if (resolution === 'user') {
            userAmount = amount;
            orderStatus = 'cancelled';
          } else if (resolution === 'merchant') {
            merchantAmount = amount;
            orderStatus = 'completed';
          } else if (resolution === 'split') {
            userAmount = amount * (splitPct.user / 100);
            merchantAmount = amount * (splitPct.merchant / 100);
            orderStatus = 'completed';
          } else {
            throw new Error('INVALID_RESOLUTION');
          }

          // Invariant: total credited must equal escrow amount (within fp epsilon).
          // A violation would mean either creating value or losing escrow — abort
          // and roll back. Surfaces config / split-percentage bugs in CI.
          const credited = userAmount + merchantAmount;
          if (Math.abs(credited - amount) > 1e-6) {
            logger.error('[core-api] Dispute finalize invariant violation', {
              orderId: id, resolution, credited, escrow: amount, splitPct,
            });
            throw new Error('INVARIANT_VIOLATION');
          }

          // Resolve the dispute row first — extra status-guard guarantees the
          // finalize block executes at most once per dispute even if some future
          // caller bypasses the FOR UPDATE serialization.
          const resolveDispute = await client.query(
            `UPDATE disputes
             SET status = 'resolved'::dispute_status,
                 resolution = $1,
                 resolved_at = NOW()
             WHERE order_id = $2 AND status = 'pending_confirmation'
             RETURNING id`,
            [resolution, id]
          );
          if (resolveDispute.rows.length === 0) {
            throw new Error('ALREADY_FINALIZED');
          }

          // Credit balances under the same lock
          if (userAmount > 0) {
            await client.query(
              'UPDATE users SET balance = balance + $1 WHERE id = $2',
              [userAmount, order.user_id]
            );
          }
          if (merchantAmount > 0) {
            await client.query(
              'UPDATE merchants SET balance = balance + $1 WHERE id = $2',
              [merchantAmount, order.merchant_id]
            );
          }

          // Resolve the order — version + status guard preserves existing optimistic-
          // concurrency contract used elsewhere in the codebase.
          const resolveOrder = await client.query(
            `UPDATE orders
             SET status = $1::order_status, order_version = order_version + 1
             WHERE id = $2 AND order_version = $3 AND status = 'disputed'
             RETURNING id`,
            [orderStatus, id, order.order_version]
          );
          if (resolveOrder.rows.length === 0) {
            throw new Error('ORDER_VERSION_CONFLICT');
          }

          // Notification outbox — inside txn so it commits atomically with the mutation
          await client.query(
            `INSERT INTO notification_outbox (order_id, event_type, payload, status)
             VALUES ($1, $2, $3, 'pending')`,
            [
              id,
              `ORDER_${orderStatus.toUpperCase()}`,
              JSON.stringify({
                orderId: id,
                userId: order.user_id,
                merchantId: order.merchant_id,
                status: orderStatus,
                previousStatus: 'disputed',
                resolution,
                updatedAt: new Date().toISOString(),
              }),
            ]
          );

          // Outbox event — use the transaction-aware helper instead of the standalone
          // *Direct variant. Keeps the event commit atomic with the balance write.
          const resolvedEvent =
            orderStatus === 'completed' ? ORDER_EVENT.COMPLETED
            : ORDER_EVENT.CANCELLED;
          await insertOutboxEvent(client, {
            event: resolvedEvent,
            orderId: id,
            previousStatus: 'disputed',
            newStatus: orderStatus,
            actorType: 'system',
            actorId: partyId,
            userId: order.user_id,
            merchantId: order.merchant_id,
            order: order as unknown as Record<string, unknown>,
            orderVersion: 0,
            minimalStatus: normalizeStatus(orderStatus as any),
            metadata: { resolution },
          });

          logger.info('[core-api] Dispute finalized', {
            orderId: id,
            resolution,
            orderStatus,
            userId: order.user_id,
            merchantId: order.merchant_id,
            userAmount,
            merchantAmount,
            escrowAmount: amount,
            triggeredBy: { party, partyId },
          });

          return {
            kind: 'finalized' as const,
            resolution,
            orderStatus,
            userAmount,
            merchantAmount,
            totalAmount: amount,
          };
        });

        // Map transaction result to HTTP response
        if (result.kind === 'rejected') {
          return {
            statusCode: 200,
            body: { success: true, data: { status: 'investigating', message: 'Resolution rejected' } },
          };
        }
        if (result.kind === 'pending') {
          return {
            statusCode: 200,
            body: {
              success: true,
              data: {
                status: 'pending_confirmation',
                userConfirmed: result.userConfirmed,
                merchantConfirmed: result.merchantConfirmed,
                finalized: false,
              },
            },
          };
        }
        return {
          statusCode: 200,
          body: {
            success: true,
            data: {
              status: `resolved_${result.resolution}`,
              orderStatus: result.orderStatus,
              finalized: true,
              moneyReleased: {
                user: result.userAmount,
                merchant: result.merchantAmount,
                total: result.totalAmount,
              },
            },
          },
        };
      } catch (error) {
        const errMsg = (error as Error).message;
        if (errMsg === 'ORDER_NOT_FOUND') {
          return { statusCode: 404, body: { success: false, error: 'Order not found' } };
        }
        if (errMsg === 'DISPUTE_NOT_FOUND') {
          return { statusCode: 404, body: { success: false, error: 'Dispute not found' } };
        }
        if (errMsg === 'UNAUTHORIZED') {
          return { statusCode: 403, body: { success: false, error: 'Unauthorized' } };
        }
        if (errMsg === 'NO_PENDING_RESOLUTION') {
          return { statusCode: 400, body: { success: false, error: 'No pending resolution' } };
        }
        if (errMsg === 'ALREADY_FINALIZED') {
          return { statusCode: 409, body: { success: false, error: 'Dispute already finalized' } };
        }
        if (errMsg === 'INVALID_RESOLUTION') {
          return { statusCode: 400, body: { success: false, error: 'Invalid proposed resolution' } };
        }
        if (errMsg === 'INVARIANT_VIOLATION') {
          return { statusCode: 500, body: { success: false, error: 'Internal invariant violation' } };
        }
        if (errMsg === 'ORDER_VERSION_CONFLICT') {
          return { statusCode: 409, body: { success: false, error: 'Order was modified concurrently during dispute resolution' } };
        }

        fastify.log.error({ error, id }, 'Error confirming dispute');
        return { statusCode: 500, body: { success: false, error: 'Internal server error' } };
      }
    });
  });
};
