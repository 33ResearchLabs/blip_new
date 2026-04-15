/**
 * Node-runtime-only part of instrumentation.
 *
 * This file is dynamically imported from instrumentation.ts ONLY when
 * NEXT_RUNTIME === "nodejs". Keeping it in a separate module lets
 * Turbopack statically exclude it from the Edge bundle — so references to
 * `process.on`, `pg`, etc. can never leak into the Edge runtime.
 *
 * Rule of thumb: if it touches Node-only APIs, it goes here.
 */

export function installNodeProcessHandlers(): void {
  if (!process.on) return;
  if ((globalThis as Record<string, unknown>).__errorTrackingGlobalsInstalled) return;
  (globalThis as Record<string, unknown>).__errorTrackingGlobalsInstalled = true;

  process.on("unhandledRejection", (reason) => {
    void (async () => {
      try {
        const { safeLog } = await import("@/lib/errorTracking/logger");
        const err = reason as { message?: string; stack?: string; name?: string };
        safeLog({
          type: "process.unhandled_rejection",
          severity: "ERROR",
          message: `Unhandled promise rejection: ${err?.message || String(reason)}`,
          source: "backend",
          metadata: {
            errorName: err?.name,
            stack: err?.stack?.slice(0, 4000),
          },
        });
      } catch { /* swallow */ }
    })();
  });

  process.on("uncaughtException", (err) => {
    // Skip client-aborted HTTP requests — these are normal browser behavior
    // when the user closes a tab/navigates mid-request. Node fires `aborted`
    // on the socket; it bubbles up here as a non-actionable noise event.
    // The stack trace contains `abortIncoming` from `node:_http_server`.
    const stack = err.stack || '';
    const isClientAbort =
      err.message === 'aborted' &&
      (stack.includes('abortIncoming') || stack.includes('socketOnClose'));
    if (isClientAbort) return;

    void (async () => {
      try {
        const { safeLog } = await import("@/lib/errorTracking/logger");
        safeLog({
          type: "process.uncaught_exception",
          severity: "CRITICAL",
          message: `Uncaught exception: ${err.message}`,
          source: "backend",
          metadata: {
            errorName: err.name,
            stack: err.stack?.slice(0, 4000),
          },
        });
      } catch { /* swallow */ }
    })();
    // IMPORTANT: we do NOT call process.exit here. Next.js's own handler
    // decides whether to continue or crash. We're only adding observability.
  });
}

export async function logRouteExceptionToErrorLogs(
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
): Promise<void> {
  try {
    const { safeLog } = await import("@/lib/errorTracking/logger");
    const e = err as { name?: string; message?: string; stack?: string };
    safeLog({
      type: `api.unhandled_exception${context.routePath ? "." + context.routePath.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) : ""}`,
      severity: "ERROR",
      message: `Unhandled exception in ${request.method || "?"} ${request.path || context.routePath || "?"}: ${e?.message || String(err)}`,
      source: "backend",
      metadata: {
        route: context.routePath,
        routeKind: context.routerKind,
        routeType: context.routeType,
        method: request.method,
        path: request.path,
        errorName: e?.name,
        stack: e?.stack?.slice(0, 4000),
        userAgent:
          typeof request.headers?.["user-agent"] === "string"
            ? request.headers["user-agent"]
            : undefined,
      },
    });
  } catch { /* swallow — never block the response */ }
}
