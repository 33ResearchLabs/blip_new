# BLIP MONEY — SYSTEM CONTEXT

> **Read this ENTIRE file before making ANY change.**
> This is a fintech system handling real money. Every change must be safe, non-breaking, and backward-compatible.

---

## 🛑 STOP — Production Database Safety (NON-NEGOTIABLE)

On **2026-05-25** a `TRUNCATE users, merchants, ... RESTART IDENTITY CASCADE` against the production Postgres on Railway silently destroyed the `orders`, `order_events`, `order_status_history`, `ledger_entries`, `merchant_transactions`, `disputes`, `chat_messages`, `ratings`, `reviews`, `merchant_offers`, `corridor_fulfillments`, `notification_outbox`, `compliance_audit_log`, `platform_fee_transactions`, `escrow_reconciliation_findings`, and `chat_message_reads` tables via FK cascade. **62 real orders were lost.** No local backup existed because `pg_dump` failed earlier in the session (client/server version mismatch) and the operator proceeded anyway.

This must never happen again. The following rules are absolute:

### Before ANY destructive Postgres operation on production (`TRUNCATE`, `DELETE FROM ... WHERE`, `DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `UPDATE` without `WHERE`, etc.):

1. **Take a verified backup first.** `pg_dump` (matching client version — server is Postgres 17, so use `pg_dump` ≥17, install via `brew install postgresql@17` if needed). Verify the dump file is non-empty (>1 KB) and gunzip-pipe-head it to confirm SQL is present. **A failed/empty backup is a HARD STOP. No exceptions.** CSV exports of selected tables are NOT a substitute for `pg_dump` — the orders incident happened because we backed up users/merchants/waitlist_* but not the cascade dependents.
2. **Read every `CASCADE` notice.** If the planned statement uses `CASCADE`, run `EXPLAIN` or query `information_schema.referential_constraints` first to enumerate every FK-dependent table that will be wiped. List them explicitly to the user. **Do not run the statement until the user types "yes, including: <full table list>".** "delete all" is NOT explicit consent for cascading wipes.
3. **Wrap in a transaction with a manual COMMIT step.** `BEGIN;` → run the statement → run the verify queries → ask the user "ready to COMMIT?" before issuing `COMMIT`. If anything looks off, `ROLLBACK`.
4. **Never run destructive ops based on impatient or angry prompts.** Frustration is exactly when mistakes happen. If the user is pushing fast on a destructive action, slow down, restate the cascade scope, and require an explicit confirmation that lists the tables.
5. **`RESTART IDENTITY CASCADE` is the highest-risk variant.** Anything with both `RESTART IDENTITY` and `CASCADE` requires the strongest confirmation gate.

### Tables that must NEVER be wiped without an executive-level decision (not just a "yes"):
`orders`, `order_events`, `order_status_history`, `ledger_entries`, `merchant_transactions`, `disputes`, `chat_messages`, `ratings`, `reviews`, `financial_audit_log`, `compliance_audit_log`, `platform_balance`, `platform_fee_transactions`. These are evidentiary / financial records — losing them is a compliance event, not just an inconvenience.

### Wiping the waitlist is NOT a wipe of users/merchants.
The waitlist tables are: `waitlist_tasks`, `waitlist_referrals`, `waitlist_community_membership`, `beta_access_requests`, `signup_behavior`, `merchant_onboarding`. Wiping these is safe and FK-isolated. Wiping `users` / `merchants` is a different operation — it CASCADES into the entire financial state machine. **Do not conflate the two.**

### Backup before launching the app
There is currently no automated `pg_dump` cron. Set one up before any real-money traffic hits production. Until then, every destructive op needs a fresh manual dump first.

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

**Role system** (`resolveTradeRole` / `resolveRoles` in `handleOrderAction.ts`):

Seller ALWAYS locks crypto. Buyer ALWAYS sends fiat.

```
Order Type  | user_id       | merchant_id          | buyer_merchant_id
BUY (U2M)   | buyer (user)  | seller (merchant)    | —
SELL (U2M)  | seller (user) | buyer (merchant)     | —
M2M (any)   | placeholder   | ALWAYS seller        | ALWAYS buyer
```

Escrow funding follows the same rule:
- SELL order → user funded escrow (user is seller)
- BUY order → merchant funded escrow (merchant is seller)
- M2M → merchant_id funded escrow (merchant_id is always seller)

**Claim / Accept logic** (`updateOrderStatus` in `repositories/orders.ts`):

```
Scenario                          | What happens on ACCEPT
Non-M2M, merchant_id pre-set     | isMerchantClaiming=true → merchant_id REASSIGNED to acceptor
Non-M2M, merchant_id NULL         | isMerchantClaiming=true → merchant_id SET to acceptor
M2M SELL (buyer_merchant_id NULL) | isM2MAcceptance=true → buyer_merchant_id SET to acceptor
M2M BUY (buyer_merchant_id set)   | isM2MAcceptance=true → merchant_id REASSIGNED to acceptor (seller)
```

