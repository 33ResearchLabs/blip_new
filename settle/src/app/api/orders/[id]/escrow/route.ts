import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderWithRelations,
} from '@/lib/db/repositories/orders';
import { logger, normalizeStatus } from 'settlement-core';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import { notifyOrderStatusUpdated } from '@/lib/pusher/server';
import {
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
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { serializeOrder } from '@/lib/api/orderSerializer';

// Schema for escrow deposit
const escrowDepositSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  escrow_address: z.string().nullish(),
  // On-chain escrow references for release
  escrow_trade_id: z.number().nullish(),
  escrow_trade_pda: z.string().nullish(),
  escrow_pda: z.string().nullish(),
  escrow_creator_wallet: z.string().nullish(),
});

// Schema for escrow release
const escrowReleaseSchema = z.object({
  tx_hash: z.string().min(1, 'Transaction hash is required'),
  actor_type: z.enum(['user', 'merchant', 'system']),
  actor_id: z.string().uuid(),
});

// GET - Get escrow status for an order (read-only, stays local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Fetch order
    const order = await getOrderWithRelations(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Check authorization
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Return escrow details with minimal_status
    const escrowData = serializeOrder({
      order_id: order.id,
      status: order.status,
      escrow_tx_hash: order.escrow_tx_hash,
      escrow_address: order.escrow_address,
      release_tx_hash: order.release_tx_hash,
      escrowed_at: order.escrowed_at,
      crypto_amount: order.crypto_amount,
      crypto_currency: order.crypto_currency,
      is_escrowed: ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status),
      is_released: order.status === 'completed' && order.release_tx_hash,
    });

    return successResponse(escrowData);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// POST - Record escrow deposit (proxied to core-api)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Rate limit: 10 escrow operations per minute
  const rateLimitResponse = checkRateLimit(request, 'escrow:deposit', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = escrowDepositSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Security: enforce actor matches authenticated identity
    // Must run BEFORE canAccessOrder so auth context is correct
    const headerMerchantId = request.headers.get('x-merchant-id');
    const actorMatchesAuth = parseResult.data.actor_id === auth.actorId;
    const actorMatchesMerchant = parseResult.data.actor_type === 'merchant' && headerMerchantId && parseResult.data.actor_id === headerMerchantId;
    if (!actorMatchesAuth && !actorMatchesMerchant) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }
    if (!actorMatchesAuth && actorMatchesMerchant) {
      auth.actorType = 'merchant';
      auth.actorId = headerMerchantId;
      auth.merchantId = headerMerchantId;
    }

    // Verify access to this order (after auth context is resolved)
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Forward to core-api (single writer for all mutations)
    const depositResponse = await proxyCoreApi(`/v1/orders/${id}/escrow`, {
      method: 'POST',
      body: parseResult.data,
    });

    // Fire Pusher notification for escrow deposit
    if (depositResponse.status >= 200 && depositResponse.status < 300) {
      try {
        const resBody = await depositResponse.json();
        const order = resBody?.data;
        if (order?.id) {
          notifyOrderStatusUpdated({
            orderId: order.id,
            userId: order.user_id || '',
            merchantId: order.merchant_id || '',
            status: order.status || 'escrowed',
            minimal_status: normalizeStatus(order.status || 'escrowed'),
            order_version: order.order_version,
            updatedAt: new Date().toISOString(),
          }).catch(err => logger.error('[Pusher] Failed to notify escrow deposit', { error: err }));
        }
        return NextResponse.json(resBody, { status: depositResponse.status });
      } catch {
        return depositResponse;
      }
    }

    return depositResponse;
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}

// PATCH - Record escrow release (proxied to core-api)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idValidation = uuidSchema.safeParse(id);
    if (!idValidation.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    const body = await request.json();

    // Require authentication
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Validate request body
    const parseResult = escrowReleaseSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { tx_hash, actor_type, actor_id } = parseResult.data;

    // Security: enforce actor matches authenticated identity (with merchant header fallback)
    // Must run BEFORE canAccessOrder so auth context is correct
    const relHeaderMerchantId = request.headers.get('x-merchant-id');
    const relActorMatchesAuth = actor_id === auth.actorId;
    const relActorMatchesMerchant = actor_type === 'merchant' && relHeaderMerchantId && actor_id === relHeaderMerchantId;
    if (!relActorMatchesAuth && !relActorMatchesMerchant) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }
    if (!relActorMatchesAuth && relActorMatchesMerchant) {
      auth.actorType = 'merchant';
      auth.actorId = relHeaderMerchantId;
      auth.merchantId = relHeaderMerchantId;
    }

    // Verify access to this order (after auth context is resolved)
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    // Forward to core-api (single writer for all mutations)
    // Core-api release only allows merchant/system — settle has already verified
    // the caller is an authorized participant, so proxy as system to ensure it goes through
    const releaseResponse = await proxyCoreApi(`/v1/orders/${id}/events`, {
      method: 'POST',
      body: { event_type: 'release', tx_hash },
      actorType: 'system',
      actorId: actor_id,
    });

    // Fire Pusher notification for escrow release
    if (releaseResponse.status >= 200 && releaseResponse.status < 300) {
      try {
        const resBody = await releaseResponse.json();
        const order = resBody?.data;
        if (order?.id) {
          notifyOrderStatusUpdated({
            orderId: order.id,
            userId: order.user_id || '',
            merchantId: order.merchant_id || '',
            status: order.status || 'completed',
            minimal_status: normalizeStatus(order.status || 'completed'),
            order_version: order.order_version,
            updatedAt: new Date().toISOString(),
          }).catch(err => logger.error('[Pusher] Failed to notify escrow release', { error: err }));
        }
        return NextResponse.json(resBody, { status: releaseResponse.status });
      } catch {
        return releaseResponse;
      }
    }

    return releaseResponse;
  } catch (error) {
    logger.api.error('PATCH', '/api/orders/[id]/escrow', error as Error);
    return errorResponse('Internal server error');
  }
}
