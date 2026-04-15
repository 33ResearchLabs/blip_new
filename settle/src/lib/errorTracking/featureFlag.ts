/**
 * Feature flag for the error tracking system.
 *
 * When ENABLE_ERROR_TRACKING is NOT "true":
 *  - no DB writes
 *  - no WebSocket emits
 *  - no admin API mutations
 *  - logger calls return a resolved promise immediately
 *
 * This lets us deploy the code safely and flip on in production without
 * any code change. The flag is read at module top-level so it can be
 * statically evaluated by the logger's fast-path.
 */
export const ERROR_TRACKING_ENABLED =
  (process.env.ENABLE_ERROR_TRACKING || '').toLowerCase() === 'true';

/** Optional real-time broadcast flag (off by default even when tracking is on) */
export const ERROR_TRACKING_REALTIME_ENABLED =
  ERROR_TRACKING_ENABLED &&
  (process.env.ENABLE_ERROR_TRACKING_REALTIME || '').toLowerCase() === 'true';
