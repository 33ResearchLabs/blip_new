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

function validateInviteCode(input: string): { ok: boolean; expired?: boolean } {
  const raw = process.env.APP_INVITE_CODES || '';
  if (!raw) return { ok: false };

  const now = Date.now();
  for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const [code, expiry] = entry.split(':');
    if (input !== code.trim()) continue;
    if (expiry) {
      const exp = new Date(expiry.trim()).getTime();
      if (!isNaN(exp) && now > exp) return { ok: false, expired: true };
    }
    return { ok: true };
  }
  return { ok: false };
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

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const input = (body.password || '').trim();
  if (!input) {
    return NextResponse.json({ success: false, error: 'Code required' }, { status: 400 });
  }

  const masterPassword = process.env.DEV_ACCESS_PASSWORD || '';
  const inviteCodes = process.env.APP_INVITE_CODES || '';

  // Must have at least one credential source configured
  if (!masterPassword && !inviteCodes) {
    return NextResponse.json(
      { success: false, error: 'Access not configured' },
      { status: 500 }
    );
  }

  // Accept master password OR a valid invite code
  const isMaster = masterPassword && input === masterPassword;
  const invite = !isMaster ? validateInviteCode(input) : null;

  if (!isMaster && invite?.expired) {
    return NextResponse.json({ success: false, error: 'This invite code has expired.' }, { status: 401 });
  }

  if (!isMaster && !invite?.ok) {
    return NextResponse.json(
      { success: false, error: 'Invalid invite code.' },
      { status: 401 }
    );
  }

  // Success — set httpOnly cookie (30 days for invite codes, 7 days for master password)
  const maxAge = isMaster ? 60 * 60 * 24 * 7 : 60 * 60 * 24 * 30;
  const response = NextResponse.json({ success: true, redirect: '/' });
  response.cookies.set('dev_access_granted', 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
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