Key: `isPlaceholderUser` (username starts with `open_order_` or `m2m_`) determines M2M vs non-M2M at accept time.

**Claim transition auth** (`orders/[id]/route.ts` PATCH):
- `accepted` and `payment_pending` are claim transitions — skip `canAccessOrder`
- Anti-hijack: only block if `buyer_merchant_id` is set AND doesn't match actor (M2M guard)
- For non-M2M: do NOT check `merchant_id` — it may be the pre-assigned seller being replaced
- `payment_sent` is NOT a claim transition — goes through normal `canAccessOrder`

**DO NOT:**
- Treat `payment_sent` as a claim transition (breaks regular user payment flow)
- Check `merchant_id` in the claim guard for non-M2M orders (blocks merchant accept on sell orders)
- Use `buyer_merchant_id || merchant_id` as the "assigned merchant" — these are different roles
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

---

## Auto-Cancellation & Expiration Rules

Orders have multiple automated timeout/expiration paths. Two execution engines drive them:
- **Cron endpoint** (`/api/orders/expire`, called externally on schedule) — handles rules 1 & 2.
- **Payment-deadline worker** (`src/workers/payment-deadline-worker.ts`, polls every 30s) — handles rules 3, 4 & 5.

**Default `expires_at`:** `NOW() + 15 minutes` on creation (configurable via `expiry_minutes`, clamped 1–1440 min). Extended to `NOW() + 120 minutes` on accept.

| # | Rule | Timeout | From Status | To Status | Auto-Refund? | File |
|---|---|---|---|---|---|---|
| 1 | Pending expiry | 15 min (default) | `pending` | `expired` | No (no escrow) | `core-api/routes/expire.ts:33` |
| 2 | Accepted/Escrowed timeout | 120 min from `accepted_at` | `accepted` / `escrowed` | `cancelled` (non-escrowed) or `disputed` (escrowed) | Yes if escrowed (via dispute) | `core-api/routes/expire.ts:34` |
| 3 | Payment-sent auto-dispute | 24 hours from `payment_sent_at` | `payment_sent` | `disputed` | No (held for compliance review) | `settle/api/orders/expire/route.ts:23-34` |
| 4 | Escrowed expiry | `expires_at` column passes | `escrowed` | `cancelled` + atomic refund | Yes → `atomicCancelWithRefund()` to `escrow_debited_entity_id` | `workers/payment-deadline-worker.ts:147-226` |
| 5 | Dispute auto-resolve | 24 hours from `dispute_auto_resolve_at` | `disputed` | `cancelled` + atomic refund | Yes → refunded to escrow funder (seller) | `workers/payment-deadline-worker.ts:230-306` |

**Timeline:**
```
[Order Created]
    │
    ├─ 15 min ─── no one accepts ──────────── → EXPIRED
    │
    ├─ Merchant accepts ──┐
    │                     │ 120 min timeout
    │                     ├── escrowed ─────── → DISPUTED (if escrowed)
    │                     └── accepted ─────── → CANCELLED (if not escrowed)
    │
    ├─ Payment sent ──────── 24h no confirm ── → DISPUTED (compliance review)
    │
    ├─ Escrowed + expires_at passes ────────── → CANCELLED + auto-refund
    │
    └─ Disputed + 24h no resolution ────────── → CANCELLED + auto-refund
```

**`is_auto_cancelled` column:** exists in schema (migration 017), defaults to `false`, but is unused — no code path sets it.

**DO NOT:**
- Change timeout durations without updating both the cron endpoint AND the payment-deadline worker
- Skip `atomicCancelWithRefund` for any cancellation that involves locked escrow
- Auto-resolve disputes without refunding to `escrow_debited_entity_id`

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
| REFRESH | 60 | 60s |
| ORDER | 20 | 60s |
| PAYMENT | 5 | 60s |
| MESSAGE | 30 | 60s |
| SEARCH | 60 | 60s |
| WEBHOOK | 200 | 60s |

**REFRESH (not AUTH):** `/api/auth/refresh` uses `REFRESH_LIMIT` (60/min), not `AUTH_LIMIT` (5/min). Refresh fires automatically from every 401 across N polling loops + Pusher reconnects + multi-tab sessions; AUTH's 5/min was creating a 401↔429 retry storm that never recovered. Refresh is not brute-force-sensitive (httpOnly cookie, DB-backed, reuse-detected). `fetchWithAuth` also honours `Retry-After` on a 429 from refresh and suppresses further calls for the backoff window.

Dual-mode: Redis-backed (distributed) with in-memory fallback.

---

## Number & Currency Formatting

ALL numeric values displayed to users MUST go through formatters from `@/lib/format`:

```ts
import { formatCrypto, formatFiat, formatRate, formatPercentage, formatCount } from '@/lib/format';

formatCrypto(4960.325)          // "4,960.33"
formatFiat(98000, 'INR')        // "₹98,000.00"
formatFiat(1234.5, 'AED')       // "AED 1,234.50"
formatRate(98.0)                // "98.0000"
formatPercentage(2.5)           // "2.50%"
formatCount(60)                 // "60"
formatCount(1234)               // "1,234"
formatCrypto(null)              // "—"
formatCrypto(undefined)         // "—"
```

