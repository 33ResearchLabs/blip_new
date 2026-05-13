import { NextRequest, NextResponse } from 'next/server';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { setCurrentStep } from '@/lib/db/repositories/merchantOnboarding';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/onboarding/step  { step: 1 | 2 | 3 | 4 | 5 }
 *
 * Records which step the merchant is currently viewing in the tour. Pure
 * UI hint — used to resume at the correct tooltip after a refresh. Does
 * NOT mark anything complete; step completion is condition-driven via
 * GET /api/onboarding/status.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can update their onboarding step');
    }

    const body = await request.json().catch(() => ({}));
    const step = Number(body?.step);
    if (!Number.isInteger(step) || step < 1 || step > 5) {
      return validationErrorResponse(['step must be an integer between 1 and 5']);
    }

    await setCurrentStep(auth.actorId, step);
    return successResponse({ current_step: step });
  } catch (error) {
    logger.api.error('POST', '/api/onboarding/step', error as Error);
    return errorResponse('Failed to update onboarding step');
  }
}
