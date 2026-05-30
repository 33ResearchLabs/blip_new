/**
 * Session Management API
 *
 * GET  /api/auth/sessions        — List active sessions (devices)
 * DELETE /api/auth/sessions      — Logout everywhere (revoke all)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getActiveSessions, revokeAllSessions, revokeSessionScoped, parseDeviceDetails } from '@/lib/auth/sessions';
import { normalizeClientIp } from '@/lib/auth/clientIp';
import { REFRESH_TOKEN_COOKIE } from '@/lib/auth/sessionToken';

// GET — List active sessions
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sessions = await getActiveSessions(auth.actorId, auth.actorType);

    // CURRENT is identified by the session id embedded in the caller's access
    // token (auth.sessionId) — NOT by browser/IP/user-agent, which are not
    // unique. Undefined for legacy v1 tokens; the UI then falls back safely.
    const currentSessionId = auth.sessionId ?? null;

    const data = sessions.map(s => {
      const details = s.user_agent ? parseDeviceDetails(s.user_agent) : null;
      return {
        id: s.id,
        device: s.device_info,
        // Normalize stored IPs for display: loopback / IPv4-mapped / unknown
        // collapse to null so the UI renders "Unknown IP" instead of ::1.
        ip: normalizeClientIp(s.ip_address),
        browser: details?.browser || null,
        browserVersion: details?.browserVersion || null,
        os: details?.os || null,
        osVersion: details?.osVersion || null,
        deviceName: details?.device || null,
        deviceType: details?.deviceType || 'desktop',
        isCurrent: currentSessionId ? s.id === currentSessionId : false,
        lastUsed: s.last_used_at,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
      };
    });

    // Surface the current session first for a stable, predictable list.
    data.sort((a, b) => (a.isCurrent === b.isCurrent ? 0 : a.isCurrent ? -1 : 1));

    return NextResponse.json({ success: true, data });
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
      // Revoke specific session — scoped to the caller's entity so one
      // account can never revoke another account's session by id.
      const revoked = await revokeSessionScoped(sessionId, auth.actorId, auth.actorType);
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
