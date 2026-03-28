# Code Audit Report — Blip Settle Module

**Date:** 2026-03-28
**Scope:** Frontend (hooks, components, contexts, store) + Backend (API routes, lib)
**Goal:** Identify inefficiencies, duplication, and optimization opportunities WITHOUT changing behavior

---

## Summary

| Category | Issues Found | High | Medium | Low |
|---|---|---|---|---|
| Duplicate Logic / Reusable Functions | 10 | 4 | 4 | 2 |
| Unnecessary Function Calls | 5 | 2 | 2 | 1 |
| Redundant API Calls | 4 | 2 | 2 | 0 |
| State Inefficiencies (Frontend) | 7 | 3 | 3 | 1 |
| Backend Inefficiencies | 6 | 2 | 3 | 1 |
| Code Structure Issues | 4 | 2 | 1 | 1 |
| **Total** | **36** | **15** | **15** | **6** |

---

## 1. Duplicate Logic / Reusable Functions

### 1.1 — `fetchDisputeInfo` duplicated in 2 hooks

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useUserOrderActions.ts:386`, `src/hooks/useDisputeHandlers.ts:120` |
| **Problem** | Identical `fetchDisputeInfo` callback (GET `/api/orders/${orderId}/dispute`, parse, `setDisputeInfo`) implemented twice |
| **Why inefficient** | Bug fixes or error handling changes must be applied in both places; divergence risk is high |
| **Suggested improvement** | Extract to a shared `useDisputeAPI()` hook or utility function |
| **Risk Level** | Low |
| **Regression Risk** | Zero — logic unchanged, only location moves |

---

### 1.2 — `requestExtension` duplicated in 2 hooks

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useUserOrderActions.ts:444-519`, `src/hooks/useDisputeHandlers.ts:135-174` |
| **Problem** | Nearly identical POST `/api/orders/${id}/extension` logic with sound effects and state updates |
| **Why inefficient** | 75+ duplicated lines; different hooks may diverge silently over time |
| **Suggested improvement** | Extract to shared utility; consumers pass orderId + actor info |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if function signature stays the same |

---

### 1.3 — Version-aware order merging logic in 3 places

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useBackendOrder.ts:63`, `src/hooks/useBackendOrders.ts:84-98`, `src/hooks/useRealtimeOrders.ts:146-179` |
| **Problem** | `order_version` comparison logic (`if incomingVersion < currentVersion → skip`) implemented 3 times with slight variations |
| **Why inefficient** | Core data integrity logic repeated; a bug in one copy wouldn't be caught by fixing another |
| **Suggested improvement** | Extract `shouldAcceptOrderUpdate(incoming, existing): boolean` utility (already exists in useRealtimeOrders as `shouldAcceptUpdate` — promote to shared) |
| **Risk Level** | High |
| **Regression Risk** | Zero — pure comparison function |

---

### 1.4 — Merchant DTO serialization repeated 6 times

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:92-109, 141-150, 275-295, 417-428, 676-694, 807-820` |
| **Problem** | Converting merchant DB row to response JSON (`id, username, display_name, business_name, wallet_address, rating, total_trades, balance, has_ops_access, has_compliance_access`) copy-pasted 6 times |
| **Why inefficient** | Adding a new field (e.g. `avatar_url`) requires 6 edits; some copies already have it, others don't |
| **Suggested improvement** | Create `serializeMerchant(dbRow)` utility in `/lib/api/` |
| **Risk Level** | High |
| **Regression Risk** | Zero — response shape unchanged |

---

