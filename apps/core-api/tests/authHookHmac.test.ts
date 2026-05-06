/**
 * Auth hook — HMAC + timestamp verification tests.
 *
 * Boots Fastify with the real authHook plugin and a stub route, then drives
 * every signature-verification path:
 *
 *   New (timestamp-bound) format:
 *     - valid signature within skew window               → 200
 *     - signature over wrong timestamp                   → 401
 *     - timestamp older than skew window                 → 401
 *     - timestamp far in the future                      → 401
 *     - malformed (non-numeric) timestamp                → 401
 *
 *   Legacy (no timestamp) format:
 *     - valid legacy signature, default mode              → 200 + warn
 *     - valid legacy signature, strict mode               → 401
 *     - invalid legacy signature                          → 401
 *
 *   Cross-cutting:
 *     - x-core-api-secret missing                         → 401
 *     - actor headers absent (channel-only call)          → 200 (no actor check)
 *     - signature missing while actor headers present     → 401
 *
 * Run: tsx apps/core-api/tests/authHookHmac.test.ts
 */

import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';

const SECRET = 'test-secret-' + Math.random().toString(36).slice(2);
process.env.CORE_API_SECRET = SECRET;
process.env.CORE_API_TS_SKEW_SEC = '60';
delete process.env.CORE_API_STRICT_AUTH;

// Import AFTER env is set so the hook captures the right values.
const { installAuthHook } = await import('../src/hooks/auth.js');

async function buildApp() {
  const app = Fastify({ logger: false });
  installAuthHook(app);
  // Register the protected route as a sibling plugin under a /v1 prefix —
  // mirrors the real production layout. If the hook were still installed via
  // `register()` (the previous bug), this route would NOT be protected and
  // every test below would fail. This is the regression-coverage for that bug.
  await app.register(async (f) => {
    f.get('/orders/test', async () => ({ success: true, data: { ok: true } }));
  }, { prefix: '/v1' });
  app.get('/protected', async () => ({ success: true, data: { ok: true } }));
  return app;
}

function hmac(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

interface Headers {
  [k: string]: string;
}

let passed = 0;
const check = (name: string, cond: boolean, ctx?: unknown) => {
  if (!cond) {
    console.error(`FAIL: ${name}`, ctx ?? '');
    process.exit(1);
  }
  console.log(`  ✓ ${name}`);
  passed++;
};

async function call(app: Awaited<ReturnType<typeof buildApp>>, headers: Headers) {
  return app.inject({ method: 'GET', url: '/protected', headers });
}

async function main(): Promise<void> {
  const app = await buildApp();

  console.log('Auth hook — channel + actor signature checks');

  // ── Cross-cutting ──
  const noSecret = await call(app, {});
  check('missing x-core-api-secret → 401', noSecret.statusCode === 401);

  // Regression: register-encapsulated hooks did not protect siblings. Confirm
  // a route registered under a /v1 prefix (separate plugin scope) IS now
  // protected.
  const noSecretPrefixed = await app.inject({
    method: 'GET',
    url: '/v1/orders/test',
    headers: {},
  });
  check(
    'regression: /v1-prefixed route enforces auth (was bypassed before fix)',
    noSecretPrefixed.statusCode === 401,
  );

  const channelOnly = await call(app, { 'x-core-api-secret': SECRET });
  check(
    'channel-only call (no actor headers) → 200',
    channelOnly.statusCode === 200,
    { code: channelOnly.statusCode, body: channelOnly.body },
  );

  const partialActor = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    // no signature
  });
  check('actor headers without signature → 401', partialActor.statusCode === 401);

  // ── New (timestamped) format ──
  const now = Math.floor(Date.now() / 1000);
  const validNew = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now),
    'x-actor-signature': hmac(`user:alice:${now}`),
  });
  check(
    'new format: valid sig within skew → 200',
    validNew.statusCode === 200,
    { code: validNew.statusCode, body: validNew.body },
  );

  const sigOverWrongTs = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now),
    'x-actor-signature': hmac(`user:alice:${now - 1}`), // signed with different ts
  });
  check('new format: signature over wrong ts → 401', sigOverWrongTs.statusCode === 401);

  const stale = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now - 120), // 2min old, > 60s skew
    'x-actor-signature': hmac(`user:alice:${now - 120}`),
  });
  check('new format: stale timestamp (>skew) → 401', stale.statusCode === 401);

  const future = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now + 120),
    'x-actor-signature': hmac(`user:alice:${now + 120}`),
  });
  check('new format: timestamp in future (>skew) → 401', future.statusCode === 401);

  const malformedTs = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': 'not-a-number',
    'x-actor-signature': hmac(`user:alice:not-a-number`),
  });
  check('new format: malformed timestamp → 401', malformedTs.statusCode === 401);

  const negativeTs = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': '-1',
    'x-actor-signature': hmac(`user:alice:-1`),
  });
  check('new format: non-positive timestamp → 401', negativeTs.statusCode === 401);

  // Replay-within-window IS still possible (timestamp alone is not a nonce);
  // we document by asserting that the same (ts, sig) is accepted twice within
  // the window. Operators must layer rate limits / anti-replay storage on top.
  const replay1 = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now),
    'x-actor-signature': hmac(`user:alice:${now}`),
  });
  const replay2 = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(now),
    'x-actor-signature': hmac(`user:alice:${now}`),
  });
  check(
    'new format: replay within skew window is accepted (documented limitation)',
    replay1.statusCode === 200 && replay2.statusCode === 200,
  );

  // ── Legacy (no timestamp) format ──
  const validLegacy = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'merchant',
    'x-actor-id': 'mid',
    'x-actor-signature': hmac('merchant:mid'),
  });
  check(
    'legacy format: valid sig in lax mode → 200',
    validLegacy.statusCode === 200,
    { code: validLegacy.statusCode, body: validLegacy.body },
  );

  const invalidLegacy = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'merchant',
    'x-actor-id': 'mid',
    'x-actor-signature': hmac('merchant:other'), // wrong payload
  });
  check('legacy format: bad sig → 401', invalidLegacy.statusCode === 401);

  // ── Strict mode ──
  process.env.CORE_API_STRICT_AUTH = 'true';
  const legacyStrict = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'merchant',
    'x-actor-id': 'mid',
    'x-actor-signature': hmac('merchant:mid'), // would be valid in lax mode
  });
  check('strict mode: legacy format rejected → 401', legacyStrict.statusCode === 401);

  // New format still works in strict mode
  const newInStrict = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'merchant',
    'x-actor-id': 'mid',
    'x-actor-timestamp': String(now),
    'x-actor-signature': hmac(`merchant:mid:${now}`),
  });
  check(
    'strict mode: new (timestamped) format still accepted → 200',
    newInStrict.statusCode === 200,
    { code: newInStrict.statusCode, body: newInStrict.body },
  );
  delete process.env.CORE_API_STRICT_AUTH;

  // ── Settle's signer must produce a signature core-api accepts ──
  const { signActorHeaders } = await import('../../../settle/src/lib/proxy/coreApi.js');
  const signed = signActorHeaders(SECRET, 'user', 'alice');
  const interop = await call(app, {
    'x-core-api-secret': SECRET,
    'x-actor-type': 'user',
    'x-actor-id': 'alice',
    'x-actor-timestamp': String(signed.timestamp),
    'x-actor-signature': signed.signature,
  });
  check(
    'interop: settle signActorHeaders → core-api accepts',
    interop.statusCode === 200,
    { code: interop.statusCode, body: interop.body },
  );

  await app.close();
  console.log(`\nPASS — ${passed} auth-hook checks`);
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
