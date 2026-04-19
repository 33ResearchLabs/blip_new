'use client';

/**
 * Global error boundary — catches errors thrown from the root layout and
 * any React render error that escaped a more specific error.tsx boundary.
 *
 * Forwards the error to both our own error_logs (via logClientError's
 * Sentry bridge) AND directly to Sentry for the rich stack+replay view.
 *
 * Must be a client component ('use client') per Next.js docs — the error
 * boundary has to rehydrate on the client.
 */

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { logClientError } from '@/lib/errorTracking/clientLogger';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capture to Sentry with a full stack trace
    Sentry.captureException(error);
    // Also record in our own error_logs so the admin dashboard has the row
    try {
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
    } catch { /* swallow */ }
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