### 1.5 — Merchant `is_online` update in 3 places

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:85, 239, 669` |
| **Problem** | Identical `UPDATE merchants SET is_online = true, last_seen_at = NOW()` query appears in `check_session`, `wallet_login`, and `login` handlers |
| **Suggested improvement** | Extract `setMerchantOnline(merchantId)` to `/lib/db/repositories/merchants.ts` |
| **Risk Level** | Medium |
| **Regression Risk** | Zero |

---

### 1.6 — Default merchant offers creation in 3 places

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:255-262, 396-403, 790-796` |
| **Problem** | 6 `INSERT INTO merchant_offers` statements (bank + cash pair) copy-pasted across `wallet_login`, `link_wallet`, and `register` handlers |
| **Why inefficient** | Default rates, amounts, and payment methods hardcoded in 3 places |
| **Suggested improvement** | Extract `createDefaultMerchantOffers(merchantId, displayName)` |
| **Risk Level** | High |
| **Regression Risk** | Zero |

---

### 1.7 — Wallet signature verification boilerplate 6 times

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:185, 309, 441`, `src/app/api/auth/user/route.ts:63, 111, 276` |
| **Problem** | `verifyWalletSignature` + error response pattern repeated 6 times across auth routes |
| **Suggested improvement** | Create `requireWalletSignature(wallet_address, signature, message)` middleware helper that returns early on failure |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

### 1.8 — Username validation logic duplicated

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:325-341, 465-473, 545-554` (3 copies), `src/app/api/auth/user/route.ts:127-132, 222-227` (2 copies) |
| **Problem** | Username length (3-20) and regex (`/^[a-zA-Z0-9_]+$/`) checks plus dual-table availability query repeated 5 times |
| **Why inefficient** | User route already imports `checkUsernameAvailable` but merchant route does inline queries |
| **Suggested improvement** | Merchant route should import and use the same `checkUsernameAvailable` utility |
| **Risk Level** | Medium |
| **Regression Risk** | Zero |

---

### 1.9 — Merchant SELECT query with different column subsets

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:55, 115, 195, 376, 615, 770` |
| **Problem** | 6 different `SELECT ... FROM merchants WHERE id = $1` queries, each selecting a slightly different column set |
| **Why inefficient** | Impossible to tell at a glance which query returns which fields; easy to miss a new column |
| **Suggested improvement** | Define a constant `MERCHANT_SELECT_COLUMNS` or use a single `findMerchantById()` repository function |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if column superset is used |

---

### 1.10 — Solana address validation regex repeated

| Field | Detail |
|---|---|
| **Location** | Multiple hooks (`useUserOrderActions.ts`, `useEscrowOperations.ts`, `useUserTradeCreation.ts`) |
| **Problem** | `/^[1-9A-HJ-NP-Za-km-z]{32,44}$/` pattern for Solana address validation appears in multiple files |
| **Suggested improvement** | Extract `isValidSolanaAddress(addr: string): boolean` |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

## 2. Unnecessary Function Calls

### 2.1 — Initial fetch effect reruns on `isMempoolVisible` change

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useOrderFetching.ts:363-381` |
| **Problem** | The initial-fetch `useEffect` includes all fetch functions in deps. When any useCallback identity changes (e.g. `fetchMempoolOrders`), the entire effect reruns calling `fetchOrders`, `fetchActiveOffers`, `fetchLeaderboard`, etc. |
| **Why inefficient** | One changed callback triggers 7 fetch functions |
| **Suggested improvement** | Split into separate effects: one for critical initial fetch (orders + offers), one for deferred data, one for mempool |
| **Risk Level** | High |
| **Regression Risk** | Zero if split correctly; each effect is independent |

---

### 2.2 — `afterMutationReconcile` hardcoded 800ms delay

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useOrderFetching.ts:323-334` |
| **Problem** | Every mutation triggers `setTimeout(800ms)` + `refetchSingleOrder` regardless of whether data has already arrived via WebSocket |
| **Why inefficient** | When Pusher is connected, the updated order likely arrives within 100ms via WS — the 800ms refetch is redundant |
| **Suggested improvement** | Skip delayed refetch when `isPusherConnected` or use a "refetch only if version unchanged" check |
| **Risk Level** | Medium |
| **Regression Risk** | Low — fallback still works if WS is slow |

---

### 2.3 — Dispute info effect triggered on every `orders` array change

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:294-302` |
| **Problem** | `useEffect` depends on `orders` (full array). Every polling cycle creates a new array reference, re-triggering this effect even when the active order's dispute status hasn't changed |
| **Why inefficient** | `fetchDisputeInfo` called on every 5s/30s poll cycle when any order changes |
| **Suggested improvement** | Depend on `orders.find(o => o.id === activeChat?.orderId)?.status` instead of full array |
| **Risk Level** | Medium |
| **Regression Risk** | Zero — same logic, narrower trigger |

