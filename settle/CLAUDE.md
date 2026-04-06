# BLIP MONEY — SYSTEM CONTEXT

> **Read this ENTIRE file before making ANY change.**
> This is a fintech system handling real money. Every change must be safe, non-breaking, and backward-compatible.

---

## Architecture

**Monorepo** (pnpm workspaces):

```
blip_new/
  settle/          → Next.js 16.1.5 frontend + API routes (App Router)
  apps/core-api/   → Fastify 4.26 backend (order mutations, escrow, state machine)
  packages/settlement-core/ → Shared types, logger, status normalizer
  blipscan/web/    → Transaction explorer
  blipscan/indexer/ → Blockchain indexer
```

**Stack:**
- React 19 + Tailwind CSS + Zustand (frontend state)
- PostgreSQL via `pg` (NOT Supabase) — pool max: 100 prod / 20 dev
- Redis via `ioredis` (rate limiting, caching — graceful fallback if unavailable)
- Solana blockchain via `@solana/web3.js` + `@coral-xyz/anchor` (escrow)
- Pusher (real-time events) + WebSocket server (chat)
- Custom `server.js` (NOT `next start`) — HTTP + WebSocket on same port

**Provider tree** (layout.tsx, outermost → innermost):
```
ThemeProvider → ClientWalletProvider → PusherProvider → WebSocketChatProvider → ModalProvider → AppProvider
```

---

## Authentication

**Token format** (HMAC-SHA256 signed):
- Access v2: `access:actorType:actorId:sessionId:ts:sig` (15 min, 6 parts)
- Access v1: `access:actorType:actorId:ts:sig` (15 min, 5 parts, legacy)
- Refresh: httpOnly cookie `blip_refresh_token` (7 days, DB-backed, rotated on use)
- Admin: `base64(username:timestamp:hmac_signature)` (24 hours, stateless)

**Actor types:** `user` | `merchant` | `compliance`

**Critical rules:**
- `getTokenSecret()` resolves lazily (NOT at import time — breaks Next.js build)
- `AUTH_TOKEN_REQUIRED` defaults to `true` in production, `false` in dev
- Header-based auth (`x-user-id`, `x-merchant-id`) is dev-only fallback — blocked in production
- `x-merchant-id` header is ONLY trusted when `auth.actorType === 'merchant'` — never for user tokens
- Refresh token rotation detects reuse (stolen token → revoke all sessions)

**DO NOT:**
- Accept `x-merchant-id` or `x-user-id` headers from user-type tokens
- Add new actor types to client-facing Zod schemas (especially NOT `"system"`)
- Store tokens or secrets at module top-level (breaks build — use lazy init)

---

## Order System (CRITICAL — handles real money)

**Order lifecycle** (strict state machine in `handleOrderAction.ts`):

```
Action           → Target Status    | Allowed From        | Role
ACCEPT           → accepted         | open                | buyer
LOCK_ESCROW      → escrowed         | accepted            | seller
CLAIM            → escrowed (stays) | escrowed            | buyer (merchant claiming broadcast order)
SEND_PAYMENT     → payment_sent     | escrowed            | buyer
CONFIRM_PAYMENT  → completed        | payment_sent        | seller
CANCEL           → cancelled        | open,accepted,escrowed | any
DISPUTE          → disputed         | escrowed,payment_sent  | any
```

**Frontend sends ACTION (e.g. `SEND_PAYMENT`), backend determines target status.** The frontend NEVER sends a target status to the action endpoint.

**Concurrency protection:**
- `claimOrder()` / `claimAndPayOrder()`: `transaction()` + `SELECT FOR UPDATE` + `IS NULL` checks
- `updateOrderStatus()`: optimistic locking via `order_version` in WHERE clause
- `atomicCancelWithRefund()`: single transaction with balance post-invariant check

**Idempotency** (table: `idempotency_log`, migration 047):
- Order creation: auto-key from `user_id + type + amount + 30s window`
- Payment actions: explicit `Idempotency-Key` header required for financial transitions
- Protected actions: `create_order`, `payment_sent`, `release_escrow`, `cancel_order`

**DO NOT:**
- Skip access control for claim transitions (always verify order is unclaimed)
- Allow `completed` without escrow being locked (check `escrow_debited_entity_id`)
- Use hardcoded fallback rates — reject orders when corridor price unavailable
- Forget `order_version` in UPDATE WHERE clauses for financial transitions

---

## Escrow

- Locked by seller (crypto deducted from balance, tracked in `escrow_debited_entity_id`)
- Released by seller only (`actor_id === order.escrow_debited_entity_id`)
- `"system"` actor type is NOT allowed in client-facing API — internal only
- Cancel + refund is atomic (`atomicCancelWithRefund` with balance verification)
- `payment_sent` orders auto-dispute after 24 hours (via `/api/orders/expire` cron)

---

## Middleware (`src/middleware.ts`)

**Location:** `src/middleware.ts` (NOT root `middleware.ts` — Turbopack requires `src/`)

**Execution order:**
1. Skip static assets (`_next/`, `favicon.ico`, `icons/`, `manifest.json`)
2. Dev access lock (if `DEV_LOCK_ENABLED=true`)
3. Non-API routes → `NextResponse.next()` (no further processing)
4. Rate limiting (auth: 10/min, orders: 30/min, standard: 100/min)
5. Body size guard (100KB max)
6. CSRF protection (origin/referer match)
7. Auth enforcement (public → admin → protected routes)
8. Security headers (CSP, HSTS, X-Frame-Options, etc.)

**No `config.matcher` export** — runs on all routes. Static assets filtered in code.

