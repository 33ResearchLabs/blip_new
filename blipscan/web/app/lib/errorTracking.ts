/**
 * Error tracking for the Blipscan web (Next.js explorer).
 *
 * Writes to the shared `error_logs` table in the same database the app
 * is already reading from. Feature-gated via ENABLE_ERROR_TRACKING.
 *
 * Purely additive — no other file's behavior changes.
 */

import { pool } from './db';

export type ErrorSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface ErrorLogPayload {
  type: string;
  message: string;
  severity?: ErrorSeverity;
  orderId?: string | null;
  userId?: string | null;
  merchantId?: string | null;
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_METADATA_BYTES = 32 * 1024;
const ENABLED = (process.env.ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true';

function _truncate(s: string, max: number): string {
  if (typeof s !== 'string') return String(s ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

function _safeJsonb(obj: unknown): Record<string, unknown> {
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

function _isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export async function logServerError(payload: ErrorLogPayload): Promise<void> {
  if (!ENABLED) return;

  try {
    const severity: ErrorSeverity =
      payload.severity === 'INFO' || payload.severity === 'WARN' ||
      payload.severity === 'ERROR' || payload.severity === 'CRITICAL'
        ? payload.severity
        : 'ERROR';

    const type = _truncate(String(payload.type || 'unknown'), 100);
    const message = _truncate(String(payload.message || ''), MAX_MESSAGE_LEN);
    const orderId = _isUuid(payload.orderId) ? payload.orderId : null;
    const userId = _isUuid(payload.userId) ? payload.userId : null;
    const merchantId = _isUuid(payload.merchantId) ? payload.merchantId : null;
    const metadata = _safeJsonb(payload.metadata);

    await pool.query(
      `INSERT INTO error_logs (type, message, severity, order_id, user_id, merchant_id, source, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'backend', $7)`,
      [type, message, severity, orderId, userId, merchantId, metadata]
    );
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.error('[blipscan-web errorTracking] insert failed', err);
    } catch { /* swallow */ }
  }
}

/** Fire-and-forget wrapper. Never throws. */
export function safeLog(payload: ErrorLogPayload): void {
  try { void logServerError(payload); } catch { /* swallow */ }
}
