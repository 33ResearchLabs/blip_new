/**
 * Security Regression: /api/auth/user and /api/auth/merchant `check_session`
 *
 * Pins the fix for the unauthenticated takeover bug: the routes used to
 * mint a fresh session for whoever the `user_id` / `merchant_id` query
 * param named, even when the caller had no valid refresh cookie. Any
 * regression here means anyone who knows a UUID can become that account.
 *
 * The fix returns `valid:false` BEFORE doing any DB lookup when the
 * refresh cookie is missing — so the test does not need the target UUID
 * to actually exist in DB. Random UUIDs (and a known-existing one if
 * available) both prove the security property: no `Set-Cookie` on
 * unauthenticated calls. That keeps this test independent of seed state
 * and DB reset auth.
 *
 * The positive path (cookie present + matches → valid:true) is exercised
 * by the existing login + dashboard e2e tests. We do not duplicate that
 * here — this file is specifically the negative-test floor.
 */

import { test, expect } from './fixtures';

const SETTLE_URL = process.env.SETTLE_URL || 'http://localhost:3000';

// Two well-formed-but-arbitrary UUIDs. The route MUST short-circuit on
// missing refresh cookie before any DB lookup, so existence is irrelevant
// for the negative assertions.
const RANDOM_UUID_A = '00000000-0000-4000-8000-000000000000';
const RANDOM_UUID_B = '11111111-1111-4111-8111-111111111111';

function assertNoAuthCookies(setCookieHeader: string | null) {
  const cookies = setCookieHeader ?? '';
  // The bug set BOTH on takeover. Either appearing on an unauthenticated
  // response is a regression that re-opens the account-takeover path.
  expect(cookies).not.toMatch(/blip_access_token=[A-Za-z0-9._:-]+/);
  expect(cookies).not.toMatch(/blip_refresh_token=[A-Za-z0-9._:-]+/);
}

test.describe('Security: check_session must not mint cookies for unauthenticated callers', () => {
  test('GET /api/auth/user check_session: no cookies + arbitrary user_id → valid:false, no Set-Cookie', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/auth/user?action=check_session&user_id=${RANDOM_UUID_A}`,
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, data: { valid: false } });

    assertNoAuthCookies(res.headers.get('set-cookie'));
  });

  test('GET /api/auth/user check_session: no cookies + different UUID → valid:false, no Set-Cookie', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/auth/user?action=check_session&user_id=${RANDOM_UUID_B}`,
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.valid).toBe(false);

    assertNoAuthCookies(res.headers.get('set-cookie'));
  });

  test('GET /api/auth/user check_session: garbage refresh cookie → valid:false, no Set-Cookie', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/auth/user?action=check_session&user_id=${RANDOM_UUID_A}`,
      {
        method: 'GET',
        headers: {
          // A refresh cookie that does not hash to any session in DB.
          Cookie: 'blip_refresh_token=not-a-real-token-just-an-attacker-string',
        },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.valid).toBe(false);

    assertNoAuthCookies(res.headers.get('set-cookie'));
  });

  test('GET /api/auth/merchant check_session: no cookies + arbitrary merchant_id → valid:false, no Set-Cookie', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/auth/merchant?action=check_session&merchant_id=${RANDOM_UUID_A}`,
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data?.valid).toBe(false);

    assertNoAuthCookies(res.headers.get('set-cookie'));
  });

  test('GET /api/auth/merchant check_session: no cookies + different UUID → valid:false, no Set-Cookie', async () => {
    const res = await fetch(
      `${SETTLE_URL}/api/auth/merchant?action=check_session&merchant_id=${RANDOM_UUID_B}`,
      { method: 'GET' },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data?.valid).toBe(false);

    assertNoAuthCookies(res.headers.get('set-cookie'));
  });

  test('GET /api/auth/user: missing user_id → 400, no Set-Cookie', async () => {
    const res = await fetch(`${SETTLE_URL}/api/auth/user?action=check_session`, { method: 'GET' });
    expect(res.status).toBe(400);
    assertNoAuthCookies(res.headers.get('set-cookie'));
  });
});
