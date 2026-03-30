/**
 * Security Test Suite: Auth Enforcement
 *
 * Tests that production mode rejects header-only auth
 * and only accepts cryptographically signed tokens.
 */

import { generateSessionToken, generateAccessToken, generateRefreshToken, verifySessionToken, verifyAccessToken, verifyRefreshToken } from '../../src/lib/auth/sessionToken';
import { createHmac } from 'crypto';

// Force production mode for these tests
process.env.NODE_ENV = 'production';
process.env.ADMIN_SECRET = 'test-secret-for-ci';

// Re-import after setting env
const { getAuthContext } = require('../../src/lib/middleware/auth');

// Mock NextRequest
function mockRequest(path: string, headers: Record<string, string | null> = {}): any {
  return {
    headers: { get: (k: string) => headers[k] ?? null },
    nextUrl: { pathname: path, searchParams: new URLSearchParams() },
  };
}

describe('Suite 1: Token System', () => {
  test('T1: Legacy token gen+verify', () => {
    const token = generateSessionToken({ actorId: 'merch-1', actorType: 'merchant' })!;
    const payload = verifySessionToken(token);
    expect(payload?.actorId).toBe('merch-1');
    expect(payload?.actorType).toBe('merchant');
  });

  test('T2: Access token gen+verify', () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const payload = verifyAccessToken(token);
    expect(payload?.actorId).toBe('user-1');
  });

  test('T3: verifySessionToken accepts access tokens', () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    expect(verifySessionToken(token)?.actorId).toBe('user-1');
  });

  test('T4: Refresh token gen+verify', () => {
    const token = generateRefreshToken({ actorId: 'merch-2', actorType: 'merchant' })!;
    expect(verifyRefreshToken(token)?.actorId).toBe('merch-2');
  });

  test('T5: CRITICAL — verifySessionToken REJECTS refresh tokens', () => {
    const refresh = generateRefreshToken({ actorId: 'x', actorType: 'merchant' })!;
    expect(verifySessionToken(refresh)).toBeNull();
  });

  test('T6: Invalid token rejected', () => {
    expect(verifySessionToken('garbage')).toBeNull();
  });

  test('T7: Tampered token rejected', () => {
    const token = generateSessionToken({ actorId: 'victim', actorType: 'merchant' })!;
    const decoded = Buffer.from(token, 'base64').toString();
    const parts = decoded.split(':');
    parts[1] = 'attacker-id';
    const tampered = Buffer.from(parts.join(':')).toString('base64');
    expect(verifySessionToken(tampered)).toBeNull();
  });

  test('T8: Expired access token rejected', () => {
    const secret = process.env.ADMIN_SECRET!;
    const oldTs = Math.floor(Date.now() / 1000) - (20 * 60);
    const data = `access:merchant:test:${oldTs}`;
    const sig = createHmac('sha256', secret).update(data).digest('hex');
    const expired = Buffer.from(`${data}:${sig}`).toString('base64');
    expect(verifyAccessToken(expired)).toBeNull();
  });

  test('T9: Refresh NOT accepted as access', () => {
    const refresh = generateRefreshToken({ actorId: 'x', actorType: 'user' })!;
    expect(verifyAccessToken(refresh)).toBeNull();
  });

  test('T10: Access NOT accepted as refresh', () => {
    const access = generateAccessToken({ actorId: 'x', actorType: 'user' })!;
    expect(verifyRefreshToken(access)).toBeNull();
  });

  test('T11: Future timestamp rejected', () => {
    const secret = process.env.ADMIN_SECRET!;
    const futureTs = Math.floor(Date.now() / 1000) + 3600;
    const data = `access:user:x:${futureTs}`;
    const sig = createHmac('sha256', secret).update(data).digest('hex');
    const future = Buffer.from(`${data}:${sig}`).toString('base64');
    expect(verifyAccessToken(future)).toBeNull();
  });

  test('T12: Invalid actorType rejected', () => {
    const bad = Buffer.from('access:admin:x:999999:abc').toString('base64');
    expect(verifySessionToken(bad)).toBeNull();
  });
});

describe('Suite 2: Auth Middleware (Production Mode)', () => {
  test('T1: No token, no headers → rejected', () => {
    const req = mockRequest('/api/orders', {});
    expect(getAuthContext(req)).toBeNull();
  });

  test('T2: Only x-merchant-id (no token) → rejected in production', () => {
    const req = mockRequest('/api/merchant/orders', { 'x-merchant-id': 'fake-id' });
    expect(getAuthContext(req)).toBeNull();
  });

  test('T3: Only x-user-id (no token) → rejected in production', () => {
    const req = mockRequest('/api/orders', { 'x-user-id': 'fake-user' });
    expect(getAuthContext(req)).toBeNull();
  });

  test('T4: Valid Bearer token → accepted', () => {
    const token = generateAccessToken({ actorId: 'real-merchant', actorType: 'merchant' })!;
    const req = mockRequest('/api/merchant/orders', { 'authorization': `Bearer ${token}` });
    const ctx = getAuthContext(req);
    expect(ctx?.actorId).toBe('real-merchant');
    expect(ctx?.actorType).toBe('merchant');
  });

  test('T5: Invalid token + fake header → rejected (no fallback)', () => {
    const req = mockRequest('/api/orders', {
      'authorization': 'Bearer invalid-garbage',
      'x-merchant-id': 'fake-id',
    });
    expect(getAuthContext(req)).toBeNull();
  });

  test('T6: Dual login — user token + merchant header context', () => {
    const token = generateAccessToken({ actorId: 'user-456', actorType: 'user' })!;
    const req = mockRequest('/api/orders/xyz', {
      'authorization': `Bearer ${token}`,
      'x-merchant-id': 'merch-789',
    });
    const ctx = getAuthContext(req);
    expect(ctx?.actorType).toBe('user');
    expect(ctx?.actorId).toBe('user-456');
    expect(ctx?.userId).toBe('user-456');
    expect(ctx?.merchantId).toBe('merch-789'); // supplementary, not identity
  });

  test('T7: Legacy 7-day token still accepted', () => {
    const token = generateSessionToken({ actorId: 'legacy-merch', actorType: 'merchant' })!;
    const req = mockRequest('/api/merchant/orders', { 'authorization': `Bearer ${token}` });
    const ctx = getAuthContext(req);
    expect(ctx?.actorId).toBe('legacy-merch');
  });

  test('T8: Compliance token with merchant context', () => {
    const token = generateAccessToken({ actorId: 'comp-1', actorType: 'compliance' })!;
    const req = mockRequest('/api/compliance/disputes', {
      'authorization': `Bearer ${token}`,
      'x-merchant-id': 'merch-access',
    });
    const ctx = getAuthContext(req);
    expect(ctx?.actorType).toBe('compliance');
    expect(ctx?.actorId).toBe('comp-1');
    expect(ctx?.merchantId).toBe('merch-access');
  });
});
