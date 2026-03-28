# Security Audit Report

**Application:** Blip P2P Money Exchange (settle)
**Date:** 2026-03-28
**Scope:** Full-stack (frontend, API routes, backend services, realtime, database)

---

## 1. Executive Summary

**Overall Security Score: 4.5 / 10**

The application has strong fundamentals in some areas (parameterized SQL, transactional escrow, state machine validation) but contains several critical vulnerabilities that could lead to financial loss, identity hijacking, and unauthorized access. The most dangerous pattern is the client-side identity trust model -- actor IDs are read from localStorage and sent as headers, with no cryptographic proof of identity on most endpoints.

**Top-Level Risks:**

- **CRITICAL:** Unauthenticated endpoints allow wallet takeover and username hijacking
- **CRITICAL:** Rate limiting is globally disabled in production (`if (true) return null`)
- **CRITICAL:** Message sender identity is never verified against auth context
- **CRITICAL:** Compliance verification falls back to `return true` on DB error
- **CRITICAL:** Real API key (Resend) committed in `.env.example`
- **HIGH:** SQL injection via template literal interpolation in financial queries
- **HIGH:** Idempotency keys for financial transactions use `Date.now()` (non-deterministic)

---

## 2. Vulnerability Report

### CRITICAL SEVERITY

#### C1. Unauthenticated Wallet Update -- Account Takeover

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:837-879` -- PATCH handler |
| **Description** | `PATCH /api/auth/merchant` accepts `merchant_id` and `wallet_address` from the request body with zero authentication. No signature, no session, no token. |
| **Exploit** | Attacker calls `PATCH /api/auth/merchant` with `{"merchant_id":"<victim>","wallet_address":"<attacker-wallet>"}`. Victim's wallet is now attacker's. All future escrow releases and payouts go to attacker. |
| **Fix** | Require wallet signature verification (existing `verifyWalletSignature`) proving ownership of the NEW wallet before allowing update. |
| **Regression Risk** | ZERO -- adds a guard, doesn't change flow |

#### C2. Unauthenticated Username Update -- Identity Hijacking

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/merchant/route.ts:519-573` -- `update_username` action |
| **Description** | `POST /api/auth/merchant` with `action: "update_username"` accepts any `merchant_id` from the body. No signature, no session check. |
| **Exploit** | Attacker renames any merchant to a confusing name, enabling social engineering attacks against users who trust merchant display names. |
| **Fix** | Require wallet signature or session token proving the caller owns `merchant_id`. |
| **Regression Risk** | ZERO |

#### C3. Rate Limiting Globally Disabled

| Field | Detail |
|---|---|
| **Location** | `src/lib/middleware/rateLimit.ts:185-187` |
| **Description** | `if (true as boolean) return null;` -- every call to `checkRateLimit()` returns null (allowed). All auth endpoints, financial mutations, and chat messages are unprotected. |
| **Exploit** | Brute-force merchant passwords. Spam order creation. Flood chat messages. DDoS any endpoint. |
| **Fix** | Remove the `if (true as boolean) return null;` line. The actual rate limit logic below it is already implemented. |
| **Regression Risk** | ZERO -- restores intended behavior |

