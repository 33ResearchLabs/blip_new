'use client';

/**
 * Global error boundary — catches errors thrown from the root layout and
 * any React render error that escaped a more specific error.tsx boundary.
 *
 * IMPORTANT: Keep ALL imports lazy (require inside useEffect). Top-level
 * imports of @sentry/nextjs or our own clientLogger trip Next.js 16's
 * prerender pass of /_global-error with
 * "Cannot read properties of null (reading 'useContext')", because those
 * modules touch React context at module-load time. Pattern mirrors
 * `src/app/error.tsx`, which is the canonical minimal App-Router error
 * boundary that works with Next 16's static prerender.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled global error:', error);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nextjs');
      Sentry.captureException(error);
    } catch { /* Sentry not available — skip */ }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { logClientError } = require('@/lib/errorTracking/clientLogger');
      logClientError({
        type: 'ui.global_error_boundary',
        severity: 'CRITICAL',
        message: error.message || 'Global error boundary triggered',
        metadata: {
          name: error.name,
          digest: error.digest,
          stack: error.stack?.slice(0, 4000),
        },
      });
    } catch { /* swallow — logging must never cascade */ }
  }, [error]);

  // NOTE: plain HTML (no `next/error`) — Next.js 16 can't prerender
  // `next/error` inside an App-Router global-error.tsx. The prerender
  // pass trips on "Cannot read properties of null (reading 'useContext')"
  // because `next/error` is a Pages-Router component.
  return (
    <html lang="en">
      <body style={{
        fontFamily: 'system-ui, sans-serif',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: 0,
        background: '#0a0a0a',
        color: '#e5e5e5',
      }}>
        <div style={{ textAlign: 'center', padding: 32, maxWidth: 420 }}>
          <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ opacity: 0.7, margin: '0 0 24px' }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '10px 20px',
              fontSize: 14,
              borderRadius: 8,
              border: 'none',
              background: '#e5e5e5',
              color: '#0a0a0a',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
