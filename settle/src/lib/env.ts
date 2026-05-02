/**
 * Environment variable validation — imported early to fail fast on missing config.
 *
 * Usage: import '@/lib/env' at the top of server.js or layout.tsx
 * Will throw at startup if required vars are missing in production.
 */

const isProduction = process.env.NODE_ENV === 'production';

interface EnvVar {
  key: string;
  required: boolean; // required in production
  secret?: boolean;  // mask value in logs
}

const ENV_SCHEMA: EnvVar[] = [
  // Database — either DATABASE_URL or individual vars
  // (checked separately below)

  // Security (required in production)
  { key: 'ADMIN_SECRET', required: true, secret: true },
  { key: 'ADMIN_PASSWORD', required: true, secret: true },
  { key: 'COMPLIANCE_PASSWORD', required: true, secret: true },
  { key: 'CORE_API_SECRET', required: true, secret: true },

  // External services
  { key: 'PUSHER_APP_ID', required: true },
  { key: 'PUSHER_SECRET', required: true, secret: true },
  { key: 'NEXT_PUBLIC_PUSHER_KEY', required: true },
  { key: 'NEXT_PUBLIC_PUSHER_CLUSTER', required: true },

  // Cloudinary
  { key: 'CLOUDINARY_CLOUD_NAME', required: true },
  { key: 'CLOUDINARY_API_KEY', required: true, secret: true },
  { key: 'CLOUDINARY_API_SECRET', required: true, secret: true },

  // Solana
  { key: 'NEXT_PUBLIC_SOLANA_RPC_URL', required: true },

  // CORS (required in production — must be set to real domain)
  { key: 'CORS_ORIGIN', required: true },

  // Telegram (notifications)
  { key: 'TELEGRAM_BOT_TOKEN', required: false, secret: true },
];

