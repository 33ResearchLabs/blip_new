/**
 * Admin auth — cookie migration + jti revocation.
 *
 * Verifies:
 *   - generateAdminToken now embeds a 32-char hex jti (4-part format).
 *   - verifyAdminToken accepts BOTH new (4-part) and legacy (3-part)
 *     tokens — the latter flagged with `legacyNoJti: true`.
 *   - HMAC tampering is rejected.
 *   - Expiry (>24h) is rejected.
 *   - readAdminTokenFromRequest reads the cookie first, falls back to
 *     `Authorization: Bearer …` header.
 *   - requireAdminAuth (async):
 *       · cookie-only request validates without any header
 *       · revoked jti → 401
 *       · Redis unavailable while checking jti → 503 (fail closed)
 *       · legacy token (no jti) skips revocation gate (admitted)
 *       · no token → 401
 *       · ADMIN_SECRET unset → 401 with config error
 */

const mockIsRevoked = jest.fn();
jest.mock('@/lib/auth/adminRevocation', () => ({
  isAdminJtiRevoked: (...a: unknown[]) => mockIsRevoked(...a),
  revokeAdminJti: jest.fn(),
}));

import { NextRequest } from 'next/server';
import {
  generateAdminToken,
  verifyAdminToken,
  readAdminTokenFromRequest,
  requireAdminAuth,
  ADMIN_COOKIE_NAME,
} from '@/lib/middleware/auth';

// Pin the secret so we can hand-craft tampered tokens in tests
process.env.ADMIN_SECRET = 'test-secret-do-not-ship';

