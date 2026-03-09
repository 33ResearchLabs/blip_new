# Blip Money — Project Map

> Every Claude Code session reads this. Know where everything is before touching anything.

---

## Servers & Ports

| Service | Port | Directory | Start Command |
|---------|------|-----------|---------------|
| settle (Next.js) | 3000 | `settle/` | `npm run dev` |
| core-api (Fastify) | 4010 | `apps/core-api/` | `npm run dev` |
| blipscan web | 3001 | `blipscan/web/` | `npm run dev` |
| blipscan indexer | — (bg) | `blipscan/indexer/` | `npm run dev` |
| telegram-bot | — | `telegram-bot/` | `npm run dev` |
| PostgreSQL | 5432 | — | `pg_ctl -D /usr/local/var/postgresql@14 start` |

**Check if running:** `lsof -iTCP -sTCP:LISTEN -P | grep -E ':(3000|3001|4010|5432)'`

---

## Product → Code Map

### 1. Merchant Dashboard (settle — port 3000)
The main trading interface. Where merchants manage orders, escrow, chat, offers.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Dashboard (main) | `settle/src/app/merchant/page.tsx` | 4,518 | `/merchant` |
| Analytics | `settle/src/app/merchant/analytics/page.tsx` | — | `/merchant/analytics` |
| Mempool | `settle/src/app/merchant/mempool/page.tsx` | — | `/merchant/mempool` |
| Settings | `settle/src/app/merchant/settings/page.tsx` | — | `/merchant/settings` |
| Wallet | `settle/src/app/merchant/wallet/page.tsx` | — | `/merchant/wallet` |
| Public Profile | `settle/src/app/merchant/profile/[id]/page.tsx` | — | `/merchant/profile/:id` |

**Components:** `settle/src/components/merchant/` (31 files)
- `OrderDetailsPanel.tsx` — Order detail view + actions
- `PendingOrdersPanel.tsx` — Pending orders list
- `InProgressPanel.tsx` — Active orders
- `CompletedOrdersPanel.tsx` — History
- `Marketplace.tsx` — Browse offers
- `MyOffers.tsx` — Manage own offers
- `TradeChat.tsx` — In-order chat
- `DirectChatView.tsx` — M2M/M2U direct messages
- `MerchantChatTabs.tsx` — Chat tab switcher
- `MessageHistory.tsx` — Message list
- `AnalyticsDashboard.tsx` — Charts & stats
- `DashboardWidgets.tsx` — Dashboard cards
- `StatusCard.tsx` — Order status display
- `ConfigPanel.tsx` — Settings panel
- `CorridorLPPanel.tsx` — Liquidity provider
- `CorridorProviderSettings.tsx` — LP config
- `LeaderboardPanel.tsx` — Rankings
- `SaedBalancePanel.tsx` — sAED balance
- `TransactionsTab.tsx` — Transaction list
- `TransactionHistory.tsx` — Full history
- `TransactionHistoryModal.tsx` — History modal
- `NotificationsPanel.tsx` — Notifications
- `LoginScreen.tsx` — Auth screen
- `MerchantNavbar.tsx` — Top nav
- `MerchantProfileModal.tsx` — Profile popup
- `PaymentMethodModal.tsx` — Payment config
- `TopRatedSellers.tsx` — Seller rankings
- `UserBadge.tsx` — Reputation badge
- `ActivityPanel.tsx` — Activity feed

---

### 2. User App (settle — port 3000)
Where users place buy/sell orders and track them.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Home / Marketplace | `settle/src/app/page.tsx` | 4,850 | `/` |
| Transactions | `settle/src/app/transactions/page.tsx` | — | `/transactions` |

**Components:** `settle/src/components/user/` (6 files)
- `HomeScreen.tsx` — Main user view
- `WelcomeScreen.tsx` — Onboarding
- `SuccessScreen.tsx` — Order success
- `shared/AmbientGlow.tsx` — UI effect
- `shared/BottomNavBar.tsx` — Mobile nav
- `shared/Chip.tsx`, `shared/GlassCard.tsx`, `shared/Sparkline.tsx` — UI primitives

---

### 3. Telegram Bot
P2P trading via Telegram with Claude Haiku AI.

| File | Size | Purpose |
|------|------|---------|
| `telegram-bot/bot.js` | 101KB | Main bot (commands, handlers, AI) |
| `telegram-bot/solana-wallet.js` | 18KB | Wallet creation/signing |
| `telegram-bot/sessions.json` | — | User sessions |
| `telegram-bot/wallets.json` | — | Wallet store |
| `telegram-bot/.env` | — | Bot token, RPC, API keys |

