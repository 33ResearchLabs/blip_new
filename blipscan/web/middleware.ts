import { NextRequest, NextResponse } from 'next/server';

const COOKIE = 'blipscan_access';
const GATE   = '/gate';

function isValidToken(token: string): boolean {
  const raw = process.env.SCAN_INVITE_CODES || '';
  if (!raw) return true; // gate disabled when no codes configured

  const codes = raw.split(',').map(s => s.trim()).filter(Boolean);
  const now = Date.now();

  for (const entry of codes) {
    const [code, expiry] = entry.split(':');
    if (token !== code.trim()) continue;
    if (expiry) {
      const exp = new Date(expiry.trim()).getTime();
      if (!isNaN(exp) && now > exp) return false; // expired
    }
    return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  const codesConfigured = !!(process.env.SCAN_INVITE_CODES || '').trim();
  if (!codesConfigured) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Always allow the gate page and its API route
  if (pathname === GATE || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE)?.value || '';
  if (isValidToken(token)) return NextResponse.next();

  // Redirect to gate, preserving the intended destination
  const url = request.nextUrl.clone();
  url.pathname = GATE;
  url.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)'],
};
