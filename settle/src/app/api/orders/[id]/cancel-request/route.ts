import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { queryOne } from '@/lib/db';
import { logger, canRequestCancel, canUnilateralCancel } from 'settlement-core';
import { proxyCoreApi } from '@/lib/proxy/coreApi';
import {
  requireAuth,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';

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

    const { id } = await params;
    const body = await request.json();

    const parseResult = requestCancelSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    return proxyCoreApi(`/v1/orders/${id}/cancel-request`, {
      method: 'POST',
      body: parseResult.data,
    });
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

    const { id } = await params;
    const body = await request.json();

    const parseResult = respondCancelSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
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