---

### 4. Dispute / Compliance Dashboard (settle — port 3000)
Where compliance team reviews and resolves disputes.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Compliance Dash | `settle/src/app/compliance/page.tsx` | — | `/compliance` |
| Arbiter Panel | `settle/src/app/arbiter/page.tsx` | — | `/arbiter` |

**API routes used:**
- `/api/compliance/disputes` — list disputes
- `/api/compliance/disputes/[id]/resolve` — propose resolution
- `/api/compliance/disputes/[id]/finalize` — force-resolve with escrow action
- `/api/disputes/[id]/arbitration` — arbitration panel
- `/api/disputes/[id]/arbitration/members` — panel members
- `/api/arbiters/[id]/votes` — arbiter votes
- `/api/disputes/resolved` — resolved disputes

---

### 5. Admin Dashboard (settle — port 3000)
Platform-wide overview, stats, merchant management.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Admin Dash | `settle/src/app/admin/page.tsx` | 1,151 | `/admin` |

**API routes used:**
- `/api/admin/stats` — platform stats
- `/api/admin/orders` — all orders
- `/api/admin/merchants` — all merchants
- `/api/admin/activity` — activity feed
- `/api/admin/balance` — platform fees
- `/api/admin/reconciliation` — balance reconciliation

---

### 6. Live Dashboard (settle — port 3000)
Real-time transaction monitoring and controls.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Live Dash | `settle/src/app/admin/live/page.tsx` | 483 | `/admin/live` |

---

### 7. Blipscan (Explorer — port 3001)
On-chain transaction explorer.

| Page | File | Lines | URL |
|------|------|-------|-----|
| Explorer Home | `blipscan/web/app/page.tsx` | 682 | `/` |
| Trade Details | `blipscan/web/app/trade/[escrow]/page.tsx` | 596 | `/trade/:escrow` |
| Merchant Profile | `blipscan/web/app/merchant/[pubkey]/page.tsx` | 382 | `/merchant/:pubkey` |

**Indexer:** `blipscan/indexer/src/index.ts` (1,100 lines) — listens to Solana, writes to DB

**Blipscan API routes:** `blipscan/web/app/api/`
- `trades/route.ts` — list trades
- `trades/[escrow]/route.ts` — trade detail
- `merchant/[pubkey]/route.ts` — merchant data
- `merchant/[pubkey]/trades/route.ts` — merchant trades
- `stats/route.ts` — explorer stats
- `events/[escrow]/route.ts` — event stream
- `transactions/route.ts` — transactions
- `lane-operations/route.ts` — lane ops

---

## LOCKED — Core Backend & Shared Logic

> Do NOT modify in parallel sessions. Coordinate via SYNC.md.

### API Routes (`settle/src/app/api/`) — 70 endpoints

**Orders:**
- `orders/route.ts` — list/create
- `orders/[id]/route.ts` — get/update/delete (548 lines)
- `orders/[id]/escrow/route.ts` — escrow lock/release
- `orders/[id]/messages/route.ts` — chat
- `orders/[id]/events/route.ts` — timeline
- `orders/[id]/typing/route.ts` — typing indicators
- `orders/[id]/extension/route.ts` — time extensions
- `orders/[id]/dispute/route.ts` — open dispute
- `orders/[id]/dispute/confirm/route.ts` — confirm resolution
- `orders/expire/route.ts` — expire stale
- `orders/match/route.ts` — matching engine

**Merchant:**
- `merchant/orders/route.ts` (523 lines) — type inversion, price engine
- `merchant/[id]/route.ts` — profile
- `merchant/[id]/public-stats/route.ts` — public stats
- `merchant/[id]/telegram/route.ts` — telegram link
- `merchant/offers/route.ts` + `merchant/offers/[id]/route.ts` — offers
- `merchant/analytics/route.ts` — analytics
- `merchant/contacts/route.ts` — contacts
- `merchant/direct-messages/route.ts` — DMs
- `merchant/messages/route.ts` — conversations
- `merchant/notifications/route.ts` — notifications
- `merchant/transactions/route.ts` — tx history

