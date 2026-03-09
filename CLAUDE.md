# Blip Money — Project Instructions

## CRITICAL: Read These Files First
Before doing ANY work, read these two files in project root:

1. **`PROJECT_MAP.md`** — Complete map of every file, directory, server, port, URL. Know where everything lives.
2. **`SYNC.md`** — Tracks active sessions, claimed zones, locked files, recent changes.

## Multi-Session Protocol
Multiple Claude Code sessions run concurrently on this repo. Follow these rules:

### 1. Claim Your Zone
After reading SYNC.md, add yourself to the active sessions list with:
- What you're working on
- Which zone (see zones below)
- Timestamp

### 2. LOCKED Files — DO NOT MODIFY
These are shared core files. If you need changes here, **log it in SYNC.md under REQUESTS** and tell the user — don't edit directly.

```
LOCKED:
├── apps/core-api/              # Backend API (single writer for mutations)
├── settle/src/lib/
│   ├── db/repositories/        # DB queries, order CRUD
│   ├── orders/statusResolver.ts # Role computation, status logic
│   ├── orders/stateMachine.ts  # State transitions, timeouts
│   └── money/escrowLock.ts     # Escrow lock/release
├── settle/src/app/api/         # ALL API routes (shared backend)
│   ├── orders/                 # Order CRUD, escrow, messages, disputes
│   ├── merchant/orders/        # Type inversion, price engine
│   ├── mempool/                # Mempool operations
│   ├── auth/                   # Auth endpoints
│   └── ... (all other api/)
├── settle/src/types/           # Shared TypeScript types
├── packages/                   # Shared packages
└── settle/src/lib/pusher/      # Realtime notifications
```

### 3. Work Zones — Safe for Parallel Work
Each zone is independent. Only ONE session per zone at a time.

| Zone | Area | Directory |
|------|------|-----------|
| **A** | Merchant Dashboard | `settle/src/app/merchant/`, `settle/src/components/merchant/`, `settle/src/hooks/` |
| **B** | User App | `settle/src/app/user/`, `settle/src/components/user/` |
| **C** | Telegram Bot | `telegram-bot/` |
| **D** | Dispute Dashboard | `settle/src/app/disputes/`, `settle/src/components/disputes/` |
| **E** | Admin Dashboard | `settle/src/app/admin/`, `settle/src/components/admin/` |
| **F** | Live Dashboard | `settle/src/app/live/`, `settle/src/components/live/` |
| **G** | Blipscan | `blipscan/` |
| **H** | Styles/CSS | `settle/src/app/globals.css`, shared UI components |

### 4. Update SYNC.md When Done
Before finishing, update SYNC.md:
- Remove yourself from active sessions
- Add a changelog entry describing what you changed
- Note any issues or things the next session should know

### 5. Conflict Protocol
If you MUST touch a LOCKED file:
1. Check SYNC.md — is anyone else active?
2. Log your intent under REQUESTS in SYNC.md
3. Make minimal, surgical changes only
4. Document exactly what you changed in the changelog

---

## Trade Flow (NEVER FORGET)
- **Seller ALWAYS locks crypto into escrow**
- **BUY order**: Buyer places order -> Seller accepts & locks escrow -> Buyer sends fiat -> Seller confirms -> Releases crypto
- **SELL order**: Seller locks escrow BEFORE offer goes live -> Buyer accepts -> Buyer sends fiat -> Seller confirms -> Releases crypto
- Cancel before escrow = clean cancel. Cancel after escrow = dispute.

## Type Inversion
- Merchant creates BUY -> stored as `type=sell` in DB (user perspective)
- Merchant creates SELL -> stored as `type=buy` in DB (user perspective)
- NEVER use `isMyOrder` — use `computeMyRole(order, merchantId)`

## Role Computation
Use `computeMyRole()` from statusResolver.ts. Rules:
- `buyer_merchant_id === me` -> BUYER (always wins)
- `merchant_id === me` + `buyer_merchant_id` exists + not me -> SELLER
- `merchant_id === me` + type='buy' -> SELLER
- `merchant_id === me` + type='sell' -> BUYER (non-M2M)

## Stack
- `settle/` — Next.js 16 (port 3000), Zustand stores, Tailwind
- `apps/core-api/` — Fastify (port 4010), single writer
- `telegram-bot/` — Telegraf + Claude Haiku
- `blipscan/` — Explorer (web port 3001 + indexer)
- DB: PostgreSQL localhost:5432, database `settle`, user `zeus`
- Currency: AED (rate 3.67), synthetic: sAED

## User Preferences
- Blunt, no-fluff responses. 5-10 lines max.
- Don't overcomplicate. Don't over-engineer.
- Never push to main directly — feature branches + PRs.
