/**
 * POST /api/auth/refresh
 *
 * Reads the httpOnly refresh token cookie, validates it,
 * rotates the refresh token, and issues a new access token.
 *
 * Token rotation: each refresh issues a NEW refresh token.
 * Reuse detection: if an old (rotated) token is used, ALL sessions are revoked.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  generateAccessToken,
  REFRESH_TOKEN_COOKIE,
  REFRESH_COOKIE_OPTIONS,
} from '@/lib/auth/sessionToken';
import { rotateRefreshToken } from '@/lib/auth/sessions';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';

export async function POST(request: NextRequest) {
  const rl = await checkRateLimit(request, 'auth:refresh', AUTH_LIMIT);
  if (rl) return rl;

  try {
    const oldRefreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

    if (!oldRefreshToken) {
      return NextResponse.json(
        { success: false, error: 'No refresh token' },
        { status: 401 }
      );
    }

    // Rotate: validate old token, create new session, revoke old
    const result = await rotateRefreshToken(oldRefreshToken, request as any);

    if (!result) {
      // Token invalid, expired, or reuse detected
      const response = NextResponse.json(
        { success: false, error: 'Invalid or expired refresh token' },
        { status: 401 }
      );
      response.cookies.delete(REFRESH_TOKEN_COOKIE);
      return response;
    }

    // Issue new access token with session tracking
    const accessToken = generateAccessToken({ ...result.payload, sessionId: result.sessionId });
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Token generation failed' },
        { status: 500 }
      );
    }

    // Set new rotated refresh token cookie
    const response = NextResponse.json({
      success: true,
      data: {
        accessToken,
        actorType: result.payload.actorType,
        actorId: result.payload.actorId,
      },
    });
    response.cookies.set(REFRESH_TOKEN_COOKIE, result.newRefreshToken, REFRESH_COOKIE_OPTIONS);

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Refresh failed' },
      { status: 500 }
    );
  }
}
