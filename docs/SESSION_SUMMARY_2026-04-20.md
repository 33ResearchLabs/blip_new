# Session Summary — 2026-04-20

Audit → fix → end-to-end test of the Blip Money P2P escrow system. This doc lists every problem found and every fix shipped in this session, mapped to the file it lives in.

---

## A. Problems found — by where they lived

### A1. On-chain Anchor program (7 critical issues)

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 1 | **`verify_ed25519_signature` was a stub** — only checked that sig bytes were non-zero, never called `ed25519_program`, never validated the message | `blip_protocol_v2/src/instructions/match_offer_and_lock_from_lane.rs:312-329`, same stub in `match_offer.rs` | **Total drain of any funded lane** — attacker spoofs merchant pubkey, drains lane vault |
| 2 | `offer_creator` was `UncheckedAccount` and never cryptographically bound to any signature | Same files | Anyone could impersonate any merchant |
| 3 | `offer_hash` was taken from params but never recomputed from trade parameters | Same files | Valid signature could be rebound to a different counterparty/amount |
| 4 | **`release_escrow` allowed `creator OR counterparty`** | `release_escrow.rs` | Buyer (counterparty) could pull crypto before paying fiat |
| 5 | **`refund_escrow` allowed depositor to refund a Locked trade** | `refund_escrow.rs` | Merchant could yank escrow after user had sent fiat (payment-sent fraud) |
| 6 | `refund_escrow.protocol_config` was `Option` | `refund_escrow.rs` | Authority check bypassable by omitting the account |
| 7 | Vault close-account rent sent to `trade.creator` | `release/refund_escrow.rs` | Rent-harvest incentive to create dummy trades |

### A2. Backend / API

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 8 | **`POST /api/orders/[id]/escrow` trusted client-submitted `tx_hash`** — no on-chain verification | `settle/src/app/api/orders/[id]/escrow/route.ts` | Attacker submits any real USDT transfer (or transfer to themselves) → backend records fake "escrow locked", debits merchant's off-chain balance via `mockEscrowLock` |
| 9 | No reconciler — DB and on-chain could drift indefinitely | — | Drift not detected until manually discovered |
| 10 | `mockEscrowLock` ran in any environment without a prod guard | `settle/src/lib/money/escrowLock.ts` | Real balances debited without on-chain verification |

### A3. Hybrid-pricing / auction

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 11 | `lockAuctionWinner` used `merchant_id = COALESCE(merchant_id, winner)` — preserved any pre-claiming merchant | `settle/src/lib/db/repositories/auctions.ts` | `merchant_id` and `selected_merchant_id` could diverge silently. Merchant A locks escrow at base price, merchant B wins auction at a different price → accounting breaks |
| 12 | No `SELECT FOR UPDATE` on the order row before claiming auction | Same | Race between accept and finalize → both could succeed with different merchants |
| 13 | No schema-level "one winner per auction" constraint | migration 101 | Partial UNIQUE only on `(order_id, merchant_id)`, not on `status='won'` |

### A4. Frontend

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 14 | Inline `convertIdlToAnchor29` in `EmbeddedWalletContext` didn't materialize event fields → anchor@0.29 crashed at `new Program(idl)` | `settle/src/context/EmbeddedWalletContext.tsx` | **Entire `/merchant` page was a build-error overlay** |
| 15 | User-side wallet connect only PATCHed `merchants.wallet_address`, never `users.wallet_address` | Same | User row's wallet column stayed empty even with wallet connected in the UI |
| 16 | **Ghost release** — UI fabricated `server-release-fallback-${Date.now()}` strings when on-chain release failed; backend accepted them and marked order `completed` while real funds stayed locked | `settle/src/hooks/useOrderActions.ts` | DB said completed, on-chain said PaymentSent, funds stuck. Caught by reconciler: 14 status_mismatches + 270 orphans (~$174k across our wallets, $6.3M devnet-wide) |

### A5. Anchor TS client — 0.30+ IDL vs 0.29 client

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 17 | 0.30+ IDL uses **snake_case** account names; anchor 0.29 `validateAccounts` looks them up by exact name; every client call passed **camelCase** keys | `settle/src/lib/solana/idlConverter.ts` | Every `new Program(...).methods.*().accounts(...)` call threw `Invalid arguments: protocol_config not provided.` — escrow lock impossible |
| 18 | 8 instruction call sites passed **positional args** (`initializeConfig(250, 1000, 0)`, `lockEscrow(counterparty)`, etc.), but 0.30+ IDL expects a single `params` struct | `settle/src/lib/solana/v2/program.ts` | `provided too many arguments` errors — init + create + lock all blocked |
| 19 | `checkProtocolConfigExists` used `program.account.protocolConfig.fetch()`, but our IDL converter emits empty `accounts: []` to avoid crashing `new Program()` → `program.account.protocolConfig` is undefined → always returned `false` | `settle/src/lib/solana/v2/program.ts` | App tried to re-initialize the already-existing ProtocolConfig PDA on every escrow lock → `already in use (0x0)` |
| 20 | Reconciler's first implementation filtered by `dataSize: 150`, but deployed program's Trade struct is 206 bytes | `settle/src/workers/reconcileEscrow.ts` | Missed all current-version Trade accounts (caught only 64 of 1,821) |
| 21 | Status enum map hardcoded `Released=2, Refunded=3`; deployed program actually uses `Released=5`, `Refunded=6`, with `PaymentSent=3`, `Disputed=4` | `reconcileEscrow.ts` | Successfully-released trades flagged as status_mismatch false positives |

