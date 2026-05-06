'use strict';

/**
 * Production security env-var gate.
 *
 * Refuses to boot in production unless every security-critical env flag is
 * set to its safe value. The code that USED to branch on these flags has
 * had its lax branches removed (LOGIN_NONCE_REQUIRED=false and
 * WALLET_OWNERSHIP_STRICT=false are no longer recognized by any runtime
 * code path). This gate is defense-in-depth:
 *
 *   - If a future PR reintroduces a `if (process.env.X === 'false') {...}`
 *     check, that regression cannot reach production because the boot
 *     fails before a request is served.
 *   - If a deploy is misconfigured (NODE_ENV unset → Next falls back to
 *     dev defaults; signing keys behave permissively; cookies lose
 *     `Secure` flag), the boot fails before traffic is taken.
 *
 * Plain CommonJS so server.js (which runs OUTSIDE Next's transpile) can
 * require it directly. A `.d.ts` shim provides types to TS consumers.
 *
 * Usage from server.js:
 *
 *   const { assertProductionSecurityEnv } = require('./src/lib/security/productionEnvGuard.js');
 *   const dev = process.env.NODE_ENV !== 'production';
 *   try {
 *     assertProductionSecurityEnv({ mode: dev ? 'warn' : 'enforce' });
 *   } catch (err) {
 *     console.error('Server boot aborted:', err.message);
 *     process.exit(1);
 *   }
 */

const REQUIRED_VARS = Object.freeze([
  Object.freeze({
    name: 'NODE_ENV',
    expected: 'production',
    reason: 'forces production-mode defaults across runtime (Secure cookies, dev-header rejection, build-time security flags)',
  }),
  Object.freeze({
    name: 'LOGIN_NONCE_REQUIRED',
    expected: 'true',
    reason: 'replay protection on wallet login — without it, a captured signature could be reused indefinitely',
  }),
  Object.freeze({
    name: 'WALLET_OWNERSHIP_STRICT',
    expected: 'true',
    reason: 'wallet-injection guard at order mutations — without it, an attacker can supply an arbitrary payout wallet',
  }),
]);

/**
 * Pure check — no side effects, no throws. Returns the list of variables
 * that don't match their expected value.
 */
function checkProductionSecurityEnv(env) {
  const e = env || process.env;
  const failures = [];
  for (const v of REQUIRED_VARS) {
    if (e[v.name] !== v.expected) {
      failures.push({
        name: v.name,
        expected: v.expected,
        actual: e[v.name] === undefined ? null : String(e[v.name]),
        reason: v.reason,
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

function formatFailures(failures) {
  return failures
    .map((f) => {
      const got = f.actual === null ? '<unset>' : `'${f.actual}'`;
      return `  - ${f.name}: expected '${f.expected}', got ${got}  (${f.reason})`;
    })
    .join('\n');
}

/**
 * Assert variant. In `enforce` mode, throws an Error tagged with code
 * `INSECURE_PRODUCTION_CONFIG`. In `warn` mode (intended for dev startups),
 * logs at warn level and returns the result without throwing.
 *
 * Operator escape hatch: `SKIP_PRODUCTION_ENV_CHECK=true`. Logs LOUDLY and
 * skips. Should never be used in real production — provided for smoke-test
 * scenarios where the security flags genuinely don't apply (e.g. running
 * the production build locally without Redis to reproduce a build issue).
 */
function assertProductionSecurityEnv(opts) {
  opts = opts || {};
  const mode = opts.mode || 'enforce';
  const log = opts.logger || console;
  const env = opts.env || process.env;

  if (env.SKIP_PRODUCTION_ENV_CHECK === 'true') {
    if (typeof log.warn === 'function') {
      log.warn(
        '[security][startup] SKIP_PRODUCTION_ENV_CHECK=true — production env validation BYPASSED. Never use this in a real production deploy.'
      );
    }
    return { ok: true, failures: [], skipped: true };
  }

  const result = checkProductionSecurityEnv(env);

  if (result.ok) {
    if (typeof log.info === 'function') {
      log.info('[security][startup] production security env: OK');
    }
    return result;
  }

  const summary =
    '[security][startup] INSECURE CONFIGURATION DETECTED — refusing to start:\n' +
    formatFailures(result.failures) +
    '\n\nSet the missing/incorrect variables, or set SKIP_PRODUCTION_ENV_CHECK=true to override (NEVER in real production).';

  if (mode === 'enforce') {
    if (typeof log.error === 'function') log.error(summary);
    const err = new Error(summary);
    err.code = 'INSECURE_PRODUCTION_CONFIG';
    err.failures = result.failures;
    throw err;
  }

  // warn mode — for non-production startups
  if (typeof log.warn === 'function') log.warn(summary);
  return result;
}

module.exports = {
  REQUIRED_VARS,
  checkProductionSecurityEnv,
  assertProductionSecurityEnv,
};
