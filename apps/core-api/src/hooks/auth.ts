/**
 * Core API Auth Hook
 *
 * Validates x-core-api-secret header on all requests except /health and /debug.
 *
 * When actor identity headers are present, verifies the HMAC-SHA256 signature.
 * Production REQUIRES the timestamp-bound format. Legacy is dev-only.
 *
 *   Required (timestamp-bound):
 *     payload   = `${actorType}:${actorId}:${unixSeconds}`
 *     headers   = x-actor-type, x-actor-id, x-actor-timestamp, x-actor-signature
 *     verifier  = (re)compute HMAC; reject if |now - ts| > CORE_API_TS_SKEW_SEC
 *
 *   Legacy (no timestamp — replayable indefinitely if secret ever leaks):
 *     payload   = `${actorType}:${actorId}`
 *     headers   = x-actor-type, x-actor-id, x-actor-signature
 *     ACCEPTED ONLY in non-production WITH `CORE_API_STRICT_AUTH != 'true'`.
 *
 * Strict-mode resolution (`isStrictMode()`):
 *   - production           → ALWAYS strict (legacy rejected with 401), regardless of env var
 *   - non-production unset → not strict (warn-and-accept, for dev rollouts)
 *   - explicit 'true'      → strict everywhere
 *   - explicit 'false'/'0' → not strict (only honored outside production)
 *
 * `assertStrictAuthInProduction()` is exported so the startup wiring in
 * index.ts can refuse to boot when CORE_API_STRICT_AUTH is explicitly set
 * to a non-true value in production — making the configuration choice
 * visible in the deploy logs even though the runtime would already be safe.
 *
 * If CORE_API_SECRET is unset, auth is disabled (local dev only — refused
 * in production by the existing FATAL guard).
 */
import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TS_SKEW_SEC = 60;

function parseSkewSec(): number {
  const raw = process.env.CORE_API_TS_SKEW_SEC;
  if (!raw) return DEFAULT_TS_SKEW_SEC;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TS_SKEW_SEC;
}

function envBool(raw: string | undefined): 'true' | 'false' | 'unset' {
  if (!raw) return 'unset';
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') return 'true';
  if (v === '0' || v === 'false' || v === 'no') return 'false';
  return 'unset';
}

/**
 * Production is ALWAYS strict — the env var can only relax the policy in
 * non-production. This is the secure-by-default behaviour: no operator
 * action is required to harden prod, and removing CORE_API_STRICT_AUTH
 * from a deploy template cannot silently re-enable the legacy path.
 */
function isStrictMode(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  return envBool(process.env.CORE_API_STRICT_AUTH) === 'true';
}

/**
 * Startup-time guard. Throws if production has CORE_API_STRICT_AUTH set to
 * something explicitly non-true. The runtime would still enforce strict
 * mode (see isStrictMode), but a deploy that ships with the var disabled
 * is a configuration mistake we want to crash on so it's noticed.
 *
 * Also rejects placeholder / development secrets in any environment — the
 * dev-default value MUST never reach a deployed instance because it's
 * (a) committed to multiple .env.example files and (b) a known string
 * that any attacker could enumerate. Production is fail-closed; staging
 * and dev should also fail-closed when an operator forgets to set a
 * unique secret.
 */
export function assertStrictAuthInProduction(): void {
  // Refuse known-weak / placeholder secrets EVERYWHERE. The list is the
  // intersection of (a) values shipped in repo .env / .env.example files
  // and (b) trivial defaults a dev might type. These should never be
  // accepted by a running service — even in dev — so a forgotten value
  // doesn't quietly become production policy on first deploy.
  const FORBIDDEN_SECRETS = new Set<string>([
    'local-dev-secret',
    'your_core_api_secret',
    'change-me',
    'changeme',
    'changeme-in-production',
    'dev',
    'development',
    'secret',
    'password',
    '',
  ]);
  const secret = (process.env.CORE_API_SECRET || '').trim();
  if (process.env.NODE_ENV === 'production' && secret.length === 0) {
    throw new Error(
      '[Auth] FATAL: CORE_API_SECRET is required in production.',
    );
  }
  if (secret.length > 0 && FORBIDDEN_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      `[Auth] FATAL: CORE_API_SECRET appears to be a placeholder ("${secret}"). ` +
      'Generate a unique secret (e.g. `openssl rand -hex 32`) and set it ' +
      'in the runtime environment before starting the service.',
    );
  }
  if (secret.length > 0 && secret.length < 32 && process.env.NODE_ENV === 'production') {
    throw new Error(
      '[Auth] FATAL: CORE_API_SECRET is too short for production ' +
      `(got ${secret.length} chars, need ≥32). Use \`openssl rand -hex 32\`.`,
    );
  }

  if (process.env.NODE_ENV !== 'production') return;
  const v = envBool(process.env.CORE_API_STRICT_AUTH);
  // 'unset' is fine — production defaults to strict.
  // 'true' is what we want.
  // 'false' is the misconfiguration we want to block.
  if (v === 'false') {
    throw new Error(
      '[Auth] FATAL: CORE_API_STRICT_AUTH must be unset or "true" in production. ' +
      'Refusing to start with legacy actor signatures explicitly enabled.',
    );
  }
}

