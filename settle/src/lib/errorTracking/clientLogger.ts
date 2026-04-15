/**
 * Client-side error logger.
 *
 * Non-critical areas ONLY — DO NOT wrap core order execution paths.
 *
 * USAGE:
 *   import { logClientError } from '@/lib/errorTracking/clientLogger';
 *   logClientError({ type: 'ui.api_fail', message: '...', orderId, userId });
 *
 * SAFETY:
 *   - Fires POST /api/client-errors with keepalive:true so it survives page unload
 *   - Never throws; returns void
 *   - Silently no-ops if NEXT_PUBLIC_ENABLE_ERROR_TRACKING !== "true"
 *   - Respects a client-side rate cap (50 logs / minute) to prevent
 *     pathological loops (e.g. broken component re-renders) from flooding
 *     the server
 *
 * SENTRY (optional):
 *   If Sentry is initialized in your app shell, logClientError also
 *   forwards to Sentry.captureMessage — integration is a best-effort
 *   dynamic import so the logger works with or without Sentry installed.
 */

export interface ClientErrorPayload {
  type: string;
  message: string;
  orderId?: string | null;
  userId?: string | null;
  merchantId?: string | null;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  metadata?: Record<string, unknown>;
}

const CLIENT_TRACKING_ENABLED =
  (process.env.NEXT_PUBLIC_ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true';

// ── Client-side rate limiter ─────────────────────────────────────────
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 50;
const timestamps: number[] = [];

function rateLimited(): boolean {
  const now = Date.now();
  while (timestamps.length > 0 && now - timestamps[0] > WINDOW_MS) {
    timestamps.shift();
  }
  if (timestamps.length >= MAX_PER_WINDOW) return true;
  timestamps.push(now);
  return false;
}

export function logClientError(payload: ClientErrorPayload): void {
  if (!CLIENT_TRACKING_ENABLED) return;
  if (typeof window === 'undefined') return; // server-rendered — skip
  if (rateLimited()) return;

  try {
    const body = JSON.stringify({
      type: String(payload.type || 'client.unknown').slice(0, 100),
      message: String(payload.message || '').slice(0, 2000),
      severity: payload.severity || 'ERROR',
      orderId: payload.orderId || null,
      userId: payload.userId || null,
      merchantId: payload.merchantId || null,
      source: 'frontend',
      metadata: {
        ...(payload.metadata || {}),
        url: window.location.href,
        userAgent: navigator.userAgent,
      },
    });

    // keepalive lets the beacon survive page unload, which is exactly
    // when a lot of frontend errors happen.
    fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {
      /* swallow — logging is best-effort */
    });
  } catch {
    /* swallow — a failing logger must never break the page */
  }

  // Optional Sentry bridge — only runs if Sentry is present
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sentry = (window as any).Sentry;
    if (sentry && typeof sentry.captureMessage === 'function') {
      sentry.captureMessage(payload.message, {
        level: (payload.severity || 'error').toLowerCase(),
        tags: {
          errorType: payload.type,
          orderId: payload.orderId || undefined,
          userId: payload.userId || undefined,
        },
        extra: payload.metadata,
      });
    }
  } catch {
    /* swallow */
  }
}

/**
 * Install lightweight global hooks to catch page-level errors + unhandled
 * promise rejections. Call once from the app shell. Safe to call multiple
 * times — uses a guard flag to avoid double-wiring.
 */
let globalHandlersInstalled = false;
export function installGlobalClientErrorHandlers(getUserContext?: () => {
  userId?: string | null;
  merchantId?: string | null;
}): void {
  if (!CLIENT_TRACKING_ENABLED) return;
  if (typeof window === 'undefined') return;
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  window.addEventListener('error', (event) => {
    const ctx = (() => {
      try { return getUserContext ? getUserContext() : {}; } catch { return {}; }
    })();
    logClientError({
      type: 'ui.window_error',
      severity: 'ERROR',
      message: event.message || 'Uncaught error',
      userId: ctx.userId || null,
      merchantId: ctx.merchantId || null,
      metadata: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack,
      },
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const ctx = (() => {
      try { return getUserContext ? getUserContext() : {}; } catch { return {}; }
    })();
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === 'string'
          ? reason
          : 'Unhandled promise rejection';
    logClientError({
      type: 'ui.unhandled_rejection',
      severity: 'ERROR',
      message,
      userId: ctx.userId || null,
      merchantId: ctx.merchantId || null,
      metadata: {
        stack: reason instanceof Error ? reason.stack : undefined,
      },
    });
  });
}
