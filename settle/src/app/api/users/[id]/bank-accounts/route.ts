import { NextRequest } from 'next/server';
import { getUserBankAccounts, addBankAccount, getUserById } from '@/lib/db/repositories/users';
import {
  addBankAccountSchema,
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

    // Authorization: users can only view their own bank accounts
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden(`GET /api/users/${id}/bank-accounts`, auth.actorId, 'Not account owner');
        return forbiddenResponse('You can only access your own bank accounts');
      }
    }

    // Check user exists
    const user = await getUserById(id);
    if (!user) {
      return notFoundResponse('User');
    }

    const accounts = await getUserBankAccounts(id);
    logger.api.request('GET', `/api/users/${id}/bank-accounts`, auth?.actorId);
    return successResponse(accounts);
  } catch (error) {
    logger.api.error('GET', '/api/users/[id]/bank-accounts', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(
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
    const parseResult = addBankAccountSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    // Authorization: users can only add bank accounts to their own profile
    const auth = getAuthContext(request);
    if (auth) {
      const isOwner = auth.actorType === 'user' && auth.actorId === id;
      if (!isOwner && auth.actorType !== 'system') {
        logger.auth.forbidden(`POST /api/users/${id}/bank-accounts`, auth.actorId, 'Adding to different user');
        return forbiddenResponse('You can only add bank accounts to your own profile');
      }
    }

    // Check user exists
    const user = await getUserById(id);
    if (!user) {
      return notFoundResponse('User');
    }

    const { bank_name, account_name, iban, is_default } = parseResult.data;

    const account = await addBankAccount({
      user_id: id,
      bank_name,
      account_name,
      iban,
      is_default,
    });

    logger.info('Bank account added', {
      userId: id,
      accountId: account.id,
    });

    return successResponse(account, 201);
  } catch (error) {
    logger.api.error('POST', '/api/users/[id]/bank-accounts', error as Error);
    return errorResponse('Internal server error');
  }
}
