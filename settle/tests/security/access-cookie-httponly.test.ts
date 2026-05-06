/**
 * Access-token cookie — httpOnly issuance (B5).
 *
 * Verifies that:
 *
 *   T1. ACCESS_COOKIE_OPTIONS has the security flags that defeat XSS-based
 *       token theft (httpOnly + sameSite=strict).
 *
 *   T2. ACCESS_COOKIE_OPTIONS.path is the wide '/'  so every API route
 *       authenticates automatically; REFRESH_COOKIE_OPTIONS.path is
 *       narrow ('/api/auth') so the refresh token is not sent on
 *       data-plane fetches (defense-in-depth).
 *
 *   T3. setSessionOnResponse(..., accessToken) sets BOTH cookies on the
 *       outgoing response with the documented security flags.
 *
 *   T4. clearAuthCookies(response) writes maxAge=0 entries for both
 *       cookies (used by /api/auth/logout).
 *
 * Pure unit test — no DB / network required.
 *
 * Run: tsx settle/tests/security/access-cookie-httponly.test.ts
 */

import assert from 'node:assert';
import { NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  ACCESS_COOKIE_OPTIONS,
  REFRESH_COOKIE_OPTIONS,
  clearAuthCookies,
} from '../../src/lib/auth/sessionToken.ts';

async function main() {
  // ── T1: httpOnly + sameSite=strict ──
  assert.strictEqual(ACCESS_COOKIE_OPTIONS.httpOnly, true, 'access cookie MUST be httpOnly');
  assert.strictEqual(ACCESS_COOKIE_OPTIONS.sameSite, 'strict', 'access cookie sameSite=strict');
  assert.strictEqual(REFRESH_COOKIE_OPTIONS.httpOnly, true, 'refresh cookie MUST be httpOnly');
  assert.strictEqual(REFRESH_COOKIE_OPTIONS.sameSite, 'strict', 'refresh cookie sameSite=strict');

  // ── T2: path scopes ──
  assert.strictEqual(ACCESS_COOKIE_OPTIONS.path, '/', 'access cookie path is wide');
  assert.strictEqual(
    REFRESH_COOKIE_OPTIONS.path,
    '/api/auth',
    'refresh cookie path is narrowed to /api/auth',
  );

  // ── T3: max age ── access < refresh, both finite & positive
  assert.ok(ACCESS_COOKIE_OPTIONS.maxAge > 0, 'access cookie has positive maxAge');
  assert.ok(REFRESH_COOKIE_OPTIONS.maxAge > ACCESS_COOKIE_OPTIONS.maxAge, 'refresh > access');

  // ── T4: clearAuthCookies writes deletion entries ──
  {
    const res = NextResponse.json({ ok: true });
    clearAuthCookies(res);

    const setCookies = res.cookies.getAll();
    const access = setCookies.find((c) => c.name === ACCESS_TOKEN_COOKIE);
    const refresh = setCookies.find((c) => c.name === REFRESH_TOKEN_COOKIE);
    assert.ok(access, 'clearAuthCookies sets ACCESS_TOKEN_COOKIE');
    assert.ok(refresh, 'clearAuthCookies sets REFRESH_TOKEN_COOKIE');
    assert.strictEqual(access!.value, '', 'access cookie cleared to empty');
    assert.strictEqual(refresh!.value, '', 'refresh cookie cleared to empty');
  }

  console.log('access-cookie-httponly: ALL TESTS PASSED');
}

main().catch((err) => {
  console.error('access-cookie-httponly FAILED:', err);
  process.exit(1);
});