**Auth:** `auth/user/`, `auth/merchant/`, `auth/wallet/`, `auth/admin/`, `auth/compliance/`
**Marketplace:** `offers/route.ts`, `marketplace/offers/route.ts`
**Mempool:** `mempool/route.ts`
**Finance:** `ledger/route.ts`, `convert/route.ts`, `mock/balance/route.ts`
**Social:** `ratings/route.ts`, `reputation/route.ts`, `merchants/leaderboard/route.ts`
**Corridor:** `corridor/dynamic-rate/`, `corridor/fulfillments/`, `corridor/providers/`
**Compliance:** `compliance/disputes/`, `compliance/disputes/[id]/resolve/`, `compliance/disputes/[id]/finalize/`
**Arbitration:** `disputes/[id]/arbitration/`, `disputes/resolved/`, `arbiters/`, `arbiters/[id]/votes/`
**Admin:** `admin/stats/`, `admin/orders/`, `admin/merchants/`, `admin/activity/`, `admin/balance/`, `admin/reconciliation/`
**Infra:** `pusher/auth/`, `upload/signature/`, `health/`, `ops/`, `transactions/`
**Dev:** `setup/seed/`, `setup/disputes/`, `setup/clear-orders/`, `setup/init-balances/`, `test/reset/`, `test/seed/`, `sync/balances/`, `sync/escrow/`

### Core Logic (`settle/src/lib/`)

| File | Lines | Purpose |
|------|-------|---------|
| `orders/statusResolver.ts` | 661 | `computeMyRole()`, `deriveOrderUI()`, `getNextAction()` |
| `orders/stateMachine.ts` | 360 | State transitions, timeouts, extensions |
| `orders/stateMachineMinimal.ts` | — | Minimal state machine |
| `orders/statusNormalizer.ts` | — | Status normalization |
| `orders/getNextStep.ts` | — | Next action determination |
| `orders/mappers.ts` | — | Order data mappers |
| `orders/mutationHelpers.ts` | — | Mutation utilities |
| `orders/atomicCancel.ts` | — | Atomic cancellation + refund |
| `orders/finalizationGuards.ts` | — | Finalization safety checks |
| `money/escrowLock.ts` | — | Mock escrow lock/release (atomic deduction) |
| `money/syntheticConversion.ts` | — | sAED conversion logic |
| `money/corridorSettlement.ts` | — | Corridor settlement |
| `money/platformFee.ts` | — | Fee calculations |
| `db/repositories/orders.ts` | 1,389 | Order CRUD + SQL `my_role` |
| `db/repositories/merchants.ts` | — | Merchant CRUD |
| `db/repositories/users.ts` | — | User CRUD |
| `db/repositories/ratings.ts` | — | Ratings |
| `db/repositories/disputes.ts` | — | Disputes |
| `db/repositories/transactions.ts` | — | Transactions |
| `db/repositories/corridor.ts` | — | Corridor data |
| `db/repositories/mempool.ts` | — | Mempool data |
| `db/repositories/directMessages.ts` | — | DMs |
| `db/index.ts` | — | DB pool init |
| `pusher/server.ts` | — | Server-side Pusher |
| `pusher/channels.ts` | — | Channel definitions |
| `pusher/events.ts` | — | Event types |
| `reputation/calculator.ts` | — | Reputation math |
| `reputation/repository.ts` | — | Reputation persistence |
| `price/priceProof.ts` | — | Signed price proofs |
| `scoring/blipScore.ts` | — | BlipScore algorithm |
| `proxy/coreApi.ts` | — | Core API proxy helper |

### Core API (`apps/core-api/src/`)

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | — | Fastify entry point |
| `batchWriter.ts` | — | Batch transaction writer |
| `routes/orderCreate.ts` | 291 | Order creation |
| `routes/orders.ts` | 1,025 | Order queries (largest) |
| `routes/escrow.ts` | 113 | Escrow ops |
| `routes/dispute.ts` | 306 | Dispute handling |
| `routes/conversion.ts` | 423 | Currency conversion |
| `routes/corridor.ts` | 386 | Corridor LP |
| `routes/extension.ts` | 229 | Time extensions |
| `routes/expire.ts` | 156 | Expire orders |
| `routes/debug.ts` | 72 | Debug endpoints |
| `routes/health.ts` | 11 | Health check |
| `workers/autoBumpWorker.ts` | — | Auto-bump orders |
| `workers/expiryWorker.ts` | — | Expiry monitor |
| `workers/corridorTimeoutWorker.ts` | — | Corridor timeouts |
| `workers/notificationOutbox.ts` | — | Notification queue |
| `workers/priceFeedWorker.ts` | — | Price feed |
| `ws/broadcast.ts` | — | WebSocket broadcaster |

### Shared Types (`settle/src/types/`)
- `merchant.ts` — Merchant/order types
- `user.ts` — User types