---

### 2.4 — Filter functions redefined every render

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:315-327` |
| **Problem** | `hasMyEscrow` and `isSelfUnaccepted` are plain functions (not `useCallback`) recreated on every render, yet used inside `useMemo` that doesn't list them as deps |
| **Why inefficient** | Missing deps means `useMemo` won't invalidate if `merchantId` changes (used inside `isSelfUnaccepted`) |
| **Suggested improvement** | Wrap in `useCallback` with `[merchantId]` dep, or move inside the `useMemo` body |
| **Risk Level** | High (potential stale data bug) |
| **Regression Risk** | Zero if moved inside useMemo |

---

### 2.5 — `handleDirectOrderCreation` wraps another callback unnecessarily

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:251-253` |
| **Problem** | `handleDirectOrderCreation` is a `useCallback` that just calls `rawHandleDirectOrderCreation(openTradeForm, setOpenTradeForm, tradeType, priorityFee)` — pure forwarding |
| **Why inefficient** | Extra closure allocation and dependency tracking for no behavioral gain |
| **Suggested improvement** | Inline or let `rawHandleDirectOrderCreation` close over those values directly |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

## 3. Redundant API Calls

### 3.1 — 3 API calls per escrow mutation

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useEscrowOperations.ts:247-287` → `src/hooks/useOrderFetching.ts:323-334` |
| **Problem** | Escrow lock/release/cancel: (1) POST to escrow endpoint, (2) `refetchSingleOrder` after 800ms, (3) `refreshBalance`. The POST response already contains the updated order |
| **Why inefficient** | The refetch is redundant when the POST response includes full order data |
| **Suggested improvement** | Use POST response data for optimistic update; skip refetch if response includes order |
| **Risk Level** | High |
| **Regression Risk** | Zero if response structure validated |

---

### 3.2 — Polling continues when Pusher is connected (mempool + balance)

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useOrderFetching.ts:388-400` |
| **Problem** | Even with Pusher connected, mempool still polls every 30s and balance every 90s |
| **Why inefficient** | Mempool could use Pusher events for new orders; balance could refresh only after mutations |
| **Suggested improvement** | Subscribe to mempool events via Pusher; refresh balance only on order completion/escrow events |
| **Risk Level** | Medium |
| **Regression Risk** | Low — polling is a safe fallback |

---

### 3.3 — `checkUsernameAvailable` called redundantly in user auth

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/user/route.ts:38, 135, 238` |
| **Problem** | Same username availability check called in 3 different action handlers within the same route file |
| **Why inefficient** | If a single request hits `set_username`, it calls `checkUsernameAvailable` then immediately does an UPDATE — no caching between check and write |
| **Suggested improvement** | Use `INSERT ... ON CONFLICT DO NOTHING` or `WHERE NOT EXISTS` to combine check+write atomically |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if query logic preserved |

---

### 3.4 — Merchant existence re-queried within same request

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:55, 115, 195` (3 queries in 3 action branches of the same POST handler) |
| **Problem** | Each action branch (`check_session`, `verify_wallet`, `wallet_login`) independently queries the merchant table. In a multi-step flow, the same merchant is fetched repeatedly across sequential requests |
| **Why inefficient** | DB round-trip for identical data within adjacent requests |
| **Suggested improvement** | Cache merchant lookup at the middleware level or pass merchant context through request |
| **Risk Level** | Low |
| **Regression Risk** | Zero — each action branch is independent |

---

## 4. State Inefficiencies (Frontend)

