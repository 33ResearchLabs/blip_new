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
import { transaction, normalizeStatus, MOCK_MODE, logger } from 'settlement-core';
import { withIdempotency, withTxIdempotency } from '../idempotency';
import { checkFinancialRateLimit } from '../rateLimit';
import { assertActorOwnership } from '../ownership';
import { ORDER_EVENT } from '../events';
import { insertOutboxEvent } from '../outbox';
import { escalateAppealToDispute } from '../appeals/escalate';

// Minutes an unresolved appeal stays open before the timeout worker auto-escalates
// it to a dispute. Configurable via APPEAL_TIMEOUT_MINUTES, clamped 1–1440 min.
// Default 10 min — short on purpose (aggressive escalation). Bump the env var in
// production if a longer counterparty-response window is wanted; no code change.
const APPEAL_TIMEOUT_MINUTES = (() => {
  const raw = parseInt(process.env.APPEAL_TIMEOUT_MINUTES || '10', 10);
  if (Number.isNaN(raw)) return 10;
  return Math.min(1440, Math.max(1, raw));
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
                     NOW() + ($7 || ' minutes')::interval, NOW(), NOW())
             RETURNING *`,
            [
              id,
              initiated_by,
              actor_id,
              issue_key,
              issue_group === 'dispute' ? 'dispute' : 'resolvable',
              description || null,
              String(APPEAL_TIMEOUT_MINUTES),
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

  // PUT /v1/orders/:id/appeal - Counterparty responds to an active appeal.
  //
  //   action: 'agree'  → (mutual_cancel only) atomic cancel + escrow refund.
  //           'reject' → escalate to a formal dispute (order → disputed).
  //
  // Idempotency-Key REQUIRED. The whole handler runs in ONE transaction with
  // row-level locks (orders + appeal, plus refund-balance + offer rows on agree),
  // mirroring the cancel-request respond path so the escrow refund behaviour is
  // byte-for-byte identical. The idempotency record commits on the same client.
  //
  // Convention (matches cancelRequest): pre-mutation guard failures `return` a
  // {statusCode,body} (safe to cache — no writes happened). Anything that fails
  // AFTER the first write `throw`s so the whole transaction rolls back; the
  // outer .catch maps the thrown code to an HTTP status.
  fastify.put<{
    Params: { id: string };
    Body: {
      action: 'agree' | 'reject';
      actor_type: 'user' | 'merchant';
      actor_id: string;
    };
  }>('/orders/:id/appeal', async (request, reply) => {
    const { id } = request.params;
    const { action, actor_type, actor_id } = request.body;

    if (!action || !['agree', 'reject'].includes(action) || !actor_type || !actor_id) {
      return reply.status(400).send({
        success: false,
        error: 'action (agree|reject), actor_type and actor_id are required',
      });
    }

    // Bind body.actor_id to the signed x-actor-id header (closes IDOR). The
    // order-participant check still runs INSIDE the txn after FOR UPDATE.
    const ownershipFail = assertActorOwnership(request, reply, {
      expectedActorId: actor_id,
      expectedActorType: actor_type,
      context: 'appeal_respond',
    });
    if (ownershipFail) return ownershipFail;

    const rl = checkFinancialRateLimit(request, 'respond_appeal');
    if (rl) return reply.status(rl.statusCode).send(rl.body);

    return withTxIdempotency(request, reply, 'appeal_respond', id, async (client) => {
      // 1. Lock the order row.
      const orderLock = await client.query(
        `SELECT id, status, user_id, merchant_id, buyer_merchant_id,
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
      const order = orderLock.rows[0] as {
        id: string; status: string; user_id: string; merchant_id: string | null;
        buyer_merchant_id: string | null; crypto_amount: string; type: string;
        escrow_tx_hash: string | null; escrow_debited_entity_type: string | null;
        escrow_debited_entity_id: string | null; offer_id: string | null; order_version: number;
      };

      if (['completed', 'cancelled', 'expired', 'disputed'].includes(order.status)) {
        return { statusCode: 409, body: { success: false, error: `Order is already ${order.status}` } };
      }

      // 2. Lock the active appeal.
      const appealLock = await client.query(
        `SELECT * FROM appeals
          WHERE order_id = $1 AND status IN ('open', 'proposed')
          FOR UPDATE`,
        [id],
      );
      if (appealLock.rows.length === 0) {
        return { statusCode: 404, body: { success: false, error: 'No active appeal to respond to', code: 'NO_ACTIVE_APPEAL' } };
      }
      const appeal = appealLock.rows[0] as { id: string; issue_key: string; opener_id: string };

      // 3. Participant check + cannot-respond-to-own guard.
      const isParticipant =
        actor_id === order.user_id ||
        actor_id === order.merchant_id ||
        (!!order.buyer_merchant_id && actor_id === order.buyer_merchant_id);
      if (!isParticipant) {
        return { statusCode: 403, body: { success: false, error: 'Only the buyer or seller can respond to an appeal', code: 'NOT_PARTICIPANT' } };
      }
      if (appeal.opener_id === actor_id) {
        return { statusCode: 400, body: { success: false, error: 'You cannot respond to your own appeal', code: 'CANNOT_RESPOND_OWN' } };
      }

      // ── REJECT → escalate to a dispute (escrow stays locked) ──
      // escalateAppealToDispute writes the appeal row first, so on a version
      // conflict it MUST throw (not return) — a `return` here would commit the
      // half-applied appeal update. The throw rolls the whole txn back; the
      // outer .catch maps ORDER_VERSION_CONFLICT → 409.
      if (action === 'reject') {
        const escalated = await escalateAppealToDispute(client, {
          appeal: { id: appeal.id, issue_key: appeal.issue_key },
          order: {
            id: order.id, status: order.status, user_id: order.user_id,
            merchant_id: order.merchant_id, order_version: order.order_version,
          },
          actor: { type: actor_type, id: actor_id },
          reason: 'appeal_rejected',
        });
        logger.info('[core-api] Appeal rejected → disputed', { orderId: id, by: actor_type });
        return {
          statusCode: 200,
          body: { success: true, data: escalated.order, disputed: true, chatMessage: escalated.chatMessage },
        };
      }

      // ── AGREE → mutual cancel + refund ──
      // Only the mutual_cancel issue resolves by cancelling. mutual_cancel is
      // offered only pre-fiat (accepted/escrowed), so refunding the depositor
      // (seller) is safe — no fiat has been sent.
      if (appeal.issue_key !== 'mutual_cancel') {
        return { statusCode: 400, body: { success: false, error: 'This appeal cannot be resolved by mutual cancellation', code: 'NOT_MUTUAL_CANCEL' } };
      }

      const amount = parseFloat(String(order.crypto_amount));
      if (!Number.isFinite(amount) || amount <= 0) {
        return { statusCode: 500, body: { success: false, error: 'Invalid order amount' } };
      }
      const hasEscrow = !!order.escrow_tx_hash;

      // Resolve + LOCK the refund target balance row before reading (mirror
      // cancelRequest respond accept). Real-mode on-chain refund is handled by
      // the reconciler/claim flow — DB balance is only credited in MOCK_MODE.
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
        const balLock = await client.query(
          `SELECT balance FROM ${refundTable} WHERE id = $1 FOR UPDATE`,
          [refundTo],
        );
        if (balLock.rows.length === 0) {
          return { statusCode: 500, body: { success: false, error: 'Refund target account not found' } };
        }
        balanceBefore = parseFloat(String((balLock.rows[0] as { balance: string }).balance));
      }

      // Lock the offer liquidity row before mutating it.
      let offerAvailableBefore: number | null = null;
      if (order.offer_id) {
        const offerLock = await client.query(
          `SELECT available_amount FROM merchant_offers WHERE id = $1 FOR UPDATE`,
          [order.offer_id],
        );
        if (offerLock.rows.length === 0) {
          return { statusCode: 500, body: { success: false, error: 'Offer not found' } };
        }
        offerAvailableBefore = parseFloat(String((offerLock.rows[0] as { available_amount: string }).available_amount));
      }

      // ── First write: cancel the order (version + status guard). ──
      const orderUpd = await client.query(
        `UPDATE orders
            SET status = 'cancelled',
                cancelled_at = NOW(),
                cancelled_by = 'system',
                cancellation_reason = $2,
                appeal_status = NULL,
                appeal_deadline = NULL,
                last_activity_at = NOW(),
                order_version = order_version + 1
          WHERE id = $1
            AND order_version = $3
            AND status = $4::order_status
          RETURNING *`,
        [id, 'Mutual cancellation (appeal agreed)', order.order_version, order.status],
      );
      if (orderUpd.rows.length === 0) {
        // No write committed yet from this branch — safe to return retryable 409.
        return { statusCode: 409, body: { success: false, error: 'Order was modified concurrently. Please retry.' } };
      }
      const updated = orderUpd.rows[0] as Record<string, unknown> & { order_version: number };

      try {
        // Resolve the appeal (peer mutual cancel).
        await client.query(
          `UPDATE appeals
              SET status = 'cancelled'::appeal_status, resolved_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status IN ('open', 'proposed')`,
          [appeal.id],
        );

        // Apply the refund with post-write invariant.
        if (refundTable && refundTo !== null && balanceBefore !== null) {
          const balUpd = await client.query(
            `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2 RETURNING balance`,
            [amount, refundTo],
          );
          const balanceAfter = parseFloat(String((balUpd.rows[0] as { balance: string }).balance));
          if (Math.abs(balanceAfter - (balanceBefore + amount)) > 1e-6) {
            logger.error('[core-api] BALANCE INVARIANT VIOLATION on appeal mutual cancel', {
              orderId: id, refundTable, refundTo, balanceBefore, balanceAfter, amount,
            });
            throw new Error('BALANCE_INVARIANT_VIOLATION');
          }
        }

        // Restore offer liquidity with post-write invariant.
        if (order.offer_id && offerAvailableBefore !== null) {
          const offUpd = await client.query(
            `UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2 RETURNING available_amount`,
            [amount, order.offer_id],
          );
          const offerAfter = parseFloat(String((offUpd.rows[0] as { available_amount: string }).available_amount));
          if (Math.abs(offerAfter - (offerAvailableBefore + amount)) > 1e-6) {
            logger.error('[core-api] OFFER INVARIANT VIOLATION on appeal mutual cancel', {
              orderId: id, offerId: order.offer_id, offerAvailableBefore, offerAfter, amount,
            });
            throw new Error('OFFER_INVARIANT_VIOLATION');
          }
        }

        // Audit + notify + system chat + outbox (all atomic on this client).
        await client.query(
          `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, old_status, new_status, metadata)
           VALUES ($1, 'appeal_resolved', $2::actor_type, $3, $4, 'cancelled', $5)`,
          [id, actor_type, actor_id, order.status, JSON.stringify({
            appeal_id: appeal.id, resolution: 'mutual_cancel', escrowRefunded: hasEscrow && MOCK_MODE,
          })],
        );
        await client.query(
          `INSERT INTO notification_outbox (order_id, event_type, payload, status)
           VALUES ($1, 'ORDER_CANCELLED', $2, 'pending')`,
          [id, JSON.stringify({
            orderId: id, userId: order.user_id, merchantId: order.merchant_id,
            status: 'cancelled', previousStatus: order.status,
            reason: 'Mutual cancellation (appeal agreed)', updatedAt: new Date().toISOString(),
          })],
        );
        const chatInsert = await client.query(
          `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
           VALUES ($1, 'system', $1, $2, 'text')
           RETURNING id, sender_id, content, created_at`,
          [id, '✅ Mutual cancellation agreed — the order has been cancelled and the escrow refunded.'],
        );
        await insertOutboxEvent(client, {
          event: ORDER_EVENT.CANCELLED,
          orderId: id, previousStatus: order.status, newStatus: 'cancelled',
          actorType: actor_type, actorId: actor_id,
          userId: order.user_id, merchantId: order.merchant_id,
          order: updated, orderVersion: updated.order_version,
          minimalStatus: normalizeStatus('cancelled'),
          metadata: { appeal_id: appeal.id, resolution: 'mutual_cancel' },
        });

        logger.info('[core-api] Appeal agreed → cancelled + refund', { orderId: id, by: actor_type });
        return {
          statusCode: 200,
          body: { success: true, data: updated, cancelled: true, chatMessage: chatInsert.rows[0] ?? null },
        };
      } catch (err) {
        // Any post-write failure rolls the whole transaction back (order stays
        // active, no partial refund). Re-throw so withTxIdempotency rolls back
        // and does NOT cache a half-applied response.
        throw err;
      }
    }).catch((error) => {
      const msg = error instanceof Error ? error.message : '';
      // A version conflict thrown after a write (e.g. the reject/escalate path)
      // rolled the whole txn back — surface it as a retryable 409.
      if (msg === 'ORDER_VERSION_CONFLICT') {
        return reply.status(409).send({ success: false, error: 'Order was modified concurrently. Please retry.' });
      }
      const consistency = msg === 'BALANCE_INVARIANT_VIOLATION' || msg === 'OFFER_INVARIANT_VIOLATION';
      if (consistency) {
        return reply.status(500).send({ success: false, error: 'Internal consistency check failed — request rejected' });
      }
      fastify.log.error({ error, id }, 'Error responding to appeal');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    });
  });
};
