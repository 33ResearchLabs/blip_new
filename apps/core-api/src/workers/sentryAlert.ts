/**
 * Sentry alerting helper (core-api) — dormant by default.
 *
 * core-api currently ships NO Sentry SDK. This helper is a best-effort,
 * fully-gated bridge so the worker health checker can page Sentry the moment
 * the project opts in, with ZERO impact until then:
 *
 *   - No top-level import of '@sentry/node' (uses a runtime variable specifier
 *     so the typecheck never requires the package to be installed).
 *   - No-op unless BOTH `@sentry/node` is installed AND SENTRY_DSN is set.
 *   - Initialises Sentry lazily on first alert, once, with tracing disabled.
 *   - Never throws.
 *
 * To activate later:  pnpm -C apps/core-api add @sentry/node  + set SENTRY_DSN.
 */

let initTried = false;
let sentry: { captureMessage?: (msg: string, opts?: unknown) => void } | null = null;

async function getSentry(): Promise<typeof sentry> {
  if (initTried) return sentry;
  initTried = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;

  try {
    // Variable specifier → not statically resolved by tsc, so the build does
    // not require @sentry/node to be present. Throws (caught) if uninstalled.
    const moduleName = '@sentry/node';
    const mod: any = await import(moduleName);
    if (typeof mod.init === 'function') {
      mod.init({ dsn, tracesSampleRate: 0 });
    }
    sentry = mod;
  } catch {
    sentry = null; // not installed / init failed → permanently no-op
  }
  return sentry;
}

/** Capture an error-level message in Sentry, if (and only if) Sentry is configured. */
export async function captureWorkerAlert(
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const s = await getSentry();
    if (!s?.captureMessage) return;
    s.captureMessage(message, { level: 'error', extra: context });
  } catch {
    /* alerting must never throw into the checker loop */
  }
}