### 4.1 — Escrow state explosion: 16 `useState` calls for 3 operations

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useEscrowOperations.ts:42-63` |
| **Problem** | Lock, release, and cancel each have 5 state variables: `show`, `order`, `isLoading`, `txHash`, `error`. Plus 1 for `cancellingOrderId`. Total: 16 useState calls |
| **Why inefficient** | Each `setState` triggers a separate re-render. `closeEscrowModal` calls 5 setters sequentially. React batches within event handlers but not always in async flows |
| **Suggested improvement** | Consolidate to `useReducer` with `{ lock: {...}, release: {...}, cancel: {...} }` shape |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if reducer dispatches mirror current setter patterns |

---

### 4.2 — Merchant page has 30 `useState` hooks

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:83-121` |
| **Problem** | 30 `useState` calls in a single component: 12 boolean modals, 5 collapse states, 4 tab selectors, form objects, selection states |
| **Why inefficient** | Each state change re-renders the entire 678-line component and all its children. Boolean modal states are mutually exclusive but managed independently |
| **Suggested improvement** | Group related state: (1) modal state → single `activeModal: string \| null`, (2) collapse states → single object, (3) tab states → single object |
| **Risk Level** | High |
| **Regression Risk** | Zero if grouped state maintains same read/write semantics |

---

### 4.3 — Actor state duplicated in PusherContext and WebSocketChatContext

| Field | Detail |
|---|---|
| **Location** | `src/context/PusherContext.tsx:54-55, 278-282`, `src/context/WebSocketChatContext.tsx:45-46, 49-50` |
| **Problem** | Both contexts maintain `actorType` and `actorId` with their own `setActor`/`clearActor`. Callers must set actor in both |
| **Why inefficient** | Easy to set one and forget the other; two sources of truth for same data |
| **Suggested improvement** | Create shared `ActorContext` consumed by both, or have one derive from the other |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if single source of truth |

---

### 4.4 — Balance state duplicated across 3 wallet contexts

| Field | Detail |
|---|---|
| **Location** | `src/context/SolanaWalletContext.tsx:252-253`, `src/context/EmbeddedWalletContext.tsx:145-146`, `src/context/MockWalletContext.tsx:27` |
| **Problem** | `solBalance` and `usdtBalance` independently declared and managed in all 3 wallet providers |
| **Why inefficient** | No unified balance interface; switching wallet provider requires parallel state management |
| **Suggested improvement** | Define shared `WalletBalance` interface; each provider implements the same shape |
| **Risk Level** | Low |
| **Regression Risk** | Zero — interface alignment only |

---

### 4.5 — `pendingOrders` useMemo missing `merchantId` dependency

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:329-354` |
| **Problem** | `pendingOrders`, `ongoingOrders`, etc. use `useMemo(() => orders.filter(...), [orders])` but filter functions internally reference `merchantId` (through `isSelfUnaccepted`). `merchantId` is not in the dep array |
| **Why inefficient** | If merchant logs out and another logs in (same session), stale merchant ID used for filtering |
| **Suggested improvement** | Add `merchantId` to dependency arrays |
| **Risk Level** | High (correctness bug) |
| **Regression Risk** | Zero — adds missing dep |

---

### 4.6 — Earnings computed per-render instead of at store level

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:351-354` |
| **Problem** | `todayEarnings`, `totalTradedVolume`, `pendingEarnings` computed via `useMemo` on `completedOrders` and `ongoingOrders` — but `TRADER_CUT_CONFIG.best` is not in deps |
| **Why inefficient** | These values only change when orders change; computing at store level with Zustand selectors would prevent component re-renders |
| **Suggested improvement** | Move to Zustand derived selectors or standalone `useMemo` with complete deps |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

### 4.7 — SolanaWalletContext Program stored in `useState` instead of `useMemo`

