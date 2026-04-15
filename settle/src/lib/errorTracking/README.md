# Error Tracking System — Integration Guide

A **purely additive**, feature-flagged logging system. When
`ENABLE_ERROR_TRACKING=false` (the default), the system does nothing and has
zero performance impact.

## Files

| File | Purpose |
|------|---------|
| `database/migrations/088_error_logs.sql` | New `error_logs` table (additive only) |
| `lib/errorTracking/featureFlag.ts` | `ENABLE_ERROR_TRACKING` + `ENABLE_ERROR_TRACKING_REALTIME` |
| `lib/errorTracking/logger.ts` | `logServerError(payload)` + `safeLog(payload)` |
| `lib/errorTracking/realtime.ts` | Pusher emitter for `new_error_log` on `private-admin` |
| `lib/errorTracking/apiWrapper.ts` | `withErrorTracking(handler, opts)` — optional route wrapper |
| `lib/errorTracking/clientLogger.ts` | `logClientError(...)` + `installGlobalClientErrorHandlers(...)` |
| `app/api/client-errors/route.ts` | Ingest endpoint for frontend logs |
| `app/api/admin/error-logs/route.ts` | Admin-only read API |
| `app/admin/error-logs/page.tsx` | Admin dashboard at `/admin/error-logs` |

## Feature flags

- `ENABLE_ERROR_TRACKING=true` — enable server-side logging + admin API + dashboard
- `ENABLE_ERROR_TRACKING_REALTIME=true` — also emit Pusher events for each log
- `NEXT_PUBLIC_ENABLE_ERROR_TRACKING=true` — enable the frontend client logger (must be `NEXT_PUBLIC_*` so the bundler picks it up at build time)

Add to `.env.local`:

```
ENABLE_ERROR_TRACKING=true
NEXT_PUBLIC_ENABLE_ERROR_TRACKING=true
# Optional:
# ENABLE_ERROR_TRACKING_REALTIME=true
```

## Non-invasive backend usage

### Example 1 — log an anomaly observed inside an existing function

```ts
import { safeLog } from '@/lib/errorTracking/logger';

// Somewhere in an existing handler — NOT modifying control flow
if (order.status === 'completed' && !order.escrow_debited_entity_id) {
  safeLog({
    type: 'escrow.state_mismatch',
    severity: 'CRITICAL',
    message: 'Completed order has no escrow debited entity',
    orderId: order.id,
    metadata: { status: order.status },
  });
}
```

### Example 2 — wrap a route to capture unhandled exceptions

```ts
import { withErrorTracking } from '@/lib/errorTracking/apiWrapper';

export const POST = withErrorTracking(
  async (request: NextRequest) => {
    // existing handler body — unchanged
  },
  { routeName: 'orders.create' }
);
```

The wrapper re-throws after logging so the response shape is **unchanged**.

### Example 3 — observe but don't interfere

```ts
// In a worker that scans expired orders — just observe
if (order.status === 'escrowed' && order.expires_at < new Date()) {
  safeLog({
    type: 'order.stuck',
    severity: 'WARN',
    message: `Order ${order.id} still in escrowed past expires_at`,
    orderId: order.id,
    metadata: { expires_at: order.expires_at },
  });
}
// … existing expiry handler runs as-is
```

## Frontend usage (non-critical areas only)

```tsx
import { logClientError } from '@/lib/errorTracking/clientLogger';

try {
  const res = await fetchWithAuth('/api/ratings', { method: 'POST', body });
  if (!res.ok) {
    logClientError({
      type: 'ui.api_fail.ratings',
      severity: 'WARN',
      message: `Rating submit failed (${res.status})`,
      userId: currentUserId,
      metadata: { status: res.status },
    });
  }
} catch (e) {
  logClientError({
    type: 'ui.network_fail.ratings',
    severity: 'ERROR',
    message: (e as Error).message,
    userId: currentUserId,
  });
}
```

**DO NOT wrap order placement, escrow lock/release, or state-machine
transitions** — those are critical paths and must not depend on logging.

### Install global handlers once in the app shell

```tsx
// app/providers or layout
import { installGlobalClientErrorHandlers } from '@/lib/errorTracking/clientLogger';

useEffect(() => {
  installGlobalClientErrorHandlers(() => ({
    userId: auth.userId,
    merchantId: auth.merchantId,
  }));
}, [auth.userId, auth.merchantId]);
```

## Where do I see the logs?

**Admin UI:** `/admin/error-logs` — filterable dashboard.

**API:** `GET /api/admin/error-logs?severity=ERROR&orderId=...&limit=200`
(admin Bearer token required).

**Raw DB:** `SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 100;`

## Safety contract

1. Logging is **always non-blocking**. Callers can safely `safeLog(...)` and
   move on — there's no `await` on the critical path.
2. Logger internals never throw. Errors are caught in the logger, again in
   the realtime emitter, and again in the ingest endpoint.
3. When the feature flag is off, the logger is a cheap boolean check and
   returns immediately — no imports of pusher, db, etc., at runtime for the
   realtime module (lazy-loaded).
4. No existing table is touched. The only schema change is the new
   `error_logs` table added by migration 088.
5. Admin API validates every filter value; type filter uses parameterized
   `LIKE` against a character-restricted prefix to prevent injection.

## Sentry (optional)

The client logger forwards to `window.Sentry.captureMessage` if Sentry is
already initialized in your app shell. To enable:

1. `npm install @sentry/nextjs`
2. Initialize once in `instrumentation.ts` with your DSN
3. The existing `logClientError` calls automatically forward

No changes to the logger API or existing code are required.
