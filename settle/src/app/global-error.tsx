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
import NextError from 'next/error';
import { useEffect } from 'react';
import { logClientError } from '@/lib/errorTracking/clientLogger';

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
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

  return (
    <html>
      <body>
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
