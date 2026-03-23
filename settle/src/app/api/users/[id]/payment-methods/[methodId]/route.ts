import { NextRequest, NextResponse } from 'next/server';
import {
  getPaymentMethodById,
  updatePaymentMethod,
  deletePaymentMethod,
} from '@/lib/db/repositories/paymentMethods';
import {
  updatePaymentMethodSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string; methodId: string }> };

function validateIds(userId: string, methodId: string) {
  if (!uuidSchema.safeParse(userId).success) return 'Invalid user ID format';
  if (!uuidSchema.safeParse(methodId).success) return 'Invalid payment method ID format';
  return null;
}

// GET /api/users/[id]/payment-methods/[methodId] — get single method
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id, methodId } = await params;
    const err = validateIds(id, methodId);
    if (err) return validationErrorResponse([err]);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only access your own payment methods');
    }

    const method = await getPaymentMethodById(methodId);
    if (!method || method.user_id !== id) return notFoundResponse('Payment method');

    return successResponse(method);
  } catch (error) {
    logger.api.error('GET', '/api/users/[id]/payment-methods/[methodId]', error as Error);
    return errorResponse('Internal server error');
  }
}

// PUT /api/users/[id]/payment-methods/[methodId] — update a method
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id, methodId } = await params;
    const err = validateIds(id, methodId);
    if (err) return validationErrorResponse([err]);

    const body = await request.json();
    const parseResult = updatePaymentMethodSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only edit your own payment methods');
    }

    const updated = await updatePaymentMethod(methodId, id, parseResult.data);
    if (!updated) return notFoundResponse('Payment method');

    logger.info('Payment method updated', { userId: id, methodId });
    return successResponse(updated);
  } catch (error) {
    logger.api.error('PUT', '/api/users/[id]/payment-methods/[methodId]', error as Error);
    return errorResponse('Internal server error');
  }
}

// DELETE /api/users/[id]/payment-methods/[methodId] — soft-delete (deactivate)
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id, methodId } = await params;
    const err = validateIds(id, methodId);
    if (err) return validationErrorResponse([err]);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only delete your own payment methods');
    }

    const deleted = await deletePaymentMethod(methodId, id);
    if (!deleted) return notFoundResponse('Payment method');

    logger.info('Payment method deleted', { userId: id, methodId });
    return successResponse({ deleted: true });
  } catch (error) {
    logger.api.error('DELETE', '/api/users/[id]/payment-methods/[methodId]', error as Error);
    return errorResponse('Internal server error');
  }
}
