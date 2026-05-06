/**
 * Startup secret guard (B9).
 *
 * `assertStrictAuthInProduction` must throw when:
 *   - CORE_API_SECRET is a known placeholder (any env)
 *   - CORE_API_SECRET is shorter than 32 chars in production
 *   - CORE_API_SECRET is missing in production
 *   - CORE_API_STRICT_AUTH is explicitly 'false' in production
 *
 * And must NOT throw when:
 *   - a strong unique secret is set (any env)
 *   - dev / staging with the dev defaults absent
 *
 * Run: tsx apps/core-api/tests/startupSecretGuard.test.ts
 */

import assert from 'node:assert';
import { assertStrictAuthInProduction } from '../src/hooks/auth.js';

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) previous[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function expectThrow(env: Record<string, string | undefined>, pattern: RegExp, label: string) {
  withEnv(env, () => {
    let threw = false;
    let msg = '';
    try {
      assertStrictAuthInProduction();
    } catch (e) {
      threw = true;
      msg = e instanceof Error ? e.message : String(e);
    }
    assert.ok(threw, `${label}: expected throw, did not throw`);
    assert.match(msg, pattern, `${label}: error message must match ${pattern}`);
  });
}

function expectNoThrow(env: Record<string, string | undefined>, label: string) {
  withEnv(env, () => {
    try {
      assertStrictAuthInProduction();
    } catch (e) {
      assert.fail(`${label}: unexpected throw: ${(e as Error).message}`);
    }
  });
}

async function main() {
  const STRONG = 'a'.repeat(64);

  // T1: placeholder secret in DEV → throw
  expectThrow(
    { NODE_ENV: 'development', CORE_API_SECRET: 'local-dev-secret', CORE_API_STRICT_AUTH: undefined },
    /placeholder/,
    'T1 dev placeholder secret',
  );

  // T2: placeholder secret in PROD → throw
  expectThrow(
    { NODE_ENV: 'production', CORE_API_SECRET: 'changeme', CORE_API_STRICT_AUTH: undefined },
    /placeholder/,
    'T2 prod placeholder secret',
  );

  // T3: empty string in PROD → throw (required)
  expectThrow(
    { NODE_ENV: 'production', CORE_API_SECRET: '', CORE_API_STRICT_AUTH: undefined },
    /required/,
    'T3 prod missing secret',
  );

  // T4: short secret in PROD → throw
  expectThrow(
    { NODE_ENV: 'production', CORE_API_SECRET: 'abc123def456', CORE_API_STRICT_AUTH: undefined },
    /too short/,
    'T4 prod short secret',
  );

  // T5: STRICT_AUTH=false in PROD → throw
  expectThrow(
    { NODE_ENV: 'production', CORE_API_SECRET: STRONG, CORE_API_STRICT_AUTH: 'false' },
    /CORE_API_STRICT_AUTH/,
    'T5 prod legacy auth explicitly enabled',
  );

  // T6: strong secret + strict mode in PROD → no throw
  expectNoThrow(
    { NODE_ENV: 'production', CORE_API_SECRET: STRONG, CORE_API_STRICT_AUTH: 'true' },
    'T6 prod hardened',
  );

  // T7: strong secret in DEV (any STRICT_AUTH) → no throw
  expectNoThrow(
    { NODE_ENV: 'development', CORE_API_SECRET: STRONG, CORE_API_STRICT_AUTH: undefined },
    'T7 dev with strong secret',
  );

  // T8: empty secret in DEV → no throw (the enforcement is prod-only for empty)
  expectNoThrow(
    { NODE_ENV: 'development', CORE_API_SECRET: undefined, CORE_API_STRICT_AUTH: undefined },
    'T8 dev with no secret set',
  );

  console.log('startupSecretGuard: ALL TESTS PASSED');
}

main().catch((err) => {
  console.error('startupSecretGuard FAILED:', err);
  process.exit(1);
});
