'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error:', error);
    // Report to Sentry if available
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/nextjs');
      Sentry.captureException(error);
    } catch {
      // Sentry not installed — skip
    }
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#0a0a0a',
      color: '#e5e5e5',
    }}>
      <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Something went wrong</h2>
      <p style={{ color: '#999', marginBottom: '2rem', textAlign: 'center', maxWidth: '400px' }}>
        An unexpected error occurred. Please try again.
      </p>
      <button
        onClick={reset}
        style={{
          padding: '0.75rem 2rem',
          borderRadius: '8px',
          border: 'none',
          background: '#2563eb',
          color: 'white',
          fontSize: '1rem',
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}
