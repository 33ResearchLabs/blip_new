# Blip Money P2P — End-to-End Manual Testing Document

**Version:** 1.0
**Date:** 2026-03-31
**App:** Blip Money Settle (P2P USDC/AED Trading Platform)
**Prepared for:** QA Team — Pre-Production Release

---

## 1. Testing Scope

### In Scope

| Module | Description |
|--------|-------------|
| **Auth** | Email login, wallet login, 2FA (TOTP), session management, token refresh, logout |
| **Merchant Dashboard** | Orders, offers, analytics, wallet, settings, contacts, DM, mempool |
| **User App** | Onboarding, order creation, payment flow, chat, ratings, disputes |
| **Order Lifecycle** | Create > Accept > Escrow > Payment > Complete (all branches) |
| **Escrow** | Lock, release, refund — mock mode + on-chain |
| **Chat** | Real-time messaging, typing indicators, read receipts, compliance controls |
| **Notifications** | In-app, Pusher real-time, toast messages |
| **Compliance Panel** | Dispute investigation, chat freeze, resolution, finalization |
| **Admin Panel** | Stats, merchant management, reconciliation, audit log |
| **2FA** | Setup, verify, login gate, disable |
| **Ratings & Reviews** | Post-trade rating, leaderboard |
| **Payments** | Bank, UPI, Cash payment methods — add, select, lock to order |
| **API Security** | Auth enforcement, rate limiting, injection prevention |

### Out of Scope

- Solana mainnet transactions (devnet only during testing)
- Telegram bot integration (requires separate bot setup)
- Load/stress testing (separate phase)
- Automated E2E test suite (manual only in this doc)

---

## 2. Test Environment Setup

### Environments

| Env | URL | Database | Blockchain | Pusher |
|-----|-----|----------|------------|--------|
| **Local Dev** | `localhost:3000` | Local Postgres (`settle`) | Solana Devnet | Test keys |
| **Staging** | TBD | Staging Postgres | Solana Devnet | Staging keys |
| **Production** | TBD | Production Postgres | Solana Mainnet | Production keys |

