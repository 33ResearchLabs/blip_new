/**
 * Production startup-guard tests.
 *
 * Verifies that the security gate in src/lib/env.ts:
 *   1. Reports every required guard (NODE_ENV, LOGIN_NONCE_REQUIRED,
 *      WALLET_OWNERSHIP_STRICT, CORE_API_SECRET) via resolveSecurityGuards().
 *   2. Treats prod / ENFORCE_PROD_SECURITY=true as "enforced".
 *   3. Marks individual guards ok / not-ok correctly across each combination.
 *   4. Surfaces the right status from /api/health/secure-config:
 *        all green        → 200 secure:true
 *        failures + dev   → 200 secure:false (so monitoring doesn't page locally)
 *        failures + prod  → 503 secure:false
 *   5. Never echoes the literal CORE_API_SECRET value in the healthcheck JSON.
 *
 * The startup CRASH path (process.exit) is exercised in a separate runtime
 * smoke (CI runs the docker container with bad env and asserts exit code 1);
 * here we only test the pure resolver + the route.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  delete process.env.NODE_ENV;
  delete process.env.LOGIN_NONCE_REQUIRED;
  delete process.env.WALLET_OWNERSHIP_STRICT;
  delete process.env.CORE_API_SECRET;
  delete process.env.ENFORCE_PROD_SECURITY;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

function setSecure() {
  process.env.NODE_ENV = 'production';
  process.env.LOGIN_NONCE_REQUIRED = 'true';
  process.env.WALLET_OWNERSHIP_STRICT = 'true';
  process.env.CORE_API_SECRET = 'a-shared-secret';
  // Plus the rest of validateEnv()'s required vars so `import @/lib/env`
  // doesn't crash before reaching the guard logic.
  process.env.ADMIN_SECRET = 'x';
  process.env.ADMIN_PASSWORD = 'x';
  process.env.COMPLIANCE_PASSWORD = 'x';
  process.env.PUSHER_APP_ID = 'x';
  process.env.PUSHER_SECRET = 'x';
  process.env.NEXT_PUBLIC_PUSHER_KEY = 'x';
  process.env.NEXT_PUBLIC_PUSHER_CLUSTER = 'x';
  process.env.CLOUDINARY_CLOUD_NAME = 'x';
  process.env.CLOUDINARY_API_KEY = 'x';
  process.env.CLOUDINARY_API_SECRET = 'x';
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL = 'https://api.devnet.solana.com';
  process.env.CORS_ORIGIN = 'https://blip.money';
  process.env.DATABASE_URL = 'postgres://localhost/x';
}

describe('resolveSecurityGuards — pure resolver', () => {
  test('all green → no failures, all guards ok', () => {
    setSecure();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    expect(result.failed).toHaveLength(0);
    expect(result.enforced).toBe(true);
    expect(result.guards.every((g: { ok: boolean }) => g.ok)).toBe(true);
    expect(result.guards.map((g: { key: string }) => g.key)).toEqual(
      expect.arrayContaining([
        'NODE_ENV', 'LOGIN_NONCE_REQUIRED', 'WALLET_OWNERSHIP_STRICT', 'CORE_API_SECRET',
      ]),
    );
  });

  test.each([
    ['NODE_ENV', 'development'],
    ['LOGIN_NONCE_REQUIRED', 'false'],
    ['WALLET_OWNERSHIP_STRICT', 'false'],
  ])('downgrade %s=%s → that guard fails, others still ok', (key, badValue) => {
    setSecure();
    process.env[key] = badValue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    expect(result.failed.map((g: { key: string }) => g.key)).toEqual([key]);
    expect(result.failed[0].ok).toBe(false);
  });

  test('CORE_API_SECRET unset → presence-only guard fails', () => {
    setSecure();
    delete process.env.CORE_API_SECRET;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    const failed = result.failed.find((g: { key: string }) => g.key === 'CORE_API_SECRET');
    expect(failed).toBeDefined();
    expect(failed.ok).toBe(false);
  });

  test('CORE_API_SECRET = whitespace → still fails (treated as unset)', () => {
    setSecure();
    process.env.CORE_API_SECRET = '   ';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    expect(result.failed.map((g: { key: string }) => g.key)).toContain('CORE_API_SECRET');
  });

  test('NODE_ENV=development → enforced=false (dev exemption)', () => {
    setSecure();
    process.env.NODE_ENV = 'development';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    expect(result.enforced).toBe(false);
    // The NODE_ENV guard itself fails since dev != production, but enforcement
    // is off — startup crash path is not triggered.
    expect(result.failed.map((g: { key: string }) => g.key)).toContain('NODE_ENV');
  });

  test('ENFORCE_PROD_SECURITY=true overrides → enforced even when NODE_ENV=staging', () => {
    setSecure();
    process.env.NODE_ENV = 'staging';
    process.env.ENFORCE_PROD_SECURITY = 'true';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const result = resolveSecurityGuards();
    expect(result.enforced).toBe(true);
    // NODE_ENV guard still fails (must be 'production' literal even with the override)
    expect(result.failed.map((g: { key: string }) => g.key)).toContain('NODE_ENV');
  });

  test('every guard carries a non-empty `reason` for ops messaging', () => {
    setSecure();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveSecurityGuards } = require('../../src/lib/env');
    const { guards } = resolveSecurityGuards();
    for (const g of guards) {
      expect(typeof g.reason).toBe('string');
      expect(g.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('GET /api/health/secure-config', () => {
  test('all green + prod → 200 secure:true', async () => {
    setSecure();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secure).toBe(true);
    expect(body.enforced).toBe(true);
    expect(body.failedCount).toBe(0);
  });

  test('failures + prod → 503 secure:false', async () => {
    setSecure();
    process.env.LOGIN_NONCE_REQUIRED = 'false';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.secure).toBe(false);
    expect(body.failedCount).toBe(1);
    const failedKey = body.guards.find((g: { ok: boolean; key: string }) => !g.ok).key;
    expect(failedKey).toBe('LOGIN_NONCE_REQUIRED');
  });

  test('failures + dev → 200 secure:false (no monitoring page in dev)', async () => {
    setSecure();
    process.env.NODE_ENV = 'development';
    process.env.LOGIN_NONCE_REQUIRED = 'false';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    // 200 because enforced=false → don't page on dev
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secure).toBe(false);
    expect(body.enforced).toBe(false);
  });

  test('NEVER echoes the literal CORE_API_SECRET value', async () => {
    setSecure();
    const literal = 'EXTREMELY-SECRET-VALUE-MUST-NOT-LEAK';
    process.env.CORE_API_SECRET = literal;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain(literal);
    // Presence-only guard reports '<set>' / '<unset>'
    const body = JSON.parse(text);
    const secret = body.guards.find((g: { key: string }) => g.key === 'CORE_API_SECRET');
    expect(secret.actual).toBe('<set>');
  });

  test('comparison guard with bad value shows actual (so ops sees what to fix)', async () => {
    setSecure();
    process.env.LOGIN_NONCE_REQUIRED = 'false';
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    const body = await res.json();
    const guard = body.guards.find((g: { key: string }) => g.key === 'LOGIN_NONCE_REQUIRED');
    expect(guard.actual).toBe('false');
    expect(guard.expected).toBe('true');
  });

  test('unset comparison guard shows <unset> (so ops sees absence)', async () => {
    setSecure();
    delete process.env.WALLET_OWNERSHIP_STRICT;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { GET } = require('../../src/app/api/health/secure-config/route');
    const res = await GET();
    const body = await res.json();
    const guard = body.guards.find((g: { key: string }) => g.key === 'WALLET_OWNERSHIP_STRICT');
    expect(guard.actual).toBe('<unset>');
  });
});
