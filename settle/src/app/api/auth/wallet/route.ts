import { NextRequest, NextResponse } from 'next/server';
import { getUserByWallet, createUser } from '@/lib/db/repositories/users';
import { getMerchantByWallet } from '@/lib/db/repositories/merchants';
import { walletAuthSchema } from '@/lib/validation/schemas';
import {
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { logger } from '@/lib/logger';
import { guardAuthVelocity } from '@/lib/guards';
import { generateAccessToken, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/auth/sessionToken';
import { createSession } from '@/lib/auth/sessions';
import { verifyWalletAuthRequest } from '@/lib/auth/loginNonce';

// Connect wallet - creates user if not exists
export async function POST(request: NextRequest) {
  // Rate limit: prevent brute-force wallet connection attempts
  const rateLimitResponse = await checkRateLimit(request, 'auth:wallet', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();

    // Validate request body
    const parseResult = walletAuthSchema.safeParse(body);
    if (!parseResult.success) {
      const errors = parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return validationErrorResponse(errors);
    }

    const { wallet_address, type, name, signature, message, nonce } = parseResult.data;

    // Detection guard: log warning for suspicious auth velocity
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
      || request.headers.get('x-real-ip') || 'unknown';
    guardAuthVelocity(ip, wallet_address);

    // Strict replay protection — every wallet-connect must carry a
    // server-issued nonce + signed message + timestamp. The legacy unsigned
    // and signature-only paths have been removed.
    const result = await verifyWalletAuthRequest({
      walletAddress: wallet_address,
      signature,
      message,
      nonce,
    });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

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

    // Issue session + access token so subsequent user-scoped routes
    // (e.g. POST /api/users/{id}/payment-methods) can authorize the
    // request via the Bearer header rather than relying on x-user-id.
    const payload = { actorId: user.id, actorType: 'user' as const };
    let sessionId: string | undefined;
    let refreshToken: string | null = null;
    try {
      const sess = await createSession(payload, request);
      if (sess) { sessionId = sess.sessionId; refreshToken = sess.refreshToken; }
    } catch {
      // Proceed without session tracking — the access token still works
    }
    const accessToken = generateAccessToken({ ...payload, sessionId });

    const response = NextResponse.json({
      success: true,
      data: {
        type: 'user',
        user,
        token: accessToken,
        accessToken,
      },
    });
    if (refreshToken) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    }
    return response;
  } catch (error) {
    logger.api.error('POST', '/api/auth/wallet', error as Error);
    return errorResponse('Internal server error');
  }
}