#### C4. Message Sender Spoofing -- No Identity Verification

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/[id]/messages/route.ts:104,144-154` |
| **Description** | `sender_type` and `sender_id` come from the request body. The endpoint checks `hasAccess` against `auth.actorId`, but then stores the message with client-provided `sender_id` -- never asserting `sender_id === auth.actorId`. |
| **Exploit** | Authenticated merchant sends message with `sender_type: "compliance"`, `sender_id: "<compliance-officer-id>"`. Message appears to come from compliance. Could manipulate dispute outcomes via social engineering. |
| **Fix** | Assert `sender_id === auth.actorId && sender_type === auth.actorType` before storing. |
| **Regression Risk** | ZERO -- rejects invalid senders, doesn't change valid flow |

#### C5. Compliance Verification Falls Back to `return true`

| Field | Detail |
|---|---|
| **Location** | `websocket-server.js:113-125` |
| **Description** | If the `compliance_team` table doesn't exist or any query error occurs, `verifyCompliance()` returns `true`. Any actor claiming to be compliance gets full access. |
| **Exploit** | Attacker sets `actorType: "compliance"` with any ID. If DB hiccups or table is missing, they get compliance-level access to all disputed orders and chats. |
| **Fix** | Change `catch` block to `return false`. Log the error for debugging. |
| **Regression Risk** | ZERO -- failing closed is correct behavior |

#### C6. SQL Injection via Template Literal in Financial Query

| Field | Detail |
|---|---|
| **Location** | `src/lib/db/repositories/corridor.ts:137` |
| **Description** | `deadlineMinutes` is interpolated directly into SQL: `NOW() + INTERVAL '${deadlineMinutes} minutes'`. The value originates from `data.send_deadline_minutes` which comes from API input. |
| **Exploit** | Attacker sends `send_deadline_minutes: "1 minute'; DROP TABLE orders; --"`. SQL injection executes arbitrary commands. |
| **Fix** | Use parameterized query: `NOW() + make_interval(mins => $9)` with `deadlineMinutes` as parameter. |
| **Regression Risk** | ZERO -- same behavior, safer execution |

#### C7. Real API Key Committed in Version Control

| Field | Detail |
|---|---|
| **Location** | `.env.example:50-51` |
| **Description** | A real Resend API key (`re_5sSy1So7_KUz7v3aMy9NMfpBpPMJbxXmN`) is committed in `.env.example`. This file is tracked by git and visible to anyone with repo access. |
| **Exploit** | Anyone with read access to the repository can use this key to send emails as `noreply@blipmoney.com`, potentially for phishing or impersonation. |
| **Fix** | 1) Immediately rotate the Resend API key in the Resend dashboard. 2) Replace the real key in `.env.example` with a placeholder like `re_your_resend_api_key_here`. 3) Audit git history for other committed secrets. |
| **Regression Risk** | ZERO |

---

### HIGH SEVERITY

#### H1. Client-Side Identity Trust Model (IDOR Foundation)

| Field | Detail |
|---|---|
| **Location** | `src/lib/api/fetchWithAuth.ts:13-68` |
| **Description** | All API requests inject `x-merchant-id`, `x-user-id`, `x-compliance-id` from localStorage. These headers are the primary identity mechanism. An attacker modifying localStorage or sending crafted headers can impersonate any actor. |
| **Exploit** | Open browser console -> `localStorage.setItem('blip_merchant', '{"id":"victim-merchant-uuid"}')` -> all subsequent API calls execute as victim merchant. |
| **Fix** | Issue signed session tokens (JWT or HMAC-signed cookies) at login. Validate token server-side to derive actor identity. Never trust client-provided identity headers without cryptographic proof. |
| **Regression Risk** | Medium -- requires coordinated frontend + backend changes |

#### H2. Idempotency Fallback Uses `Date.now()` -- Double-Execution Risk

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/[id]/route.ts:354-356` |
| **Description** | For financial transitions (`payment_sent`, `completed`, `cancelled`), if no `Idempotency-Key` header is provided, the fallback key includes `Date.now()`. Two retries of the same request produce different keys, bypassing idempotency. |
| **Exploit** | Network timeout on `payment_sent` -> user retries -> both requests execute with different keys -> double payment recorded. |
| **Fix** | Reject financial transitions that lack an explicit `Idempotency-Key` header. Return 400 with message: "Idempotency-Key header required for financial actions." |
| **Regression Risk** | LOW -- clients should already send this header |

