import { NextRequest, NextResponse } from 'next/server';

// HTTP Basic Auth gate for scan.blip.money. Opt-in via env: when
// SCAN_DEV_PASSWORD is unset, this middleware is a no-op. Set the
// password (and optionally the username) on the blipscan/web Railway
// service to lock the explorer behind the browser's native auth prompt.

const REALM = 'Blipscan (private preview)';

export function middleware(request: NextRequest) {
  const expectedPassword = process.env.SCAN_DEV_PASSWORD;
  if (!expectedPassword) return NextResponse.next();

  const expectedUser = process.env.SCAN_DEV_USER || 'blip';

  const header = request.headers.get('authorization') || '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(':');
      const user = sep >= 0 ? decoded.slice(0, sep) : '';
      const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
      if (user === expectedUser && pass === expectedPassword) {
        return NextResponse.next();
      }
    } catch {
      // fall through to 401
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
  });
}

export const config = {
  // Skip Next internals and common static assets so the browser doesn't
  // re-prompt for every chunk; the page request itself is gated.
  matcher: ['/((?!_next/|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js|map)$).*)'],
};