export function validateEnv(): { valid: boolean; missing: string[]; warnings: string[] } {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check database: need either DATABASE_URL or DB_HOST+DB_NAME+DB_USER
  const hasDbUrl = !!process.env.DATABASE_URL;
  const hasDbParts = !!process.env.DB_HOST && !!process.env.DB_NAME && !!process.env.DB_USER;
  if (!hasDbUrl && !hasDbParts) {
    if (isProduction) {
      missing.push('DATABASE_URL (or DB_HOST+DB_NAME+DB_USER)');
    } else {
      warnings.push('DATABASE_URL (or DB_HOST+DB_NAME+DB_USER)');
    }
  }

  for (const { key, required } of ENV_SCHEMA) {
    const value = process.env[key];
    if (!value || value.trim() === '') {
      if (required && isProduction) {
        missing.push(key);
      } else if (required) {
        warnings.push(key);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// SECURITY GUARDS — production startup gate
// ──────────────────────────────────────────────────────────────────────────
//
// A production deployment must have every legacy "downgrade" path closed.
// Past incidents: a staging-config bundle promoted to prod with
// LOGIN_NONCE_REQUIRED=false silently disabled replay protection. The
// nonce-required and wallet-strict branches have since been deleted from
// the code (see loginNonce.ts:251 / orders/[id]/action/route.ts:143), but
// the env vars persist in deployment templates. We assert them here so:
//
//   * The server REFUSES to start if NODE_ENV != 'production' on a host
//     that's supposed to be production (controlled by ENFORCE_PROD_SECURITY=true).
//   * The server REFUSES to start if any of the security guards are off.
//   * `/api/health/secure-config` reports the guard state for ops dashboards
//     so a misconfiguration is visible even if the crash mechanism is bypassed.
//
// Local dev (NODE_ENV=development, no ENFORCE_PROD_SECURITY) is exempt — the
// validator runs and warns, but does not crash.

export interface SecurityGuard {
  /** Env var name — what ops sets / clears. */
  key: string;
  /** Required value (case-sensitive). For presence-only checks, leave undefined. */
  expected?: string;
  /** Reason this guard exists — surfaces in startup logs and the healthcheck. */
  reason: string;
  /** Resolved-at-call-time actual value (no caching — env vars can change in tests). */
  actual?: string;
  /** True when this guard is satisfied. */
  ok?: boolean;
}

const SECURITY_GUARD_DEFINITIONS: ReadonlyArray<Pick<SecurityGuard, 'key' | 'expected' | 'reason'>> = [
  {
    key: 'NODE_ENV',
    expected: 'production',
    reason:
      'Many code paths gate cookie `secure` flags, log verbosity, dev-only routes, ' +
      'and TOTP test bypasses on NODE_ENV. Anything other than "production" leaves ' +
      'one of those open in a prod deployment.',
  },
  {
    key: 'LOGIN_NONCE_REQUIRED',
    expected: 'true',
    reason:
      'Wallet-signature replay protection. The legacy fallback that allowed ' +
      'signature-only auth (no nonce) has been deleted from the code, but ops ' +
      'templates still carry the var. Pin to "true" so a misconfig cannot ' +
      'silently re-enable the bypass if a future revert reintroduces it.',
  },
  {
    key: 'WALLET_OWNERSHIP_STRICT',
    expected: 'true',
    reason:
      'Order-action wallet ownership check. Same shape as LOGIN_NONCE_REQUIRED — ' +
      'the lax branch is gone from code, but the var must be pinned to "true" ' +
      'in prod templates so downgrades are caught at startup.',
  },
  {
    key: 'CORE_API_SECRET',
    // No expected value — presence-only.
    reason:
      'HMAC base secret for the settle → core-api proxy. Without it, settle ' +
      'cannot sign actor headers, so core-api refuses every mutation. Misconfig ' +
      'manifests as a global 503 — fail fast at startup instead.',
  },
];

/**
 * Vars that must NOT take a specific value in production. Distinct from the
 * "expected value" guards above — those check that a flag is set to its
 * required value; these check that a flag is *not* dangerous.
 *
 * NEXT_PUBLIC_MOCK_MODE is the canonical example: when set to 'true' the
 * client bundle ships with fake-balance rails and bypasses real-money
 * invariants. We refuse to start a prod process built with that flag.
 */
const SECURITY_FORBIDDEN_VALUES: ReadonlyArray<{
  key: string;
  forbiddenValue: string;
  reason: string;
}> = [
  {
    key: 'NEXT_PUBLIC_MOCK_MODE',
    forbiddenValue: 'true',
    reason:
      'Mock mode swaps real balances for fake ones in the client bundle. ' +
      'Setting this to "true" in production exposes fake-money rails to real ' +
      'users and would have disabled CSRF/rate-limit historically. Fail closed.',
  },
];

function checkForbiddenValues(): { failed: typeof SECURITY_FORBIDDEN_VALUES[number][]; } {
  const failed: typeof SECURITY_FORBIDDEN_VALUES[number][] = [];
  for (const f of SECURITY_FORBIDDEN_VALUES) {
    const actual = (process.env[f.key] ?? '').trim().toLowerCase();
    if (actual === f.forbiddenValue) failed.push(f);
  }
  return { failed };
}

function isProductionDeployment(): boolean {
  // Either NODE_ENV says so OR ops opted in explicitly. The override exists
  // so staging deployments can run with the same strictness as prod when
  // they're being treated as a release-rehearsal environment.
  if (process.env.NODE_ENV === 'production') return true;
  const override = process.env.ENFORCE_PROD_SECURITY?.trim().toLowerCase();
  return override === '1' || override === 'true' || override === 'yes';
}

/**
 * Resolve every guard against the current env. Pure — does not throw.
 * Used both at startup (where we then crash on failure) and from the
 * healthcheck endpoint (where we report status without crashing).
 */
export function resolveSecurityGuards(): {
  guards: SecurityGuard[];
  failed: SecurityGuard[];
  enforced: boolean;
} {
  const guards: SecurityGuard[] = SECURITY_GUARD_DEFINITIONS.map((g) => {
    const actual = process.env[g.key];
    const ok = g.expected === undefined
      ? typeof actual === 'string' && actual.trim().length > 0
      : actual === g.expected;
    return { ...g, actual, ok };
  });
  return {
    guards,
    failed: guards.filter((g) => !g.ok),
    enforced: isProductionDeployment(),
  };
}

function formatGuardFailure(g: SecurityGuard): string {
  const actualStr = g.actual === undefined ? '<unset>' : `'${g.actual}'`;
  if (g.expected === undefined) {
    return `${g.key} must be set (got ${actualStr})`;
  }
  return `${g.key} must equal '${g.expected}' (got ${actualStr})`;
}

// Auto-validate on import — crash in production if critical vars are missing.
// Skipped under Jest (JEST_WORKER_ID is set by every Jest worker) so tests can
// import this module to call the pure resolvers without triggering process.exit.
// Also skipped during `next build` page-data collection — runtime secrets aren't
// available at build time, only Docker ARGs / NEXT_PUBLIC_* are. Runtime fail-fast
// still happens because NEXT_PHASE is unset (or 'phase-production-server') at boot.
const _isJest = typeof process !== 'undefined' && !!process.env.JEST_WORKER_ID;
const _isBuildPhase =
  typeof process !== 'undefined' && process.env.NEXT_PHASE === 'phase-production-build';
const _envResult = validateEnv();
if (!_isJest && !_isBuildPhase && isProduction && !_envResult.valid) {
  const msg = `[env] FATAL: Missing required environment variables: ${_envResult.missing.join(', ')}`;
  console.error(msg);
  console.error('[env] Server cannot start without these.');
  // Crash server-side only (Edge/Node); on client this is a no-op
  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    process.exit(1);
  }
  throw new Error(msg);
} else if (_envResult.warnings.length > 0) {
  console.warn(
    `[env] Missing recommended variables: ${_envResult.warnings.join(', ')}`
  );
}

// Forbidden-value gate: refuse to start in production if any flag whose
// dangerous value is "do not set this in prod" has been set to that value.
// Runs BEFORE the standard guard gate so the operator sees the most specific
// failure first.
{
  const _forbiddenResult = checkForbiddenValues();
  if (!_isJest && !_isBuildPhase && isProductionDeployment() && _forbiddenResult.failed.length > 0) {
    console.error('[env] FATAL: forbidden production env values:');
    for (const f of _forbiddenResult.failed) {
      console.error(`  • ${f.key} must not be "${f.forbiddenValue}" in production`);
      console.error(`      reason: ${f.reason}`);
    }
    console.error('[env] Server refuses to start. Unset the flag or use a non-prod build.');
    if (typeof process !== 'undefined' && typeof process.exit === 'function') {
      process.exit(1);
    }
    throw new Error(
      `[env] FATAL: forbidden production env values: ${_forbiddenResult.failed.map((f) => f.key).join(', ')}`,
    );
  } else if (_forbiddenResult.failed.length > 0) {
    console.warn(
      `[env] Forbidden production env values present (dev mode — would crash in production):\n` +
        _forbiddenResult.failed.map((f) => `  • ${f.key}="${f.forbiddenValue}"`).join('\n'),
    );
  }
}

// Security-guard gate (separate from the missing-required-vars check above
// because the failure modes and the right ops response differ).
const _guardResult = resolveSecurityGuards();
if (!_isJest && !_isBuildPhase && _guardResult.enforced && _guardResult.failed.length > 0) {
  console.error('[env] FATAL: Security guards failed for production deployment:');
  for (const g of _guardResult.failed) {
    console.error(`  • ${formatGuardFailure(g)}`);
    console.error(`      reason: ${g.reason}`);
  }
  console.error(
    '[env] Server refuses to start in an insecure configuration. Fix the env vars and redeploy.\n' +
    '[env] To run intentionally in non-production mode, unset NODE_ENV=production AND ENFORCE_PROD_SECURITY.',
  );
  if (typeof process !== 'undefined' && typeof process.exit === 'function') {
    process.exit(1);
  }
  throw new Error(
    `[env] FATAL: security guards failed: ${_guardResult.failed.map((g) => g.key).join(', ')}`,
  );
} else if (_guardResult.failed.length > 0) {
  console.warn(
    `[env] Security guards not satisfied (dev mode — would crash in production):\n` +
      _guardResult.failed.map((g) => '  • ' + formatGuardFailure(g)).join('\n'),
  );
}
