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
export declare function logServerError(payload: ErrorLogPayload): Promise<void>;
/** Fire-and-forget wrapper — swallows every possible failure. */
export declare function safeLog(payload: ErrorLogPayload): void;
export declare const ERROR_TRACKING_ENABLED: boolean;
//# sourceMappingURL=logger.d.ts.map