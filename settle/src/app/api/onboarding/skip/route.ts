import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { skipOnboarding } from '@/lib/db/repositories/merchantOnboarding';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/skip
 *
 * Marks the onboarding tour as skipped for the authenticated merchant.
 * Step-completion timestamps are preserved — skipping the tour does not
 * delete progress, only hides the tooltip walkthrough.
 *
 * Idempotent: repeated calls keep the earliest skipped_at via COALESCE.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can skip the onboarding tour');
    }

    const row = await skipOnboarding(auth.actorId);
    return successResponse({ skipped_at: row.skipped_at });
  } catch (error) {
    logger.api.error('POST', '/api/onboarding/skip', error as Error);
    return errorResponse('Failed to skip onboarding');
  }
}
