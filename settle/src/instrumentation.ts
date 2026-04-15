/**
 * Next.js instrumentation hook — runs once at server startup per runtime.
 *
 * Bundled for BOTH the Node.js runtime AND the Edge runtime (middleware,
 * edge routes). To keep Turbopack's static analysis happy, this file
 * intentionally avoids direct references to any Node-only API
 * (`process.on`, `pg`, etc.). All Node-only work lives in
 * ./instrumentation-node.ts and is dynamically imported ONLY when
 * NEXT_RUNTIME === "nodejs", so Turbopack can cleanly exclude that module
 * from the Edge bundle.
 */

export async function register() {
  // Validate required environment variables (exits process in production if missing)
  await import("@/lib/env");

  // Initialize Sentry for the runtime we're actually in. Each config file
  // calls Sentry.init() which is a no-op when SENTRY_DSN is unset.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    // Dynamic import — Turbopack keeps this out of the Edge bundle.
    const { installNodeProcessHandlers } = await import("./instrumentation-node");
    installNodeProcessHandlers();
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

/**
 * Next.js 15+ hook: invoked for every error thrown inside a request handler
 * BEFORE Next.js returns its default 500. Runs in both runtimes.
 *
 * Docs: https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation#onrequesterror-optional
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
  // 1) Forward to Sentry (works in both Node and Edge)
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(
      err,
      request as unknown as Parameters<typeof Sentry.captureRequestError>[1],
      context as unknown as Parameters<typeof Sentry.captureRequestError>[2],
    );
  } catch { /* swallow — Sentry never blocks */ }

  // 2) Write to error_logs (Node runtime only — the logger uses `pg`).
  //    Dynamic import so Turbopack excludes this from the Edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { logRouteExceptionToErrorLogs } = await import("./instrumentation-node");
      await logRouteExceptionToErrorLogs(err, request, context);
    } catch { /* swallow */ }
  }
}
