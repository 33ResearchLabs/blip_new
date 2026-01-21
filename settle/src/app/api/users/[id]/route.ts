import { NextRequest } from 'next/server';
import { getUserById, updateUser } from '@/lib/db/repositories/users';
import {
  updateUserSchema,
  uuidSchema,
} from '@/lib/validation/schemas';
import {
  getAuthContext,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

// Validate user ID parameter
function validateUserId(id: string): { valid: boolean; error?: string } {
  const result = uuidSchema.safeParse(id);
  if (!result.success) {
    return { valid: false, error: 'Invalid user ID format' };
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
    const idValidation = validateUserId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    // Authorization: users can only view their own profile (merchants/system can view any)
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === id;
      const isMerchantOrSystem = auth.actorType === 'merchant' || auth.actorType === 'system';
      if (!isOwner && !isMerchantOrSystem) {
        logger.auth.forbidden(`GET /api/users/${id}`, auth.actorId, 'Not profile owner');
        return forbiddenResponse('You can only access your own profile');
      }
    }

    const user = await getUserById(id);

    if (!user) {
      return notFoundResponse('User');
    }

    logger.api.request('GET', `/api/users/${id}`, auth?.actorId);
    return successResponse(user);
  } catch (error) {
    logger.api.error('GET', '/api/users/[id]', error as Error);
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
    const idValidation = validateUserId(id);
    if (!idValidation.valid) {
      return validationErrorResponse([idValidation.error!]);
    }

    const body = await request.json();

    // Validate request body
    const parseResult = updateUserSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Authorization: users can only update their own profile
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden(`PATCH /api/users/${id}`, auth.actorId, 'Updating different user');
        return forbiddenResponse('You can only update your own profile');
      }
    }

    const user = await updateUser(id, parseResult.data);

    if (!user) {
      return notFoundResponse('User');
    }

    logger.api.request('PATCH', `/api/users/${id}`, auth?.actorId);
    return successResponse(user);
  } catch (error) {
    logger.api.error('PATCH', '/api/users/[id]', error as Error);
    return errorResponse('Internal server error');
  }
}
