/**
 * Sentry — Edge runtime init
 *
 * Used by Next.js middleware and edge route handlers. Fewer features than
 * the Node config because the Edge runtime doesn't support most Node APIs.
 *
 * Hardened defaults — middleware sees every request including the auth
 * cookie + Bearer tokens + x-merchant-id headers, so an unscrubbed payload
 * here ships those secrets to Sentry on any thrown middleware error.
 *
 *   - sendDefaultPii: false   — no IP / cookies / user identifiers
 *   - beforeSend scrubs headers, query strings, and known sensitive keys
 *     before any payload leaves the process.
 */

import * as Sentry from '@sentry/nextjs';
import type { ErrorEvent, EventHint } from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|signature|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key|seed|mnemonic|nonce|otp|totp|refresh|session|x-actor-signature|x-core-api-secret|idempotency-key|x-csrf-token)/i;

const REDACT = '[REDACTED]';

function scrubHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== 'object') return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACT : v;
  }
  return out;
}

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = REDACT;
    } else if (v && typeof v === 'object') {
      out[k] = scrubObject(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

Sentry.init({
  dsn: DSN,
  enabled: !!DSN,

  environment: process.env.NODE_ENV,

  // FAIL-CLOSED: do NOT attach IP, cookies, or user identifiers. Middleware
  // sees auth cookies + Bearer tokens on every request — those must never
  // ship to Sentry by default.
  sendDefaultPii: false,

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  initialScope: {
    tags: { app: 'blip-settle', runtime: 'edge' },
  },

  beforeSend(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
    try {
      if (event.request) {
        event.request.cookies = undefined;
        event.request.headers = scrubHeaders(event.request.headers as Record<string, unknown> | undefined) as
          | Record<string, string>
          | undefined;
        if (event.request.data && typeof event.request.data === 'object') {
          event.request.data = scrubObject(event.request.data) as typeof event.request.data;
        }
        // Strip token-bearing query params — older clients sometimes used ?token=...
        if (typeof event.request.query_string === 'string') {
          event.request.query_string = event.request.query_string.replace(
            /([?&])(token|access_token|auth|signature|key)=[^&]*/gi,
            '$1$2=[REDACTED]',
          );
        }
      }
      if (event.user) {
        event.user.ip_address = undefined;
        event.user.email = undefined;
      }
      if (event.extra) event.extra = scrubObject(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrubObject(event.contexts) as typeof event.contexts;
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((b) => ({
          ...b,
          data: scrubObject(b.data) as typeof b.data,
        }));
      }
    } catch {
      // Never block error reporting on a scrubber bug — but better to send
      // nothing than a leaky payload, so on scrubber failure drop the event.
      return null;
    }
    return event;
  },
});
