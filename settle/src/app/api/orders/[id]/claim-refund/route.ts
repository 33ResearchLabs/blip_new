/**
 * POST /api/orders/[id]/claim-refund
 *
 * User-triggered recovery for an on-chain escrow refund that the
 * payment-deadline worker couldn't complete. The DB side of cancellation
 * has already happened by the time this route runs — we only finalise the
 * Solana-side refund and record `release_tx_hash` so the order stops
 * showing as "stuck".
 *
 * Guards:
 *   - Order must be in a terminal state already (cancelled/expired/disputed).
 *     This route never cancels anything — the cancel decision was made
 *     through the normal flow.
 *   - Caller must be the entity that originally funded the escrow
 *     (`escrow_debited_entity_id` + matching `escrow_debited_entity_type`).
 *   - On-chain escrow must still be outstanding (`escrow_tx_hash` set,
 *     `release_tx_hash` null).
 *   - Idempotency-Key header scopes the attempt so rapid double-taps do
 *     not submit two on-chain txs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { logger } from 'settlement-core';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { refundEscrowFromBackend } from '@/lib/solana/backendRefund';

interface StuckOrderRow {
  id: string;
  order_number: string;
  status: string;
  escrow_tx_hash: string | null;
  release_tx_hash: string | null;
  escrow_creator_wallet: string | null;
  escrow_trade_id: string | null;
  escrow_debited_entity_type: 'user' | 'merchant' | null;
  escrow_debited_entity_id: string | null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Merchants may pass x-merchant-id; only trusted when the token is a
    // merchant token (same pattern as cancel-request/route.ts).
    const merchantIdHeader = request.headers.get('x-merchant-id');
    if (merchantIdHeader && auth.actorType === 'merchant' && !auth.merchantId) {
      auth.merchantId = merchantIdHeader;
    }

    const { id } = await params;

    const order = await queryOne<StuckOrderRow>(
      `SELECT id, order_number, status,
              escrow_tx_hash, release_tx_hash,
              escrow_creator_wallet, escrow_trade_id,
              escrow_debited_entity_type, escrow_debited_entity_id
       FROM orders WHERE id = $1`,
      [id]
    );

    if (!order) return notFoundResponse('Order');

    // ── Terminal-state gate ────────────────────────────────────────────
    // Claim only finalises an existing refund — it cannot trigger one.
    const terminalStatuses = ['cancelled', 'expired', 'disputed'];
    if (!terminalStatuses.includes(order.status)) {
      return NextResponse.json(
        {
          success: false,
          error: `Refund is only available after the order has been cancelled. Current status: ${order.status}.`,
          code: 'ORDER_NOT_TERMINAL',
        },
        { status: 400 }
      );
    }

    // ── Escrow presence gate ──────────────────────────────────────────
    if (!order.escrow_tx_hash || !order.escrow_creator_wallet || !order.escrow_trade_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'This order has no on-chain escrow to refund.',
          code: 'NO_ESCROW',
        },
        { status: 400 }
      );
    }

    if (order.release_tx_hash) {
      return NextResponse.json(
        {
          success: true,
          data: { alreadyRefunded: true, txHash: order.release_tx_hash },
        },
        { status: 200 }
      );
    }

    // ── Authorisation gate ────────────────────────────────────────────
    // Only the entity that funded the escrow may claim its own refund.
    // Without this check any participant could trigger the on-chain call
    // (which would still refund the correct wallet, but a random caller
    // paying the SOL fee and filling the retry audit log isn't useful).
    const debitedType = order.escrow_debited_entity_type;
    const debitedId = order.escrow_debited_entity_id;
    if (!debitedType || !debitedId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Escrow funder is unknown for this order. Contact support.',
          code: 'NO_ESCROW_FUNDER',
        },
        { status: 400 }
      );
    }

    const callerId =
      debitedType === 'merchant' ? auth.merchantId || auth.actorId : auth.actorId;
    const callerType = debitedType === 'merchant' ? 'merchant' : 'user';

    if (auth.actorType !== callerType || callerId !== debitedId) {
      logger.warn('[ClaimRefund] Rejected — caller is not escrow funder', {
        orderId: id,
        actorType: auth.actorType,
        actorId: auth.actorId,
        debitedType,
        debitedId,
      });
      return forbiddenResponse('Only the escrow funder can claim this refund.');
    }

    // ── Execute refund (idempotent) ───────────────────────────────────
    const explicitKey = getIdempotencyKey(request);
    const effectiveKey = explicitKey || `claim-refund:${id}:${debitedId}`;

    type ClaimRefundResponse =
      | { success: true; data: { txHash: string } }
      | { success: false; error: string; code: string };

    const idempotencyResult = await withIdempotency<ClaimRefundResponse>(
      effectiveKey,
      'claim_refund',
      id,
      async () => {
        // `refundEscrowFromBackend` can throw synchronously (e.g. the
        // Anchor program constructor fails IDL decoding, a malformed
        // keypair, or SOL RPC is unreachable). Its try/catch covers only
        // the tx-submit path, not the program-init path, so we wrap it
        // here and convert any thrown error into the same structured
        // failure shape as a returned `{success:false}`.
        let result: Awaited<ReturnType<typeof refundEscrowFromBackend>>;
        try {
          result = await refundEscrowFromBackend(
            order.escrow_creator_wallet!,
            Number(order.escrow_trade_id),
          );
        } catch (err) {
          result = {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }

        if (result.success && result.txHash) {
          await query(
            `UPDATE orders
             SET release_tx_hash     = COALESCE(release_tx_hash, $1),
                 refund_retry_after  = NULL,
                 refund_last_error   = NULL
             WHERE id = $2`,
            [result.txHash, id]
          );
          logger.info('[ClaimRefund] Refund completed via user action', {
            orderId: id,
            orderNumber: order.order_number,
            txHash: result.txHash,
            actorType: auth.actorType,
            actorId: auth.actorId,
          });
          return {
            data: { success: true, data: { txHash: result.txHash } },
            statusCode: 200,
          };
        }

        // Persist the failure reason so the worker and admin dashboards
        // can see what's going wrong. Don't touch refund_retry_after on
        // a manual attempt — the user's next tap should always execute.
        await query(
          `UPDATE orders SET refund_last_error = $1 WHERE id = $2`,
          [result.error || 'unknown', id]
        );
        logger.warn('[ClaimRefund] Refund attempt failed', {
          orderId: id,
          orderNumber: order.order_number,
          error: result.error,
        });
        return {
          data: {
            success: false,
            error: result.error || 'Failed to submit refund transaction. Please try again later.',
            code: 'REFUND_FAILED',
          },
          statusCode: 502,
        };
      }
    );

    return NextResponse.json(idempotencyResult.data, {
      status: idempotencyResult.statusCode,
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/claim-refund', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;

    const order = await queryOne<{
      status: string;
      escrow_tx_hash: string | null;
      release_tx_hash: string | null;
      escrow_debited_entity_type: 'user' | 'merchant' | null;
      escrow_debited_entity_id: string | null;
      refund_retry_count: number;
      refund_retry_after: Date | null;
      refund_last_error: string | null;
    }>(
      `SELECT status, escrow_tx_hash, release_tx_hash,
              escrow_debited_entity_type, escrow_debited_entity_id,
              refund_retry_count, refund_retry_after, refund_last_error
       FROM orders WHERE id = $1`,
      [id]
    );

    if (!order) return notFoundResponse('Order');

    const isTerminal = ['cancelled', 'expired', 'disputed'].includes(order.status);
    const hasStuckEscrow =
      !!order.escrow_tx_hash && !order.release_tx_hash && isTerminal;

    const callerId =
      order.escrow_debited_entity_type === 'merchant' ? auth.merchantId || auth.actorId : auth.actorId;
    const isFunder =
      !!order.escrow_debited_entity_id &&
      order.escrow_debited_entity_id === callerId &&
      auth.actorType === (order.escrow_debited_entity_type === 'merchant' ? 'merchant' : 'user');

    return successResponse({
      canClaim: hasStuckEscrow && isFunder,
      hasStuckEscrow,
      alreadyRefunded: !!order.release_tx_hash,
      retryCount: order.refund_retry_count,
      nextAutoRetryAt: order.refund_retry_after,
      lastError: order.refund_last_error,
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/claim-refund', error as Error);
    return errorResponse('Internal server error');
  }
}
