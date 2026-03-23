import { NextRequest, NextResponse } from 'next/server';
import {
  getUserPaymentMethods,
  addPaymentMethod,
} from '@/lib/db/repositories/paymentMethods';
import { getUserById } from '@/lib/db/repositories/users';
import {
  createPaymentMethodSchema,
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

function validateUserId(id: string) {
  const result = uuidSchema.safeParse(id);
  if (!result.success) return { valid: false, error: 'Invalid user ID format' };
  return { valid: true };
}

// GET /api/users/[id]/payment-methods — list active payment methods
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = validateUserId(id);
    if (!v.valid) return validationErrorResponse([v.error!]);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`GET /api/users/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only access your own payment methods');
    }

    const user = await getUserById(id);
    if (!user) return notFoundResponse('User');

    const methods = await getUserPaymentMethods(id);
    return successResponse(methods);
  } catch (error) {
    logger.api.error('GET', '/api/users/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}

// POST /api/users/[id]/payment-methods — add a new payment method
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const v = validateUserId(id);
    if (!v.valid) return validationErrorResponse([v.error!]);

    const body = await request.json();
    const parseResult = createPaymentMethodSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      logger.auth.forbidden(`POST /api/users/${id}/payment-methods`, auth.actorId, 'Not owner');
      return forbiddenResponse('You can only add payment methods to your own profile');
    }

    const user = await getUserById(id);
    if (!user) return notFoundResponse('User');

    const { type, label, details } = parseResult.data;
    const method = await addPaymentMethod({
      user_id: id,
      type,
      label,
      details,
    });

    logger.info('Payment method added', { userId: id, methodId: method.id, type });
    return successResponse(method, 201);
  } catch (error) {
    logger.api.error('POST', '/api/users/[id]/payment-methods', error as Error);
    return errorResponse('Internal server error');
  }
}
