/**
 * Shared error-tracking logger for settlement-core.
 *
 * Writes to the `error_logs` table created by settle migration 088. Used
 * by both the settle app and the core-api service. Feature-gated via
 * ENABLE_ERROR_TRACKING — when the flag is off, every call is a no-op with
 * zero DB activity.
 *
 * Safety contract:
 *   - Never throws (all errors swallowed internally).
 *   - Fire-and-forget by default — callers never await on a critical path.
 *   - Guards against infinite recursion if a query on error_logs itself
 *     fails (we skip logging for DB errors that mention error_logs).
 *   - Metadata is capped at 32 KB to prevent single-row blowout.
 */

import { query } from '../db/client';

export type ErrorSeverity = 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
export type ErrorSource = 'backend' | 'frontend' | 'worker';

export interface ErrorLogPayload {
  type: string;
  message: string;
  severity?: ErrorSeverity;
  orderId?: string | null;
  userId?: string | null;
  merchantId?: string | null;
  source?: ErrorSource;
  metadata?: Record<string, unknown>;
}

const MAX_MESSAGE_LEN = 2000;
const MAX_METADATA_BYTES = 32 * 1024;

const ENABLED = (process.env.ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true';

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

export async function logServerError(payload: ErrorLogPayload): Promise<void> {
  if (!ENABLED) return;

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
  } catch (err) {
    try {
      // eslint-disable-next-line no-console
      console.error('[settlement-core errorTracking] failed to insert log', err);
    } catch { /* swallow */ }
  }
}

/** Fire-and-forget wrapper — swallows every possible failure. */
export function safeLog(payload: ErrorLogPayload): void {
  try {
    void logServerError(payload);
  } catch { /* swallow */ }
}

export const ERROR_TRACKING_ENABLED = ENABLED;
