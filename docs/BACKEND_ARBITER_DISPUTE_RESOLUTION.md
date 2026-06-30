# Backend-Arbiter Dispute Resolution (Option A)

> Branch: `feature/backend-arbiter-dispute-resolution` — **not merged, not deployed, all feature flags OFF.**
> Goal: make the **backend** an on-chain arbiter that signs dispute settlement, so disputes settle on-chain **before** the DB is finalized — while keeping the existing **human compliance-wallet** flow as a fallback. Mainnet is untouched.

---

## TL;DR

- A disputed escrow could be marked "resolved" in the DB while the USDT stayed locked on-chain (DB-first finalize, optional tx hash, a fail-open client step, and a broken `actor_type:"system"` PATCH). `split` silently released 100%. The finalize route trusted a body `complianceId`, had no conflict-of-interest guard, and a toothless vote tally.
- This branch makes finalization **blockchain-first**, adds a **backend arbiter** that can settle server-side, hardens the route, and adds a **recovery reconciler** that repairs the chain-success/DB-failure window.
- Everything new is **behind flags that default OFF**. With flags off, behavior is identical to `main` except the route is now correctly ordered (settle → confirm → finalize) and the security holes are closed.
- **Verified:** `tsc` 0 errors; **+19 new unit tests** (47 dispute tests total) all pass; **zero new test failures vs `main`** (same 12 pre-existing failing suites / 72 failures on both branches).
- **Not done (manual, blocked on the devnet protocol authority key `K2WFx…`):** the on-chain `set_arbiters` registration and the live devnet on-chain e2e.

---

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Security + DB safety on the finalize route + helper | ✅ code complete |
| 2 | Backend arbiter service (server-side settlement) behind a flag | ✅ code complete |
| 4 | Recovery & reconciliation worker (done before Phase 3 by request) | ✅ code complete |
| 3 | Devnet arbiter registration + startup validation + readiness gate | ✅ code/scripts complete; **on-chain registration + live e2e are manual & pending** |

---

## Architecture / execution flow

```
Compliance officer → POST /api/compliance/disputes/[id]/finalize
   ├─ rate limit · requireAuth · hasComplianceAccess
   ├─ require Idempotency-Key
   ├─ bind acting officer to auth.actorId  (body complianceId must match, else 403)
   ├─ reject 'split' → 400
   ├─ conflict-of-interest: officer must not be a party to the trade → 403
   └─ settlement-before-finalize gate (escrowed + real mode):
        if a settlement hash is already supplied (human wallet settled) → use it
        else if backend arbiter ENABLED && READY:
              resolveDisputeFromBackend()  → build resolve_dispute
                                            → sign with arbiter key
                                            → confirmTransaction('confirmed')
                                            → return tx hash
        else → 400 "settle on-chain first" (human-wallet fallback)
   → atomicFinalizeDispute({ ..., requireSettlementTx })
        SELECT … FOR UPDATE · status='disputed' re-check · order_version guard
        · refund/release · idempotent ledger ON CONFLICT · real-mode no cache credit
        · dispute=resolved · order_events · notification_outbox · chat
   → Pusher / WebSocket / Telegram (outbox worker republishes)

Recovery (independent worker): disputeReconciler
   for orders still 'disputed' with on-chain escrow and no recorded settlement hash:
        read AUTHORITATIVE on-chain Trade.status
          Released(5) → finalize 'user' (completed)
          Refunded(6) → finalize 'merchant' (cancelled)
        → atomicFinalizeDispute (same guards; never double-pays; never touches finalized)
   startup scan + 30s poll + per-order exponential backoff
```

---

## Files changed (branch vs `main`)

**Phase 1 — security & DB safety**
- `settle/src/lib/orders/atomicFinalizeDispute.ts` — opt-in `requireSettlementTx` guard (default off → existing tests unaffected); refuses to finalize an escrowed order without the matching confirmed hash.
- `settle/src/app/api/compliance/disputes/[id]/finalize/route.ts` — bind `complianceId`→`auth.actorId`; conflict-of-interest 403; `split`→400; require `Idempotency-Key`; settlement-before-finalize gate.
- `settle/src/hooks/useDisputeManagement.ts` — blockchain-first reorder (settle → finalize with hash); removed the broken `actor_type:"system"` PATCH; defers to backend when its public flag is on.
- `settle/tests/unit/atomicFinalizeDispute.test.ts` — +4 tests for the guard.

