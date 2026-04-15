/**
 * Sentry — Node.js server runtime init
 *
 * Captures unhandled exceptions from route handlers, server components,
 * server actions, and the process itself. Works alongside our own
 * error_logs table — both receive every error.
 */

import * as Sentry from '@sentry/nextjs';

const DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  enabled: !!DSN,

  environment: process.env.NODE_ENV,

  // Attach IP, headers, request body — helpful for debugging real user flows
  sendDefaultPii: true,

  // Attach local variable values to stack frames (server only)
  includeLocalVariables: true,

  tracesSampleRate: process.env.NODE_ENV === 'development' ? 1.0 : 0.1,

  ignoreErrors: [
    // Expected auth flow — not a real error
    'NEXT_REDIRECT',
  ],

  initialScope: {
    tags: { app: 'blip-settle', runtime: 'nodejs' },
  },
});
