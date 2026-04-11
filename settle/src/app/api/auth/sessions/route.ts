/**
 * Session Management API
 *
 * GET  /api/auth/sessions        — List active sessions (devices)
 * DELETE /api/auth/sessions      — Logout everywhere (revoke all)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getActiveSessions, revokeAllSessions, revokeSession, parseDeviceDetails } from '@/lib/auth/sessions';
import { REFRESH_TOKEN_COOKIE } from '@/lib/auth/sessionToken';

// GET — List active sessions
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sessions = await getActiveSessions(auth.actorId, auth.actorType);

    return NextResponse.json({
      success: true,
      data: sessions.map(s => {
        const details = s.user_agent ? parseDeviceDetails(s.user_agent) : null;
        return {
          id: s.id,
          device: s.device_info,
          ip: s.ip_address,
          browser: details?.browser || null,
          browserVersion: details?.browserVersion || null,
          os: details?.os || null,
          osVersion: details?.osVersion || null,
          deviceName: details?.device || null,
          deviceType: details?.deviceType || 'desktop',
          lastUsed: s.last_used_at,
          createdAt: s.created_at,
          expiresAt: s.expires_at,
        };
      }),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to fetch sessions' },
      { status: 500 }
    );
  }
}

// DELETE — Logout everywhere OR revoke specific session
export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sessionId = request.nextUrl.searchParams.get('session_id');

    if (sessionId) {
      // Revoke specific session
      const revoked = await revokeSession(sessionId);
      return NextResponse.json({
        success: true,
        data: { revoked: revoked ? 1 : 0, message: revoked ? 'Session revoked' : 'Session not found' },
      });
    }

    // Revoke ALL sessions (logout everywhere)
    const count = await revokeAllSessions(auth.actorId, auth.actorType);

    // Clear refresh token cookie so the current device can't silently
    // refresh into a new session — caller must log in again.
    const response = NextResponse.json({
      success: true,
      data: { revoked: count, message: `${count} session(s) revoked`, loggedOut: true },
    });
    response.cookies.set(REFRESH_TOKEN_COOKIE, '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 0,
    });
    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to revoke sessions' },
      { status: 500 }
    );
  }
}
