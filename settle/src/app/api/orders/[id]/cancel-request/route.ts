import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { logger, canRequestCancel, canUnilateralCancel } from 'settlement-core';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { getIdempotencyKey, withIdempotency } from '@/lib/idempotency';
import { getOrderWithRelations } from '@/lib/db/repositories/orders';
import { resolveTradeRole } from '@/lib/orders/handleOrderAction';
import { normalizeStatus } from '@/lib/orders/statusNormalizer';

const requestCancelSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  reason: z.string().optional(),
});

const respondCancelSchema = z.object({
  actor_type: z.enum(['user', 'merchant']),
  actor_id: z.string().uuid(),
  accept: z.boolean(),
});

// POST - Request cancellation
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Resolve merchant identity from header — only trust if authenticated as merchant
    const postMerchantId = request.headers.get('x-merchant-id');
    if (postMerchantId && auth.actorType === 'merchant' && !auth.merchantId) {
      auth.merchantId = postMerchantId;
    }

    const { id } = await params;
    const body = await request.json();

    const parseResult = requestCancelSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Security: enforce actor matches authenticated identity
    if (parseResult.data.actor_id !== auth.actorId && !(parseResult.data.actor_type === 'merchant' && auth.actorType === 'merchant' && postMerchantId && parseResult.data.actor_id === postMerchantId)) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    // ── STATUS + ROLE VALIDATION ──
    // Cancel only allowed from open, accepted, or escrowed statuses
    // and only by a participant (buyer or seller)
    const cancelOrder = await getOrderWithRelations(id);
    if (!cancelOrder) {
      return notFoundResponse('Order');
    }

    const minimalStatus = normalizeStatus(cancelOrder.status);
    const allowedCancelStatuses = ['open', 'accepted', 'escrowed'];
    if (!allowedCancelStatuses.includes(minimalStatus)) {
      logger.warn('[CancelRequest] Rejected — invalid status for cancellation', {
        orderId: id,
        currentStatus: cancelOrder.status,
        minimalStatus,
      });
      return NextResponse.json(
        { success: false, error: `Cannot cancel from status '${minimalStatus}'. Cancellation is only allowed before payment is sent.`, code: 'INVALID_STATUS_FOR_CANCEL' },
        { status: 400 }
      );
    }

    const role = resolveTradeRole(cancelOrder, parseResult.data.actor_id);
    if (role !== 'buyer' && role !== 'seller') {
      logger.warn('[CancelRequest] Rejected — actor is not a participant', {
        orderId: id,
        actorId: parseResult.data.actor_id,
        resolvedRole: role,
      });
      return NextResponse.json(
        { success: false, error: 'Only the buyer or seller can request cancellation.', code: 'NOT_PARTICIPANT' },
        { status: 403 }
      );
    }

    // TASK 10: Enforce idempotency for cancel requests
    const idempotencyKey = getIdempotencyKey(request);
    const effectiveKey = idempotencyKey || `cancel:${id}:${parseResult.data.actor_id}:${Date.now()}`;

    const idempotencyResult = await withIdempotency(
      effectiveKey,
      'cancel_order',
      id,
      async () => {
        const resp = await proxyCoreApi(`/v1/orders/${id}/cancel-request`, {
          method: 'POST',
          body: parseResult.data,
        });
        const respData = await resp.json();
        return { data: respData, statusCode: resp.status };
      }
    );

    return NextResponse.json(idempotencyResult.data, { status: idempotencyResult.statusCode });
  } catch (error) {
    logger.api.error('POST', '/api/orders/[id]/cancel-request', error as Error);
    return errorResponse('Internal server error');
  }
}

// PUT - Accept/decline cancel request
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Resolve merchant identity from header
    const putMerchantId = request.headers.get('x-merchant-id');
    if (putMerchantId && !auth.merchantId) {
      auth.merchantId = putMerchantId;
    }

    const { id } = await params;
    const body = await request.json();

    const parseResult = respondCancelSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Security: enforce actor matches authenticated identity (with merchant header fallback)
    if (parseResult.data.actor_id !== auth.actorId && !(parseResult.data.actor_type === 'merchant' && putMerchantId && parseResult.data.actor_id === putMerchantId)) {
      return forbiddenResponse('actor_id does not match authenticated identity');
    }

    return proxyCoreApi(`/v1/orders/${id}/cancel-request`, {
      method: 'PUT',
      body: parseResult.data,
    });
  } catch (error) {
    logger.api.error('PUT', '/api/orders/[id]/cancel-request', error as Error);
    return errorResponse('Internal server error');
  }
}

// GET - Get cancel request status (read-only, local)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const { id } = await params;

    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      return forbiddenResponse('You do not have access to this order');
    }

    const order = await queryOne<{
      status: string;
      cancel_requested_by: string | null;
      cancel_requested_at: Date | null;
      cancel_request_reason: string | null;
      last_activity_at: Date | null;
      inactivity_warned_at: Date | null;
      disputed_at: Date | null;
      dispute_auto_resolve_at: Date | null;
    }>(
      `SELECT status, cancel_requested_by, cancel_requested_at, cancel_request_reason,
              last_activity_at, inactivity_warned_at, disputed_at, dispute_auto_resolve_at
       FROM orders WHERE id = $1`,
      [id]
    );

    if (!order) {
      return notFoundResponse('Order');
    }

    return successResponse({
      // Cancel request state
      canRequestCancel: canRequestCancel(order.status as any),
      canUnilateralCancel: canUnilateralCancel(order.status as any),
      pendingCancelRequest: order.cancel_requested_by ? {
        requestedBy: order.cancel_requested_by,
        requestedAt: order.cancel_requested_at,
        reason: order.cancel_request_reason,
      } : null,
      // Inactivity state
      lastActivityAt: order.last_activity_at,
      inactivityWarnedAt: order.inactivity_warned_at,
      // Dispute auto-resolve state
      disputedAt: order.disputed_at,
      disputeAutoResolveAt: order.dispute_auto_resolve_at,
    });
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/cancel-request', error as Error);
    return errorResponse('Internal server error');
  }
}
