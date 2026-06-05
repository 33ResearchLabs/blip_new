/**
 * GET  /api/auth/user/username  → { username, isSet }
 * POST /api/auth/user/username  { username } → claims the username (once)
 *
 * Token-authenticated, self-only. Unlike the wallet-signature
 * `set_username` action in /api/auth/user, this lets an already
 * signed-in user (e.g. the onboarding "pick a username" step) claim their
 * username with just their session — no wallet signature required, since
 * the user may not have a wallet connected during onboarding.
 *
 * "Set-once" is keyed off `username_customized_at` (migration 152), NOT a
 * `user_` prefix: Google signups derive a handle from the email (e.g.
 * "gorav_researchlab") which has no prefix, so the prefix heuristic wrongly
 * locked those users out of editing. While username_customized_at IS NULL the
 * handle is still the auto-assigned default and may be changed (or kept); once
 * the user commits, it's locked.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUserById,
  updateUsername,
  markUsernameCustomized,
  checkUsernameAvailable,
} from '@/lib/db/repositories/users';
import { validateUsername } from '@/lib/validation/username';
import {
  requireAuth,
  forbiddenResponse,
  notFoundResponse,
  validationErrorResponse,
  successResponse,
  errorResponse,
} from '@/lib/middleware/auth';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'user') {
      return forbiddenResponse('Only user accounts have a username');
    }

    const user = await getUserById(auth.actorId);
    if (!user) return notFoundResponse('User');

    return successResponse({
      username: user.username ?? null,
      // Auto-assigned default (NULL) → editable; once chosen → locked.
      isSet: !!user.username_customized_at,
    });
  } catch (error) {
    logger.api.error('GET', '/api/auth/user/username', error as Error);
    return errorResponse('Internal server error');
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    if (auth.actorType !== 'user') {
      return forbiddenResponse('Only user accounts can set a username');
    }

    const body = await request.json().catch(() => null);
    const username = typeof body?.username === 'string' ? body.username.trim() : '';

    // Format validation — same 3-20 / [a-zA-Z0-9_] rule the rest of the app uses.
    const formatError = validateUsername(username);
    if (formatError) {
      return validationErrorResponse([formatError]);
    }

    const user = await getUserById(auth.actorId);
    if (!user) return notFoundResponse('User');

    // Set-once: a user who already committed a handle can't rename here.
    if (user.username_customized_at) {
      return validationErrorResponse(['Username already set and cannot be changed']);
    }

    // Keeping the auto-assigned handle (e.g. the Google-derived name): the name
    // is already theirs, so skip the availability check — which would report it
    // "taken" by themselves — and just lock it in as their choice.
    if (username.toLowerCase() === (user.username ?? '').toLowerCase()) {
      const confirmed = await markUsernameCustomized(auth.actorId);
      if (!confirmed) return notFoundResponse('User');
      logger.api.request('POST', '/api/auth/user/username', auth.actorId);
      return successResponse({ username: confirmed.username });
    }

    // Changing to a different handle — cheap pre-check; updateUsername re-checks
    // and handles the unique-constraint race (Postgres 23505) authoritatively.
    const available = await checkUsernameAvailable(username);
    if (!available) {
      return NextResponse.json(
        { success: false, error: 'Username already taken' },
        { status: 409 },
      );
    }

    let updated;
    try {
      updated = await updateUsername(auth.actorId, username);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'Username already taken') {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 },
        );
      }
      throw err;
    }
    if (!updated) return notFoundResponse('User');

    logger.api.request('POST', '/api/auth/user/username', auth.actorId);
    return successResponse({ username: updated.username });
  } catch (error) {
    logger.api.error('POST', '/api/auth/user/username', error as Error);
    return errorResponse('Internal server error');
  }
}