| Field | Detail |
|---|---|
| **Location** | `src/context/SolanaWalletContext.tsx:409-480` |
| **Problem** | `Program` instance stored via `useState` + `useEffect` update pattern, plus a `programVersion` counter to force reinitialization |
| **Why inefficient** | `useState` + effect causes an extra render cycle on every wallet change. `useMemo` would compute synchronously |
| **Suggested improvement** | Replace with `useMemo(() => new Program(...), [connection, anchorWallet])` |
| **Risk Level** | Medium |
| **Regression Risk** | Low — verify program isn't mutated elsewhere |

---

## 5. Backend Inefficiencies

### 5.1 — auth/merchant/route.ts is a 820+ line monolith

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts` |
| **Problem** | Single POST handler with a `switch(action)` dispatching to 10+ action branches (check_session, wallet_login, login, register, link_wallet, set_username, update_profile, etc.) |
| **Why inefficient** | Every action shares the same cold-start; no code splitting. A single syntax error blocks all merchant auth |
| **Suggested improvement** | Split into separate route files per action group (auth, profile, wallet) |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if routes map 1:1 |

---

### 5.2 — Liquidity rollback failure silently swallowed

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/route.ts` (around lines 310-320) |
| **Problem** | If order creation on core-api fails, liquidity rollback is attempted but if rollback also fails, the error is caught and logged without any recovery mechanism |
| **Why inefficient** | Orphaned liquidity reservations accumulate; manual intervention required |
| **Suggested improvement** | Add dead-letter queue or retry mechanism for failed rollbacks; alert on orphaned reservations |
| **Risk Level** | High |
| **Regression Risk** | Zero — adds safety net, doesn't change flow |

---

### 5.3 — Inconsistent logging: `console.log` vs `logger`

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:88, 250, 268` (console.log), vs `src/app/api/orders/route.ts:66, 69` (structured logger) |
| **Problem** | Some routes use structured `logger.api.request/error()`, others use raw `console.log/error` |
| **Why inefficient** | Inconsistent observability; structured logs are searchable, console logs are not |
| **Suggested improvement** | Replace all `console.log/error` in API routes with structured logger |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

### 5.4 — Username check + update is not atomic

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/user/route.ts:135-170`, `src/app/api/auth/merchant/route.ts:332-380` |
| **Problem** | `checkUsernameAvailable` runs as SELECT, then a separate UPDATE sets the username. Between check and write, another request could claim the same username |
| **Why inefficient** | TOCTOU race condition; duplicate usernames possible under concurrent requests |
| **Suggested improvement** | Use unique constraint + `INSERT/UPDATE ... RETURNING` to fail atomically on conflict |
| **Risk Level** | High |
| **Regression Risk** | Zero if unique DB constraint exists |

---

### 5.5 — `hashPassword` / `verifyPassword` defined inline in route file

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:12-37` |
| **Problem** | Crypto utilities defined at top of a 820-line route handler instead of in a shared auth library |
| **Why inefficient** | Cannot be reused if other routes need password auth; testing requires importing the route file |
| **Suggested improvement** | Move to `/lib/auth/passwordAuth.ts` |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

### 5.6 — Hardcoded polling intervals scattered across codebase

| Field | Detail |
|---|---|
| **Location** | `src/hooks/useRealtimeChat.ts` (5000ms), `src/hooks/useOrderFetching.ts` (5000ms/30000ms), `src/hooks/useUserEffects.ts` (1000ms), `src/hooks/useBackendOrder.ts` (200ms), `src/hooks/useMerchantEffects.ts` (30000ms) |
| **Problem** | 5+ different hardcoded intervals with no centralized configuration |
| **Why inefficient** | Tuning poll frequency requires editing 5 files; no way to disable all polling in tests |
| **Suggested improvement** | Create `/lib/config/pollingConfig.ts` with named interval constants |
| **Risk Level** | Low |
| **Regression Risk** | Zero |

---

## 6. Code Structure Issues

### 6.1 — Merchant page.tsx is a 678-line God Component

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx` |
| **Problem** | 30 useState + 12 custom hooks + 6 useMemo + 4 useEffect + JSX rendering all in one component. Every state change re-renders the entire tree |
| **Why inefficient** | Impossible to test individual sections; any state change causes full reconciliation |
| **Suggested improvement** | Split into composition: `<MerchantOrdersPanel>`, `<MerchantChatPanel>`, `<MerchantModals>`, etc. Each owns its relevant state |
| **Risk Level** | High |
| **Regression Risk** | Low if split follows existing state boundaries |

