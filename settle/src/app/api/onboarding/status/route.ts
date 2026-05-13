import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { getOnboardingStatus } from '@/lib/db/repositories/merchantOnboarding';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/onboarding/status
 *
 * Returns the merchant's progressive onboarding state, auto-recording
 * any step whose truth condition became true since the last read.
 *
 * Server-side condition validation is authoritative — the client cannot
 * mark a step as complete without the underlying state actually being true.
 *
 * Auth: merchant token required. Status is always for the authenticated
 * actor — no merchant_id is accepted from the body or query.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants have an onboarding status');
    }

    const status = await getOnboardingStatus(auth.actorId);
    return successResponse(status);
  } catch (error) {
    logger.api.error('GET', '/api/onboarding/status', error as Error);
    return errorResponse('Failed to load onboarding status');
  }
}
