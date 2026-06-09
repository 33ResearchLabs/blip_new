/**
 * GET /api/auth/user/username-availability?username=<value>
 *
 * Lightweight live-availability check for the user registration form.
 * Used by the username field's debounced typeahead so we can show
 * "✓ Available" / "✗ Taken" inline.
 *
 * Why a dedicated GET endpoint instead of the existing
 * POST /api/auth/user { action: 'check_username' }:
 *   The /api/auth/user POST path is gated by the brute-force-sensitive
 *   login rate-limit bucket (10 req / 60s per IP, applied in middleware),
 *   because it ALSO handles login and register. Even a moderate typing
 *   speed would burn through the bucket and silently 429 the
 *   availability check while leaving the field-level UI unaware. This
 *   endpoint sits outside that bucket and uses SEARCH_LIMIT (60/min)
 *   instead — same ceiling as other read-only lookup endpoints.
 *
 * Returns { success: true, data: { available: boolean } } — preserves
 * the shape the legacy action returned so consumers can be swapped
 * easily. Mirrors the format-validation rules from
 * validateUserUsername so the server doesn't disagree with the client
 * about what counts as a "checkable" username; an invalid-format
 * request returns available=false rather than an error, since the
 * caller should already be showing the format hint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkUsernameAvailable } from '@/lib/db/repositories/users';
import { checkRateLimit, SEARCH_LIMIT } from '@/lib/middleware/rateLimit';

// Mirrors validateUserUsername in src/lib/validation/userAuth.ts —
// duplicated here (not imported) to avoid pulling client validation
// into a server-only path. Keep them in sync.
const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/;
const USERNAME_MIN = 4;
const USERNAME_MAX = 20;

export async function GET(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:user:username-availability', SEARCH_LIMIT);
  if (rl) return rl;

  const raw = request.nextUrl.searchParams.get('username') ?? '';
  const username = raw.trim();

  // Don't ask the DB about garbage input — format-invalid candidates
  // can never be created, so they're definitionally "not available" for
  // claim. Returning false (not an error) keeps the client logic
  // simple: it only has to look at one boolean.
  if (
    !username ||
    username.length < USERNAME_MIN ||
    username.length > USERNAME_MAX ||
    !USERNAME_REGEX.test(username)
  ) {
    return NextResponse.json({ success: true, data: { available: false } });
  }

  try {
    const available = await checkUsernameAvailable(username);
    return NextResponse.json({ success: true, data: { available } });
  } catch (error) {
    console.error('[username-availability] DB error', error);
    return NextResponse.json(
      { success: false, error: 'Failed to check username availability' },
      { status: 500 },
    );
  }
}
