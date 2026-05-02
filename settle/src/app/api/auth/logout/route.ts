/**
 * POST /api/auth/logout
 *
 * Revokes the current session (or all sessions) and clears the refresh token cookie.
 * Body: { all?: boolean }  — if true, revokes ALL sessions (logout everywhere)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { revokeAllSessions, revokeSession } from '@/lib/auth/sessions';
import { clearAuthCookies } from '@/lib/auth/sessionToken';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const logoutAll = body?.all === true;

    let revoked = 0;
    if (logoutAll) {
      revoked = await revokeAllSessions(auth.actorId, auth.actorType);
    } else if (auth.sessionId) {
      const ok = await revokeSession(auth.sessionId);
      revoked = ok ? 1 : 0;
    } else {
      // No session ID in token (legacy token) — revoke all as fallback
      revoked = await revokeAllSessions(auth.actorId, auth.actorType);
    }

    // Clear BOTH auth cookies (access + refresh). httpOnly access cookie
    // is the new XSS-safe identity carrier; clearing both ensures the
    // browser session is fully torn down on logout / revoke-all.
    const response = NextResponse.json({
      success: true,
      data: { revoked, message: `${revoked} session(s) revoked` },
    });
    clearAuthCookies(response);

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to logout' },
      { status: 500 }
    );
  }
}