**Phase 2 — backend arbiter service**
- `settle/src/lib/solana/backendArbiter.ts` (new) — loads dedicated `BACKEND_ARBITER_KEYPAIR` (falls back to `BACKEND_SIGNER_KEYPAIR`); `isBackendArbiterEnabled()` (`BACKEND_ARBITER_ENABLED`, default off).
- `settle/src/lib/solana/backendResolve.ts` (new) — `resolveDisputeFromBackend()`: build → sign → confirm → return hash (mirrors `backendRefund.ts`).

**Phase 4 — recovery & reconciliation**
- `settle/database/migrations/177_dispute_reconcile_backoff.sql` (new) — `dispute_reconcile_{attempts,after,error}` + partial index.
- `settle/src/workers/disputeReconciler.ts` (new) — reconciler worker (startup scan + poll loop + backoff), gated by `DISPUTE_RECONCILER_ENABLED`.
- `settle/src/app/api/cron/reconcile-disputes/route.ts` (new) — admin/`CRON_SECRET` manual trigger.
- `settle/server.js` — flag-gated worker spawn.
- `settle/tests/unit/disputeReconciler.test.ts` — +8 tests.

**Phase 3 — registration + startup validation**
- `settle/src/lib/solana/backendArbiterReadiness.ts` (new) — fail-closed validation (key/RPC/program id/ArbiterSet PDA/on-chain registration); startup log; per-finalize gate.
- `settle/src/instrumentation.ts` / `settle/src/instrumentation-node.ts` — fire-and-forget startup validation (Node runtime).
- `settle/scripts/register-backend-arbiter.ts` (new) — devnet-only, idempotent **union** registration (preserves existing arbiters), DRY_RUN, post-verify, refuses mainnet.
- `settle/scripts/generate-arbiter-keypair.ts` (new) — mint a dedicated arbiter key.
- `settle/tests/unit/backendArbiterReadiness.test.ts` — +7 tests.
- `settle/.env.example` — documents the new vars.

---

## Feature flags (all default OFF)

| Flag | Scope | Effect |
|---|---|---|
| `BACKEND_ARBITER_ENABLED` | server | enables backend on-chain settlement (only if readiness validation passes) |
| `NEXT_PUBLIC_BACKEND_ARBITER_ENABLED` | client | compliance client defers signing to the backend |
| `DISPUTE_RECONCILER_ENABLED` | server | spawns the recovery reconciler + startup scan |
| `BACKEND_ARBITER_KEYPAIR` | server | dedicated arbiter secret (base58); falls back to `BACKEND_SIGNER_KEYPAIR` if unset |

**Flag-combination behavior (no double-settlement in any combo):**

| Server | Client | Behavior |
|---|---|---|
| OFF | OFF | current production (human wallet signs) |
| ON | OFF | human wallet signs (client passes hash → backend skipped) |
| OFF | ON | human wallet must sign (client defers, no hash → 400 until wallet connected) |
| ON | ON | backend signs **iff readiness passes**, else human-wallet fallback |

> ⚠️ **Two-flag coupling:** "fully backend" requires BOTH the server and client flags set together. This is operational, not enforced in code.

---

## On-chain state (RPC-verified)

- **Backend refund signer:** `9Zj5WD5MJAwMvCiqes8oY3UJai8GHn4KTNVUCdvzXsSy` (funded; signs refunds only; **not** an arbiter).
- **Devnet** program `AzhunmkEJEBa7RBjhgwvax8WdKZGMfmF8EHbMG1a4ez8` — ArbiterSet exists, 4 arbiters = the human compliance wallets (`FD4Mqh…`, `FxXGL…`, `GbYh4…`, `GdaNz…`); authority `K2WFx…`.
- **Mainnet** program `gfFC2pjvRCALNehRWJb2ce81eDXJMwJdg9W7yeLyBqS` — **ArbiterSet account does not exist** (`set_arbiters` never run); authority `BEV2d9i6…`. Out of scope here.
- On-chain `resolve_dispute` can only pay the **buyer or the seller** (never an arbitrary wallet) — a compromised arbiter key can misroute/grief but **cannot drain to an attacker**. `split` is **not supported on-chain** (binary enum) and would require a Rust upgrade + redeploy.

---