#### H3. Parallel Escrow Lock -- No Upstream Database Lock

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/[id]/escrow/route.ts:279-295` |
| **Description** | The escrow lock endpoint calls `proxyCoreApi` without first acquiring a `SELECT ... FOR UPDATE` lock on the order. Two concurrent requests can both pass validation and both deduct escrow. |
| **Exploit** | Attacker sends two simultaneous POST requests to lock escrow. Both pass the "is order in valid state?" check before either commits. Balance deducted twice. |
| **Fix** | Acquire `FOR UPDATE` lock on the order row before calling `proxyCoreApi`. |
| **Regression Risk** | ZERO -- adds serialization, doesn't change logic |

#### H4. Admin Secret Accepted via Query Parameter

| Field | Detail |
|---|---|
| **Location** | `src/app/api/ops/route.ts:20-22` |
| **Description** | `const secret = request.headers.get('x-admin-secret') \|\| request.nextUrl.searchParams.get('secret')`. Query parameters are logged in access logs, browser history, CDN caches, and Referer headers. |
| **Fix** | Remove the query parameter fallback. Accept secrets only via headers. |
| **Regression Risk** | LOW -- legitimate callers should use headers |

#### H5. User Password Hashing -- SHA256 Without Salt

| Field | Detail |
|---|---|
| **Location** | `src/lib/db/repositories/users.ts:6-13` |
| **Description** | User passwords use `crypto.createHash('sha256')` -- a single unsalted hash. Rainbow table attacks trivially crack these. Meanwhile, merchant passwords use PBKDF2 with 100k iterations + salt -- a massive inconsistency. |
| **Fix** | Migrate user passwords to PBKDF2 (match merchant implementation). On next login, re-hash with strong algorithm. |
| **Regression Risk** | LOW -- transparent re-hash on login |

#### H6. Liquidity Rollback Failure Silently Swallowed

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/route.ts:310-321` |
| **Description** | If core-api fails during order creation and the liquidity rollback also fails, the error is caught and only logged. The API returns a generic error, but merchant liquidity is permanently lost. |
| **Fix** | Return 500 with explicit "CRITICAL: liquidity rollback failed" to alert the client. Add a dead-letter queue or reconciliation job to detect and recover leaked liquidity. |
| **Regression Risk** | ZERO |

#### H7. WebSocket Authentication via Plaintext Query Parameters

| Field | Detail |
|---|---|
| **Location** | `src/context/WebSocketChatContext.tsx:229`, `websocket-server.js:728-746` |
| **Description** | WebSocket connections authenticate via `?actorType=merchant&actorId=<id>` in the URL. No signature or token. Server only checks DB existence, not cryptographic proof. |
| **Fix** | Use a short-lived signed token issued at login. Pass it as the first WS message (post-connect auth handshake). |
| **Regression Risk** | Medium -- requires WS protocol change |

#### H8. Parallel Order Accept -- Double-Claim Race Condition

| Field | Detail |
|---|---|
| **Location** | `src/lib/db/repositories/orders.ts:1346-1455` (claimOrder), `src/app/api/orders/[id]/action/route.ts:319-357` |
| **Description** | `claimOrder` uses optimistic locking (`WHERE buyer_merchant_id IS NULL`), but no row-level lock is held during the validation phase in the API route. Between reading order state and executing claimOrder, another merchant could claim the order. |
| **Fix** | Apply `SELECT ... FOR UPDATE` in action route before calling handleOrderAction. |
| **Regression Risk** | ZERO |

---

### MEDIUM SEVERITY

#### M1. Pusher Channel Auth Trusts Client Headers

| Field | Detail |
|---|---|
| **Location** | `src/app/api/pusher/auth/route.ts:59-69` |
| **Description** | `x-actor-type` and `x-actor-id` headers determine Pusher channel authorization. The endpoint does verify against DB (`verifyUser`/`verifyMerchant`, `canUserAccessOrder`/`canMerchantAccessOrder`) which mitigates raw spoofing. The risk is that an authenticated user (with valid DB record) can claim a different actorId via headers. |
| **Fix** | Derive actor identity from signed session token, not client headers. |

#### M2. Auto-Escrow Deducts Balance Without Explicit User Consent

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/[id]/escrow/route.ts:366-420` |
| **Description** | When a seller calls release, if escrow isn't locked yet, the system auto-locks it (deducting balance) before releasing. The seller may not expect a balance deduction. |
| **Fix** | Return error "Escrow must be locked before release" instead of auto-locking. |

#### M3. Price Guardrails Missing on User Order Route

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/route.ts:149-181` |
| **Description** | Merchant order route has price deviation guardrails. User order route does NOT. A stale offer rate could lock in an unfavorable trade. |
| **Fix** | Apply the same `PRICE_MAX_DEVIATION` check to user order creation. |

#### M4. Compliance Access -- No Audit Trail

