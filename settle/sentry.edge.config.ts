/**
 * Sentry — Edge runtime init
 *
 * Used by Next.js middleware and edge route handlers. Fewer features than
 * the Node config because the Edge runtime doesn't support most Node APIs.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  enabled: !!DSN,

  environment: process.env.NODE_ENV,

  sendDefaultPii: true,

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  initialScope: {
    tags: { app: 'blip-settle', runtime: 'edge' },
  },
});