### Required Configuration (.env.local)

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=settle
DB_USER=zeus
NEXT_PUBLIC_MOCK_MODE=true          # true for testing without Solana
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_SECRET=<any-string>           # Required for token signing
ADMIN_PASSWORD=<any-string>         # Admin panel login
COMPLIANCE_PASSWORD=<any-string>    # Compliance panel login
PUSHER_APP_ID=<test-key>
PUSHER_SECRET=<test-secret>
NEXT_PUBLIC_PUSHER_KEY=<test-key>
NEXT_PUBLIC_PUSHER_CLUSTER=ap2
TOTP_ISSUER=Blip
```

### Pre-Test Setup

1. Run migrations: `psql -U zeus -d settle -f database/migrations/067_totp_2fa.sql`
2. Seed data: `GET /api/setup/seed`
3. Init balances: `POST /api/setup/init-balances`
4. Start dev server: `pnpm dev`
5. Verify health: `GET /api/health` should return `{ success: true }`

### Browser/Device Matrix

| Browser | Desktop | Mobile |
|---------|---------|--------|
| Chrome 120+ | P0 | P0 |
| Safari 17+ | P1 | P0 (iOS) |
| Firefox 120+ | P1 | P2 |
| Edge | P2 | — |

---

## 3. Test Strategy

### Priority Levels

| Level | Definition | Examples |
|-------|-----------|---------|
| **P0** | Critical — blocks release | Login, order creation, escrow lock/release, payment flow |
| **P1** | High — major feature broken | 2FA, chat, notifications, merchant offers |
| **P2** | Medium — workaround exists | Analytics, leaderboard, profile editing |
| **P3** | Low — cosmetic | Text alignment, icon color, animation smoothness |

### Risk-Based Focus Areas

1. **Money flows** — Any bug that causes incorrect balance, double-spend, or lost funds
2. **Auth bypass** — Any path that allows unauthorized access to another user's data
3. **State machine violations** — Orders reaching invalid states (e.g., completed twice)
4. **Race conditions** — Two merchants accepting the same order simultaneously
5. **Data leakage** — Merchant seeing another merchant's orders/balance

---

## 4. Detailed Test Scenarios & Test Cases

### 4.1 Authentication — Merchant Email Login

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| AUTH-001 | Valid email login | 1. Go to `/merchant` 2. Enter valid email + password 3. Click "Sign In" | Dashboard loads, merchant name visible in header | | |
| AUTH-002 | Invalid password | 1. Enter valid email 2. Enter wrong password 3. Click "Sign In" | Error: "Incorrect email or password" | | |
| AUTH-003 | Non-existent email | 1. Enter unknown email 2. Enter any password 3. Submit | Error message displayed, no crash | | |
| AUTH-004 | Empty fields | 1. Leave email empty 2. Click "Sign In" | Button disabled OR validation error | | |
| AUTH-005 | Session persistence | 1. Login successfully 2. Close tab 3. Reopen `/merchant` | Session restored, dashboard loads without login | | |
| AUTH-006 | Logout | 1. Login 2. Go to Settings 3. Click "Log Out" | Redirected to login, session cleared | | |
| AUTH-007 | Multiple tabs | 1. Login in Tab A 2. Open `/merchant` in Tab B | Tab B should show dashboard (shared session) | | |

### 4.2 Authentication — Merchant Registration

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| AUTH-010 | Valid registration | 1. Click "Create Account" 2. Fill email, password, business name 3. Submit | Account created, redirected to dashboard | | |
| AUTH-011 | Duplicate email | 1. Register with existing email | Error: "Email already in use" or similar | | |
| AUTH-012 | Weak password | 1. Enter password < 6 chars | Error: "Password must be at least 6 characters" | | |
| AUTH-013 | Password mismatch | 1. Enter password 2. Enter different confirm password | Error: "Passwords do not match" | | |

### 4.3 Authentication — 2FA (TOTP)

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| 2FA-001 | Enable 2FA | 1. Login 2. Settings > Account 3. Click "Enable 2FA" 4. Scan QR with Google Authenticator 5. Enter 6-digit code 6. Click "Confirm" | Green "ENABLED" badge appears, success message | | |
| 2FA-002 | Login with 2FA | 1. Logout 2. Login with email+password | After password, shown 2FA code input screen | | |
| 2FA-003 | Valid 2FA code | 1. On 2FA screen, enter correct code from authenticator | Dashboard loads, fully authenticated | | |
| 2FA-004 | Invalid 2FA code | 1. On 2FA screen, enter "000000" | Error: "Invalid authenticator code" | | |
| 2FA-005 | Expired pending token | 1. On 2FA screen, wait 5+ minutes 2. Enter valid code | Error: "Invalid or expired login token. Please log in again." | | |
| 2FA-006 | Rate limiting | 1. Enter wrong code 5 times in 15 min | Error: "Too many attempts. Please wait 15 minutes." | | |
| 2FA-007 | Disable 2FA | 1. Settings > Account > "Disable 2FA" 2. Enter password + current code | Badge changes to "OFF", 2FA removed | | |
| 2FA-008 | Disable with wrong password | 1. Try disable with wrong password | Error: "Invalid password" | | |
| 2FA-009 | Cancel 2FA setup | 1. Click "Enable 2FA" 2. See QR code 3. Click "Cancel" | Returns to idle state, no 2FA enabled | | |
| 2FA-010 | Re-enable after disable | 1. Disable 2FA 2. Enable again | New QR code generated, old codes stop working | | |
| 2FA-011 | Back to login from 2FA screen | 1. On 2FA input screen 2. Click "Back to login" | Returns to email/password form | | |

### 4.4 Authorization — Role-Based Access

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| RBAC-001 | User cannot access merchant API | 1. Login as user 2. Call `GET /api/merchant/orders?merchant_id=<someone>` | 401 or 403 — "Access denied" | | |
| RBAC-002 | Merchant cannot access other merchant's orders | 1. Login as Merchant A 2. Try to fetch Merchant B's orders | Only own orders returned | | |
| RBAC-003 | Compliance can access disputed orders | 1. Login as compliance 2. Call dispute endpoints | Access granted for disputed orders | | |
| RBAC-004 | Admin requires ADMIN_SECRET | 1. Call `/api/admin/stats` without Bearer token | 401 — "Admin authentication required" | | |
| RBAC-005 | Expired token rejected | 1. Use a token older than 15 min (access token) | 401, then auto-refresh attempted | | |
| RBAC-006 | User cannot access compliance panel | 1. Login as user 2. Navigate to `/compliance` | Access denied or redirected | | |

### 4.5 Order Lifecycle — Happy Path (Buy Order)

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| ORD-001 | Create buy order | 1. User app: select amount (e.g. 100 USDC) 2. Select payment method (Bank) 3. Submit | Order created, appears in Pending list for merchant | | |
| ORD-002 | Merchant sees new order | 1. Merchant dashboard: check Pending tab | New order visible with amount, user, timer | | |
| ORD-003 | Merchant accepts order | 1. Click order 2. Click "Accept" | Order moves to In Progress, status = accepted | | |
| ORD-004 | Lock escrow (mock) | 1. Merchant clicks "Lock Escrow" | Balance deducted, order status = escrowed | | |
| ORD-005 | Mark payment sent | 1. Buyer marks fiat payment sent | Order status = payment_sent, merchant notified | | |
| ORD-006 | Confirm payment | 1. Merchant confirms payment received | Order status = payment_confirmed | | |
| ORD-007 | Complete order | 1. Merchant releases escrow | Order status = completed, balance credited to buyer | | |
| ORD-008 | Rating after completion | 1. Rate counterparty (1-5 stars) | Rating saved, visible on profile | | |

### 4.6 Order Lifecycle — Cancellation Flows

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| ORD-010 | Cancel pending order (by creator) | 1. Create order 2. Cancel before acceptance | Order removed from list, no balance change | | |
| ORD-011 | Cancel after escrow (by merchant) | 1. Accept + lock escrow 2. Request cancellation | Cancel request sent to counterparty | | |
| ORD-012 | Counterparty approves cancel | 1. Receive cancel request 2. Click "Agree to Cancel" | Order cancelled, escrow refunded | | |
| ORD-013 | Counterparty rejects cancel | 1. Receive cancel request 2. Click "Continue Order" | Order continues normally | | |

### 4.7 Order Lifecycle — Expiry & Timeout

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| ORD-020 | Pending order expires | 1. Create order 2. Wait 15 min without acceptance | Order disappears from pending list | | |
| ORD-021 | Accepted order expires | 1. Accept order 2. Don't lock escrow 3. Wait for timeout | Order expired, both parties notified | | |
| ORD-022 | Timer display accuracy | 1. Create order 2. Watch countdown timer | Timer counts down in real-time, matches server | | |

### 4.8 Order Lifecycle — Dispute

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| ORD-030 | Raise dispute | 1. After escrow locked 2. Click "Dispute" 3. Enter reason | Order status = disputed, compliance notified | | |
| ORD-031 | Compliance investigates | 1. Login as compliance 2. Open disputed order 3. View chat history | Full chat visible, can highlight messages | | |
| ORD-032 | Compliance freezes chat | 1. Compliance clicks "Freeze Chat" | Both parties cannot send new messages | | |
| ORD-033 | Compliance resolves dispute | 1. Compliance proposes resolution 2. Both parties confirm | Dispute resolved, funds released/refunded per ruling | | |

### 4.9 Merchant Offers & Spread

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| OFR-001 | Create offer | 1. Settings > Payments 2. Create offer with spread tier | Offer saved, visible in marketplace | | |
| OFR-002 | Spread tier pricing | 1. Select "Fast" tier (+2.5%) 2. Check displayed rate | Rate = ref_price * (1 + 2.5%) | | |
| OFR-003 | Priority fee / Boost | 1. Set 5% priority fee 2. Create order | Order shows in mempool with higher premium | | |

### 4.10 Chat System

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| CHAT-001 | Send text message | 1. Open order chat 2. Type message 3. Send | Message appears instantly (optimistic), then confirmed | | |
| CHAT-002 | Receive message real-time | 1. Have counterparty send a message | Message appears without page refresh | | |
| CHAT-003 | Typing indicator | 1. Start typing in chat | Counterparty sees "typing..." indicator | | |
| CHAT-004 | Read receipts | 1. Open chat with unread messages | Messages marked as read, unread count resets to 0 | | |
| CHAT-005 | Image upload in chat | 1. Click image icon 2. Upload image | Image preview appears, sent to counterparty | | |

### 4.11 Notification System

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| NOTIF-001 | Order accepted notification | 1. Merchant accepts your order | Notification appears: "Your order accepted..." | | |
| NOTIF-002 | Payment sent notification | 1. Counterparty marks payment sent | Notification + sound plays | | |
| NOTIF-003 | Trade complete notification | 1. Order completed | Notification: "Trade completed!" + balance refreshed | | |
| NOTIF-004 | No self-notification on create | 1. Create an order yourself | NO "New order" notification in YOUR panel | | |
| NOTIF-005 | Notification count badge | 1. Receive multiple notifications | Orange badge shows correct unread count | | |
| NOTIF-006 | Mark notification read | 1. Click on a notification | Notification marked as read, badge decrements | | |

### 4.12 Merchant Dashboard — Balance & Transactions

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| BAL-001 | Balance displays correctly | 1. Login to dashboard | Available balance matches DB/wallet | | |
| BAL-002 | Balance after escrow lock | 1. Lock escrow for 100 USDC | Balance decreases by 100 | | |
| BAL-003 | Balance after release | 1. Complete order, receive 100 USDC | Balance increases by 100 | | |
| BAL-004 | Transaction history shows trades | 1. Complete a trade 2. Open Transaction History | Completed trade visible with correct amounts | | |
| BAL-005 | MAX button | 1. Click MAX in amount field | Field populated with full available balance | | |

### 4.13 Payment Methods

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| PAY-001 | Add bank account | 1. Profile/Settings 2. Add bank 3. Enter name, IBAN | Bank account saved, selectable in orders | | |
| PAY-002 | Add UPI | 1. Add UPI method 2. Enter UPI ID | UPI method saved | | |
| PAY-003 | Select payment method in order | 1. Create order 2. Select from "Your Payment Method" dropdown | Selected method locked to order | | |
| PAY-004 | Payment method text visible | 1. View dropdown list | All method labels, types, and subtexts clearly readable | | |

### 4.14 Admin Panel

| ID | Scenario | Steps | Expected | Actual | Status |
|----|----------|-------|----------|--------|--------|
| ADM-001 | Admin login | 1. Go to `/admin` 2. Enter admin credentials | Admin dashboard loads | | |
| ADM-002 | View system stats | 1. Check stats endpoint | Total orders, active merchants, volume displayed | | |
| ADM-003 | View all orders | 1. Admin > Orders | All orders across all merchants visible | | |
| ADM-004 | Reconciliation report | 1. Admin > Reconciliation | Debit/credit totals match | | |

---

## 5. UI/UX Testing Checklist

### Responsive Design

| Check | Mobile (375px) | Tablet (768px) | Desktop (1440px) | Status |
|-------|---------------|----------------|-------------------|--------|
| Login screen layout | | | | |
| Merchant dashboard — no horizontal scroll | | | | |
| Order cards readable | | | | |
| Chat window usable | | | | |
| Settings page — all fields accessible | | | | |
| Modals don't overflow viewport | | | | |
| Bottom nav (mobile) doesn't cover content | | | | |

### Button & Interactive States

| Check | Status |
|-------|--------|
| Disabled buttons have reduced opacity | |
| Loading buttons show spinner + disabled state | |
| "Add Account" button visible above bottom nav | |
| All clickable text has hover state | |
| Form inputs show focus ring on focus | |
| Close (X) buttons on all modals work | |

### Text Visibility

| Check | Status |
|-------|--------|
| Payment method dropdown text readable (neutral-400+) | |
| Notification badge clearly visible (solid bg) | |
| Unlock wallet "Import key" / "New wallet" / "Cancel" readable | |
| Order detail modal — text not oversized | |
| Dark mode text contrast meets WCAG AA (4.5:1 minimum) | |

### Loading States

| Check | Status |
|-------|--------|
| Dashboard shows loader while orders fetch | |
| "No active trades" empty state when no orders | |
| Settings page shows loader while data loads | |
| Transaction history shows loader then data | |

---

## 6. Performance Testing (Manual Observations)

| Metric | Acceptable | Steps to Verify | Actual | Status |
|--------|-----------|-----------------|--------|--------|
| Login → dashboard load | < 3s | Login and time until orders visible | | |
| Order creation → appears in list | < 2s | Create order, check it appears | | |
| Chat message send → visible | < 500ms | Send message, check instant display | | |
| Real-time order update (Pusher) | < 1s | Accept order on one device, check other | | |
| Page refresh → data reload | < 2s | Hard refresh merchant dashboard | | |
| Settings page load | < 2s | Navigate to Settings | | |
| Transaction history modal open | < 1s | Click to open, check data loads | | |

---

## 7. Regression Testing Checklist

Run these for EVERY release:

| # | Critical Flow | Status |
|---|---------------|--------|
| 1 | Merchant can login (email + wallet) | |
| 2 | User can login (wallet) | |
| 3 | Order can be created | |
| 4 | Order can be accepted by merchant | |
| 5 | Escrow can be locked (mock mode) | |
| 6 | Payment can be marked sent | |
| 7 | Payment can be confirmed | |
| 8 | Order can be completed (escrow released) | |
| 9 | Balance updates correctly after trade | |
| 10 | Chat messages deliver in real-time | |
| 11 | Notifications appear for key events | |
| 12 | 2FA login works (if enabled) | |
| 13 | Order can be cancelled | |
| 14 | Dispute can be raised | |
| 15 | Payment methods can be added/selected | |
| 16 | Session persists across tab refresh | |
| 17 | Logout clears all session data | |
| 18 | No console errors on main flows | |

---

## 8. Bug Reporting Template

```markdown
## Bug Report