| Field | Detail |
|---|---|
| **Location** | `src/app/api/compliance/disputes/route.ts:22-43`, `src/app/api/compliance/disputes/[id]/resolve/route.ts:6-16` |
| **Description** | Any merchant with `has_compliance_access = true` can access ALL disputed orders. No logging of who accessed what, when, or why. |
| **Fix** | Add audit log entries for every compliance data access and action. |

#### M5. Admin/Compliance Plaintext Password Comparison -- Timing Attack

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/admin/route.ts:31`, `src/app/api/auth/compliance/route.ts:137` |
| **Description** | Uses `!==` for password comparison. Timing differences can leak password length and character matches. |
| **Fix** | Use `crypto.timingSafeEqual()` for all password comparisons. |

#### M6. Error Messages Leak Internal Details

| Field | Detail |
|---|---|
| **Location** | `src/app/api/orders/route.ts:326-334` and ~15 other routes |
| **Description** | `errorResponse(err.name + ': ' + err.message)` returns raw error names and messages to the client, potentially revealing stack details, DB schema, or internal service names. |
| **Fix** | Return generic "An error occurred" to client. Log full details server-side only. |

#### M7. Merchant Direct Messages -- No Relationship Validation

| Field | Detail |
|---|---|
| **Location** | `src/app/api/merchant/direct-messages/route.ts:44-108` |
| **Description** | A merchant can send a direct message to ANY user ID. No check for existing order relationship. |
| **Fix** | Verify an active order exists between sender and recipient before allowing messages. |

#### M8. Escrow Amount Mismatch Risk

| Field | Detail |
|---|---|
| **Location** | `src/lib/money/escrowLock.ts:87-110` |
| **Description** | When locking escrow, the code deducts `order.crypto_amount` but doesn't verify this matches `escrow_trade_id` or on-chain escrow amount. If `crypto_amount` was edited post-creation, the escrow lock will deduct the wrong amount. |
| **Fix** | Fetch escrow_trade_id from blockchain and verify amount matches before deducting. |

#### M9. Compliance Wallet Auth -- No Signature Verification

| Field | Detail |
|---|---|
| **Location** | `src/app/api/auth/compliance/route.ts:12-26` |
| **Description** | Wallet-based compliance auth only checks if wallet address is in authorized list. No cryptographic signature verification. Anyone who knows the wallet address can authenticate. |
| **Fix** | Verify wallet signature using existing `verifyWalletSignature()` function. |

---

### LOW SEVERITY

| ID | Issue | Location | Description |
|---|---|---|---|
| L1 | `Math.random()` for nonce generation | `src/lib/solana/verifySignature.ts:49` | Uses `Math.random()` instead of `crypto.randomBytes()`. Predictable nonces weaken replay protection. |
| L2 | 5-minute signature replay window | `src/lib/solana/verifySignature.ts:47-72` | No nonce tracking. Valid signatures can be replayed within 5-minute window. |
| L3 | `dangerouslySetInnerHTML` in layout | `src/app/layout.tsx:72-73` | Used for theme/SW scripts. Currently hardcoded (safe), but fragile pattern. |
| L4 | Auth context cached 5 minutes | `src/lib/middleware/auth.ts:143-172` | Revoked access remains effective for up to 5 minutes. |
| L5 | Inconsistent error response format | Various routes | Some use `errorResponse()`, others use raw `NextResponse.json()`. |
| L6 | No CSRF token on mutations | All POST/PATCH routes | Mitigated by header-based auth, but defense-in-depth recommends CSRF tokens. |

---

## 3. Critical Risks -- Top Priority Fixes

### Fix Immediately (Day 1)

| Priority | Issue | Effort | Impact |
|---|---|---|---|
| P0 | **C7** -- Rotate Resend API key, replace with placeholder in .env.example | 5 min | Prevents email impersonation |
| P0 | **C3** -- Re-enable rate limiting (delete one line) | 1 min | Prevents brute force on all endpoints |
| P0 | **C1** -- Add auth to PATCH wallet update | 30 min | Prevents wallet account takeover |
| P0 | **C2** -- Add auth to update_username | 30 min | Prevents identity hijacking |
| P0 | **C5** -- Change compliance fallback to `return false` | 1 min | Prevents compliance impersonation |
| P0 | **C4** -- Assert sender_id === auth.actorId in messages | 15 min | Prevents message spoofing |
| P0 | **C6** -- Parameterize corridor SQL | 15 min | Prevents SQL injection |

### Fix Within First Week

| Priority | Issue | Effort |
|---|---|---|
| P1 | **H2** -- Require explicit Idempotency-Key for financial ops | 1 hour |
| P1 | **H3** -- Add FOR UPDATE before escrow proxy call | 1 hour |
| P1 | **H4** -- Remove query param secret fallback | 5 min |
| P1 | **H5** -- Migrate user passwords to PBKDF2 | 2 hours |
| P1 | **H6** -- Surface rollback failures to client | 30 min |
| P1 | **H8** -- Add FOR UPDATE before order claim | 1 hour |

---

## 4. Safe Fix Recommendations

All fixes below preserve existing business logic, API contracts, and state flow:

1. **Rate limiting**: Delete line 187 in `rateLimit.ts` -- the entire implementation already exists below it
2. **Auth guards on PATCH/update_username**: Add `verifyWalletSignature()` call before the DB update -- same pattern used in `wallet_login` action
3. **Compliance fallback**: Change `return true` to `return false` in the catch block
4. **Message sender verification**: Add one `if` statement: `if (sender_id !== auth.actorId) return forbiddenResponse()`
5. **SQL parameterization**: Replace `'${deadlineMinutes} minutes'` with `make_interval(mins => $N)`
6. **Idempotency**: Reject financial transitions missing `Idempotency-Key` header with 400
7. **Password comparison**: Replace `!==` with `crypto.timingSafeEqual()` in admin/compliance auth
8. **Error messages**: Replace `${err.message}` in client responses with generic text
9. **API key rotation**: Rotate Resend key immediately, scrub `.env.example`

---

## 5. Optional Hardening (Future Improvements)

| Enhancement | Description | Effort |
|---|---|---|
| **Signed session tokens** | Replace localStorage ID headers with server-issued JWTs. Eliminates entire IDOR class (H1, M1). | Large |
| **WebSocket post-connect auth** | Issue short-lived token at login, verify as first WS message | Medium |
| **Compliance RBAC** | Replace boolean `has_compliance_access` with role-based assignment per dispute | Medium |
| **Nonce replay tracking** | Store used nonces in Redis with TTL to prevent signature replay within the 5-min window | Small |
| **Audit log table** | Log all compliance access, admin privilege changes, and financial actions | Medium |
| **CSP nonce for inline scripts** | Replace `dangerouslySetInnerHTML` with Next.js Script component + nonce | Small |
| **Dead-letter queue for rollbacks** | Detect and auto-recover leaked liquidity from failed rollbacks | Medium |
| **DB constraint on status transitions** | Add CHECK constraint or trigger preventing backward status changes | Small |
| **Git secret scanning** | Add pre-commit hook with tools like `gitleaks` or `trufflehog` to prevent future credential commits | Small |

---

## 6. Positive Security Controls Found

The following security measures are already well-implemented:

- Parameterized SQL queries across most of the codebase (except noted exceptions)
- `SELECT ... FOR UPDATE` locks on most financial operations
- `order_version` increment for optimistic concurrency control
- Transaction atomicity wrapping critical operations (cancel, claim, lock)
- Idempotency log table for replay protection on financial actions
- State machine validation enforcing role and status rules before DB updates
- Ownership validation on most API routes (auth.actorId matches request)
- Escrow-first model preventing SELL orders from proceeding without escrow
- PBKDF2 with 100k iterations for merchant password hashing
- Security headers configured (HSTS, X-Frame-Options, CSP)
- Pusher channel auth with DB-level verification of order access
- Admin token using HMAC-SHA256 with timing-safe comparison

---

## Summary

| Severity | Count |
|---|---|
| Critical | 7 |
| High | 8 |
| Medium | 9 |
| Low | 6 |
| **Total** | **30** |

The 7 Critical fixes are straightforward (most are single-line or single-function changes) and should be deployed immediately. The identity trust model (H1) is the most architecturally significant issue but requires coordinated work -- it should be planned as a sprint-level effort.