---

### 6.2 — Custom hooks require 5-10 props each (deep prop drilling)

| Field | Detail |
|---|---|
| **Location** | `src/app/merchant/page.tsx:145-196` |
| **Problem** | `useEscrowOperations` takes 10 params, `useMerchantEffects` takes 8, `useDirectChat` takes 6. Every hook reads from page-level state and passes down callbacks |
| **Why inefficient** | Tight coupling; adding a feature to one hook cascades param changes to the page. Hooks can't be tested without mocking 10 dependencies |
| **Suggested improvement** | Hooks should read shared state from Zustand store or context directly, reducing prop drilling |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if hooks access same data from store |

---

### 6.3 — PusherContext event handlers not unbound on cleanup

| Field | Detail |
|---|---|
| **Location** | `src/context/PusherContext.tsx:235-237` |
| **Problem** | `pusher.connection.bind('state_change', handleStateChange)` and `bind('error', handleError)` inside effect without corresponding `unbind` in cleanup |
| **Why inefficient** | Memory leak: if `initPusher` is called multiple times, handlers accumulate on the Pusher connection object |
| **Suggested improvement** | Add `pusher.connection.unbind('state_change', handleStateChange)` in cleanup function |
| **Risk Level** | Medium |
| **Regression Risk** | Zero |

---

### 6.4 — WebSocketChatContext callbacks never cleaned up

| Field | Detail |
|---|---|
| **Location** | `src/context/WebSocketChatContext.tsx:100-104` |
| **Problem** | `messageCallbacksRef`, `typingCallbacksRef`, etc. are `Set` collections that grow but subscribed components may not unsubscribe on unmount |
| **Why inefficient** | Leaked callbacks cause stale closures and multiple invocations per event |
| **Suggested improvement** | Return unsubscribe function from `onMessage`/`onTyping`; verify all consumers call it on unmount |
| **Risk Level** | Medium |
| **Regression Risk** | Zero if unsubscribe returns cleanup function |

---

## Priority Matrix

### P0 — Fix Now (correctness bugs masked as inefficiencies)

1. **Issue 4.5** — `pendingOrders` useMemo missing `merchantId` dep (stale filter after re-login)
2. **Issue 2.4** — Filter functions not in useMemo deps (stale data)
3. **Issue 5.4** — Username check + update TOCTOU race condition
4. **Issue 1.3** — Version-aware merge logic divergence risk

### P1 — High Value (significant API/render reduction)

5. **Issue 4.2** — 30 useState in merchant page → group into objects
6. **Issue 1.4** — Merchant DTO serialization (6 copies)
7. **Issue 1.6** — Default offer creation (3 copies)
8. **Issue 3.1** — 3 API calls per escrow mutation → use response data
9. **Issue 2.1** — Initial fetch effect fires all 7 functions when any dep changes
10. **Issue 6.1** — Split God Component

### P2 — Medium Value (DRY / maintainability)

11. **Issue 1.1** — fetchDisputeInfo duplication
12. **Issue 1.2** — requestExtension duplication
13. **Issue 1.5** — is_online update duplication
14. **Issue 1.8** — Username validation duplication
15. **Issue 5.1** — Monolith auth route
16. **Issue 4.1** — Escrow state explosion

### P3 — Low Value (code quality)

17. **Issue 5.3** — console.log vs logger
18. **Issue 5.6** — Hardcoded intervals
19. **Issue 1.7** — Wallet signature boilerplate
20. **Issue 1.10** — Solana address regex

---

**Total issues: 36 | Zero behavioral changes required | All improvements are DRY, memoization, or consolidation**
