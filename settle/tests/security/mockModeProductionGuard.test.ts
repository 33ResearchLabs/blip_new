/**
 * Production boot guard — NEXT_PUBLIC_MOCK_MODE must not be 'true'.
 *
 * Loads settle/src/lib/env.ts in a forked child process under three
 * configurations and asserts the right boot decision in each:
 *
 *   1. NODE_ENV=production + NEXT_PUBLIC_MOCK_MODE=true → exits non-zero
 *   2. NODE_ENV=production + NEXT_PUBLIC_MOCK_MODE=false → boots clean
 *      (other guards may still warn, but the forbidden-value crash MUST
 *      not fire)
 *   3. NODE_ENV=development + NEXT_PUBLIC_MOCK_MODE=true → boots clean
 *      with a warning on stderr
 *
 * Run: tsx settle/tests/security/mockModeProductionGuard.test.ts
 *
 * NOTE: env.ts is normally loaded once per process. We can't toggle env
 * vars after the import has already side-effected — so we drive the
 * scenarios via spawned tsx subprocesses that import env.ts fresh.
 */

import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ENV_TS = path.resolve(__dirname, '../../src/lib/env.ts');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runEnvWith(env: Record<string, string>): RunResult {
  // We need every required-in-prod var to be populated so the schema-required
  // check doesn't independently crash and confuse the test. The forbidden
  // check runs BEFORE the schema check in env.ts, but supplying these means
  // case 2 (the negative case) really only differs from case 1 by the one var
  // under test.
  const baseProdEnv = {
    NODE_ENV: 'production',
    ENFORCE_PROD_SECURITY: 'true',
    ADMIN_SECRET: 'x',
    ADMIN_PASSWORD: 'x',
    COMPLIANCE_PASSWORD: 'x',
    CORE_API_SECRET: 'x',
    PUSHER_APP_ID: 'x',
    PUSHER_SECRET: 'x',
    NEXT_PUBLIC_PUSHER_KEY: 'x',
    NEXT_PUBLIC_PUSHER_CLUSTER: 'x',
    CLOUDINARY_CLOUD_NAME: 'x',
    CLOUDINARY_API_KEY: 'x',
    CLOUDINARY_API_SECRET: 'x',
    NEXT_PUBLIC_SOLANA_RPC_URL: 'x',
    CORS_ORIGIN: 'x',
    DATABASE_URL: 'postgres://x:x@x:5432/x',
    LOGIN_NONCE_REQUIRED: 'true',
    WALLET_OWNERSHIP_STRICT: 'true',
  };

  // Build the merged env. Caller-supplied values override; if NODE_ENV is
  // overridden to non-production we drop the `ENFORCE_*` flag to ensure
  // dev mode is properly exercised.
  const merged: Record<string, string> = { ...baseProdEnv, ...env };
  if (merged.NODE_ENV !== 'production') delete merged.ENFORCE_PROD_SECURITY;

  // Use the workspace tsx; minimal stub that imports env.ts to trigger guards.
  const stubPath = path.resolve(__dirname, './_fixture-load-env.mjs');
  const result = spawnSync(
    'node',
    ['--experimental-vm-modules', stubPath],
    {
      env: { ...process.env, ...merged, _ENV_TS_PATH: ENV_TS } as NodeJS.ProcessEnv,
      encoding: 'utf-8',
      timeout: 20_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function main(): Promise<void> {
  // Case 1: prod + mock=true → must crash
  const crash = runEnvWith({ NODE_ENV: 'production', NEXT_PUBLIC_MOCK_MODE: 'true' });
  assert.ok(
    crash.status !== 0,
    `expected non-zero exit for prod+MOCK_MODE=true; got status=${crash.status}\nstderr=${crash.stderr}\nstdout=${crash.stdout}`,
  );
  assert.match(
    crash.stderr,
    /forbidden production env values|NEXT_PUBLIC_MOCK_MODE/,
    `expected forbidden-value error in stderr; got:\n${crash.stderr}`,
  );

  // Case 2: prod + mock=false → must not crash on the forbidden-value rule
  const safe = runEnvWith({ NODE_ENV: 'production', NEXT_PUBLIC_MOCK_MODE: 'false' });
  assert.ok(
    !/forbidden production env values/.test(safe.stderr),
    `forbidden-value crash should not fire for mock=false; stderr=${safe.stderr}`,
  );

  // Case 3: dev + mock=true → no crash, warn on stderr
  const dev = runEnvWith({ NODE_ENV: 'development', NEXT_PUBLIC_MOCK_MODE: 'true' });
  assert.strictEqual(dev.status, 0, `dev mode must not crash; status=${dev.status}\nstderr=${dev.stderr}`);
  assert.match(
    dev.stderr,
    /Forbidden production env values present/i,
    `expected dev warning; got:\n${dev.stderr}`,
  );

  console.log('PASS NEXT_PUBLIC_MOCK_MODE forbidden-in-production guard');
}

main().catch((err) => {
  console.error('FAIL', err);
  process.exit(1);
});
