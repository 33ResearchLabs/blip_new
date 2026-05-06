/**
 * Sentry — Browser / Client runtime init
 *
 * Tuned for the free Developer tier:
 *   - 100% of error sessions recorded (replaysOnErrorSampleRate: 1.0)
 *   - 0% of normal sessions recorded (replaysSessionSampleRate: 0)
 *     → replay quota only spent on real bugs
 *   - 10% traces in production, 100% in dev
 *   - Disabled completely when NEXT_PUBLIC_SENTRY_DSN is unset
 *
 * Our existing `logClientError` in clientLogger.ts already forwards to
 * `window.Sentry.captureMessage` — so the settle error_logs table AND
 * Sentry both receive every structured client event.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

const SENSITIVE_KEY_PATTERN =
  /(token|secret|password|signature|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key|seed|mnemonic|nonce|otp|totp|refresh|session|x-actor-signature|x-core-api-secret|idempotency-key|x-csrf-token)/i;
const REDACT = '[REDACTED]';

function scrubObject(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((v) => scrubObject(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) out[k] = REDACT;
    else if (v && typeof v === 'object') out[k] = scrubObject(v, depth + 1);
    else out[k] = v;
  }
  return out;
}

function scrubHeaders(h: Record<string, unknown> | undefined) {
  if (!h) return h;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) out[k] = SENSITIVE_KEY_PATTERN.test(k) ? REDACT : v;
  return out;
}

Sentry.init({
  dsn: DSN,
  enabled: !!DSN,

  environment: process.env.NODE_ENV,

  // FAIL-CLOSED: do NOT attach IP, cookies, or user identifiers by default.
  // Mirrors server-side hardening — fintech UI shows balances + bank details.
  sendDefaultPii: false,

  // Trace sampling: 100% in dev for easy debugging, 10% in prod for cost control
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Session Replay sampling:
  //  - 0% of normal browsing sessions (saves your 50/mo quota)
  //  - 100% of sessions where an error fires (what you actually want to see)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Mask user-entered text AND inputs (financial UI shows balances /
      // wallet addresses / IBANs); block images/video.
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
  ],

  // Filter out known noise that burns quota without adding signal
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications.',
    'Non-Error promise rejection captured',
    // Our own logger already captures API failures with richer context
    'Failed to fetch',
    'Load failed',
    'NetworkError',
  ],

  beforeSend(event) {
    const url = event.request?.url || '';
    // Don't report errors from the dev-lock splash screen or the admin
    // error-logs dashboard itself (would create noise loops) — EXCEPT
    // explicit verification events tagged with `testId`, which the admin
    // deliberately fires to confirm the Sentry pipeline is alive.
    const isVerificationEvent = !!event.tags?.testId;
    if (!isVerificationEvent) {
      if (url.includes('/dev-lock')) return null;
      if (url.includes('/admin/error-logs')) return null;
    }
    try {
      if (event.request) {
        event.request.cookies = undefined;
        event.request.headers = scrubHeaders(
          event.request.headers as Record<string, unknown> | undefined,
        ) as Record<string, string> | undefined;
        if (event.request.data && typeof event.request.data === 'object') {
          event.request.data = scrubObject(event.request.data) as typeof event.request.data;
        }
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
      // never block error reporting on a scrubber bug — but better to send
      // nothing than a leaky payload, so on scrubber failure drop the event.
      return null;
    }
    return event;
  },

  beforeBreadcrumb(breadcrumb) {
    try {
      if (breadcrumb.data) {
        breadcrumb.data = scrubObject(breadcrumb.data) as typeof breadcrumb.data;
      }
    } catch {
      return null;
    }
    return breadcrumb;
  },

  initialScope: {
    tags: { app: 'blip-settle' },
  },
});

// Hook for Next.js App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
