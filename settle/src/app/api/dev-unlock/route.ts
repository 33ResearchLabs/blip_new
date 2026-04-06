import { NextRequest, NextResponse } from 'next/server';

// In-memory rate limiter for brute-force protection
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute

function getIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function POST(request: NextRequest) {
  const ip = getIP(request);
  const now = Date.now();

  // Rate limit check
  const entry = attempts.get(ip);
  if (entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { success: false, error: `Too many attempts. Try again in ${retryAfter}s.` },
      { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
    );
  }

  // Track attempt
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count++;
  }

  const envPassword = process.env.DEV_ACCESS_PASSWORD;
  if (!envPassword) {
    return NextResponse.json(
      { success: false, error: 'Dev lock not configured' },
      { status: 500 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  if (!body.password || body.password !== envPassword) {
    return NextResponse.json(
      { success: false, error: 'Wrong password' },
      { status: 401 }
    );
  }

  // Success — set httpOnly cookie
  const response = NextResponse.json({ success: true });
  response.cookies.set('dev_access_granted', 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return response;
}

// DELETE — clear dev access (logout)
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('dev_access_granted', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
