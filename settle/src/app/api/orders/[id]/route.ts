import { NextRequest, NextResponse } from 'next/server';
import {
  getOrderWithRelations,
} from '@/lib/db/repositories/orders';
import {
  logger,
  normalizeStatus,
} from 'settlement-core';
import {
  updateOrderStatusSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { proxyCoreApi, signActorHeaders } from '@/lib/proxy/coreApi';
import { MOCK_MODE } from '@/lib/config/mockMode';
import { atomicCancelWithRefund } from '@/lib/orders/atomicCancel';
import { serializeOrder } from '@/lib/api/orderSerializer';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';

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

    // Require authenticated user
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // NOTE: GET always uses local query (read-only) because core-api
    // doesn't return joined merchant/user/offer objects needed by the UI.
    // Core-api proxy is used only for mutations (PATCH).
    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`GET /api/orders/${id}`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Add minimal_status to response (8-state normalized status)
    const orderWithMinimalStatus = {
      ...order,
      minimal_status: normalizeStatus(order.status),
    };

    logger.api.request('GET', `/api/orders/${id}`, auth?.actorId);
    return successResponse(orderWithMinimalStatus);
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

    // Require authentication
    const auth = await requireAuth(request, body);
    if (auth instanceof NextResponse) return auth;

    // Verify access to this order
    // Skip access check for 'accepted' status — merchant is joining, not yet a participant
    const isAccepting = body.status === 'accepted';
    if (!isAccepting) {
      const canAccess = await canAccessOrder(auth, id);
      if (!canAccess) {
        logger.auth.forbidden(`PATCH /api/orders/${id}`, auth.actorId, 'Not order participant');
        return forbiddenResponse('You do not have access to this order');
      }
    }

    // Validate request body
    const parseResult = updateOrderStatusSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { status, actor_type, actor_id, reason, acceptor_wallet_address, refund_tx_hash } = parseResult.data;

    // Security: enforce actor matches authenticated identity
    if (actor_id !== auth.actorId) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    // Fetch current order status BEFORE the update so we can send previousStatus in Pusher
    let previousStatus: string | undefined;
    try {
      const currentOrder = await getOrderWithRelations(id);
      if (currentOrder) {
        previousStatus = currentOrder.status;
      }
    } catch (e) {
      logger.warn('[PATCH /orders] Could not fetch previous status', { orderId: id });
    }

    // If refund_tx_hash provided, save it to DB regardless of mode
    if (refund_tx_hash) {
      const { query } = await import('@/lib/db');
      await query(`UPDATE orders SET refund_tx_hash = $1 WHERE id = $2`, [refund_tx_hash, id]);
      logger.info('[PATCH /orders] Saved refund_tx_hash', { orderId: id, refund_tx_hash });
    }

    // Mock mode (or Core-API absent): handle cancellation locally with escrow refund
    const isMockMode = MOCK_MODE || !process.env.CORE_API_URL;
    if (isMockMode && status === 'cancelled') {
      // Fetch current order to get its status and details
      const currentOrder = await getOrderWithRelations(id);
      if (!currentOrder) {
        return notFoundResponse('Order');
      }

      // Use atomicCancelWithRefund for deterministic escrow refund
      const result = await atomicCancelWithRefund(
        id,
        currentOrder.status,
        actor_type,
        actor_id,
        reason ?? undefined,
        {
          type: currentOrder.type,
          crypto_amount: currentOrder.crypto_amount,
          merchant_id: currentOrder.merchant_id,
          user_id: currentOrder.user_id,
          buyer_merchant_id: currentOrder.buyer_merchant_id ?? null,
          order_number: Number(currentOrder.order_number),
          crypto_currency: currentOrder.crypto_currency,
          fiat_amount: currentOrder.fiat_amount,
          fiat_currency: currentOrder.fiat_currency,
        }
      );

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error },
          { status: 400 }
        );
      }

      return NextResponse.json({
        success: true,
        data: serializeOrder(result.order!),
      });
    }

    // Forward to core-api (single writer for all mutations)
    const response = await proxyCoreApi(`/v1/orders/${id}`, {
      method: 'PATCH',
      body: { status, actor_type, actor_id, reason, acceptor_wallet_address },
    });

    // Fire Pusher notification so all parties see the update in realtime
    if (response.status >= 200 && response.status < 300) {
      try {
        const resBody = await response.json();
        const order = resBody?.data;
        if (order?.id) {
          notifyOrderStatusUpdated({
            orderId: order.id,
            userId: order.user_id || '',
            merchantId: order.merchant_id || '',
            status: order.status || status,
            minimal_status: normalizeStatus(order.status || status),
            order_version: order.order_version,
            previousStatus,
            updatedAt: new Date().toISOString(),
            data: order,
          }).catch(err => logger.error('[Pusher] Failed to notify status update', { error: err }));
        }
        return NextResponse.json(resBody, { status: response.status });
      } catch {
        return response;
      }
    }

    return response;
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

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Get params from query string
    const searchParams = request.nextUrl.searchParams;
    const actorType = searchParams.get('actor_type');
    const actorId = searchParams.get('actor_id');
    const reason = searchParams.get('reason');

    // Security: enforce actor matches authenticated identity
    if (actorId && actorId !== auth.actorId) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    const effectiveActorId = actorId || auth.actorId;
    const effectiveActorType = actorType || auth.actorType;

    const queryStr = `actor_type=${effectiveActorType}&actor_id=${effectiveActorId}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
    return proxyCoreApi(`/v1/orders/${id}?${queryStr}`, { method: 'DELETE' });
  } catch (error) {
    logger.api.error('DELETE', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
