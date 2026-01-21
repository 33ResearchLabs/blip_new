import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getOrderById,
  getOrderWithRelations,
  updateOrderStatus,
  cancelOrder,
} from '@/lib/db/repositories/orders';
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

    const { status, actor_type, actor_id, reason } = parseResult.data;

    // Check authorization
    const order = await getOrderById(id);
    if (!order) {
      return notFoundResponse('Order');
    }

    // Verify actor can access this order
    const auth = { actorType: actor_type, actorId: actor_id };
    const canAccess = await canAccessOrder(auth as { actorType: 'user' | 'merchant' | 'system'; actorId: string }, id);
    if (!canAccess) {
      logger.auth.forbidden(`PATCH /api/orders/${id}`, actor_id, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Additional permission check based on actor type
    // - Users: can mark payment_sent (for buy orders), complete (for sell orders after releasing escrow), cancelled, disputed
    // - Merchants: can accept, escrow, mark payment_sent (for sell orders), confirm payment, complete, cancel, dispute
    const userAllowedStatuses: OrderStatus[] = ['payment_sent', 'completed', 'cancelled', 'disputed'];
    const merchantAllowedStatuses: OrderStatus[] = ['accepted', 'escrowed', 'payment_sent', 'payment_confirmed', 'completed', 'cancelled', 'disputed'];

    if (actor_type === 'user' && !userAllowedStatuses.includes(status)) {
      return forbiddenResponse(`Users cannot set status to '${status}'`);
    }

    if (actor_type === 'merchant' && !merchantAllowedStatuses.includes(status)) {
      return forbiddenResponse(`Merchants cannot set status to '${status}'`);
    }

    // Perform the status update (state machine validates transition)
    const result = await updateOrderStatus(
      id,
      status,
      actor_type,
      actor_id,
      reason ? { reason } : undefined
    );

    if (!result.success) {
      // State machine rejected the transition
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // Fetch full order with relations for notification (includes merchant info for popup)
    const fullOrder = await getOrderWithRelations(id);

    // Trigger real-time notification with full order data including merchant
    if (fullOrder) {
      notifyOrderStatusUpdated({
        orderId: id,
        userId: fullOrder.user_id,
        merchantId: fullOrder.merchant_id,
        status,
        previousStatus: order.status,
        updatedAt: new Date().toISOString(),
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

    logger.api.request('DELETE', `/api/orders/${id}`, actorId);
    return successResponse(result.order);
  } catch (error) {
    logger.api.error('DELETE', '/api/orders/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
