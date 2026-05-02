/**
 * Secure-config healthcheck.
 *
 * GET /api/health/secure-config
 *
 * Reports the state of every production security guard. Designed for ops
 * dashboards / uptime checks / manual auditing — operators can curl this
 * during/after a deploy to confirm no guard is in a downgraded state.
 *
 * Response:
 *   { secure: boolean, enforced: boolean, guards: [{ key, ok, ... }] }
 *
 * Status codes:
 *   200 — all guards satisfied (independent of `enforced`)
 *   503 — at least one guard failed AND we're in an enforced environment
 *         (i.e. production OR ENFORCE_PROD_SECURITY=true)
 *   200 — at least one guard failed but we're in dev (still useful info)
 *
 * Security note: response intentionally does NOT echo `actual` values for
 * presence-only guards (e.g. CORE_API_SECRET) — only `ok`. Comparison-only
 * guards leak the bad value because that's what ops needs to see to fix it
 * (e.g. `LOGIN_NONCE_REQUIRED='false'` is exactly what they need to know).
 * Secret values are never echoed.
 */

import { NextResponse } from 'next/server';
import { resolveSecurityGuards } from '@/lib/env';

// Keys whose value MUST NEVER appear in the response. Even though the
// healthcheck is server-only, we guard against an ops mistake (exposing
// it via a reverse-proxy alias) leaking the literal secret.
const NEVER_ECHO_VALUE = new Set<string>(['CORE_API_SECRET']);

export async function GET() {
  const { guards, failed, enforced } = resolveSecurityGuards();

  const sanitized = guards.map((g) => ({
    key: g.key,
    ok: g.ok,
    expected: g.expected ?? '<set>',
    actual: NEVER_ECHO_VALUE.has(g.key)
      ? (g.actual ? '<set>' : '<unset>')
      : (g.actual ?? '<unset>'),
    reason: g.reason,
  }));

  const secure = failed.length === 0;
  const body = {
    secure,
    enforced,
    failedCount: failed.length,
    guards: sanitized,
  };

  // 503 only when failures occur in an enforced environment — in dev we
  // return 200 so monitoring doesn't page on every laptop.
  const status = !secure && enforced ? 503 : 200;
  return NextResponse.json(body, { status });
}