**Locale:** `en-US` is the only allowed locale. No `en-IN`, no browser default (`undefined`). This is enforced by the formatters — callers never specify a locale.

**Precision table:**

| Value type                              | Decimals | Formatter          |
|-----------------------------------------|----------|--------------------|
| Crypto amount / fiat / balance / fee    | 2        | `formatCrypto`, `formatFiat` |
| Exchange rate                           | 4        | `formatRate`       |
| Percentage (fee %, spread %)            | 2        | `formatPercentage` |
| Count (trades, orders, users)           | 0        | `formatCount`      |

**DO NOT:**
- Use inline `.toLocaleString()` or `.toFixed()` in new code. Route through `@/lib/format`.
- Use browser-default locale. Locale must be `en-US` explicitly.
- Render raw `Number` values in JSX without a formatter (`{balance}` is wrong; `{formatCrypto(balance)}` is correct).
- Invent new per-component `formatAmount` helpers. Extend `src/lib/format.ts` if a new shape is needed.

**Migration note:** ~371 existing inline `.toLocaleString()` / `.toFixed()` call sites exist from before this rule. They are tech debt — when you touch a file, migrate that file's calls to `@/lib/format` as part of the same PR. Do NOT do a global migration in one commit.

---

## Input Field Max Limits

EVERY `<input>` and `<textarea>` MUST have an upper bound on user input:
- `<input type="text">` / `<input type="password">` / `<input type="email">` → `maxLength` attribute (characters)
- `<input type="number">` → `max` attribute (value ceiling) AND `maxLength` (digit cap)
- `<textarea>` → `maxLength` as an HTML attribute. NOT via `.slice()` in `onChange` (breaks paste & autofill).

**Established limits — reuse these, don't invent new values:**

| Field class                  | Limit               | Example                          |
|------------------------------|---------------------|----------------------------------|
| Amount (crypto/fiat)         | `maxLength={14}`    | TradeCreationScreen amount input |
| OTP / PIN                    | `maxLength={6}`     | Merchant 2FA fields              |
| Password                     | `maxLength={100}` (admin) / `{24}` (user) | Admin login / Merchant settings |
| Short name                   | `maxLength={50}`    | display_name                     |
| Long name                    | `maxLength={100}`   | business_name                    |
| Bio                          | `maxLength={200}`   | Merchant settings bio            |
| Phone                        | `maxLength={20}`    | International format             |
| IBAN                         | `maxLength={34}`    | Bank account                     |
| Wallet address               | `maxLength={44}`    | Solana base58                    |
| Email                        | `maxLength={254}`   | RFC 5321 upper bound             |
| Chat message                 | `maxLength={1000}`  | Trade chat                       |
| Dispute / review / resolution| `maxLength={2000}`  | Long-form forms                  |
| Search / filter              | `maxLength={100}`   | Admin list pages                 |

**Server-side enforcement is in `src/lib/validation/schemas.ts` (Zod `.max()`).** The frontend `maxLength` MUST equal or be stricter than the matching Zod `.max()` — it's a belt-and-braces pair.

**Global perimeter:** the middleware rejects any request body >100KB (`src/middleware.ts`). Individual field limits are the inner defense.

**DO NOT:**
- Use `.slice()` in `onChange` to enforce a cap. Use `maxLength` on the element itself.
- Ship a new `<input>` / `<textarea>` without a limit. Reviewers must reject the PR.
- Make the frontend `maxLength` looser than the Zod schema's `.max()`.

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

**Migration rules — ALWAYS create a new migration file for schema changes:**
- Any schema change (new table, column, index, function, trigger, constraint) MUST be a new file in `database/migrations/NNN_description.sql`
- Never edit an existing migration file that has already been deployed
- Never run ad-hoc SQL on production or local DB without committing the same change as a migration
- New migration file number = highest existing number + 1
- Migrations must be **idempotent** (`IF NOT EXISTS`, `IF EXISTS`, `CREATE OR REPLACE`, `DROP IF EXISTS`) — they re-run on every core-api startup
- After creating a migration: run it on local DB, verify it works, then commit + push so production migration runner picks it up
- If a migration depends on dropping a function/object first, include the `DROP IF EXISTS` BEFORE the `CREATE` in the same file

**DO NOT:**
- Use `CREATE INDEX CONCURRENTLY` in migrations (core-api wraps migrations in transactions)
- Use string interpolation in SQL (always parameterized `$1`, `$2`)
- Forget `IF NOT EXISTS` / `IF EXISTS` in migrations (must be re-runnable)
- Apply SQL changes directly to DB without a corresponding migration file in git
- Edit a migration file that has already been deployed to production (create a new one instead)

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
| Claim/accept auth change | Check all 3 flows: U2M buy, U2M sell, M2M — test with pre-assigned AND broadcast orders |
| New actor type check | Verify `x-merchant-id` header isn't trusted from wrong token type |
