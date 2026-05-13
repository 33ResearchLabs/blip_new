import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { resumeOnboarding } from '@/lib/db/repositories/merchantOnboarding';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/resume
 *
 * Clears the skipped_at flag so the tour walkthrough re-runs. Picks up
 * from the first incomplete step (determined by the truth conditions).
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can resume the onboarding tour');
    }

    const row = await resumeOnboarding(auth.actorId);
    return successResponse({ skipped_at: row.skipped_at });
  } catch (error) {
    logger.api.error('POST', '/api/onboarding/resume', error as Error);
    return errorResponse('Failed to resume onboarding');
  }
}
