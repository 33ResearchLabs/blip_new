import { NextRequest, NextResponse } from 'next/server';
import { setDefaultPaymentMethod } from '@/lib/db/repositories/paymentMethods';
import { uuidSchema } from '@/lib/validation/schemas';
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

// PUT /api/users/[id]/payment-methods/[methodId]/default
// Marks the given payment method as the user's default. The repository
// atomically clears any previous default so the partial unique index is
// never violated mid-flight.
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id, methodId } = await params;
    if (!uuidSchema.safeParse(id).success) {
      return validationErrorResponse(['Invalid user ID format']);
    }
    if (!uuidSchema.safeParse(methodId).success) {
      return validationErrorResponse(['Invalid payment method ID format']);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only change your own payment methods');
    }

    const updated = await setDefaultPaymentMethod(methodId, id);
    if (!updated) return notFoundResponse('Payment method');

    logger.info('Payment method set as default', { userId: id, methodId });
    return successResponse(updated);
  } catch (error) {
    logger.api.error(
      'PUT',
      '/api/users/[id]/payment-methods/[methodId]/default',
      error as Error,
    );
    return errorResponse('Internal server error');
  }
}
