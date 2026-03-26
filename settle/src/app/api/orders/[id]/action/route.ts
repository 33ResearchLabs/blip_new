/**
 * POST /api/orders/:id/action
 *
 * Action-based order mutation endpoint. The frontend sends an ACTION
 * (ACCEPT, LOCK_ESCROW, SEND_PAYMENT, CONFIRM_PAYMENT, CANCEL, DISPUTE),
 * and the backend resolves, validates, and executes the transition atomically.
 *
 * The frontend NEVER sends a target status — only an action intent.
 * The backend is the single source of truth for all status transitions.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getOrderWithRelations, claimOrder, claimAndPayOrder } from '@/lib/db/repositories/orders';
import { logger } from 'settlement-core';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { mockEscrowLock } from '@/lib/money/escrowLock';
import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';
import {
  handleOrderAction,
  resolveTradeRole,
  getAllowedActions,
  ORDER_ACTIONS,
  type OrderAction,
} from '@/lib/orders/handleOrderAction';
import { denormalizeStatus } from '@/lib/orders/statusNormalizer';
import { fireInstantNotification } from '@/lib/notifications/instantNotify';
import { invalidateOrderCache, updateOrderCache } from '@/lib/cache';
import { enrichOrderResponse } from '@/lib/orders/enrichOrderResponse';

export const dynamic = 'force-dynamic';

// ── Request schema ─────────────────────────────────────────────────────

const orderActionSchema = z.object({
  action: z.enum(ORDER_ACTIONS as unknown as [string, ...string[]]),
  actor_id: uuidSchema,
  actor_type: z.enum(['user', 'merchant']),
  // Optional fields for specific actions
  reason: z.string().max(500).nullish(),                   // CANCEL reason
  tx_hash: z.string().min(1).nullish(),                    // LOCK_ESCROW tx hash
  acceptor_wallet_address: z.string().nullish(),           // ACCEPT wallet
  escrow_trade_id: z.number().nullish(),                   // On-chain escrow refs
  escrow_trade_pda: z.string().nullish(),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().nullish(),
});

// ── POST handler ───────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Validate order ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const parseResult = orderActionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const {
      action,
      actor_id,
      actor_type,
      reason,
      tx_hash,
      acceptor_wallet_address,
      escrow_trade_id,
      escrow_trade_pda,
      escrow_pda,
      escrow_creator_wallet,
    } = parseResult.data;

    // 3. Authenticate
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // 4. Security: enforce actor matches authenticated identity
    const headerMerchantId = request.headers.get('x-merchant-id');
    const actorMatchesAuth = actor_id === auth.actorId;
    const actorMatchesMerchant =
      actor_type === 'merchant' && headerMerchantId && actor_id === headerMerchantId;

    if (!actorMatchesAuth && !actorMatchesMerchant) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    // Override auth context if merchant is acting
    if (!actorMatchesAuth && actorMatchesMerchant) {
      auth.actorType = 'merchant';
      auth.actorId = headerMerchantId;
      auth.merchantId = headerMerchantId;
    }

    // 5. Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // 6. Access check (skip for ACCEPT/SEND_FIAT — observer is joining/claiming)
    const isClaimingOrder = ['ACCEPT', 'SEND_FIAT', 'CLAIM'].includes(action);
    if (!isClaimingOrder) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`POST /api/orders/${id}/action`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // 7. Run handleOrderAction — the core validation
    const result = handleOrderAction(order, action as OrderAction, actor_id);

    if (!result.success) {
      logger.warn('[Action] Rejected', {
        orderId: id,
        action,
        actorId: actor_id,
        error: result.error,
        code: result.code,
        currentStatus: order.status,
      });

      return NextResponse.json(
        { success: false, error: result.error, code: result.code },
        { status: 400 }
      );
    }

    const targetStatus = result.targetStatus!;
    const dbTargetStatus = denormalizeStatus(targetStatus);

    logger.info('[Action] Validated, executing', {
      orderId: id,
      action,
      actorId: actor_id,
      currentStatus: order.status,
      targetStatus,
      dbTargetStatus,
    });

    // 8. Execute the action — delegate to specialized handlers for complex actions

    // ── LOCK_ESCROW: atomic balance deduction + status update ──
    if (action === 'LOCK_ESCROW') {
      const escrowTxHash = tx_hash || `mock-escrow-${id}-${Date.now()}`;
      const escrowResult = await mockEscrowLock(
        id,
        actor_type,
        actor_id,
        escrowTxHash,
        {
          escrow_trade_id: escrow_trade_id ?? undefined,
          escrow_trade_pda: escrow_trade_pda ?? undefined,
          escrow_pda: escrow_pda ?? undefined,
          escrow_creator_wallet: escrow_creator_wallet ?? undefined,
        }
      );

      if (!escrowResult.success) {
        return NextResponse.json(
          { success: false, error: escrowResult.error, code: 'ESCROW_LOCK_FAILED' },
          { status: 400 }
        );
      }

      // Instant notification for escrow lock
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id,
        status: 'escrowed',
        previousStatus: order.status,
        orderVersion: escrowResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: escrowResult.order,
      });
      // Write-through: update cache with fresh data instead of invalidating
      if (escrowResult.order) updateOrderCache(id, escrowResult.order);
      else invalidateOrderCache(id);

      const enrichedEscrow = escrowResult.order
        ? enrichOrderResponse(escrowResult.order, actor_id)
        : undefined;
      return successResponse({
        order: escrowResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'escrowed',
        ...enrichedEscrow,
      });
    }

    // ── CANCEL: atomic cancel with escrow refund ──
    if (action === 'CANCEL') {
      const cancelResult = await atomicCancelWithRefund(
        id,
        order.status,
        actor_type,
        actor_id,
        reason || undefined
      );

      if (!cancelResult.success) {
        return NextResponse.json(
          { success: false, error: cancelResult.error, code: 'CANCEL_FAILED' },
          { status: 400 }
        );
      }

      // Instant notification for cancellation
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id,
        status: 'cancelled',
        previousStatus: order.status,
        orderVersion: cancelResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: cancelResult.order,
      });
      if (cancelResult.order) updateOrderCache(id, cancelResult.order);
      else invalidateOrderCache(id);

      const enrichedCancel = cancelResult.order
        ? enrichOrderResponse(cancelResult.order, actor_id)
        : undefined;
      return successResponse({
        order: cancelResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'cancelled',
        ...enrichedCancel,
      });
    }

    // ── CONFIRM_PAYMENT: confirm + release escrow (two-step atomic via core-api) ──
    if (action === 'CONFIRM_PAYMENT') {
      const idempotencyKey = getIdempotencyKey(request) || `${id}:confirm:${actor_id}:${Date.now()}`;

      const idempotencyResult = await withIdempotency(
        idempotencyKey,
        'confirm_and_complete',
        id,
        async () => {
          // First confirm payment, then core-api handles release + completion
          const resp = await proxyCoreApi(`/v1/orders/${id}`, {
            method: 'PATCH',
            body: {
              status: 'payment_confirmed',
              actor_type,
              actor_id,
            },
          });
          const respData = await resp.json();
          return { data: respData, statusCode: resp.status };
        }
      );

      if (idempotencyResult.cached) {
        logger.info('[Action] Returning cached CONFIRM_PAYMENT result', { orderId: id });
      }

      // Instant notification — fire immediately so UI sees completion without waiting for outbox poll
      if (idempotencyResult.statusCode >= 200 && idempotencyResult.statusCode < 300) {
        const respOrder = idempotencyResult.data?.order || idempotencyResult.data;
        fireInstantNotification({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id,
          status: 'completed',
          previousStatus: order.status,
          orderVersion: respOrder?.order_version,
          updatedAt: new Date().toISOString(),
          data: respOrder,
        });
        // Write-through cache update
        if (respOrder) updateOrderCache(id, respOrder);
        else invalidateOrderCache(id);
      }

      return NextResponse.json(
        {
          ...idempotencyResult.data,
          action,
          previousStatus: order.status,
        },
        { status: idempotencyResult.statusCode }
      );
    }

    // ── CLAIM: atomic claim of an escrowed order (broadcast model) ──
    if (action === 'CLAIM') {
      const claimResult = await claimOrder(
        id,
        actor_id,
        acceptor_wallet_address || undefined,
      );

      if (!claimResult.success) {
        return NextResponse.json(
          { success: false, error: claimResult.error, code: 'CLAIM_FAILED' },
          { status: 409 } // Conflict — likely already claimed
        );
      }

      // Instant notification for claim (status stays escrowed, only buyer_merchant_id set)
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: actor_id,
        status: 'escrowed',
        previousStatus: order.status,
        orderVersion: claimResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: claimResult.order,
      });
      if (claimResult.order) updateOrderCache(id, claimResult.order);
      else invalidateOrderCache(id);

      const enrichedClaim = claimResult.order
        ? enrichOrderResponse(claimResult.order, actor_id)
        : undefined;
      return successResponse({
        order: claimResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'escrowed',
        ...enrichedClaim,
      });
    }

    // ── SEND_PAYMENT on unclaimed escrowed order: auto-claim + pay (Option B) ──
    // Only for truly unclaimed broadcast orders (merchant-created with placeholder user).
    // Skip if actor is already merchant_id — they're already assigned, just do normal SEND_PAYMENT.
    const isUnclaimed = !order.buyer_merchant_id && order.merchant_id !== actor_id;
    if (action === 'SEND_PAYMENT' && order.status === 'escrowed' && isUnclaimed) {
      // Merchant is trying to send payment on an unclaimed order — do atomic claim+pay
      const claimPayResult = await claimAndPayOrder(
        id,
        actor_id,
        acceptor_wallet_address || undefined,
      );

      if (!claimPayResult.success) {
        return NextResponse.json(
          { success: false, error: claimPayResult.error, code: 'CLAIM_AND_PAY_FAILED' },
          { status: 409 }
        );
      }

      // Instant notification
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: actor_id,
        status: 'payment_sent',
        previousStatus: order.status,
        orderVersion: claimPayResult.order?.order_version,
        updatedAt: new Date().toISOString(),
        data: claimPayResult.order,
      });
      if (claimPayResult.order) updateOrderCache(id, claimPayResult.order);
      else invalidateOrderCache(id);

      const enrichedClaimPay = claimPayResult.order
        ? enrichOrderResponse(claimPayResult.order, actor_id)
        : undefined;
      return successResponse({
        order: claimPayResult.order,
        action,
        previousStatus: order.status,
        newStatus: 'payment_sent',
        claimed: true,
        ...enrichedClaimPay,
      });
    }

    // ── Backfill escrow_debited_entity_id if missing on escrowed orders ──
    // The DB constraint chk_escrow_required_for_payment_statuses requires
    // escrow_debited_entity_id for payment_sent/completed. On-chain escrow
    // may not have set this field. Backfill using seller-determination logic.
    if (action === 'SEND_PAYMENT' && !order.escrow_debited_entity_id && order.merchant_id) {
      const { query: dbQuery } = await import('@/lib/db');
      await dbQuery(
        `UPDATE orders
         SET escrow_debited_entity_id = COALESCE(escrow_debited_entity_id,
               CASE
                 WHEN buyer_merchant_id IS NOT NULL THEN merchant_id
                 WHEN type = 'sell' THEN user_id
                 ELSE merchant_id
               END),
             escrow_debited_entity_type = COALESCE(escrow_debited_entity_type,
               CASE WHEN type = 'sell' AND buyer_merchant_id IS NULL THEN 'user' ELSE 'merchant' END),
             escrow_debited_amount = COALESCE(escrow_debited_amount, crypto_amount),
             escrow_debited_at = COALESCE(escrow_debited_at, escrowed_at, created_at)
         WHERE id = $1 AND escrow_debited_entity_id IS NULL`,
        [id]
      );
      logger.info('[Action] Backfilled escrow_debited_entity_id for SEND_PAYMENT', {
        orderId: id,
        merchantId: order.merchant_id,
      });
    }

    // ── ACCEPT, SEND_PAYMENT, DISPUTE: standard status transitions via core-api ──
    const isFinancial = action === 'SEND_PAYMENT';
    const idempotencyKey = getIdempotencyKey(request);

    const executeTransition = async () => {
      const resp = await proxyCoreApi(`/v1/orders/${id}`, {
        method: 'PATCH',
        body: {
          status: dbTargetStatus,
          actor_type,
          actor_id,
          reason: action === 'DISPUTE' ? (reason || 'Dispute raised') : reason,
          acceptor_wallet_address: action === 'ACCEPT' ? acceptor_wallet_address : undefined,
        },
      });
      const respData = await resp.json();
      return { data: respData, statusCode: resp.status };
    };

    if (isFinancial) {
      const key = idempotencyKey || `${id}:${action}:${actor_id}:${Date.now()}`;
      const idempotencyResult = await withIdempotency(key, 'payment_sent', id, executeTransition);

      if (idempotencyResult.cached) {
        logger.info('[Action] Returning cached SEND_PAYMENT result', { orderId: id });
      }

      // Instant notification for SEND_PAYMENT
      if (idempotencyResult.statusCode >= 200 && idempotencyResult.statusCode < 300) {
        const respOrder = idempotencyResult.data?.order || idempotencyResult.data;
        fireInstantNotification({
          orderId: id,
          userId: order.user_id,
          merchantId: order.merchant_id,
          buyerMerchantId: order.buyer_merchant_id,
          status: dbTargetStatus,
          previousStatus: order.status,
          orderVersion: respOrder?.order_version,
          updatedAt: new Date().toISOString(),
          data: respOrder,
        });
        if (respOrder) updateOrderCache(id, respOrder);
        else invalidateOrderCache(id);
      }

      return NextResponse.json(
        {
          ...idempotencyResult.data,
          action,
          previousStatus: order.status,
        },
        { status: idempotencyResult.statusCode }
      );
    }

    // Non-financial: execute directly (ACCEPT, DISPUTE)
    const transitionResult = await executeTransition();

    // Instant notification for non-financial transitions
    if (transitionResult.statusCode >= 200 && transitionResult.statusCode < 300) {
      const respOrder = transitionResult.data?.order || transitionResult.data;
      fireInstantNotification({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        buyerMerchantId: order.buyer_merchant_id,
        status: dbTargetStatus,
        previousStatus: order.status,
        orderVersion: respOrder?.order_version,
        updatedAt: new Date().toISOString(),
        data: respOrder,
      });
      if (respOrder) updateOrderCache(id, respOrder);
      else invalidateOrderCache(id);
    }

    return NextResponse.json(
      {
        ...transitionResult.data,
        action,
        previousStatus: order.status,
      },
      { status: transitionResult.statusCode }
    );
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/action', error as Error);
    return errorResponse('Internal server error');
  }
}

// ── GET: Return allowed actions for current user ───────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Determine actor ID from auth context
    const headerMerchantId = request.headers.get('x-merchant-id');
    const actorId = headerMerchantId || auth.actorId;

    const allowedActions = getAllowedActions(order, actorId);
    const role = resolveTradeRole(order, actorId);
    const uiFields = enrichOrderResponse(order, actorId);

    return successResponse({
      orderId: id,
      currentStatus: order.status,
      role,
      allowedActions,
      ...uiFields,
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/action', error as Error);
    return errorResponse('Internal server error');
  }
}