function safeEqualHex(expected: string, provided: string): boolean {
  // Length-equal hex strings only; timingSafeEqual throws on length mismatch.
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Install the auth `onRequest` hook directly on the root Fastify instance.
 *
 * IMPORTANT: previously this was a `FastifyPluginAsync` registered via
 * `fastify.register(authHook)`. Fastify wraps every `register()` call in an
 * encapsulation context — hooks added inside that scope apply ONLY to the
 * plugin's children, NOT to siblings on the parent. Because routes were
 * registered as separate siblings (`fastify.register(orderRoutes, { prefix:
 * '/v1' })` after `fastify.register(authHook)`), the hook NEVER ran on any
 * protected route. The CORE_API_SECRET check was effectively disabled.
 *
 * Calling `addHook` on the root instance directly avoids encapsulation and
 * makes the hook fire on every route registered at any depth.
 */
export function installAuthHook(fastify: FastifyInstance): void {
  const secret = process.env.CORE_API_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      fastify.log.error('[Auth] FATAL: CORE_API_SECRET not set in production — refusing to start without auth');
      throw new Error('CORE_API_SECRET is required in production');
    }
    fastify.log.warn('[Auth] CORE_API_SECRET not set -- auth disabled (dev only)');
    return;
  }

  const skewSec = parseSkewSec();

  fastify.addHook('onRequest', async (request, reply) => {
    // Health + debug endpoints are always public (debug has own NODE_ENV guard)
    if (request.url === '/health' || request.url.startsWith('/debug')) return;

    // 1. Verify shared secret
    const provided = request.headers['x-core-api-secret'];
    if (provided !== secret) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: invalid or missing x-core-api-secret',
      });
    }

    // 2. Verify HMAC-signed actor headers (if present)
    const actorType = request.headers['x-actor-type'] as string | undefined;
    const actorId = request.headers['x-actor-id'] as string | undefined;
    const actorSignature = request.headers['x-actor-signature'] as string | undefined;
    const actorTimestamp = request.headers['x-actor-timestamp'] as string | undefined;

    if (!actorType || !actorId) return;

    if (!actorSignature) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: missing actor signature',
      });
    }

    // ── New, timestamp-bound format ────────────────────────────────────
    if (actorTimestamp !== undefined) {
      const ts = parseInt(actorTimestamp, 10);
      if (!Number.isFinite(ts) || ts <= 0) {
        return reply.status(401).send({
          success: false,
          error: 'Unauthorized: malformed actor timestamp',
        });
      }

      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - ts) > skewSec) {
        fastify.log.warn(
          { actorType, actorId, ts, now, skewSec, url: request.url },
          '[Auth] Actor timestamp outside skew window — rejecting',
        );
        return reply.status(401).send({
          success: false,
          error: 'Unauthorized: actor timestamp expired or in future',
        });
      }

      const expected = createHmac('sha256', secret)
        .update(`${actorType}:${actorId}:${ts}`)
        .digest('hex');
      if (!safeEqualHex(expected, actorSignature)) {
        return reply.status(401).send({
          success: false,
          error: 'Unauthorized: invalid actor signature',
        });
      }
      return; // pass — new format verified
    }

    // ── Legacy format (no timestamp) ───────────────────────────────────
    if (isStrictMode()) {
      fastify.log.warn(
        { actorType, actorId, url: request.url },
        '[Auth] Strict mode: legacy signature rejected (missing x-actor-timestamp)',
      );
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: legacy signature format no longer accepted',
      });
    }

    // Once-per-request deprecation log so we can confirm zero legacy callers
    // before flipping CORE_API_STRICT_AUTH.
    fastify.log.warn(
      { actorType, actorId, url: request.url },
      '[Auth] Legacy actor signature accepted — caller must include x-actor-timestamp',
    );

    const expectedLegacy = createHmac('sha256', secret)
      .update(`${actorType}:${actorId}`)
      .digest('hex');
    if (!safeEqualHex(expectedLegacy, actorSignature)) {
      return reply.status(401).send({
        success: false,
        error: 'Unauthorized: invalid actor signature',
      });
    }
    // pass — legacy format verified
  });
}