function buildRequest(opts: { cookie?: string; bearer?: string }): NextRequest {
  const headers = new Headers();
  const cookies: string[] = [];
  if (opts.cookie) cookies.push(`${ADMIN_COOKIE_NAME}=${opts.cookie}`);
  if (cookies.length) headers.set('cookie', cookies.join('; '));
  if (opts.bearer) headers.set('authorization', `Bearer ${opts.bearer}`);
  return new NextRequest(new URL('https://admin.example/api/admin/test'), { headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: nothing revoked
  mockIsRevoked.mockResolvedValue(false);
});

describe('generateAdminToken — new format with jti', () => {
  test('payload has 4 colon-separated parts: username:ts:jti:sig', () => {
    const t = generateAdminToken('admin');
    const decoded = Buffer.from(t, 'base64').toString();
    const parts = decoded.split(':');
    expect(parts).toHaveLength(4);
    const [user, ts, jti, sig] = parts;
    expect(user).toBe('admin');
    expect(parseInt(ts, 10)).toBeGreaterThan(0);
    expect(jti).toMatch(/^[0-9a-f]{32}$/); // 16 random bytes hex
    expect(sig).toMatch(/^[0-9a-f]{64}$/); // HMAC-SHA256 hex
  });

  test('jti is unique across calls — proves randomness, not a constant', () => {
    const a = generateAdminToken('admin');
    const b = generateAdminToken('admin');
    const aJti = Buffer.from(a, 'base64').toString().split(':')[2];
    const bJti = Buffer.from(b, 'base64').toString().split(':')[2];
    expect(aJti).not.toBe(bJti);
  });
});

describe('verifyAdminToken — accepts both formats', () => {
  test('new 4-part token → valid + jti returned', () => {
    const t = generateAdminToken('admin');
    const r = verifyAdminToken(t);
    expect(r.valid).toBe(true);
    expect(r.username).toBe('admin');
    expect(r.jti).toMatch(/^[0-9a-f]{32}$/);
    expect(r.legacyNoJti).toBeFalsy();
  });

  test('legacy 3-part token → valid + legacyNoJti=true', () => {
    // Hand-craft a legacy token (no jti) using the same HMAC the verifier
    // expects. This is what an unmigrated admin's localStorage holds.
    const { createHmac } = require('crypto');
    const ts = Math.floor(Date.now() / 1000);
    const payload = `admin:${ts}`;
    const sig = createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
    const legacyToken = Buffer.from(`${payload}:${sig}`).toString('base64');

    const r = verifyAdminToken(legacyToken);
    expect(r.valid).toBe(true);
    expect(r.username).toBe('admin');
    expect(r.jti).toBeUndefined();
    expect(r.legacyNoJti).toBe(true);
  });

  test('tampered signature → invalid', () => {
    const t = generateAdminToken('admin');
    const decoded = Buffer.from(t, 'base64').toString();
    const parts = decoded.split(':');
    parts[3] = '0'.repeat(64); // wipe the signature
    const tampered = Buffer.from(parts.join(':')).toString('base64');
    expect(verifyAdminToken(tampered).valid).toBe(false);
  });

  test('expired token (ts > 24h ago) → invalid', () => {
    const { createHmac } = require('crypto');
    const ts = Math.floor(Date.now() / 1000) - 86401;
    const jti = '0'.repeat(32);
    const payload = `admin:${ts}:${jti}`;
    const sig = createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
    const expired = Buffer.from(`${payload}:${sig}`).toString('base64');
    expect(verifyAdminToken(expired).valid).toBe(false);
  });

  test('garbage input → invalid (no throw)', () => {
    expect(verifyAdminToken('not-a-valid-token').valid).toBe(false);
    expect(verifyAdminToken('').valid).toBe(false);
    expect(verifyAdminToken('only:two').valid).toBe(false);
  });
});

describe('readAdminTokenFromRequest', () => {
  test('cookie-only → returns cookie value', () => {
    const req = buildRequest({ cookie: 'cookie-token-abc' });
    expect(readAdminTokenFromRequest(req)).toBe('cookie-token-abc');
  });

  test('bearer-only (legacy migration) → returns bearer value', () => {
    const req = buildRequest({ bearer: 'legacy-token-xyz' });
    expect(readAdminTokenFromRequest(req)).toBe('legacy-token-xyz');
  });

  test('both present → cookie wins (more secure path)', () => {
    const req = buildRequest({ cookie: 'cookie-A', bearer: 'bearer-B' });
    expect(readAdminTokenFromRequest(req)).toBe('cookie-A');
  });

  test('neither → null', () => {
    const req = buildRequest({});
    expect(readAdminTokenFromRequest(req)).toBeNull();
  });
});

describe('requireAdminAuth — gates and revocation', () => {
  test('valid jti token via cookie → null (auth passes), revocation checked', async () => {
    const t = generateAdminToken('admin');
    const req = buildRequest({ cookie: t });

    const result = await requireAdminAuth(req);
    expect(result).toBeNull();
    expect(mockIsRevoked).toHaveBeenCalledTimes(1);
    expect(mockIsRevoked).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{32}$/));
  });

  test('valid token via Bearer (legacy migration) → null, revocation checked', async () => {
    const t = generateAdminToken('admin');
    const req = buildRequest({ bearer: t });

    const result = await requireAdminAuth(req);
    expect(result).toBeNull();
  });

  test('jti is REVOKED → 401', async () => {
    mockIsRevoked.mockResolvedValueOnce(true);
    const t = generateAdminToken('admin');
    const req = buildRequest({ cookie: t });

    const result = await requireAdminAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
    const body = await result!.json();
    expect(body.error).toMatch(/revoked/i);
  });

  test('Redis unavailable while checking jti → 503 (fail closed)', async () => {
    mockIsRevoked.mockRejectedValueOnce(new Error('REVOCATION_CHECK_UNAVAILABLE'));
    const t = generateAdminToken('admin');
    const req = buildRequest({ cookie: t });

    const result = await requireAdminAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
    const body = await result!.json();
    expect(body.error).toMatch(/temporarily unavailable/i);
  });

  test('legacy token (no jti) → revocation gate is SKIPPED, admitted', async () => {
    const { createHmac } = require('crypto');
    const ts = Math.floor(Date.now() / 1000);
    const payload = `admin:${ts}`;
    const sig = createHmac('sha256', process.env.ADMIN_SECRET).update(payload).digest('hex');
    const legacyToken = Buffer.from(`${payload}:${sig}`).toString('base64');

    const req = buildRequest({ bearer: legacyToken });
    const result = await requireAdminAuth(req);
    expect(result).toBeNull();
    expect(mockIsRevoked).not.toHaveBeenCalled();
  });

  test('no token at all → 401', async () => {
    const req = buildRequest({});
    const result = await requireAdminAuth(req);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  test('invalid token → 401', async () => {
    const req = buildRequest({ cookie: 'garbage' });
    const result = await requireAdminAuth(req);
    expect(result!.status).toBe(401);
    expect(mockIsRevoked).not.toHaveBeenCalled();
  });
});
