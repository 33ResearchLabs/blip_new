import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  requireAuth,
  forbiddenResponse,
  successResponse,
  errorResponse,
  validationErrorResponse,
} from '@/lib/middleware/auth';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { validateUsername } from '@/lib/validation/username';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/merchant/username?check=<value>
 *
 * Live availability check for the onboarding modal. Returns:
 *   { available: boolean, reason?: string }
 *
 * The merchant's own current username (if any) is reported as available
 * so a no-op submit doesn't show a false "taken" warning.
 *
 * STANDARD rate limit (100/min) accommodates per-keystroke debounced
 * calls from the modal without throttling legitimate users.
 */
export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'merchant:username:check', STANDARD_LIMIT);
  if (rl) return rl;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can check username availability');
    }

    const candidate = (request.nextUrl.searchParams.get('check') ?? '').trim();
    const formatError = validateUsername(candidate);
    if (formatError) {
      return successResponse({ available: false, reason: formatError });
    }

    // Case-insensitive uniqueness across both tables, excluding the
    // caller's own row so picking back the same name reports available.
    const userRows = await query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
      [candidate]
    );
    const merchantRows = await query(
      `SELECT id FROM merchants WHERE LOWER(username) = LOWER($1) AND id != $2`,
      [candidate, auth.actorId]
    );

    const taken = userRows.length > 0 || merchantRows.length > 0;
    return successResponse(
      taken ? { available: false, reason: 'Username already taken' } : { available: true }
    );
  } catch (error) {
    logger.api.error('GET', '/api/merchant/username', error as Error);
    return errorResponse('Failed to check username');
  }
}

/**
 * PATCH /api/merchant/username  { username: string }
 *
 * Update the authenticated merchant's username. Token-auth only — no
 * wallet signature required, because at first-time-setup the merchant
 * may not have connected a wallet yet.
 *
 * The legacy `update_username` action on /api/auth/merchant requires
 * a wallet ownership proof; that's still the right path for changing
 * the username on a wallet-bound account. This endpoint covers the
 * onboarding-time customization case.
 *
 * Sets merchants.username_customized_at the first time the column is
 * set (COALESCE keeps the earliest timestamp), which is the signal
 * the onboarding tour uses to mark step 1 complete.
 *
 * Rate limit: AUTH_LIMIT (5/min) — username is identity, brute-force
 * enumeration of available names is in scope to throttle.
 */
export async function PATCH(request: NextRequest) {
  const rl = await checkRateLimit(request, 'merchant:username', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    if (auth.actorType !== 'merchant' || !auth.actorId) {
      return forbiddenResponse('Only merchants can update their username');
    }

    const body = await request.json().catch(() => ({}));
    const username = typeof body?.username === 'string' ? body.username.trim() : '';

    const validationError = validateUsername(username);
    if (validationError) {
      return validationErrorResponse([validationError]);
    }

    // ── Username is set-once ──
    // Once the merchant customizes it (stamped via username_customized_at),
    // it becomes a stable identity handle — ratings, mentions, and
    // off-platform pointers all rely on the name not silently moving.
    // Changing it requires a wallet-bound support flow (legacy
    // `update_username` action on /api/auth/merchant, which verifies a
    // wallet signature).
    // Fetch current username + customization flag to enforce set-once.
    const lockCheck = await query<{
      username: string | null;
      username_customized_at: Date | null;
    }>(
      `SELECT username, username_customized_at FROM merchants WHERE id = $1`,
      [auth.actorId]
    );
    const existing = lockCheck[0];
    // Same-name no-op: re-submitting the current handle always succeeds,
    // even once locked (lets the onboarding "confirm" path keep working).
    if (existing?.username && existing.username.toLowerCase() === username.toLowerCase()) {
      return successResponse({ username: existing.username });
    }
    // Set-once: a merchant who already committed a handle can't rename here.
    // Mirrors the user route (POST /api/auth/user/username). Changing it
    // afterwards is a wallet-bound support flow (legacy update_username).
    if (existing?.username_customized_at) {
      return validationErrorResponse(['Username already set and cannot be changed']);
    }

    // Uniqueness check across both tables. Case-insensitive match — we
    // store with original case but treat names as case-insensitively
    // unique (matches the legacy update_username action).
    const userCheck = await query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
      [username]
    );
    const merchantCheck = await query(
      `SELECT id FROM merchants WHERE LOWER(username) = LOWER($1) AND id != $2`,
      [username, auth.actorId]
    );
    if (userCheck.length > 0 || merchantCheck.length > 0) {
      return errorResponse('Username already taken', 409);
    }

    // COALESCE on customized_at means repeated edits don't reset the
    // first-customization timestamp — the onboarding step stays sticky.
    try {
      await query(
        `UPDATE merchants
            SET username = $1,
                username_customized_at = COALESCE(username_customized_at, NOW()),
                updated_at = NOW()
          WHERE id = $2`,
        [username, auth.actorId]
      );
    } catch (err: unknown) {
      // Race: another request claimed this username between our check
      // and the update. The unique constraint surfaces as 23505.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === '23505'
      ) {
        return errorResponse('Username already taken', 409);
      }
      throw err;
    }

    return successResponse({ username });
  } catch (error) {
    logger.api.error('PATCH', '/api/merchant/username', error as Error);
    return errorResponse('Failed to update username');
  }
}
