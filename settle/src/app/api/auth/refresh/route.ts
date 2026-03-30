/**
 * POST /api/auth/refresh
 *
 * Reads the httpOnly refresh token cookie, validates it,
 * and issues a new short-lived access token.
 *
 * Does NOT issue a new refresh token (rotation not yet implemented).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  verifyRefreshToken,
  generateAccessToken,
  REFRESH_TOKEN_COOKIE,
} from '@/lib/auth/sessionToken';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';

export async function POST(request: NextRequest) {
  // Rate limit: prevent brute-force refresh attempts
  const rl = await checkRateLimit(request, 'auth:refresh', AUTH_LIMIT);
  if (rl) return rl;

  try {
    // Read refresh token from httpOnly cookie
    const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;

    if (!refreshToken) {
      return NextResponse.json(
        { success: false, error: 'No refresh token' },
        { status: 401 }
      );
    }

    // Verify the refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      // Clear invalid cookie
      const response = NextResponse.json(
        { success: false, error: 'Invalid or expired refresh token' },
        { status: 401 }
      );
      response.cookies.delete(REFRESH_TOKEN_COOKIE);
      return response;
    }

    // Issue a new access token
    const accessToken = generateAccessToken(payload);
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'Token generation failed' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        accessToken,
        actorType: payload.actorType,
        actorId: payload.actorId,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Refresh failed' },
      { status: 500 }
    );
  }
}