### A6. State machine trap (the stuck-trade root cause)

| # | Issue | Where | Impact |
|---|-------|-------|--------|
| 22 | The user's "Payment Sent" handler called BOTH `acceptTrade` AND `confirmPayment` on-chain. `confirmPayment` transitions `Accepted → PaymentSent`; `release_escrow` (creator-signed) cannot fire from `PaymentSent` | `settle/src/hooks/useUserOrderActions.ts:138-270` | **Every BUY order got stuck** at merchant's release step. The ghost-release fallback was the app's way of papering over it. That's how 270+ orphans built up on devnet. |
| 23 | `acceptTrade` errors were silently swallowed | Same | If accept never ran, nobody found out until release failed 5 minutes later with `CannotRelease` |

---

## B. Fixes shipped — file-by-file

### B1. Anchor program changes (non-deployed v3 repo)

- **`utils/ed25519.rs`** — new file, implements real `verify_preceding_ed25519_ix` via Instructions Sysvar introspection, plus canonical `build_offer_message` that binds program_id, offer_creator, counterparty, mint, lane_id, trade_id, amount, side, expiry, nonce
- **`match_offer_and_lock_from_lane.rs` + `match_offer.rs`** — replaced sig stubs with real verifier, added `offer_hash = sha256(canonical_message)` binding
- **`release_escrow.rs`** — restricted auth to `creator OR protocol_authority`; vault rent → treasury
- **`refund_escrow.rs`** — state-gated: `Created → creator|depositor|authority`; `Locked → authority ONLY`; `protocol_config` now required (not Option)
- **`errors/mod.rs`** — added 6 new error codes

### B2. Backend / API

- **`settle/src/lib/solana/verifyEscrowTx.ts`** — new file. Fetches `getParsedTransaction`, asserts success, Blip-V2 program touched, Trade PDA in accountKeys, USDT balance delta on derived trade vault matches expected amount exactly
- **`settle/src/app/api/orders/[id]/escrow/route.ts`** — POST route rewrite: zod tightened to base58 signature shape, cross-order replay pre-check, calls `verifyEscrowTx` before any DB write, clean 400/409/425 error contract. **PATCH** route: `release_tx_hash` zod now requires valid base58 Solana signature format — rejects `server-release-fallback-*` at 400
- **`settle/src/lib/money/escrowLock.ts`** — `mockEscrowLock` fails closed when `NODE_ENV=production` unless `ALLOW_MOCK_ESCROW=true` explicitly set

### B3. Hybrid pricing

