/**
 * Solana RPC proxy — leak + allowlist tests.
 *
 * Verifies:
 *   1. The keyed upstream URL never appears in the response (body or headers).
 *   2. Method allowlist blocks abuse vectors (requestAirdrop / arbitrary
 *      method names) with a JSON-RPC 32601 error code.
 *   3. Allowlisted methods are forwarded verbatim with the request body
 *      preserved (id, params, batch).
 *   4. Client cookies / Authorization headers are NOT forwarded upstream.
 *   5. GET / non-POST returns 405 (predictable surface for fuzzers).
 *   6. Misconfiguration (no upstream URL set) returns 503 without leaking
 *      which env var is missing.
 *   7. Batch with one disallowed method is rejected.
 */

process.env.NODE_ENV = 'test';

// Mock rate-limiter so we always pass through.
jest.mock('../../src/lib/middleware/rateLimit', () => ({
  checkRateLimit: jest.fn().mockResolvedValue(null),
}));

const SECRET_UPSTREAM =
  'https://devnet.helius-rpc.com/?api-key=SECRET-KEY-NEVER-LEAK';

const ORIGINAL_FETCH = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SOLANA_RPC_URL_PRIVATE = SECRET_UPSTREAM;
  delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  delete process.env.SOLANA_RPC_PROXY_ALLOWED_METHODS;
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

import { POST, GET } from '../../src/app/api/rpc/route';

