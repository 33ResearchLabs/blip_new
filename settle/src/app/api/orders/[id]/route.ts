import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderById,
  getOrderWithRelations,
  updateOrderStatus,
  cancelOrder,
} from '@/lib/db/repositories/orders';
import { query } from '@/lib/db';
import { MOCK_MODE } from '@/lib/config/mockMode';
import { OrderStatus, ActorType } from '@/lib/types/database';
import {
  updateOrderStatusSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';
import { notifyOrderStatusUpdated, notifyOrderCancelled } from '@/lib/pusher/server';
import { wsBroadcastOrderUpdate, wsBroadcastOrderCancelled } from '@/lib/websocket/broadcast';

// Prevent Next.js from caching this route
export const dynamic = 'force-dynamic';

// Validate order ID parameter
async function validateOrderId(id: string): Promise<{ valid: boolean; error?: string }> {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: 'Invalid order ID format' };
  }
  return { valid: true };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Get auth context from query params
    const auth = getAuthContext(request);

    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization if auth context provided
    if (auth) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`GET /api/orders/${id}`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    logger.api.request('GET', `/api/orders/${id}`, auth?.actorId);
    return successResponse(order);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = updateOrderStatusSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { status, actor_type, actor_id, reason, acceptor_wallet_address } = parseResult.data;

    // Check authorization
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Special case: Any merchant can claim a pending or escrowed order (Uber-like model)
    // This allows orders to be broadcast to all merchants and first to accept wins
    // For sell orders, user locks escrow first (status = escrowed), then merchant accepts
    // M2M flow: escrowed orders can go directly to payment_pending (skipping accepted)
    const isMerchantClaimingOrder =
      actor_type === 'merchant' &&
      (order.status === 'pending' || order.status === 'escrowed') &&
      (status === 'accepted' || (order.status === 'escrowed' && status === 'payment_pending'));

    if (!isMerchantClaimingOrder) {
      // Verify actor can access this order (for all other cases)
      const auth = { actorType: actor_type, actorId: actor_id };
      const canAccess = await canAccessOrder(auth as { actorType: 'user' | 'merchant' | 'system'; actorId: string }, id);
      if (!canAccess) {
        logger.auth.forbidden(`PATCH /api/orders/${id}`, actor_id, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // Additional permission check based on actor type
    // - Users: can mark payment_sent (for buy orders), complete (for sell orders after releasing escrow), cancelled, disputed
    // - Merchants: can accept, escrow, mark payment_sent (for sell orders), confirm payment, complete, cancel, dispute
    const userAllowedStatuses: OrderStatus[] = ['payment_sent', 'payment_confirmed', 'completed', 'cancelled', 'disputed'];
    const merchantAllowedStatuses: OrderStatus[] = ['accepted', 'escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'completed', 'cancelled', 'disputed'];

    if (actor_type === 'user' && !userAllowedStatuses.includes(status)) {
      return forbiddenResponse(`Users cannot set status to '${status}'`);
    }

    if (actor_type === 'merchant' && !merchantAllowedStatuses.includes(status)) {
      return forbiddenResponse(`Merchants cannot set status to '${status}'`);
    }

    // Guard: prevent completing M2M trades without escrow
    // In a payment app, funds must be escrowed before completion
    if (status === 'completed' && !order.escrow_tx_hash && order.buyer_merchant_id) {
      return NextResponse.json(
        { success: false, error: 'Cannot complete M2M trade without escrow. Lock escrow first.' },
        { status: 400 }
      );
    }

    // Build metadata for status update
    const metadata: Record<string, unknown> = {};
    if (reason) metadata.reason = reason;
    if (acceptor_wallet_address) metadata.acceptor_wallet_address = acceptor_wallet_address;

    // Perform the status update (state machine validates transition)
    const result = await updateOrderStatus(
      id,
      status,
      actor_type,
      actor_id,
      Object.keys(metadata).length > 0 ? metadata : undefined
    );

    if (!result.success) {
      // State machine rejected the transition
      console.error(`[PATCH /api/orders/${id}] Status update REJECTED:`, result.error, { from: order.status, to: status, actor: actor_type, actorId: actor_id });
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    console.log(`[PATCH /api/orders/${id}] Status update SUCCESS: ${order.status} → ${status} by ${actor_type}:${actor_id}`);
    console.log(`[PATCH /api/orders/${id}] Updated order:`, { id: result.order?.id, status: result.order?.status, merchant_id: result.order?.merchant_id });

    // Mock mode balance handling for status transitions
    // CRITICAL: Use result.order (from inside FOR UPDATE transaction) for checks,
    // NOT the pre-fetched 'order' which can have stale data from before concurrent updates.
    if (MOCK_MODE) {
      const latestOrder = result.order!;
      const amount = parseFloat(String(latestOrder.crypto_amount));
      const hadEscrow = !!latestOrder.escrow_tx_hash;

      if (status === 'completed' && hadEscrow && !latestOrder.release_tx_hash) {
        // Order completed (not via escrow release endpoint) - credit the buyer
        // SAFETY: This only runs if release_tx_hash is null, meaning the escrow endpoint
        // hasn't already credited the buyer. Uses latestOrder from FOR UPDATE to prevent race.
        const isBuyOrder = latestOrder.type === 'buy';
        const recipientId = isBuyOrder
          ? (latestOrder.buyer_merchant_id || latestOrder.user_id)
          : (latestOrder.buyer_merchant_id || latestOrder.merchant_id);
        const recipientTable = isBuyOrder
          ? (latestOrder.buyer_merchant_id ? 'merchants' : 'users')
          : 'merchants';

        try {
          await query(
            `UPDATE ${recipientTable} SET balance = balance + $1 WHERE id = $2`,
            [amount, recipientId]
          );
          logger.info('[Mock] Credited buyer on completion', { recipientId, amount, table: recipientTable });
        } catch (creditErr) {
          logger.api.error('PATCH', `/api/orders/${id}/mock-credit`, creditErr as Error);
        }
      }

      if (status === 'cancelled' && hadEscrow) {
        // Order cancelled after escrow was locked - refund the escrow creator
        // In M2M trades, merchant_id is always the seller who locked escrow
        // In user trades: BUY = merchant locked, SELL = user locked
        const isBuyOrder = latestOrder.type === 'buy';
        const isM2M = !!latestOrder.buyer_merchant_id;
        let refundId: string;
        let refundTable: string;

        if (isM2M) {
          // M2M: merchant_id is always the seller who locked escrow
          refundId = latestOrder.merchant_id;
          refundTable = 'merchants';
        } else {
          // User trade: BUY = merchant locked, SELL = user locked
          refundId = isBuyOrder ? latestOrder.merchant_id : latestOrder.user_id;
          refundTable = isBuyOrder ? 'merchants' : 'users';
        }

        try {
          await query(
            `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
            [amount, refundId]
          );
          logger.info('[Mock] Refunded seller on cancellation', { refundId, amount, table: refundTable });
        } catch (refundErr) {
          logger.api.error('PATCH', `/api/orders/${id}/mock-refund`, refundErr as Error);
        }
      }
    }

    // Fetch full order with relations for notification (includes merchant info for popup)
    const fullOrder = await getOrderWithRelations(id);

    // Auto system messages for status changes removed - keeping only real user messages

    // Trigger real-time notification with full order data including merchant
    // Use actual DB status (may differ from requested status, e.g. escrowed→accepted stays escrowed)
    if (fullOrder) {
      const actualStatus = fullOrder.status || status;
      const updatePayload = {
        orderId: id,
        userId: fullOrder.user_id,
        merchantId: fullOrder.merchant_id,
        status: actualStatus,
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: fullOrder,
      };

      // Pusher notification
      notifyOrderStatusUpdated(updatePayload);

      // Also notify buyer_merchant if this is an M2M trade
      if (fullOrder.buyer_merchant_id && fullOrder.buyer_merchant_id !== fullOrder.merchant_id) {
        notifyOrderStatusUpdated({
          ...updatePayload,
          merchantId: fullOrder.buyer_merchant_id,
        });
      }

      // WebSocket broadcast to all clients subscribed to this order
      wsBroadcastOrderUpdate({
        orderId: id,
        status: actualStatus,
        previousStatus: order.status,
        updatedAt: updatePayload.updatedAt,
        data: fullOrder,
      });
    }

    logger.api.request('PATCH', `/api/orders/${id}`, actor_id);
    return successResponse(fullOrder || result.order);
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = await validateOrderId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Get params from query string
    const searchParams = request.nextUrl.searchParams;
    const actorType = searchParams.get('actor_type');
    const actorId = searchParams.get('actor_id');
    const reason = searchParams.get('reason');

    // Validate required params
    if (!actorType || !actorId) {
      return validationErrorResponse(['actor_type and actor_id are required query parameters']);
    }

    // Validate actor_type enum
    if (!['user', 'merchant', 'system'].includes(actorType)) {
      return validationErrorResponse(['actor_type must be user, merchant, or system']);
    }

    // Validate actor_id is UUID
    const actorIdValidation = uuidSchema.safeParse(actorId);
    if (!actorIdValidation.success) {
      return validationErrorResponse(['actor_id must be a valid UUID']);
    }

    // Check order exists
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const auth = { actorType: actorType as 'user' | 'merchant' | 'system', actorId };
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`DELETE /api/orders/${id}`, actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Cancel uses the state machine internally
    const result = await cancelOrder(
      id,
      actorType as ActorType,
      actorId,
      reason || undefined
    );

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Mock mode: refund seller if escrow was locked
    if (MOCK_MODE && order.escrow_tx_hash) {
      const amount = parseFloat(String(order.crypto_amount));
      // Refund the escrow creator (seller)
      const isBuyOrder = order.type === 'buy';
      const isM2M = !!order.buyer_merchant_id;
      let refundId: string;
      let refundTable: string;

      if (isM2M) {
        // M2M: merchant_id is always the seller who locked escrow
        refundId = order.merchant_id;
        refundTable = 'merchants';
      } else {
        // User trade: BUY = merchant locked, SELL = user locked
        refundId = isBuyOrder ? order.merchant_id : order.user_id;
        refundTable = isBuyOrder ? 'merchants' : 'users';
      }

      try {
        await query(
          `UPDATE ${refundTable} SET balance = balance + $1 WHERE id = $2`,
          [amount, refundId]
        );
        logger.info('[Mock] Refunded seller on DELETE cancellation', { refundId, amount, table: refundTable });
      } catch (refundErr) {
        logger.api.error('DELETE', `/api/orders/${id}/mock-refund`, refundErr as Error);
      }
    }

    // Auto system messages for cancellation removed - keeping only real user messages

    // Notify order cancellation via Pusher + WebSocket
    try {
      notifyOrderCancelled({
        orderId: id,
        userId: order.user_id,
        merchantId: order.merchant_id,
        status: 'cancelled',
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
        data: { cancelledBy: actorType, reason: reason || undefined },
      });

      wsBroadcastOrderCancelled({
        orderId: id,
        cancelledBy: actorType,
        reason: reason || undefined,
        data: result.order,
      });
    } catch (msgError) {
      logger.api.error('DELETE', `/api/orders/${id}/cancellation-notification`, msgError as Error);
    }

    logger.api.request('DELETE', `/api/orders/${id}`, actorId);
    return successResponse(result.order);
  } catch (error) {
    logger.api.error('DELETE', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