- **`settle/database/migrations/102_auction_escrow_invariants.sql`** — partial UNIQUE on `order_bids(auction_id) WHERE status='won'`, trigger `trg_auction_lock_consistency` (on lock: winner = selected_merchant = merchant_id for BUY), trigger `trg_assert_auction_resolved_before_escrow` (can't escrow until auction resolves; BUY funder must = winner), CHECK `orders_payout_not_exceeds_escrow`
- **`settle/src/lib/db/repositories/auctions.ts`** — `lockAuctionWinner` rewritten: `SELECT FOR UPDATE` on order first, validates state + no-merchant-conflict, compare-and-swap on auction status, force-overwrites merchant_id (no more COALESCE divergence), returns tagged outcome
- **`settle/src/app/api/orders/[id]/finalize-auction/route.ts`** — handles new tagged outcomes with clean 409s

### B4. Reconciler

- **`settle/database/migrations/103_escrow_reconciliation.sql`** — new tables `escrow_reconciliation_runs` + `escrow_reconciliation_findings`, partial UNIQUE dedupe on open findings
- **`settle/src/workers/reconcileEscrow.ts`** — new worker. Scans on-chain Trade PDAs via raw `getProgramAccounts` (no Anchor dep), memcmp filter on **Anchor discriminator** (not dataSize), per-status batched RPC calls, decodes raw Trade buffers, cross-checks `orders` table, upserts 4 kinds of findings (`orphaned_escrow`, `ghost_db`, `amount_mismatch`, `status_mismatch`), correct deployed-program enum mapping
- **`settle/src/app/api/cron/reconcile-escrow/route.ts`** — new endpoint. Auth via admin HMAC OR `X-Cron-Secret` (timing-safe)

### B5. Frontend

- **`settle/src/context/EmbeddedWalletContext.tsx`** — deleted buggy inline `convertIdlToAnchor29`, uses the shared converter. Added user-side wallet sync: signs fresh challenge with embedded keypair, POSTs `/api/auth/user { action:'link_wallet' }`, backend writes `users.wallet_address`
- **`settle/src/hooks/useOrderActions.ts`** — removed `server-release-fallback-${Date.now()}` fabrication. On-chain release failure now surfaces a clear error and returns early; DB stays at `payment_sent`
- **`settle/src/hooks/useUserOrderActions.ts`** — **removed the `confirmPayment` on-chain call** (was pushing state to PaymentSent and breaking merchant release). Kept `acceptTrade` (needed for release). Replaced silent error-swallowing with a visible alert that blocks the "Payment Sent" click if accept fails

### B6. Anchor TS client

- **`settle/src/lib/solana/idlConverter.ts`** — converts snake_case IDL account names → camelCase (inline, avoiding Turbopack hoisting issues)
- **`settle/src/lib/solana/v2/program.ts`** — 8 instruction call sites wrapped in `{ ...params }` structs. `checkProtocolConfigExists` uses `getAccountInfo` instead of Anchor coder (which is unavailable under our converted IDL). `initializeProtocolConfig` has pre-flight `getAccountInfo` guard — idempotent

### B7. Environment

- **`settle/.env.local`** — added `CRON_SECRET=dev-secret-123` for cron-endpoint access

### B8. Operational scripts

- **`settle/scripts/release-stuck-trade.ts`** — standalone Node script. Takes a base58 secret key + trade PDA. Verifies signer = creator or counterparty, derives all accounts, calls `release_escrow` on-chain, optionally corrects the DB `release_tx_hash`

---

## C. What got proven by end-to-end testing

| Test | Result |
|------|--------|
| New verified escrow lock — 114 USDT merchant→vault (order `cbb7e9f9`) | ✅ On-chain tx verified, DB matches on-chain exactly |
| New verified escrow lock — 121 USDT merchant→vault (order `71b0d9be`) | ✅ Same, after all the Anchor client fixes landed |
| **Full end-to-end happy path — 131 USDT BUY (order `f8ca548c`)** | ✅ **Lock → accept → payment → release, all on-chain, zero intervention, zero drift, zero fake hashes.** First clean run. |
| **Full end-to-end happy path — 141 USDT SELL (order `de28c606`)** | ✅ **Reverse flow proven.** User-side create+lock, merchant claim+accept (on-chain counterparty updated), merchant pay fiat, user release. Exact math on fees + final balances. |
| **M2M SELL — 11 USDT (`173f758a`, gaurav → shubh-merchant)** | ✅ Role-matrix: merchant_id=seller, buyer_merchant_id=buyer. Clean release, exact fees. |
| **M2M BUY — 12 USDT (`ad11f603`, shubh-merchant → gaurav)** | ✅ Role reversal proven. Clean release, exact fees. |
| Ghost-release fabrication | ❌ Blocked: UI now surfaces error, backend schema rejects, DB stays at `payment_sent` |
| Reconciler — detect a status_mismatch | ✅ Caught `cbb7e9f9` at CRITICAL severity in ~1s |
| Reconciler — discriminator filter covers current program | ✅ 1,821 Trade accounts scanned vs. 64 under old size filter |
| Supervised release via counterparty signer (order `cbb7e9f9`) | ✅ 111.15 USDT → user, 2.85 → treasury, exact math, tx `2AKjs9wa...rZxNQ` |
| Auction flow (Phase 2) | Not yet run — only fixed-mode tested |

---

## D. What's still open

| # | Item | Status |
|---|------|--------|
| D1 | ~~Order `71b0d9be` stuck~~ | ✅ Released — counterparty-signed tx `44YK7S98...UEm9cN1`, DB flipped to `completed`, reconciler clean. `release-stuck-trade.ts` now also flips status atomically. |
| D2 | **~1,700 pre-existing orphans** on devnet (~$6.3M accounted for) | Manual per-wallet admin review — no blanket refund |
| D3 | Anchor v3 lockdown (C1–C7 in original audit) | Not deployed — edits are in a different repo; requires migration-safe redeploy |
| D4 | Original audit C7 — `platform_balance` race condition (atomic increment) | Not fixed |
| D5 | Original audit H1 — `POST /api/orders` still uses `requireAuth`, not `requireTokenAuth` | Not fixed |
| D6 | Phase 2 — full hybrid-auction end-to-end test | Not yet executed |
| D7 | Merchant's release path relies on counterparty having called `accept_trade` first | Fixed in user-side flow — not retroactive to existing stuck trades |

---

## TL;DR

Started as a security audit. Escalated to end-to-end testing when the user wanted to validate. **In the process of testing, discovered the app was on top of a stack of latent bugs** — not just security issues from the audit, but straight-up "things that don't work":

- Turbopack + buggy inline IDL converter → merchant page was a build-error wall
- Anchor 0.29 client vs 0.30+ IDL shape → every on-chain call was silently broken until the first user actually tried to lock escrow
- State machine trap in the user flow → every BUY order was engineered to get stuck and be papered over by a fake hash

**All three now fixed.** The app actually works end-to-end for a fixed-mode BUY order today. Hybrid auction + the remaining audit items still pending.
