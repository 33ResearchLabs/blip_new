/**
 * Auth hook — production strict-mode regression test.
 *
 * Verifies the secure-by-default behaviour added to apps/core-api/src/hooks/auth.ts:
 *
 *   1. In production (NODE_ENV='production'), the legacy (no-timestamp)
 *      actor signature is REJECTED with 401 — even when CORE_API_STRICT_AUTH
 *      is unset. The runtime cannot be coerced into accepting the legacy
 *      format outside non-production.
 *
 *   2. In production with the timestamp-bound signature, freshness is
 *      enforced — a stale timestamp returns 401.
 *
 *   3. The startup helper `assertStrictAuthInProduction()`:
 *        - throws when NODE_ENV='production' and CORE_API_STRICT_AUTH='false'
 *        - is a no-op when NODE_ENV='production' and CORE_API_STRICT_AUTH unset
 *        - is a no-op when NODE_ENV='production' and CORE_API_STRICT_AUTH='true'
 *        - is a no-op outside production
 *
 * Run: tsx apps/core-api/tests/authStrictModeProduction.test.ts
 */

import assert from 'node:assert';
import { createHmac } from 'node:crypto';
import Fastify from 'fastify';

const SECRET = 'test-secret-' + Math.random().toString(36).slice(2);
process.env.CORE_API_SECRET = SECRET;
process.env.CORE_API_TS_SKEW_SEC = '60';

// We toggle NODE_ENV per case below; ensure CORE_API_STRICT_AUTH starts unset
// so the production default-on path is what we exercise in case 1.
delete process.env.CORE_API_STRICT_AUTH;
process.env.NODE_ENV = 'production';

const { installAuthHook, assertStrictAuthInProduction } = await import('../src/hooks/auth.js');

function hmac(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('hex');
}

async function buildApp() {
  const app = Fastify({ logger: false });
  installAuthHook(app);
  await app.register(async (f) => {
    f.get('/orders/test', async () => ({ success: true, data: { ok: true } }));
  }, { prefix: '/v1' });
  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  try {
    // ── Case 1: legacy signature rejected in production (var unset) ───
    {
      const actorType = 'user';
      const actorId = 'user-1';
      const sig = hmac(`${actorType}:${actorId}`); // legacy payload, no ts
      const resp = await app.inject({
        method: 'GET',
        url: '/v1/orders/test',
        headers: {
          'x-core-api-secret': SECRET,
          'x-actor-type': actorType,
          'x-actor-id': actorId,
          'x-actor-signature': sig,
          // NO x-actor-timestamp — this IS the legacy form
        },
      });
      assert.strictEqual(
        resp.statusCode,
        401,
        `production must reject legacy signature; got ${resp.statusCode} ${resp.body}`,
      );
    }

    // ── Case 2: stale timestamp rejected in production ────────────────
    {
      const actorType = 'user';
      const actorId = 'user-1';
      const ts = Math.floor(Date.now() / 1000) - 600; // 10 min old
      const sig = hmac(`${actorType}:${actorId}:${ts}`);
      const resp = await app.inject({
        method: 'GET',
        url: '/v1/orders/test',
        headers: {
          'x-core-api-secret': SECRET,
          'x-actor-type': actorType,
          'x-actor-id': actorId,
          'x-actor-timestamp': String(ts),
          'x-actor-signature': sig,
        },
      });
      assert.strictEqual(
        resp.statusCode,
        401,
        `stale timestamp must be rejected in prod; got ${resp.statusCode} ${resp.body}`,
      );
    }

    // ── Case 3: fresh timestamped signature accepted in production ────
    {
      const actorType = 'user';
      const actorId = 'user-1';
      const ts = Math.floor(Date.now() / 1000);
      const sig = hmac(`${actorType}:${actorId}:${ts}`);
      const resp = await app.inject({
        method: 'GET',
        url: '/v1/orders/test',
        headers: {
          'x-core-api-secret': SECRET,
          'x-actor-type': actorType,
          'x-actor-id': actorId,
          'x-actor-timestamp': String(ts),
          'x-actor-signature': sig,
        },
      });
      assert.strictEqual(
        resp.statusCode,
        200,
        `fresh signed request must pass in prod; got ${resp.statusCode} ${resp.body}`,
      );
    }

    // ── Case 4: assertStrictAuthInProduction() ────────────────────────
    {
      // Production + 'false' → must throw
      process.env.NODE_ENV = 'production';
      process.env.CORE_API_STRICT_AUTH = 'false';
      assert.throws(
        () => assertStrictAuthInProduction(),
        /CORE_API_STRICT_AUTH/,
        'expected throw when CORE_API_STRICT_AUTH=false in production',
      );

      // Production + 'true' → no-op
      process.env.CORE_API_STRICT_AUTH = 'true';
      assert.doesNotThrow(() => assertStrictAuthInProduction());

      // Production + unset → no-op (strict is default)
      delete process.env.CORE_API_STRICT_AUTH;
      assert.doesNotThrow(() => assertStrictAuthInProduction());

      // Non-production + anything → no-op
      process.env.NODE_ENV = 'test';
      process.env.CORE_API_STRICT_AUTH = 'false';
      assert.doesNotThrow(() => assertStrictAuthInProduction());
    }

    console.log('PASS auth strict-mode is default-on in production + startup guard works');
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
