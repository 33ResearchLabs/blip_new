/**
 * GET  /api/auth/user/onboarding  → { completed, completed_at }
 * POST /api/auth/user/onboarding  → marks first-run onboarding complete
 *
 * Token-authenticated, self-only. The user-side onboarding flow (welcome →
 * username → App Lock PIN) used to record completion ONLY in localStorage
 * (`blip_onb_v1_<userId>`), which is per-device and invisible to the server.
 * This persists it on `users.onboarding_completed_at` (migration 151) so the
 * gate survives a device switch / cache clear, and so completion is queryable.
 *
 * Mirrors the merchant onboarding persistence (merchant_onboarding.completed_at)
 * and the sibling /api/auth/user/username route's auth shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserById, markOnboardingComplete } from '@/lib/db/repositories/users';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'user') {
      return forbiddenResponse('Only user accounts have an onboarding status');
    }

    const user = await getUserById(auth.actorId);
    if (!user) return notFoundResponse('User');

    const completedAt = user.onboarding_completed_at ?? null;
    return successResponse({
      completed: !!completedAt,
      completed_at: completedAt,
    });
  } catch (error) {
    logger.api.error('GET', '/api/auth/user/onboarding', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'user') {
      return forbiddenResponse('Only user accounts can complete onboarding');
    }

    const completedAt = await markOnboardingComplete(auth.actorId);
    if (!completedAt) return notFoundResponse('User');

    logger.api.request('POST', '/api/auth/user/onboarding', auth.actorId);
    return successResponse({ completed: true, completed_at: completedAt });
  } catch (error) {
    logger.api.error('POST', '/api/auth/user/onboarding', error as Error);
    return errorResponse('Internal server error');
  }
}
