/**
 * Centralized server-side error tracking logger.
 *
 * DESIGN CONSTRAINTS:
 *  - Purely additive — never modifies business state or existing DB rows
 *  - Gated by ENABLE_ERROR_TRACKING — zero work when disabled
 *  - Fully async, never awaited by callers (fire-and-forget by default)
 *  - All errors inside the logger are swallowed — logging MUST NOT cascade
 *    into the caller's code path
 *
 * Callers should import `logServerError` and pass a payload. The returned
 * promise resolves when the insert completes — but callers should never
 * `await` it on a critical path. Use `void logServerError(...)` or the
 * `safeLog(...)` helper which wraps in try/catch for maximum safety.
 */

import { query } from '@/lib/db';
import {
  ERROR_TRACKING_ENABLED,
  ERROR_TRACKING_REALTIME_ENABLED,
} from './featureFlag';

export type ErrorSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type ErrorSource = 'backend' | 'frontend' | 'worker';

export interface ErrorLogPayload {
  /** Short machine-readable classification, e.g. "api.500", "order.stuck" */
  type: string;
  /** Human-readable summary (will be truncated to 2000 chars) */
  message: string;
  severity?: ErrorSeverity;
  orderId?: string | null;
  userId?: string | null;
  merchantId?: string | null;
  source?: ErrorSource;
  /** Any extra structured context (stack, url, headers, etc.) */
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_METADATA_BYTES = 32 * 1024; // 32KB cap — prevents blowout

function normalizeSeverity(s: string | undefined): ErrorSeverity {
  if (s === 'INFO' || s === 'WARN' || s === 'ERROR' || s === 'CRITICAL') return s;
  return 'ERROR';
}

function normalizeSource(s: string | undefined): ErrorSource {
  if (s === 'frontend' || s === 'backend' || s === 'worker') return s;
  return 'backend';
}

function safeTruncate(str: string, max: number): string {
  if (typeof str !== 'string') return String(str ?? '');
  return str.length > max ? str.slice(0, max) : str;
}

function safeJsonb(obj: unknown): Record<string, unknown> {
  if (!obj || typeof obj !== 'object') return {};
  try {
    const serialized = JSON.stringify(obj);
    if (serialized.length > MAX_METADATA_BYTES) {
      return { __truncated: true, preview: serialized.slice(0, MAX_METADATA_BYTES) };
    }
    return JSON.parse(serialized);
  } catch {
    return { __unserializable: true };
  }
}

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

/**
 * Insert a single error log row. Swallows all errors internally — callers
 * can safely fire-and-forget without try/catch on the happy path.
 *
 * When ENABLE_ERROR_TRACKING is false, this is a no-op that returns
 * immediately with zero DB or network activity.
 */
export async function logServerError(payload: ErrorLogPayload): Promise<void> {
  if (!ERROR_TRACKING_ENABLED) return;

  try {
    const severity = normalizeSeverity(payload.severity);
    const source = normalizeSource(payload.source);
    const type = safeTruncate(String(payload.type || 'unknown'), 100);
    const message = safeTruncate(String(payload.message || ''), MAX_MESSAGE_LEN);
    const orderId = isUuid(payload.orderId) ? payload.orderId : null;
    const userId = isUuid(payload.userId) ? payload.userId : null;
    const merchantId = isUuid(payload.merchantId) ? payload.merchantId : null;
    const metadata = safeJsonb(payload.metadata);

    await query(
      `INSERT INTO error_logs (type, message, severity, order_id, user_id, merchant_id, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [type, message, severity, orderId, userId, merchantId, source, metadata]
    );

    // Optional real-time broadcast (off by default).
    // Lazy-import the emitter so the logger has zero cost when realtime is disabled.
    if (ERROR_TRACKING_REALTIME_ENABLED) {
      try {
        const { emitNewErrorLog } = await import('./realtime');
        void emitNewErrorLog({ type, message, severity, orderId, userId, merchantId, source, metadata });
      } catch {
        /* swallow — realtime is optional and must never block */
      }
    }
  } catch (err) {
    // Last-resort: log to stderr so the event isn't completely lost in dev.
    // Never throw.
    try {
      // eslint-disable-next-line no-console
      console.error('[errorTracking] failed to insert log', err, {
        type: payload.type,
        severity: payload.severity,
      });
    } catch {
      /* even console.error can theoretically throw — swallow */
    }
  }
}

/**
 * Sync wrapper for callers that don't want to deal with the promise at all.
 * Always fire-and-forget. Errors are swallowed at two layers (here + in
 * logServerError itself) to guarantee cascading safety.
 */
export function safeLog(payload: ErrorLogPayload): void {
  try {
    void logServerError(payload);
  } catch {
    /* swallow */
  }
}
