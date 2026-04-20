'use client';

/**
 * Global error boundary — minimal JSX shell with NO hooks, NO imports.
 *
 * Next.js 16 prerenders /_global-error at build time (even though it's
 * a client component). Anything in this file that touches React context
 * at module-load — including @sentry/nextjs, our clientLogger, or even
 * a useEffect that lazy-requires them — crashes the prerender pass with
 *   "Cannot read properties of null (reading 'useContext')".
 *
 * Error reporting still happens elsewhere:
 *   - `src/app/error.tsx` catches render-time errors inside the normal
 *     React tree and forwards to Sentry via @sentry/nextjs's
 *     auto-instrumentation.
 *   - The instrumentation hook in `src/instrumentation-node.ts` covers
 *     server-side crashes.
 * This file is the last-resort shell shown only when the root layout
 * itself has crashed, and at that point doing nothing beyond rendering
 * "Something went wrong" is the right behaviour.
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
