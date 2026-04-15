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

Sentry.init({
  dsn: DSN,
  enabled: !!DSN,

  environment: process.env.NODE_ENV,

  // Attach IP, headers, request body — helpful for debugging real user flows
  sendDefaultPii: true,

  // Trace sampling: 100% in dev for easy debugging, 10% in prod for cost control
  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  // Session Replay sampling:
  //  - 0% of normal browsing sessions (saves your 50/mo quota)
  //  - 100% of sessions where an error fires (what you actually want to see)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      // Mask user-entered text and inputs for privacy; block images/video.
      maskAllText: false,
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
    return event;
  },

  initialScope: {
    tags: { app: 'blip-settle' },
  },
});

// Hook for Next.js App Router navigation transitions
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