---

## Rate Limits

| Preset | Requests | Window |
|--------|----------|--------|
| STANDARD | 100 | 60s |
| STRICT | 10 | 60s |
| AUTH | 5 | 60s |
| ORDER | 20 | 60s |
| PAYMENT | 5 | 60s |
| MESSAGE | 30 | 60s |
| SEARCH | 60 | 60s |
| WEBHOOK | 200 | 60s |

Dual-mode: Redis-backed (distributed) with in-memory fallback.

---

## Security Guards (`src/lib/guards.ts`)

In-memory sliding window trackers + DB persistence (`security_alerts` table):
- `guardOrderCreation`: >3 orders/min from same user → HIGH alert
- `guardOrderClaim`: >2 claims/min on same order → MEDIUM alert
- `guardPaymentRetry`: >2 payment actions/min on same order → HIGH alert
- `guardAuthVelocity`: >10 auth calls/min from same IP → MEDIUM alert

Alerts viewable at `/admin/monitor` dashboard.

---

## API Patterns

**Auth helpers** (import from `@/lib/middleware/auth`):
```typescript
const auth = await requireAuth(request);        // standard routes
const auth = await requireTokenAuth(request);   // financial routes (stricter)
const authError = requireAdminAuth(request);    // admin routes (stateless HMAC)
```

**Response helpers:**
```typescript
return successResponse(data);                   // 200 { success: true, data }
return errorResponse('message');                // 500 { success: false, error }
return forbiddenResponse('reason');             // 403
return notFoundResponse('Resource');            // 404
return validationErrorResponse(['error1']);     // 400
```

**Core-API proxy** (for order mutations):
```typescript
const resp = await proxyCoreApi('/v1/orders', { method: 'POST', body: {...} });
```
Settle API routes validate auth + inputs, then proxy mutations to core-api. Core-api owns the state machine and DB writes for orders.

---

## Database

**PostgreSQL** (not Supabase). Connection via `pg` library.

**Key tables:** `orders`, `users`, `merchants`, `disputes`, `sessions`, `idempotency_log`, `security_alerts`, `order_events`, `chat_messages`, `merchant_offers`, `ratings`, `corridor_prices`

**Query helpers** (import from `@/lib/db`):
```typescript
const rows = await query<T>('SELECT ...', [params]);
const row = await queryOne<T>('SELECT ...', [params]);
const result = await transaction(async (client) => { ... });
```

**DO NOT:**
- Use `CREATE INDEX CONCURRENTLY` in migrations (core-api wraps migrations in transactions)
- Use string interpolation in SQL (always parameterized `$1`, `$2`)
- Forget `IF NOT EXISTS` / `IF EXISTS` in migrations (must be re-runnable)

---

## Build & Deploy

**Dockerfile** (multi-stage):
- Build args: all `NEXT_PUBLIC_*` vars + `DEV_LOCK_ENABLED`
- Runtime env vars: `DEV_ACCESS_PASSWORD`, `ADMIN_SECRET`, `DATABASE_URL`, etc.
- `NODE_ENV=production` in runner stage

**Railway:**
- settle service: Docker build from root `Dockerfile`
- core-api service: Docker build from `apps/core-api/Dockerfile`
- PostgreSQL + Redis as Railway services
- Migrations run by core-api `migrationRunner.ts` on startup

**DO NOT:**
- Throw errors at module top-level in production (breaks Next.js build page data collection)
- Use `CONCURRENTLY` in CREATE INDEX statements (breaks transaction-wrapped migrations)
- Assume env vars exist at build time (only `NEXT_PUBLIC_*` and explicit Docker ARGs are available)

---

## Dev Access Lock

- `DEV_LOCK_ENABLED=true` (Docker build ARG, defaults to true)
- `DEV_ACCESS_PASSWORD` (runtime env var, server-side only)
- Password NEVER exposed to frontend — only compared in `/api/dev-unlock` Node.js route
- Cookie: `dev_access_granted=true` (httpOnly, 7 days)

---

## File Conventions

| Pattern | Example |
|---------|---------|
| API routes | `src/app/api/{resource}/route.ts` |
| Dynamic routes | `src/app/api/orders/[id]/route.ts` |
| Pages | `src/app/{page}/page.tsx` |
| DB repositories | `src/lib/db/repositories/{table}.ts` |
| Auth | `src/lib/auth/*.ts` |
| Middleware helpers | `src/lib/middleware/*.ts` |
| Business logic | `src/lib/orders/*.ts`, `src/lib/money/*.ts` |
| Validation schemas | `src/lib/validation/schemas.ts` |
| Migrations | `database/migrations/NNN_description.sql` |

---

## Admin UI Patterns

- Lucide React icons
- Status styles via `getStatusStyle(status)` / `getStatusLabel(status)` helpers
- Nav pills: duplicated across all admin pages (no shared layout component)
- Data fetching: `fetchWithAuth()` with `Authorization: Bearer ${token}` header
- Real-time: Pusher channel `private-admin` for order events
- Auth: `blip_admin_token` in localStorage, validated via GET `/api/auth/admin`

---

## What to Update When

| Change | Also Update |
|--------|-------------|
| New admin page | Add nav link to ALL 8 admin page.tsx files |
| New migration | Add to `database/railway-migration.sql` (no CONCURRENTLY) |
| New env var needed at build | Add as ARG in `Dockerfile` |
| New API route | Consider rate limiting, auth, Zod validation |
| Status transition change | Update `handleOrderAction.ts` ACTION_RULES |
| New actor type check | Verify `x-merchant-id` header isn't trusted from wrong token type |