**Title:** [Short description]

**Severity:** P0 / P1 / P2 / P3

**Environment:** Local / Staging / Production
**Browser:** Chrome 120 / Safari 17 / Firefox 120
**Mode:** Mock / Devnet

### Steps to Reproduce
1. ...
2. ...
3. ...

### Expected Behavior
[What should happen]

### Actual Behavior
[What actually happens]

### Screenshots / Video
[Attach here]

### Console Errors (if any)
```
[Paste error]
```

### Additional Context
- Merchant ID: ...
- Order ID: ...
- Timestamp: ...
```

---

## 9. Pre-Production Release Checklist

### Environment Configuration

| Check | Status |
|-------|--------|
| `NEXT_PUBLIC_MOCK_MODE=false` (production uses real Solana) | |
| `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta` | |
| `NEXT_PUBLIC_SOLANA_RPC_URL` points to mainnet RPC | |
| `ADMIN_SECRET` is a strong random value (32+ chars) | |
| `ADMIN_PASSWORD` is a strong random value | |
| `COMPLIANCE_PASSWORD` is set and communicated | |
| `AUTH_TOKEN_REQUIRED=true` for production | |
| `TOTP_ENCRYPTION_KEY` is set (32 bytes base64) | |
| Pusher credentials are production keys | |
| Cloudinary credentials are production | |
| Database URL points to production DB | |
| Redis URL points to production Redis | |

### Security

| Check | Status |
|-------|--------|
| No hardcoded secrets in code or `.env.example` | |
| `.env.local` is in `.gitignore` | |
| HTTPS enforced in production | |
| CORS headers properly configured | |
| Rate limiting active on auth endpoints (5/min) | |
| Rate limiting active on order actions (20/min) | |
| Admin panel requires token auth | |
| SQL injection tested on all input fields | |
| XSS tested on chat messages and profile fields | |
| No test/seed endpoints accessible in production | |

### Monitoring

| Check | Status |
|-------|--------|
| `/api/health` returns 200 | |
| Error logging captures stack traces | |
| Auth migration metrics logging active | |
| Outbox worker running for reliable notifications | |
| Auto-bump worker running (if needed) | |

### Data Integrity

| Check | Status |
|-------|--------|
| All DB migrations applied (001 through 067) | |
| No orphaned orders in invalid states | |
| Escrow balances reconcile with on-chain state | |
| Platform fee transactions balance correctly | |

---

## 10. Final QA Sign-off Checklist

| Area | Tested By | Date | Sign-off |
|------|-----------|------|----------|
| Authentication (all methods) | | | |
| 2FA (setup, login, disable) | | | |
| Order lifecycle (happy path) | | | |
| Order lifecycle (cancel, expire, dispute) | | | |
| Escrow (lock, release, refund) | | | |
| Chat (send, receive, typing, read) | | | |
| Notifications (accuracy, no duplicates) | | | |
| Payment methods (add, select, display) | | | |
| Balance accuracy (after all operations) | | | |
| Admin panel access & data | | | |
| Compliance panel & dispute resolution | | | |
| UI/UX (responsive, text visible, no overflow) | | | |
| Security (auth, injection, access control) | | | |
| Performance (acceptable load times) | | | |
| Regression (all critical flows pass) | | | |

**QA Lead Sign-off:** __________________ Date: __________

**Dev Lead Sign-off:** __________________ Date: __________

**Product Owner Sign-off:** __________________ Date: __________

---

*Generated for Blip Money Settle v1.0 — Pre-production release testing.*
