/**
 * POST /api/auth/admin/logout
 *
 * Verifies:
 *   - Cookie cleared (Set-Cookie with Max-Age=0)
 *   - jti added to Redis revocation list
 *   - Idempotent: works with no token, with garbage token, with legacy token
 *   - Revocation write failure does NOT 500 the response (cookie still cleared)
 */

const mockRevoke = jest.fn();
jest.mock('@/lib/auth/adminRevocation', () => ({
  revokeAdminJti: (...a: unknown[]) => mockRevoke(...a),
  isAdminJtiRevoked: jest.fn(),
}));

jest.mock('@/lib/auditLog', () => ({
  auditLog: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/auth/admin/logout/route';
import { generateAdminToken, ADMIN_COOKIE_NAME } from '@/lib/middleware/auth';

process.env.ADMIN_SECRET = 'test-secret-do-not-ship';

function buildRequest(opts: { cookie?: string; bearer?: string } = {}): NextRequest {
  const headers = new Headers();
  if (opts.cookie) headers.set('cookie', `${ADMIN_COOKIE_NAME}=${opts.cookie}`);
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  return new NextRequest(new URL('https://admin.example/api/auth/admin/logout'), {
    method: 'POST',
    headers,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRevoke.mockResolvedValue(undefined);
});

describe('cookie clearing', () => {
  test('always sets Set-Cookie with Max-Age=0 — even when no token presented', async () => {
    const res = await POST(buildRequest());
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(new RegExp(`^${ADMIN_COOKIE_NAME}=`));
    expect(setCookie).toMatch(/max-age=0/i);
    expect(setCookie).toMatch(/httponly/i);
    expect(setCookie).toMatch(/samesite=strict/i);
    expect(setCookie).toMatch(/path=\//i);
  });

  test('clears cookie even when token is garbage', async () => {
    const res = await POST(buildRequest({ cookie: 'gibberish' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/max-age=0/i);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});

describe('revocation', () => {
  test('valid jti token → revokeAdminJti called with that jti', async () => {
    const token = generateAdminToken('admin');
    const decoded = Buffer.from(token, 'base64').toString();
    const expectedJti = decoded.split(':')[2];

    const res = await POST(buildRequest({ cookie: token }));
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRevoke).toHaveBeenCalledWith(
      expectedJti,
      expect.any(Number)
    );
    // TTL should be a positive integer roughly the remaining lifetime
    const callTtl = mockRevoke.mock.calls[0][1] as number;
    expect(callTtl).toBeGreaterThanOrEqual(60);
    expect(callTtl).toBeLessThanOrEqual(86400);
  });

  test('legacy 3-part token → no revocation (no jti to revoke), cookie still cleared', async () => {
    const { createHmac } = require('crypto');
    const ts = Math.floor(Date.now() / 1000);
    const payload = `admin:${ts}`;
    const sig = createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
    const legacy = Buffer.from(`${payload}:${sig}`).toString('base64');

    const res = await POST(buildRequest({ cookie: legacy }));
    expect(res.status).toBe(200);
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toMatch(/max-age=0/i);
  });

  test('Bearer-presented token → still revoked (logout works during migration)', async () => {
    const token = generateAdminToken('admin');
    const res = await POST(buildRequest({ bearer: token }));
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  test('revocation write fails → still 200 (cookie cleared, log warning)', async () => {
    mockRevoke.mockRejectedValueOnce(new Error('redis is down'));
    const token = generateAdminToken('admin');
    const res = await POST(buildRequest({ cookie: token }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/max-age=0/i);
  });
});

describe('idempotency', () => {
  test('called twice with same token → second call also 200, revoke called twice (Redis dedupes)', async () => {
    const token = generateAdminToken('admin');
    const r1 = await POST(buildRequest({ cookie: token }));
    const r2 = await POST(buildRequest({ cookie: token }));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledTimes(2);
  });

  test('expired token → 200, no revoke (token would expire on its own)', async () => {
    const { createHmac } = require('crypto');
    const ts = Math.floor(Date.now() / 1000) - 86401; // expired
    const jti = '0'.repeat(32);
    const payload = `admin:${ts}:${jti}`;
    const sig = createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
    const expired = Buffer.from(`${payload}:${sig}`).toString('base64');

    const res = await POST(buildRequest({ cookie: expired }));
    expect(res.status).toBe(200);
    expect(mockRevoke).not.toHaveBeenCalled();
  });
});
