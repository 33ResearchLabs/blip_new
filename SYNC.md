# SYNC — Multi-Session Tracker

> Every Claude Code session MUST read this before starting and update it before finishing.

---

## Active Sessions

<!-- Add yourself here when starting work. Remove when done. -->

| Session | Zone | Working On | Started |
|---------|------|------------|---------|
| — | — | No active sessions | — |

---

## Zone Status

| Zone | Area | Status | Last Updated |
|------|------|--------|--------------|
| **A** | Merchant Dashboard | FREE | — |
| **B** | User App | FREE | — |
| **C** | Telegram Bot | FREE | — |
| **D** | Dispute Dashboard | FREE | — |
| **E** | Admin Dashboard | FREE | — |
| **F** | Live Dashboard | FREE | — |
| **G** | Blipscan | FREE | — |
| **H** | Styles/CSS | FREE | — |

---

## Requests (Need LOCKED File Changes)

<!-- If you need a LOCKED file modified, log it here so it can be coordinated. -->

| Requester | File | Change Needed | Status |
|-----------|------|---------------|--------|
| — | — | — | — |

---

## Changelog

<!-- Log what you changed, most recent first. -->

| Date | Session/Zone | Changes | Files Touched |
|------|-------------|---------|---------------|
| 2026-03-01 | core-api (stored proc) | **Fix double-accept race condition**: `accept_order_v1` stored proc idempotency check only caught `status='accepted'`, but accepting escrowed orders keeps status as `escrowed` — second accept slipped through and corrupted `merchant_id = buyer_merchant_id`. Fixed by also checking `accepted_at IS NOT NULL`. Added safety net: RAISE EXCEPTION if `merchant_id = buyer_merchant_id` after update. Fixed 2 active self-referencing orders (`a1e4b5f1`, `0d01071f`). | `accept_order_v1` stored procedure (PostgreSQL) |
| 2026-02-28 | C,E,core-api | **escrow_funded flag**: BUY orders with createTrade intent now stay `pending` (not `escrowed`). Added `escrow_funded` boolean to order creation payload. SELL = true (funds locked), BUY = false (intent only). | `apps/core-api/src/routes/orderCreate.ts`, `settle/src/app/api/merchant/orders/route.ts`, `settle/src/app/api/orders/route.ts`, `settle/src/lib/validation/schemas.ts`, `settle/src/hooks/useOrderActions.ts`, `telegram-bot/handlers/orders.js` |
| 2026-02-28 | E | **Transactions page fixes**: (1) Sorting now uses max of all timestamps instead of `\|\|` chain — newest orders appear first. (2) On-chain events for BUY intents labeled "Trade Intent" (cyan) vs "Escrow Lock" (orange). | `settle/src/app/api/transactions/route.ts`, `settle/src/app/transactions/page.tsx` |
| 2026-02-28 | core-api | **expiry_minutes**: Merchant orders route now respects `expiry_minutes` from settle instead of hardcoded 15min. | `apps/core-api/src/routes/orderCreate.ts` |

---

## Known Issues / Warnings

<!-- Things the next session should know about. -->

- 55 pre-existing TS errors in page-test.tsx, mempool, convert, match — ignore these
- page-test.tsx is a stale copy of page.tsx — don't use it
- SINR_MINTING_GUIDE.md is outdated (references INR/rate 92)
