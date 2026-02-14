import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { generateAdminToken, verifyAdminToken } from '@/lib/middleware/auth';

// Admin credentials from env vars (with dev fallbacks)
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'pass123';

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

    // Generate a signed admin token (valid for 24h)
    const token = generateAdminToken(username);

    return NextResponse.json({
      success: true,
      data: {
        admin: {
          username: ADMIN_USERNAME,
          role: 'super_admin',
          authenticated_at: new Date().toISOString(),
        },
        token,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// GET - Validate admin session (supports both old query param and new token-based auth)
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, 'auth:admin:check', { maxRequests: 100, windowSeconds: 60 });
  if (rateLimitResponse) return rateLimitResponse;

  // Check for Bearer token first (new secure method)
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const result = verifyAdminToken(authHeader.slice(7));
    return NextResponse.json({
      success: true,
      data: { valid: result.valid, username: result.username },
    });
  }

  // Fallback: query param check (legacy, less secure)
  const username = request.nextUrl.searchParams.get('username');
  return NextResponse.json({
    success: true,
    data: { valid: username === ADMIN_USERNAME },
  });
}
