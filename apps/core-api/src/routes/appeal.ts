/**
 * Core API Appeal Routes
 *
 * An appeal is the peer-to-peer resolution stage that happens BEFORE a formal
 * dispute. Either party (buyer/seller) opens one on an active order; the
 * counterparty is notified and the two try to resolve it themselves. Opening an
 * appeal does NOT change the order status — it pauses the auto-cancel/expiry
 * timers (via orders.appeal_status, honoured by the workers) so funds can't move
 * out from under an open appeal.
 *
 * POST /v1/orders/:id/appeal - Open an appeal
 */
import type { FastifyPluginAsync } from 'fastify';
import { transaction, logger } from 'settlement-core';
import { withIdempotency } from '../idempotency';
import { checkFinancialRateLimit } from '../rateLimit';
import { assertActorOwnership } from '../ownership';

// Hours an unresolved appeal stays open before the timeout worker auto-escalates
// it to a dispute. Configurable via env, clamped to a sane 1–24h window.
const APPEAL_TIMEOUT_HOURS = (() => {
  const raw = parseInt(process.env.APPEAL_TIMEOUT_HOURS || '12', 10);
  if (Number.isNaN(raw)) return 12;
  return Math.min(24, Math.max(1, raw));
})();

const APPEAL_OPEN_STATUSES = ['accepted', 'escrowed', 'payment_sent'];