function buildPostRequest(body: unknown, headers: Record<string, string> = {}) {
  // Minimal NextRequest-like shape: the route only calls .json() and
  // checkRateLimit which we've mocked.
  return {
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    nextUrl: { pathname: '/api/rpc', searchParams: new URLSearchParams() },
    method: 'POST',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function buildUpstreamResponse(payload: unknown, status = 200) {
  return {
    status,
    text: async () => JSON.stringify(payload),
    headers: new Headers({
      // Provider headers we MUST NOT forward — they fingerprint plan / key.
      'x-helius-plan': 'pro',
      'x-ratelimit-remaining': '99',
    }),
  } as unknown as Response;
}

describe('RPC proxy — secret containment', () => {
  test('upstream URL is NEVER included in the response body or headers', async () => {
    fetchMock.mockResolvedValueOnce(buildUpstreamResponse({ jsonrpc: '2.0', id: 1, result: 'ok' }));

    const req = buildPostRequest({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
    const res = await POST(req);
    const text = await res.text();

    expect(text).not.toContain('SECRET-KEY-NEVER-LEAK');
    expect(text).not.toContain('helius-rpc.com');
    expect(text).not.toContain('api-key');

    // Response headers also must not echo the upstream's provider headers
    expect(res.headers.get('x-helius-plan')).toBeNull();
    expect(res.headers.get('x-ratelimit-remaining')).toBeNull();
  });

  test('client Authorization / Cookie headers are NOT forwarded upstream', async () => {
    fetchMock.mockResolvedValueOnce(buildUpstreamResponse({ jsonrpc: '2.0', id: 1, result: 'ok' }));

    const req = buildPostRequest(
      { jsonrpc: '2.0', id: 1, method: 'getHealth' },
      {
        authorization: 'Bearer sensitive-session-token',
        cookie: 'session=secret',
        'x-actor-id': 'user-123',
      },
    );
    await POST(req);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, fetchOpts] = fetchMock.mock.calls[0];
    const fwdHeaders = fetchOpts.headers as Record<string, string>;
    expect(Object.keys(fwdHeaders).map((k) => k.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(fwdHeaders).map((k) => k.toLowerCase())).not.toContain('cookie');
    expect(Object.keys(fwdHeaders).map((k) => k.toLowerCase())).not.toContain('x-actor-id');
    expect(fwdHeaders['content-type']).toBe('application/json');
  });

  test('upstream URL not configured → 503 without naming the env var', async () => {
    delete process.env.SOLANA_RPC_URL_PRIVATE;
    delete process.env.NEXT_PUBLIC_SOLANA_RPC_URL;

    const req = buildPostRequest({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
    const res = await POST(req);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.message).toBe('RPC proxy not configured');
    expect(JSON.stringify(body)).not.toMatch(/SOLANA_RPC_URL_PRIVATE|NEXT_PUBLIC_SOLANA_RPC_URL/);
  });
});

describe('RPC proxy — method allowlist', () => {
  test.each([
    'getAccountInfo',
    'getBalance',
    'getLatestBlockhash',
    'sendTransaction',
    'simulateTransaction',
    'getHealth',
    'getTransaction',
  ])('forwards allowlisted method %s', async (method) => {
    fetchMock.mockResolvedValueOnce(buildUpstreamResponse({ jsonrpc: '2.0', id: 7, result: {} }));
    const req = buildPostRequest({ jsonrpc: '2.0', id: 7, method, params: [] });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test.each([
    'requestAirdrop',
    'getProgramAccounts',
    'accountSubscribe',
    '__internal_admin',
    'arbitraryEvilMethod',
  ])('blocks non-allowlisted method %s with -32601', async (method) => {
    const req = buildPostRequest({ jsonrpc: '2.0', id: 7, method });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
    expect(body.error.message).toMatch(/Method not allowed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('env override SOLANA_RPC_PROXY_ALLOWED_METHODS narrows the set', async () => {
    process.env.SOLANA_RPC_PROXY_ALLOWED_METHODS = 'getHealth,getSlot';
    const req = buildPostRequest({ jsonrpc: '2.0', id: 1, method: 'getBalance' });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  test('batch with one disallowed method is rejected entirely', async () => {
    const req = buildPostRequest([
      { jsonrpc: '2.0', id: 1, method: 'getHealth' },
      { jsonrpc: '2.0', id: 2, method: 'requestAirdrop' },
    ]);
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('RPC proxy — body forwarding integrity', () => {
  test('id and params are forwarded verbatim', async () => {
    fetchMock.mockResolvedValueOnce(buildUpstreamResponse({ jsonrpc: '2.0', id: 'abc-42', result: 'ok' }));
    const req = buildPostRequest({
      jsonrpc: '2.0',
      id: 'abc-42',
      method: 'getAccountInfo',
      params: ['So11111111111111111111111111111111111111112', { encoding: 'base64' }],
    });
    await POST(req);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(SECRET_UPSTREAM);
    const fwdBody = JSON.parse((opts as { body: string }).body);
    expect(fwdBody.id).toBe('abc-42');
    expect(fwdBody.method).toBe('getAccountInfo');
    expect(fwdBody.params).toEqual([
      'So11111111111111111111111111111111111111112',
      { encoding: 'base64' },
    ]);
  });

  test('upstream response status is passed through', async () => {
    fetchMock.mockResolvedValueOnce(buildUpstreamResponse({ jsonrpc: '2.0', id: 1, error: 'upstream' }, 502));
    const req = buildPostRequest({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  test('parse error in incoming body returns -32700', async () => {
    const req = {
      json: async () => {
        throw new Error('boom');
      },
      headers: { get: () => null },
      nextUrl: { pathname: '/api/rpc', searchParams: new URLSearchParams() },
      method: 'POST',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  test('empty array body returns -32600 Invalid Request', async () => {
    const req = buildPostRequest([]);
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  test('upstream timeout maps to JSON-RPC -32603 error', async () => {
    fetchMock.mockImplementationOnce((_, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          (e as Error & { name: string }).name = 'AbortError';
          reject(e);
        });
      });
    });
    // Override the route's 10s timeout with a fake-timer; for speed, we
    // manually trigger the controller. The route uses a real setTimeout, so
    // for this test we rely on an immediate AbortError thrown by the mock.
    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(() => {
      const err = new Error('aborted');
      (err as Error & { name: string }).name = 'AbortError';
      return Promise.reject(err);
    });
    const req = buildPostRequest({ jsonrpc: '2.0', id: 1, method: 'getHealth' });
    const res = await POST(req);
    const body = await res.json();
    expect(body.error.code).toBe(-32603);
    expect(body.error.message).toMatch(/timeout|RPC error/i);
  });
});

describe('RPC proxy — non-POST surface', () => {
  test('GET returns 405', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
