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
  getAuthContext,
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

    // FEATURE FLAG: Proxy to core-api if enabled
    if (process.env.USE_CORE_API === '1' && process.env.CORE_API_URL) {
      try {
        const coreApiUrl = `${process.env.CORE_API_URL}/v1/orders/${id}`;
        const headers: Record<string, string> = {};

        const coreApiSecret = process.env.CORE_API_SECRET;
        if (coreApiSecret) headers['x-core-api-secret'] = coreApiSecret;

        if (auth) {
          headers['x-actor-type'] = auth.actorType;
          headers['x-actor-id'] = auth.actorId;
          if (coreApiSecret) {
            headers['x-actor-signature'] = signActorHeaders(coreApiSecret, auth.actorType, auth.actorId);
          }
        }

        const response = await fetch(coreApiUrl, { headers });
        const data = await response.json();

        return NextResponse.json(data, { status: response.status });
      } catch (proxyError) {
        logger.error('[Proxy] Failed to reach core-api', { error: proxyError });
        // Fall through to local logic
      }
    }

    // LOCAL LOGIC (read-only fallback)
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

    // Validate request body
    const parseResult = updateOrderStatusSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { status, actor_type, actor_id, reason, acceptor_wallet_address, refund_tx_hash } = parseResult.data;

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
    return proxyCoreApi(`/v1/orders/${id}`, {
      method: 'PATCH',
      body: { status, actor_type, actor_id, reason, acceptor_wallet_address },
    });
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

    const queryStr = `actor_type=${actorType}&actor_id=${actorId}${reason ? `&reason=${encodeURIComponent(reason)}` : ''}`;
    return proxyCoreApi(`/v1/orders/${id}?${queryStr}`, { method: 'DELETE' });
  } catch (error) {
    logger.api.error('DELETE', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
