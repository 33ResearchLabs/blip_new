import { NextRequest, NextResponse } from 'next/server';
import { updateBankAccount, deleteBankAccount } from '@/lib/db/repositories/users';
import { updateBankAccountSchema, uuidSchema } from '@/lib/validation/schemas';
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

type Params = { params: Promise<{ id: string; accountId: string }> };

function validateIds(userId: string, accountId: string) {
  if (!uuidSchema.safeParse(userId).success) return 'Invalid user ID format';
  if (!uuidSchema.safeParse(accountId).success) return 'Invalid bank account ID format';
  return null;
}

// PUT /api/users/[id]/bank-accounts/[accountId] — edit a saved bank account
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id, accountId } = await params;
    const err = validateIds(id, accountId);
    if (err) return validationErrorResponse([err]);

    const body = await request.json().catch(() => ({}));
    const parseResult = updateBankAccountSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only edit your own bank accounts');
    }

    const updated = await updateBankAccount(accountId, id, parseResult.data);
    if (!updated) return notFoundResponse('Bank account');

    logger.info('Bank account updated', { userId: id, accountId });
    return successResponse(updated);
  } catch (error) {
    logger.api.error('PUT', '/api/users/[id]/bank-accounts/[accountId]', error as Error);
    return errorResponse('Internal server error');
  }
}

// DELETE /api/users/[id]/bank-accounts/[accountId] — remove a saved bank account
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id, accountId } = await params;
    const err = validateIds(id, accountId);
    if (err) return validationErrorResponse([err]);

    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const isOwner = auth.actorType === 'user' && auth.actorId === id;
    if (!isOwner && auth.actorType !== 'system') {
      return forbiddenResponse('You can only delete your own bank accounts');
    }

    const deleted = await deleteBankAccount(accountId, id);
    if (!deleted) return notFoundResponse('Bank account');

    logger.info('Bank account deleted', { userId: id, accountId });
    return successResponse({ deleted: true });
  } catch (error) {
    logger.api.error('DELETE', '/api/users/[id]/bank-accounts/[accountId]', error as Error);
    return errorResponse('Internal server error');
  }
}
