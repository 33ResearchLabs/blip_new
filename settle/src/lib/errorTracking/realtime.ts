/**
 * Optional real-time broadcast for new error logs.
 *
 * Emits `new_error_log` on the private-admin channel so the admin dashboard
 * can stream incoming errors. Guarded by ENABLE_ERROR_TRACKING_REALTIME —
 * off by default even when tracking itself is on.
 *
 * Uses Pusher (already present in the stack) rather than adding Socket.io
 * to avoid new infra. If you'd rather use Socket.io, swap this file — the
 * logger's import is lazy so the contract is just `emitNewErrorLog(payload)`.
 */

import type { ErrorLogPayload } from './logger';

export async function emitNewErrorLog(payload: ErrorLogPayload & { metadata?: unknown }): Promise<void> {
  try {
    // Lazy-load the Pusher server instance so the logger never pulls this in
    // when realtime is disabled. We call `.trigger` directly rather than the
    // typed `triggerEvent()` wrapper so we can use our own event name without
    // polluting the existing PusherEvent union type (which is reserved for
    // order/chat events).
    const { getPusherServer } = await import('@/lib/pusher/server');
    const pusher = await getPusherServer();
    if (!pusher || typeof pusher.trigger !== 'function') return;

    // Strip metadata down to a tiny preview for the realtime stream —
    // dashboards fetch the full row via the admin API when the user clicks it.
    const preview: Record<string, unknown> = { ...payload };
    if (preview.metadata && typeof preview.metadata === 'object') {
      const serialized = JSON.stringify(preview.metadata);
      if (serialized.length > 1024) {
        preview.metadata = { __truncated: true, preview: serialized.slice(0, 1024) };
      }
    }
    await pusher.trigger('private-admin', 'new_error_log', preview);
  } catch {
    /* swallow — realtime is a nice-to-have and must never block logging */
  }
}
