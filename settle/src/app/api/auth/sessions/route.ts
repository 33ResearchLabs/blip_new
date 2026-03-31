/**
 * Session Management API
 *
 * GET  /api/auth/sessions        — List active sessions (devices)
 * DELETE /api/auth/sessions      — Logout everywhere (revoke all)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware/auth';
import { getActiveSessions, revokeAllSessions, revokeSession } from '@/lib/auth/sessions';

// GET — List active sessions
export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const sessions = await getActiveSessions(auth.actorId, auth.actorType);

    return NextResponse.json({
      success: true,
      data: sessions.map(s => ({
        id: s.id,
        device: s.device_info,
        ip: s.ip_address,
        lastUsed: s.last_used_at,
        createdAt: s.created_at,
        expiresAt: s.expires_at,
      })),
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

    return NextResponse.json({
      success: true,
      data: { revoked: count, message: `${count} session(s) revoked` },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Failed to revoke sessions' },
      { status: 500 }
    );
  }
}
