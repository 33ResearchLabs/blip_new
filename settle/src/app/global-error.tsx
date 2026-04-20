'use client';

/**
 * Global error boundary — must be a minimal client component with no
 * hooks, no imports touching React context, no side-effect modules.
 * Next.js 16 prerenders /_global-error at build time; anything that
 * looks at React.useContext during module-load crashes the pass with
 *   "Cannot read properties of null (reading 'useContext')".
 *
 * Error reporting to Sentry and our own error_logs still happens —
 * just not from this file. The root `error.tsx` boundary captures
 * render-time errors inside the normal React tree and forwards them
 * via @sentry/nextjs's auto-instrumentation. This file is the LAST
 * resort shell for when even the root layout crashes, and it
 * deliberately does nothing except render a fallback.
 */

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          background: '#0a0a0a',
          color: '#e5e5e5',
        }}
      >
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
