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

  const actorId = auth.actorId;
  // Liveness applies to user and merchant accounts. Both tables carry
  // face_verified / face_verified_at (users: migration 163, merchants: 164).
  const table = auth.actorType === 'merchant' ? 'merchants' : 'users';

  try {
    await dbQuery(
      `UPDATE ${table} SET face_verified = TRUE, face_verified_at = NOW() WHERE id = $1`,
      [actorId]
    );
    logger.info('[Liveness] Face verified', { actorId, actorType: auth.actorType });
    return successResponse({ face_verified: true });
  } catch (err) {
    logger.error('[Liveness] Failed to update', { error: (err as Error).message });
    return errorResponse('Failed to save verification');
  }
}
