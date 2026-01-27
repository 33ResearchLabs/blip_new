import { NextRequest } from 'next/server';
import { getUserByWallet, createUser } from '@/lib/db/repositories/users';
import { getMerchantByWallet } from '@/lib/db/repositories/merchants';
import { walletAuthSchema } from '@/lib/validation/schemas';
import {
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

// Connect wallet - creates user if not exists
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const parseResult = walletAuthSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { wallet_address, type, name } = parseResult.data;

    if (type === 'merchant') {
      // Check if merchant exists
      const merchant = await getMerchantByWallet(wallet_address);

      if (!merchant) {
        return validationErrorResponse(['Merchant not found. Please register first.']);
      }

      logger.auth.walletConnected(wallet_address, 'merchant', merchant.id);

      return successResponse({
        type: 'merchant',
        merchant,
      });
    }

    // User flow
    let user = await getUserByWallet(wallet_address);
    let isNewUser = false;

    if (!user) {
      // Create new user with wallet address and auto-generated username
      user = await createUser({
        wallet_address,
        username: name || `user_${wallet_address.slice(0, 8)}`,
      });
      isNewUser = true;
    }

    logger.auth.walletConnected(wallet_address, 'user', user.id);

    if (isNewUser) {
      logger.info('New user created', { userId: user.id, walletAddress: wallet_address });
    }

    return successResponse({
      type: 'user',
      user,
    });
  } catch (error) {
    logger.api.error('POST', '/api/auth/wallet', error as Error);
    return errorResponse('Internal server error');
  }
}