export const appealRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /v1/orders/:id/appeal - Open an appeal
  // Idempotency-protected: same key returns same response, no duplicate appeals.
  fastify.post<{
    Params: { id: string };
    Body: {
      issue_key: string;
      issue_group: 'resolvable' | 'dispute';
      issue_label: string;
      opener_role: 'buyer' | 'seller';
      description?: string;
      initiated_by: 'user' | 'merchant';
      actor_id: string;
    };
  }>('/orders/:id/appeal', async (request, reply) => {
    const { id } = request.params;
    const {
      issue_key,
      issue_group,
      issue_label,
      opener_role,
      description,
      initiated_by,
      actor_id,
    } = request.body;

    if (!issue_key || !initiated_by || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'issue_key, initiated_by, and actor_id are required',
      });
    }

    // Bind body.actor_id to the signed x-actor-id header (closes IDOR).
    const ownershipFail = assertActorOwnership(request, reply, {
      expectedActorId: actor_id,
      expectedActorType: initiated_by,
      context: 'appeal_open',
    });
    if (ownershipFail) return ownershipFail;

    const rl = checkFinancialRateLimit(request, 'open_appeal');
    if (rl) return reply.status(rl.statusCode).send(rl.body);

    return withIdempotency(request, reply, 'open_appeal', id, async () => {
      try {
        const result = await transaction(async (client) => {
          // Lock the order row — serializes concurrent opens on the same order
          // so the active-appeal pre-check below is race-free.
          const orderLock = await client.query(
            `SELECT id, status, user_id, merchant_id, buyer_merchant_id
             FROM orders
             WHERE id = $1
             FOR UPDATE`,
            [id]
          );
          if (orderLock.rows.length === 0) {
            throw new Error('ORDER_NOT_FOUND');
          }
          const order = orderLock.rows[0] as {
            id: string;
            status: string;
            user_id: string;
            merchant_id: string;
            buyer_merchant_id: string | null;
          };

          // Appeals can only be opened on an active order (post-accept, pre-terminal).
          // A disputed order is excluded — that enforces the no-loop rule.
          if (!APPEAL_OPEN_STATUSES.includes(order.status)) {
            throw new Error('INVALID_STATUS_FOR_APPEAL');
          }

          // Participant check — the opener must be a party to the order. Settle
          // additionally validates buyer/seller specifically before proxying.
          const isParticipant =
            actor_id === order.user_id ||
            actor_id === order.merchant_id ||
            actor_id === order.buyer_merchant_id;
          if (!isParticipant) {
            throw new Error('NOT_PARTICIPANT');
          }

          // Reject if an appeal is already active (open/proposed) — the partial
          // unique index ux_appeals_one_active is the backstop.
          const active = await client.query(
            `SELECT id FROM appeals
             WHERE order_id = $1 AND status IN ('open', 'proposed')`,
            [id]
          );
          if (active.rows.length > 0) {
            throw new Error('APPEAL_ALREADY_OPEN');
          }

          // Create the appeal with its auto-escalation deadline.
          const appealInsert = await client.query(
            `INSERT INTO appeals (
               order_id, opened_by, opener_id, issue_key, issue_group,
               description, status, appeal_deadline, created_at, updated_at
             )
             VALUES ($1, $2::actor_type, $3, $4, $5, $6, 'open'::appeal_status,
                     NOW() + ($7 || ' hours')::interval, NOW(), NOW())
             RETURNING *`,
            [
              id,
              initiated_by,
              actor_id,
              issue_key,
              issue_group === 'dispute' ? 'dispute' : 'resolvable',
              description || null,
              String(APPEAL_TIMEOUT_HOURS),
            ]
          );
          const appeal = appealInsert.rows[0] as Record<string, unknown>;

          // Denormalize onto the order so the expiry/auto-cancel workers skip it
          // and the UI can badge it. Status is NOT changed.
          await client.query(
            `UPDATE orders
             SET appeal_status = 'open', appeal_deadline = $2
             WHERE id = $1`,
            [id, appeal.appeal_deadline]
          );

          // Audit event (status unchanged — old == new).
          await client.query(
            `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
             VALUES ($1, 'appeal_opened', $2::actor_type, $3, $4, $4, $5)`,
            [
              id,
              initiated_by,
              actor_id,
              order.status,
              JSON.stringify({ issue_key, issue_group, description: description || '' }),
            ]
          );

          // Notify the counterparty.
          await client.query(
            `INSERT INTO notification_outbox (order_id, event_type, payload, status)
             VALUES ($1, 'APPEAL_OPENED', $2, 'pending')`,
            [
              id,
              JSON.stringify({
                orderId: id,
                userId: order.user_id,
                merchantId: order.merchant_id,
                openedBy: initiated_by,
                issueKey: issue_key,
                issueLabel: issue_label,
                updatedAt: new Date().toISOString(),
              }),
            ]
          );

          // System message in the order chat so both parties see it inline.
          // RETURNING the row so settle can push it live over Pusher (the chat
          // listener dedupes by message id, so no duplicate on later refetch).
          const roleWord = opener_role === 'seller' ? 'seller' : 'buyer';
          const chatContent =
            `🚩 Appeal raised by ${roleWord} — ${issue_label || issue_key}` +
            (description ? `\n${description}` : '');
          // NOTE: message_type is 'text' (not 'system') on purpose. getOrderMessages
          // excludes (sender_type='system' AND message_type='system') rows from the
          // chat thread — those are status-transition messages rendered via the
          // receipt/timeline instead. An appeal is a real chat event that must show
          // in the thread, so we store it as a system-sender 'text' message; every
          // renderer styles it as a centered system pill via from==='system'.
          const chatInsert = await client.query(
            `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
             VALUES ($1, 'system', $1, $2, 'text')
             RETURNING id, sender_id, content, created_at`,
            [id, chatContent]
          );

          return { appeal, chatMessage: chatInsert.rows[0] };
        });

        logger.info('[core-api] Appeal opened', { orderId: id, issueKey: issue_key, initiatedBy: initiated_by });
        return {
          statusCode: 200,
          body: { success: true, data: result.appeal, chatMessage: result.chatMessage },
        };
      } catch (error) {
        const msg = (error as Error).message;
        if (msg === 'ORDER_NOT_FOUND') {
          return { statusCode: 404, body: { success: false, error: 'Order not found' } };
        }
        if (msg === 'INVALID_STATUS_FOR_APPEAL') {
          return {
            statusCode: 400,
            body: {
              success: false,
              error: 'Appeals can only be opened on an active order (accepted, escrowed, or payment_sent).',
              code: 'INVALID_STATUS_FOR_APPEAL',
            },
          };
        }
        if (msg === 'NOT_PARTICIPANT') {
          return { statusCode: 403, body: { success: false, error: 'Only the buyer or seller can open an appeal.', code: 'NOT_PARTICIPANT' } };
        }
        if (msg === 'APPEAL_ALREADY_OPEN' || (error as { code?: string }).code === '23505') {
          return { statusCode: 409, body: { success: false, error: 'An appeal is already open for this order.', code: 'APPEAL_ALREADY_OPEN' } };
        }
        fastify.log.error({ error, id }, 'Error opening appeal');
        return { statusCode: 500, body: { success: false, error: 'Internal server error' } };
      }
    });
  });
};
