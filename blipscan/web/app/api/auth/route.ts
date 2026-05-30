import { NextRequest, NextResponse } from 'next/server';

const COOKIE = 'blipscan_access';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function isValidCode(code: string): boolean {
  const raw = process.env.SCAN_INVITE_CODES || '';
  if (!raw) return true;

  const codes = raw.split(',').map(s => s.trim()).filter(Boolean);
  const now = Date.now();

  for (const entry of codes) {
    const [c, expiry] = entry.split(':');
    if (code !== c.trim()) continue;
    if (expiry) {
      const exp = new Date(expiry.trim()).getTime();
      if (!isNaN(exp) && now > exp) return false;
    }
    return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const { code, next } = await req.json().catch(() => ({ code: '', next: '/' }));
  const redirect = (typeof next === 'string' && next.startsWith('/') && next !== '/gate') ? next : '/';

  if (!isValidCode(code?.trim() || '')) {
    return NextResponse.json({ error: 'Invalid or expired invite code.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, redirect });
  res.cookies.set(COOKIE, code.trim(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
  return res;
}
