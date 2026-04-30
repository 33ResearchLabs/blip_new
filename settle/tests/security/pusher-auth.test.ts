/**
 * Security Test Suite: Pusher Channel Auth
 *
 * Verifies that /api/pusher/auth derives identity ONLY from a verified
 * session token. Header-based identity (x-actor-id / x-actor-type) MUST
 * NOT be honored.
 *
 * Threats covered:
 *   - No token, forged x-actor-* headers → reject (was: bypass)
 *   - Valid user token, channel for another user → reject
 *   - Valid user token, merchant-only channel → reject
 *   - Valid merchant token, foreign-order channel → reject
 *   - Valid token on own channel → accept
 *   - Valid merchant on merchants-global → accept
 */

process.env.NODE_ENV = 'production';
process.env.ADMIN_SECRET = 'test-secret-for-ci';
process.env.PUSHER_APP_ID = 'test-app';
process.env.NEXT_PUBLIC_PUSHER_KEY = 'test-key';
process.env.PUSHER_SECRET = 'test-pusher-secret';
process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'test-cluster';

// ── Mocks must be declared before route import ────────────────────────

jest.mock('pusher', () => {
  return jest.fn().mockImplementation(() => ({
    authorizeChannel: (socketId: string, channel: string) => ({
      auth: `mock-auth-sig:${socketId}:${channel}`,
      channel_data: undefined,
    }),
  }));
});

jest.mock('../../src/lib/db/repositories/users', () => ({
  getUserById: jest.fn(),
}));
jest.mock('../../src/lib/db/repositories/merchants', () => ({
  getMerchantById: jest.fn(),
}));
jest.mock('../../src/lib/db/repositories/orders', () => ({
  getOrderById: jest.fn(),
}));

// Bypass session-revocation + blacklist DB checks
jest.mock('../../src/lib/auth/sessions', () => ({
  isSessionValid: jest.fn().mockResolvedValue(true),
  hasNoActiveSessions: jest.fn().mockResolvedValue(false),
  getSessionIdFromRefreshCookie: jest.fn().mockResolvedValue(null),
}));
jest.mock('../../src/lib/middleware/blacklist', () => ({
  checkBlacklist: jest.fn().mockResolvedValue(null),
}));

// Silence the safeLog import inside the route
jest.mock('../../src/lib/errorTracking/logger', () => ({
  safeLog: jest.fn(),
}));

// ── Imports after mocks ───────────────────────────────────────────────
import { generateAccessToken } from '../../src/lib/auth/sessionToken';
import { POST } from '../../src/app/api/pusher/auth/route';
import { getUserById } from '../../src/lib/db/repositories/users';
import { getMerchantById } from '../../src/lib/db/repositories/merchants';
import { getOrderById } from '../../src/lib/db/repositories/orders';

const mockedGetUserById = getUserById as jest.MockedFunction<typeof getUserById>;
const mockedGetMerchantById = getMerchantById as jest.MockedFunction<typeof getMerchantById>;
const mockedGetOrderById = getOrderById as jest.MockedFunction<typeof getOrderById>;

// ── Request stub matching what the route reads from NextRequest ──────
function buildRequest(opts: {
  bearerToken?: string;
  extraHeaders?: Record<string, string>;
  socketId?: string;
  channelName?: string;
}): any {
  const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) };
  if (opts.bearerToken) headers['authorization'] = `Bearer ${opts.bearerToken}`;

  const form = new Map<string, string>();
  if (opts.socketId !== undefined) form.set('socket_id', opts.socketId);
  if (opts.channelName !== undefined) form.set('channel_name', opts.channelName);

  return {
    headers: {
      get: (k: string) => headers[k.toLowerCase()] ?? headers[k] ?? null,
    },
    cookies: { get: () => undefined },
    nextUrl: { pathname: '/api/pusher/auth', searchParams: new URLSearchParams() },
    formData: async () => ({
      get: (k: string) => form.get(k) ?? null,
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default DB stubs — overridden per test
  mockedGetUserById.mockResolvedValue({ id: 'user-1', username: 'alice' } as any);
  mockedGetMerchantById.mockResolvedValue({ id: 'merch-1', business_name: 'Acme', status: 'active' } as any);
  mockedGetOrderById.mockResolvedValue(null);
});

describe('Pusher /api/pusher/auth — token enforcement', () => {
  test('A1: no token, forged x-actor-* headers → 401 (legacy bypass closed)', async () => {
    const req = buildRequest({
      extraHeaders: {
        'x-actor-type': 'user',
        'x-actor-id': 'attacker-tries-to-be-anyone',
      },
      socketId: '123.456',
      channelName: 'private-user-victim-id',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('A2: invalid Bearer token → 401', async () => {
    const req = buildRequest({
      bearerToken: 'totally-not-a-valid-token',
      socketId: '123.456',
      channelName: 'private-user-someone',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('A3: missing socket_id → 400', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      channelName: 'private-user-user-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

describe('Pusher /api/pusher/auth — channel ownership', () => {
  test('B1: user subscribing to OWN private channel → 200', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-user-user-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test('B2: user subscribing to ANOTHER user\'s channel → 403', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-user-user-victim',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test('B3: user subscribing to a merchant channel → 403', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-merchant-merch-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test('B4: user subscribing to merchants-global → 403', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-merchants-global',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test('B5: merchant subscribing to OWN merchant channel → 200', async () => {
    const token = generateAccessToken({ actorId: 'merch-1', actorType: 'merchant' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-merchant-merch-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test('B6: merchant subscribing to merchants-global → 200', async () => {
    const token = generateAccessToken({ actorId: 'merch-1', actorType: 'merchant' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-merchants-global',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test('B7: merchant subscribing to ANOTHER merchant\'s chat channel → 403', async () => {
    const token = generateAccessToken({ actorId: 'merch-1', actorType: 'merchant' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-merchant-chat-merch-other',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe('Pusher /api/pusher/auth — order channels', () => {
  test('C1: user authorized for order they own → 200', async () => {
    mockedGetOrderById.mockResolvedValueOnce({
      id: 'order-1',
      user_id: 'user-1',
      merchant_id: 'merch-9',
      status: 'escrowed',
    } as any);
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-order-order-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test('C2: user trying to subscribe to a stranger\'s order channel → 403', async () => {
    mockedGetOrderById.mockResolvedValueOnce({
      id: 'order-1',
      user_id: 'someone-else',
      merchant_id: 'merch-9',
      status: 'escrowed',
    } as any);
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-order-order-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test('C3: user trying to use forged x-actor-id to access another order → 403', async () => {
    // Token says user-1, headers say merch-1 — server must use the token.
    mockedGetOrderById.mockResolvedValueOnce({
      id: 'order-1',
      user_id: 'someone-else',
      merchant_id: 'merch-1',
      status: 'escrowed',
    } as any);
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      extraHeaders: {
        'x-actor-type': 'merchant',
        'x-actor-id': 'merch-1',
      },
      socketId: '111.222',
      channelName: 'private-order-order-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test('C4: presence-order channel respects same access rules', async () => {
    mockedGetOrderById.mockResolvedValueOnce({
      id: 'order-1',
      user_id: 'someone-else',
      merchant_id: 'merch-9',
      status: 'escrowed',
    } as any);
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'presence-order-order-1',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe('Pusher /api/pusher/auth — unknown channels', () => {
  test('D1: unknown channel pattern → 403', async () => {
    const token = generateAccessToken({ actorId: 'user-1', actorType: 'user' })!;
    const req = buildRequest({
      bearerToken: token,
      socketId: '111.222',
      channelName: 'private-something-weird-123',
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
