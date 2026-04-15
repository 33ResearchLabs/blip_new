/**
 * Next.js instrumentation hook for blipscan-web.
 *
 * Captures:
 *   - Unhandled exceptions from any API route (onRequestError)
 *   - Process-level unhandled rejections + uncaught exceptions
 *
 * Writes to the shared `error_logs` table via the local errorTracking
 * module. Feature-gated via ENABLE_ERROR_TRACKING — zero cost when off.
 */

export async function register() {
  if (typeof process === 'undefined' || !process.on) return;
  if ((globalThis as Record<string, unknown>).__blipscanWebGlobalsInstalled) return;
  (globalThis as Record<string, unknown>).__blipscanWebGlobalsInstalled = true;

  process.on('unhandledRejection', (reason) => {
    void (async () => {
      try {
        const { safeLog } = await import('./app/lib/errorTracking');
        const e = reason as { message?: string; stack?: string; name?: string };
        safeLog({
          type: 'process.unhandled_rejection',
          severity: 'ERROR',
          message: `[blipscan-web] Unhandled rejection: ${e?.message || String(reason)}`,
          metadata: {
            service: 'blipscan-web',
            errorName: e?.name,
            stack: e?.stack?.slice(0, 4000),
          },
        });
      } catch { /* swallow */ }
    })();
  });

  process.on('uncaughtException', (err) => {
    void (async () => {
      try {
        const { safeLog } = await import('./app/lib/errorTracking');
        safeLog({
          type: 'process.uncaught_exception',
          severity: 'CRITICAL',
          message: `[blipscan-web] Uncaught exception: ${err.message}`,
          metadata: {
            service: 'blipscan-web',
            errorName: err.name,
            stack: err.stack?.slice(0, 4000),
          },
        });
      } catch { /* swallow */ }
    })();
  });
}

/**
 * Fires for every unhandled exception inside a route handler before
 * Next.js returns its default 500. We observe, we don't alter the response.
 */
export async function onRequestError(
  err: unknown,
  request: {
    path?: string;
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
  },
  context: {
    routerKind?: string;
    routePath?: string;
    routeType?: string;
  },
) {
  try {
    const { safeLog } = await import('./app/lib/errorTracking');
    const e = err as { name?: string; message?: string; stack?: string };
    safeLog({
      type: `blipscan.api_exception${context.routePath ? '.' + context.routePath.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) : ''}`,
      severity: 'ERROR',
      message: `[blipscan-web] Unhandled exception in ${request.method || '?'} ${request.path || context.routePath || '?'}: ${e?.message || String(err)}`,
      metadata: {
        service: 'blipscan-web',
        route: context.routePath,
        method: request.method,
        path: request.path,
        errorName: e?.name,
        stack: e?.stack?.slice(0, 4000),
      },
    });
  } catch { /* swallow — never block the response */ }
}
