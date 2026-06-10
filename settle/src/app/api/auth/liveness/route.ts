import { NextRequest, NextResponse } from 'next/server';
import { requireTokenAuth, errorResponse, successResponse } from '@/lib/middleware/auth';
import { checkRateLimit, STRICT_LIMIT } from '@/lib/middleware/rateLimit';
import { query as dbQuery } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'liveness', STRICT_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  const auth = await requireTokenAuth(request);
  if (auth instanceof NextResponse) return auth;

  const userId = auth.actorId;

  try {
    await dbQuery(
      `UPDATE users SET face_verified = TRUE, face_verified_at = NOW() WHERE id = $1`,
      [userId]
    );
    logger.info('[Liveness] Face verified', { userId });
    return successResponse({ face_verified: true });
  } catch (err) {
    logger.error('[Liveness] Failed to update', { error: (err as Error).message });
    return errorResponse('Failed to save verification');
  }
}
