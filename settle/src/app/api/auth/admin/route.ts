import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'pass123';

// POST - Admin login
export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'auth:admin', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { success: false, error: 'Username and password are required' },
        { status: 400 }
      );
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
      return NextResponse.json(
        { success: false, error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        admin: {
          username: ADMIN_USERNAME,
          role: 'super_admin',
          authenticated_at: new Date().toISOString(),
        },
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// GET - Validate admin session
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'auth:admin:check', { maxRequests: 100, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  const username = request.nextUrl.searchParams.get('username');

  return NextResponse.json({
    success: true,
    data: { valid: username === ADMIN_USERNAME },
  });
}