## Enable runbook (DEVNET only)

```bash
# 1. Mint a dedicated arbiter key (store the secret securely; never commit)
tsx scripts/generate-arbiter-keypair.ts

# 2. Fund the new arbiter pubkey with devnet SOL (airdrop)

# 3. Configure the key
#    BACKEND_ARBITER_KEYPAIR=<dedicated base58 secret>

# 4. Dry-run the registration (reads current set, plans the union, signs nothing)
DRY_RUN=true tsx scripts/register-backend-arbiter.ts

# 5. Register on-chain — REQUIRES the devnet protocol authority key (K2WFx…)
ARBITER_REGISTRATION_AUTHORITY=<K2WFx secret> tsx scripts/register-backend-arbiter.ts
#    (or AUTHORITY_KEYPAIR_PATH=<solana json>)

# 6. Enable recovery FIRST, then the arbiter
#    DISPUTE_RECONCILER_ENABLED=true
#    BACKEND_ARBITER_ENABLED=true
#    NEXT_PUBLIC_BACKEND_ARBITER_ENABLED=true

# 7. Restart. Startup log must print: "[BackendArbiter] READY"
#    If it prints "NOT READY", the route safely falls back to the human-wallet flow.

# Manual recovery lever (any time, admin/CRON_SECRET gated):
#   POST /api/cron/reconcile-disputes
```

---

## Recovery / failure handling (Phase 4)

The reconciler reads the **authoritative on-chain `Trade.status`** and finalizes via `atomicFinalizeDispute` (so it inherits the row lock, status guard, `order_version` guard, idempotent ledger, and real-mode no-cache-credit). It covers:

| Scenario | Recovery |
|---|---|
| Chain success + DB failure | reconciler reads terminal status → finalizes |
| Confirmation timeout (tx lands later) | next tick finalizes |
| Server restart mid-settlement | startup scan finalizes on boot |
| Already settled / raced | helper status guard → idempotent no-op |
| RPC failure / not-yet-terminal | exponential backoff, retry |
| Trade account closed before read | parks for manual review after 10 attempts (does **not** guess) |

**Never double-pays** (real mode skips DB cache credit; ledger `ON CONFLICT`); **never changes finalized orders** (status guard).

---

## Testing status

- ✅ `tsc --noEmit` = 0 errors.
- ✅ Dispute unit tests: `atomicFinalizeDispute` (32) + `disputeReconciler` (8) + `backendArbiterReadiness` (7) = **47 pass**.
- ✅ **Zero regressions:** full unit suite on this branch vs `main` — identical 12 pre-existing failing suites / 72 failures on both; branch adds **+19 passing tests** (the new dispute tests). The 72 failures pre-date this work (auth/ws/mock-mode/`atomicCancel` suites).
- ✅ Registration script verified live on devnet via DRY_RUN (reads 4 existing arbiters → plans 5; idempotent no-op + mainnet-refusal guards confirmed).
- ⏳ **Live devnet on-chain e2e: NOT run** — blocked on the manual `set_arbiters` registration (needs `K2WFx…`) + funded test wallets.

---

## Remaining risks / not production-ready

1. **Not registered on-chain / not e2e-tested live.** Until the devnet registration + live e2e are done, enabling the flags yields the safe "NOT READY → human fallback" state, not backend settlement.
2. **Two-flag coupling** (server + client) is operational, not code-enforced.
3. **Closed-trade reconciliation edge** parks for manual review (deliberately does not guess the outcome).
4. **Settlement hash is best-effort** when reconciling (most-recent trade-PDA signature, or a `reconciled:onchain-<status>` marker).
5. **`split` is unsupported** (rejected at the route); real proportional split needs a Rust program upgrade + redeploy.
6. **Mainnet** ArbiterSet is absent (needs `BEV2…`); mainnet enablement is entirely out of scope here.

---

## Security notes

- Arbiter secret loaded **server-side only**; only the **public** key is ever logged.
- Recommend a **dedicated** arbiter key (separate from the refund fee-payer) so the two privileges rotate/monitor independently. Key rotation = `set_arbiters` with the new key in the union.
- Invalid/unregistered arbiter ⇒ readiness fails ⇒ backend settlement disabled (fail-closed); the app keeps running on the human-wallet path.
- Finalize route: token-bound officer identity, conflict-of-interest rejection, idempotency-key required.
