import { NextRequest, NextResponse } from 'next/server';
import { issueLoginNonce } from '@/lib/auth/loginNonce';
import { walletAddressSchema } from '@/lib/validation/schemas';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';

/**
 * POST /api/auth/nonce
 * Body: { wallet_address: string }
 * Returns: { nonce, message, expires_at }
 *
 * No authentication required — this is the first step of wallet-signature
 * login. The returned `message` is what the client must sign verbatim.
 */
export async function POST(request: NextRequest) {
  // Rate limit shares the same bucket shape as other auth calls.
  const rl = await checkRateLimit(request, 'auth:nonce', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const body = await request.json().catch(() => ({}));
    const parse = walletAddressSchema.safeParse(body?.wallet_address);
    if (!parse.success) {
      return NextResponse.json(
        { success: false, error: 'wallet_address is required' },
        { status: 400 }
      );
    }

    const issued = await issueLoginNonce(parse.data);
    return NextResponse.json({
      success: true,
      data: {
        nonce: issued.nonce,
        message: issued.message,
        expires_at: issued.expiresAt,
      },
    });
  } catch (error) {
    console.error('[API] POST /api/auth/nonce error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to issue nonce' },
      { status: 500 }
    );
  }
}
