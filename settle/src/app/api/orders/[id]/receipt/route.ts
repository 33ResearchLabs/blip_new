import { NextRequest, NextResponse } from 'next/server';
import { getReceiptByOrderId } from '@/lib/db/repositories/receipts';
import { uuidSchema } from '@/lib/validation/schemas';
import {
  requireAuth,
  canAccessOrder,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate ID format
    const idResult = uuidSchema.safeParse(id);
    if (!idResult.success) {
      return validationErrorResponse(['Invalid order ID format']);
    }

    // Authorization check
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    // Check order access
    const canAccess = await canAccessOrder(auth, id);
    if (!canAccess) {
      logger.auth.forbidden(`GET /api/orders/${id}/receipt`, auth.actorId, 'Not order participant');
      return forbiddenResponse('You do not have access to this order');
    }

    // Fetch receipt
    const receipt = await getReceiptByOrderId(id);
    if (!receipt) {
      return notFoundResponse('Receipt');
    }

    logger.api.request('GET', `/api/orders/${id}/receipt`, auth.actorId);
    return successResponse(receipt);
  } catch (error) {
    logger.api.error('GET', '/api/orders/[id]/receipt', error as Error);
    return errorResponse('Internal server error');
  }
}
