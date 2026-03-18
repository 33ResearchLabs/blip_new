import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import {
  Order,
  canExtendOrder,
  getExtensionDuration,
  logger,
} from 'settlement-core';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

const requestExtensionSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
});

const respondExtensionSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  accept: z.boolean(),
});

// POST - Request an extension
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authorization — mandatory
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;
    const body = await request.json();

    const parseResult = requestExtensionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { actor_type, actor_id } = parseResult.data;

    // Security: enforce actor matches authenticated identity (with merchant header fallback)
    const extHeaderMerchantId = request.headers.get('x-merchant-id');
    if (actor_id !== auth.actorId && !(actor_type === 'merchant' && extHeaderMerchantId && actor_id === extHeaderMerchantId)) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    return proxyCoreApi(`/v1/orders/${id}/extension`, {
      method: 'POST',
      body: { actor_type, actor_id },
    });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}

// PUT - Respond to an extension request (accept/decline)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authorization — mandatory
    const authPut = await requireAuth(request);
    if (authPut instanceof NextResponse) return authPut;

    const { id } = await params;
    const body = await request.json();

    const parseResult = respondExtensionSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { actor_type, actor_id, accept } = parseResult.data;

    // Security: enforce actor matches authenticated identity (with merchant header fallback)
    const putHeaderMerchantId = request.headers.get('x-merchant-id');
    if (actor_id !== authPut.actorId && !(actor_type === 'merchant' && putHeaderMerchantId && actor_id === putHeaderMerchantId)) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    return proxyCoreApi(`/v1/orders/${id}/extension`, {
      method: 'PUT',
      body: { actor_type, actor_id, accept },
    });
  } catch (error) {
    logger.api.error('PUT', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}

// GET - Get extension status for an order (read-only, stays local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Authorization — mandatory
    const authGet = await requireAuth(request);
    if (authGet instanceof NextResponse) return authGet;

    const { id } = await params;

    const order = await queryOne<Order>(
      'SELECT * FROM orders WHERE id = $1',
      [id]
    );

    if (!order) {
      return notFoundResponse('Order');
    }

    const extensionCheck = canExtendOrder(
      order.status,
      order.extension_count,
      order.max_extensions
    );

    return successResponse({
      canExtend: extensionCheck.canExtend,
      reason: extensionCheck.reason,
      extensionCount: order.extension_count,
      maxExtensions: order.max_extensions,
      extensionsRemaining: order.max_extensions - order.extension_count,
      pendingRequest: order.extension_requested_by ? {
        requestedBy: order.extension_requested_by,
        requestedAt: order.extension_requested_at,
        extensionMinutes: order.extension_minutes,
      } : null,
      extensionDuration: getExtensionDuration(order.status),
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/extension', error as Error);
    return errorResponse('Internal server error');
  }
}