### Shared Package (`packages/settlement-core/`)
- `src/state-machine/stateMachine.ts` — Canonical state machine
- `src/finalization/atomicCancel.ts` — Cancel + refund
- `src/finalization/guards.ts` — Safety checks
- `src/db/client.ts` — DB client
- `src/config/mockMode.ts` — Mock config

---

## Hooks (`settle/src/hooks/`) — 19 files

| File | Purpose |
|------|---------|
| `useOrderActions.ts` | Order mutations (accept, cancel, release, etc.) |
| `useOrderFetching.ts` | Order queries + polling |
| `useEscrowOperations.ts` | Escrow lock/release |
| `useDisputeHandlers.ts` | Dispute actions |
| `useChat.ts` | Order chat |
| `useDirectChat.ts` | DM chat |
| `useRealtimeChat.ts` | WebSocket chat |
| `useRealtimeOrder.ts` | Real-time single order |
| `useRealtimeOrders.ts` | Real-time order list |
| `useNotifications.ts` | Notification handling |
| `useSounds.ts` | Audio notifications |
| `useMerchantAuth.ts` | Merchant auth state |
| `useWalletAuth.ts` | Wallet auth |
| `useWalletConnection.ts` | Wallet connection |
| `useDashboardAuth.ts` | Admin auth |
| `usePolling.ts` | Generic polling |
| `useMobileDetect.ts` | Mobile detection |
| `usePWA.ts` | PWA install |
| `useWebSocketChat.ts` | WS chat |

## Stores (`settle/src/stores/`) — Zustand
- `merchantStore.ts` — Merchant state
- `confirmationStore.ts` — Confirmation dialogs

## Context (`settle/src/context/`) — React Context
- `EmbeddedWalletContext.tsx` (23,255 lines) — Embedded wallet
- `SolanaWalletContext.tsx` (2,135 lines) — Solana wallet
- `PusherContext.tsx` — Real-time events
- `WebSocketChatContext.tsx` — Chat WS
- `AppContext.tsx` — App state
- `MockWalletContext.tsx` — Mock wallet
- `ThemeContext.tsx` — Theme

## Shared Components (`settle/src/components/`)
- `WalletModal.tsx` (23,943 lines) — Wallet selection
- `NotificationToast.tsx` (12,206 lines) — Notifications
- `BottomNav.tsx` — Mobile nav
- `ConfirmationModal.tsx` — Confirm dialogs
- `RatingModal.tsx` — Rating UI
- `UsernameModal.tsx` — Username setup
- `WalletConnectModal.tsx` — Wallet connect
- `MerchantWalletModal.tsx` — Merchant wallet
- `ErrorBoundary.tsx` — Error handling
- `PWAInstallBanner.tsx` — PWA banner
- `ClientWalletProvider.tsx` — Wallet provider
- `chat/` (7 files) — Chat UI (FileUpload, ImageMessage, BankInfoCard, EscrowCard, StatusEventCard)
- `mempool/` (8 files) — Mempool UI (MarketSnapshot, MempoolWidget, OrderInspector, QuoteControl, QuoteModal)
- `wallet/` (3 files) — EmbeddedWalletPanel, EmbeddedWalletSetup, UnlockWalletPrompt

---

## Database

- **PostgreSQL** localhost:5432, db: `settle`, user: `zeus`, no password
- Schema: `settle/database/schema.sql`
- Migrations: `settle/database/migrations/` (38 files)
- Reset: `settle/database/reset.sql`
- Truncate: `settle/database/truncate_all.sql`
- `.env.local` uses `DB_HOST/DB_PORT/DB_NAME/DB_USER` (NOT `DATABASE_URL`)

---

## Dev / Test / Scripts

| File | Purpose |
|------|---------|
| `settle/src/app/dev/orders/page.tsx` | Dev order list |
| `settle/src/app/dev/orders/[orderId]/page.tsx` | Dev order detail |
| `settle/src/app/ops/page.tsx` | Ops debug |
| `settle/src/app/console/page.tsx` | Dev console |
| `scripts/dev-local.sh` | Local dev stack |
| `scripts/qa-robot.sh` | QA automation |
| `scripts/run-migrations.js` | DB migrations |
| `settle/scripts/` | Various utility scripts |
| `check_merchant.js` | Merchant check (root) |
| `complete_order.js` | Order completion (root) |
| `create_order.js` | Order creation (root) |
| `fix_stuck_orders.js` | Stuck order recovery (root) |
| `test-bot.js` | Bot test (root) |
