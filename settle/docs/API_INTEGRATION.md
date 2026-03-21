# Blip Money API Integration Guide

Base URL: `http://localhost:3000/api` (dev) or `https://your-domain.com/api` (prod)

All responses follow: `{ success: boolean, data?: any, error?: string }`

---

## Authentication

No JWT/sessions. Every request passes `actor_type` + `actor_id` in the body or query params.

| actor_type | Description |
|-----------|-------------|
| `merchant` | Merchant account |
| `user` | Buyer/seller user |
| `system` | Internal/admin |

---

## 1. Account Setup

### Register Merchant (email/password)

```
POST /api/auth/merchant
{
  "action": "register",
  "email": "merchant@example.com",
  "password": "securepassword",
  "business_name": "My Shop"
}
→ { merchant: { id, email, business_name, balance, status } }
```

In MOCK_MODE, new merchants auto-receive 10,000 USDC balance (MOCK_INITIAL_BALANCE).

### Register Merchant (wallet)

```
POST /api/auth/merchant
{
  "action": "wallet_login",
  "wallet_address": "So1ana...",
  "signature": "...",
  "message": "Sign in to Blip Money"
}
→ { merchant, isNewMerchant, needsUsername }

# If isNewMerchant, follow up with:
POST /api/auth/merchant
{
  "action": "create_merchant",
  "wallet_address": "So1ana...",
  "signature": "...",
  "message": "...",
  "username": "myshop"
}
```

### Login Merchant

```
POST /api/auth/merchant
{ "action": "login", "email": "...", "password": "..." }
→ { merchant }
```

### Register User

```
POST /api/auth/user
{ "action": "register", "username": "buyer1", "password": "..." }
→ { user: { id, username, balance } }
```

### Login User

```
POST /api/auth/user
{ "action": "login", "username": "buyer1", "password": "..." }
→ { user }
```

### Check Session

```
GET /api/auth/merchant?action=check_session&merchant_id={id}
→ { valid: true, merchant }

GET /api/auth/user?action=check_session&user_id={id}
→ { valid: true }
```

---

## 2. Offers (Corridors)

Merchants create offers defining their trading corridors (buy/sell, rates, limits).

### List Merchant Offers

```
GET /api/merchant/offers?merchant_id={id}
→ [{ id, type, payment_method, rate, min_amount, max_amount, available_amount, is_active, bank_name, ... }]
```

### Create Offer

```
POST /api/merchant/offers
{
  "merchant_id": "uuid",
  "type": "buy" | "sell",
  "payment_method": "bank" | "cash",
  "rate": 1.02,
  "min_amount": 50,
  "max_amount": 5000,
  "available_amount": 10000,
  "bank_name": "Chase",
  "bank_account_name": "John Doe",
  "bank_iban": "US123..."
}
→ { offer }
```

### Update Offer

```
PATCH /api/merchant/offers/{offer_id}
{ "rate": 1.03, "is_active": false, ... }
→ { offer }
```

### Browse Public Offers

```
GET /api/offers?type=buy&payment_method=bank&amount=500
→ { offer } (best match) or [offers]
```

---

## 3. Orders — Core Trading Flow

### Create Order (as User)

```
POST /api/orders
{
  "user_id": "uuid",
  "offer_id": "uuid",
  "crypto_amount": 100,
  "type": "buy" | "sell",
  "payment_method": "bank",
  "buyer_wallet_address": "So1ana..."
}
→ { order, offer, merchant }
```

### Create Order (as Merchant — M2M)

```
POST /api/merchant/orders
{
  "merchant_id": "uuid",
  "type": "buy" | "sell",
  "crypto_amount": 500,
  "payment_method": "bank",
  "spread_preference": "fastest",  // "best" | "fastest" | "cheap"
  "target_merchant_id": "uuid"    // optional: direct M2M trade
}
→ { order }
```

### Get Orders

```
# User's orders
GET /api/orders?user_id={id}&status=pending,accepted,escrowed

# Merchant's orders (own + pending broadcast)
GET /api/merchant/orders?merchant_id={id}&include_all_pending=true

# Single order
GET /api/orders/{order_id}
→ { order }
```

### Update Order Status (State Machine)

```
PATCH /api/orders/{order_id}
{
  "status": "accepted",
  "actor_type": "merchant",
  "actor_id": "uuid",
  "acceptor_wallet_address": "So1ana..."  // optional, for escrow
}
→ { order }
```

### Cancel Order

```
DELETE /api/orders/{order_id}?actor_type=merchant&actor_id={id}&reason=No+longer+needed
→ { order }
```

---

## 4. Order Lifecycle (State Machine)

```
pending → accepted → escrowed → payment_sent → payment_confirmed → releasing → completed
   ↓         ↓          ↓            ↓                ↓                ↓
cancelled  cancelled  cancelled   disputed         disputed         disputed
```

### Valid Transitions

| From | To | Who Can |
|------|----|---------|
| `pending` | `accepted` | merchant |
| `pending` | `escrowed` | user, merchant |
| `pending` | `cancelled` | user, merchant |
| `accepted` | `escrowed` | user, merchant |
| `accepted` | `payment_pending` | merchant (M2M) |
| `accepted` | `cancelled` | user, merchant |
| `escrowed` | `payment_pending` | user, merchant |
| `escrowed` | `payment_sent` | user, merchant |
| `escrowed` | `completed` | user, merchant (after release) |
| `escrowed` | `cancelled` | user, merchant |
| `escrowed` | `disputed` | user, merchant |
| `payment_pending` | `payment_sent` | user, merchant |
| `payment_sent` | `payment_confirmed` | user, merchant |
| `payment_sent` | `completed` | user, merchant (after release) |
| `payment_confirmed` | `completed` | user, merchant |
| `completed` | — | terminal |
| `cancelled` | — | terminal |
| `disputed` | `completed` / `cancelled` | system only |

### Timeout

All orders expire after **15 minutes** from creation. Up to **3 extensions** can be requested.

---

## 5. Escrow

### Lock Escrow (Seller deposits)

```
POST /api/orders/{order_id}/escrow
{
  "tx_hash": "demo-tx-123",
  "actor_type": "merchant",
  "actor_id": "uuid",
  "escrow_address": "...",
  "escrow_trade_id": 1770740284866
}
→ { order, escrow_verified: true }
```

In MOCK_MODE with `demo-tx-` prefix, on-chain verification is skipped. Balance is deducted from seller atomically.

### Release Escrow (Seller releases to buyer)

```
PATCH /api/orders/{order_id}/escrow
{
  "tx_hash": "demo-tx-456",
  "actor_type": "merchant",
  "actor_id": "uuid"
}
→ { order, release_verified: true }
```

Credits buyer's balance, moves order to `completed`.

### Check Escrow Status

```
GET /api/orders/{order_id}/escrow
→ { order_id, status, is_escrowed, is_released, escrow_tx_hash, release_tx_hash }
```

---

## 6. Chat & Messages

### Get Messages

```
GET /api/orders/{order_id}/messages
→ [{ id, sender_type, sender_id, content, message_type, created_at }]
```

### Send Message

```
POST /api/orders/{order_id}/messages
{
  "sender_type": "merchant",
  "sender_id": "uuid",
  "content": "Payment sent!",
  "message_type": "text"  // text, image, system
}
→ { message }
```

### Mark Messages Read

```
PATCH /api/orders/{order_id}/messages
{ "reader_type": "merchant" }
```

### Typing Indicator

```
POST /api/orders/{order_id}/typing
{ "actor_type": "merchant", "is_typing": true }
```

---

## 7. Extensions

### Request Extension

```
POST /api/orders/{order_id}/extension
{ "actor_type": "merchant", "actor_id": "uuid" }
→ { order, message }
```

### Respond to Extension

```
PUT /api/orders/{order_id}/extension
{ "actor_type": "user", "actor_id": "uuid", "accept": true }
→ { order, message }
```

### Check Extension Status

```
GET /api/orders/{order_id}/extension
→ { canExtend, extensionCount, maxExtensions: 3, extensionsRemaining, pendingRequest }
```

---

## 8. Disputes

### Create Dispute

```
POST /api/orders/{order_id}/dispute
{
  "reason": "payment_not_received",
  "description": "Buyer claims payment sent but I haven't received it",
  "initiated_by": "merchant",
  "merchant_id": "uuid"
}
→ { dispute }
```

### Get Dispute

```
GET /api/orders/{order_id}/dispute
→ { dispute }
```

---

## 9. Reviews

### Submit Review (after completion)

```
POST /api/orders/{order_id}/review
{
  "reviewer_type": "user",
  "reviewer_id": "uuid",
  "reviewee_type": "merchant",
  "reviewee_id": "uuid",
  "rating": 5,
  "comment": "Fast trader"
}
→ { review }
```

---

## 10. Balance & Transactions

### Get Merchant Transactions

```
GET /api/merchant/transactions?merchant_id={id}
→ [{ id, type, amount, balance_before, balance_after, description, created_at }]
```

Transaction types: `escrow_lock` (negative), `escrow_release` (positive), `escrow_refund`, `order_cancelled`, `manual_adjustment`

### Get Analytics

```
GET /api/merchant/analytics?merchant_id={id}
→ { totalVolume, completedTrades, activeOrders, recentOrders, reputation }
```

### Mock Balance (dev only)

```
POST /api/mock/balance
{ "merchant_id": "uuid", "amount": 1000 }
```

---

## 11. User Management

### Get User Profile

```
GET /api/users/{user_id}
→ { user }
```

### Update User Profile

```
PATCH /api/users/{user_id}
{ "name": "John", "email": "john@example.com", "phone": "+1234567890" }
→ { user }
```

### Bank Accounts

```
GET /api/users/{user_id}/bank-accounts
→ [{ id, bank_name, account_name, iban, is_default }]

POST /api/users/{user_id}/bank-accounts
{ "bank_name": "Chase", "account_name": "John Doe", "iban": "US123...", "is_default": true }
→ { account }
```

---

## 12. Real-time (Pusher)

### Channel Authentication

```
POST /api/pusher/auth
Headers: { x-actor-type: "merchant", x-actor-id: "uuid" }
Body (form): { socket_id: "...", channel_name: "private-merchant-{id}" }
```

### Channels

| Channel | Format | Purpose |
|---------|--------|---------|
| User private | `private-user-{userId}` | User's order updates |
| Merchant private | `private-merchant-{merchantId}` | Merchant's order updates |
| All merchants | `private-merchants-global` | New order broadcasts |
| Order private | `private-order-{orderId}` | Order-specific updates |
| Order presence | `presence-order-{orderId}` | Who's viewing the order |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `order:created` | `{ orderId, orderNumber, type, amount, ... }` | New order |
| `order:status-updated` | `{ orderId, status, previousStatus, data }` | Status change |
| `order:cancelled` | `{ orderId }` | Order cancelled |
| `order:expired` | `{ orderId }` | Order expired |
| `order:extension-requested` | `{ orderId, requestedBy, extensionMinutes }` | Extension request |
| `order:extension-response` | `{ orderId, accepted, newExpiresAt }` | Extension response |
| `chat:message-new` | `{ message }` | New chat message |
| `chat:messages-read` | `{ orderId, readerType }` | Messages marked read |
| `chat:typing-start` / `chat:typing-stop` | `{ actorType }` | Typing indicators |

---

## 13. Admin / Compliance

### Activity Feed

```
GET /api/admin/activity?limit=20
→ { recentTrades, recentEscrows, activeDisputes, ... }
```

### Compliance Disputes

```
GET /api/compliance/disputes?status=disputed&limit=20
→ { disputes, pagination }
```

### Resolve Dispute

```
PATCH /api/compliance/disputes/{dispute_id}/resolve
{ "resolution": "Buyer provided proof of payment", "resolved_in_favor_of": "user" }
→ { dispute }
```

---

## Complete Trade Flow Example (Telegram Bot)

```
# 1. Register merchant
POST /api/auth/merchant
{ "action": "register", "email": "tg_123@blip.bot", "password": "random", "business_name": "TG User" }
→ Save merchant.id

# 2. Create BUY order
POST /api/merchant/orders
{ "merchant_id": "saved_id", "type": "buy", "crypto_amount": 100, "payment_method": "bank" }
→ Save order.id

# 3. Poll for acceptance (or use Pusher)
GET /api/orders/{order_id}
→ Wait until status != "pending"

# 4. When status = "escrowed" (seller locked funds), mark payment sent
PATCH /api/orders/{order_id}
{ "status": "payment_sent", "actor_type": "merchant", "actor_id": "saved_id" }

# 5. Wait for seller to confirm & release escrow
# Poll or listen for status = "completed"
GET /api/orders/{order_id}

# 6. Check updated balance
GET /api/merchant/transactions?merchant_id=saved_id
```

---

## Rate Limits

| Category | Limit |
|----------|-------|
| Auth endpoints | 5/min |
| Order creation | 20/min |
| All other endpoints | 100/min |

## Error Codes

| Status | Meaning |
|--------|---------|
| 400 | Validation error or invalid state transition |
| 401 | Authentication required |
| 403 | Not authorized for this resource |
| 404 | Resource not found |
| 429 | Rate limited |
| 500 | Server error |

---

## 14. Order Matching

### Find Matching Orders

```
GET /api/orders/match?type=buy&payment_method=bank&crypto_amount=500&exclude_merchant_id={id}
→ { bestMatch, allMatches, totalMatches }
```

Returns up to 10 matching orders ranked by spread preference, merchant rating, and response time. Allows 10% variance on amount.

### Order Book Stats

```
POST /api/orders/match
{ "type": "buy", "payment_method": "bank" }
→ { statistics: [{ spread_preference, order_count, avg_amount, best_rate, worst_rate }] }
```

---

## 15. Merchant Analytics & Leaderboard

### Analytics Dashboard

```
GET /api/merchant/analytics?merchant_id={id}
→ { totalVolume, completedTrades, activeOrders, recentOrders, reputation }
```

### Leaderboard

```
GET /api/merchants/leaderboard
→ [{ id, display_name, rating, total_trades, avg_response_time_mins }]
```

---

## 16. Marketplace Offers

### Browse Offers with BlipScore

```
GET /api/marketplace/offers?type=buy&payment_method=bank&amount=500
→ [{ offer, merchant, blipScore }]
```

---

## 17. Disputes & Arbitration

### Create Dispute

```
POST /api/orders/{order_id}/dispute
{
  "reason": "payment_not_received",
  "description": "...",
  "initiated_by": "merchant",
  "merchant_id": "uuid"
}
→ { dispute }
```

### Propose Resolution (Compliance)

```
POST /api/compliance/disputes/{dispute_id}/resolve
{
  "resolution": "Buyer provided proof of payment",
  "resolved_in_favor_of": "user"
}
→ { dispute }
```

### Confirm/Reject Resolution (Party)

```
POST /api/orders/{order_id}/dispute/confirm
{
  "actor_type": "merchant",
  "actor_id": "uuid",
  "accepted": true
}
→ { dispute }
```

### Escalate to Arbitration

```
POST /api/disputes/{dispute_id}/arbitration
→ { arbitration }
```

### Get Resolved Disputes

```
GET /api/disputes/resolved?actor_type=merchant&actor_id={id}
→ [{ dispute }]
```

---

## 18. Reputation System

```
GET /api/reputation?merchant_id={id}
→ { score, components, history }

GET /api/reputation?action=leaderboard
→ [{ merchant_id, display_name, score, rank }]
```

---

## 19. Admin Endpoints

```
GET /api/admin/merchants
→ [{ merchant with stats }]

GET /api/admin/activity?limit=20
→ { recentTrades, recentEscrows, activeDisputes }

GET /api/admin/orders?status=pending&limit=50
→ [{ order }]

GET /api/admin/stats
→ { totalOrders, totalVolume, activeMerchants, ... }
```

---

## 20. Health & Utilities

```
GET /api/health
→ { status: "ok", timestamp, database: "connected" }

POST /api/orders/expire
→ { expired: number }  (runs expiration check on old orders)

POST /api/mock/balance
{ "merchant_id": "uuid", "amount": 1000 }
→ { balance }  (dev only — credit/debit balance)
```

---

## Complete M2M Trade Flows (Verified 2026-02-11)

### M2M BUY Flow — Merchant A Buys USDC from Merchant B

```
# 1. Register both merchants
POST /api/auth/merchant { "action": "register", "email": "a@test.com", "password": "...", "business_name": "Merchant A" }
→ { data: { merchant: { id: "MERCH_A", balance: 10000 } } }

POST /api/auth/merchant { "action": "register", "email": "b@test.com", "password": "...", "business_name": "Merchant B" }
→ { data: { merchant: { id: "MERCH_B", balance: 10000 } } }

# 2. A creates BUY order
POST /api/merchant/orders {
  "merchant_id": "MERCH_A",
  "type": "buy",
  "crypto_amount": 500,
  "payment_method": "bank",
  "spread_preference": "fastest"
}
→ Order created: type="sell" (inverted), merchant_id=MERCH_A, buyer_merchant_id=MERCH_A
→ Status: "pending"

# 3. B accepts (becomes the seller)
PATCH /api/orders/{id} { "status": "accepted", "actor_type": "merchant", "actor_id": "MERCH_B" }
→ merchant_id reassigned to MERCH_B, buyer_merchant_id stays MERCH_A
→ Status: "accepted"

# 4. B locks escrow (seller deposits USDC)
POST /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-lock-123",
  "actor_type": "merchant",
  "actor_id": "MERCH_B",
  "escrow_trade_id": 12345
}
→ Status: "escrowed" | B balance: 10000 → 9500

# 5. A marks fiat payment sent (buyer sends AED offline)
PATCH /api/orders/{id} { "status": "payment_sent", "actor_type": "merchant", "actor_id": "MERCH_A" }
→ Status: "payment_sent"

# 6. B confirms fiat received
PATCH /api/orders/{id} { "status": "payment_confirmed", "actor_type": "merchant", "actor_id": "MERCH_B" }
→ Status: "payment_confirmed"

# 7. B releases escrow (USDC credited to buyer A)
PATCH /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-release-123",
  "actor_type": "merchant",
  "actor_id": "MERCH_B"
}
→ Status: "completed" | A balance: 10000 → 10500 | B balance: 9500
```

### M2M SELL Flow — Merchant A Sells USDC to Merchant B

```
# 1. A creates SELL order
POST /api/merchant/orders {
  "merchant_id": "MERCH_A",
  "type": "sell",
  "crypto_amount": 500,
  "payment_method": "bank",
  "spread_preference": "fastest"
}
→ Order created: type="buy" (inverted), merchant_id=MERCH_A, buyer_merchant_id=null
→ Status: "pending"

# 2. B accepts (becomes the buyer)
PATCH /api/orders/{id} { "status": "accepted", "actor_type": "merchant", "actor_id": "MERCH_B" }
→ merchant_id stays MERCH_A (seller), buyer_merchant_id set to MERCH_B
→ Status: "accepted"

# 3. A locks escrow (seller deposits USDC)
POST /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-lock-456",
  "actor_type": "merchant",
  "actor_id": "MERCH_A",
  "escrow_trade_id": 12346
}
→ Status: "escrowed" | A balance deducted by 500

# 4. B marks fiat payment sent (buyer sends AED offline)
PATCH /api/orders/{id} { "status": "payment_sent", "actor_type": "merchant", "actor_id": "MERCH_B" }
→ Status: "payment_sent"

# 5. A confirms fiat received
PATCH /api/orders/{id} { "status": "payment_confirmed", "actor_type": "merchant", "actor_id": "MERCH_A" }
→ Status: "payment_confirmed"

# 6. A releases escrow (USDC credited to buyer B)
PATCH /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-release-456",
  "actor_type": "merchant",
  "actor_id": "MERCH_A"
}
→ Status: "completed" | B balance credited by 500
```

### Key M2M Concepts

| Concept | BUY Order | SELL Order |
|---------|-----------|------------|
| Creator perspective | `type: "buy"` (API input) | `type: "sell"` (API input) |
| Stored type (user perspective) | `"sell"` | `"buy"` |
| `merchant_id` after accept | Reassigned to acceptor (seller) | Stays as creator (seller) |
| `buyer_merchant_id` | Set to creator at creation | Set to acceptor on accept |
| Who locks escrow | Acceptor (seller) | Creator (seller) |
| Who sends fiat | Creator (buyer) | Acceptor (buyer) |
| Who releases escrow | Acceptor (seller) | Creator (seller) |
| Balance: escrow lock | Deducted from seller | Deducted from seller |
| Balance: escrow release | Credited to buyer | Credited to buyer |

### Balance Verification (Automated Test)

Full round-trip verified: A buys 500x2 from B, then sells 500x2 to B.
```
Start:  A=10000, B=10000
After Phase 1 (A buys 1000):  A=11000, B=9000  ✓
After Phase 2 (A sells 1000): A=10000, B=10000  ✓
```

Test script: `settle/scripts/test-m2m-full-cycle.sh`

---

## Complete User-to-Merchant Trade Flows (Verified 2026-02-11)

### User BUY Flow — User Buys USDC from Merchant

User pays fiat offline, merchant locks escrow (USDC). In-app balance only (no on-chain wallet).

```
# 1. Register user
POST /api/auth/user { "action": "register", "username": "buyer123", "password": "..." }
→ { data: { user: { id: "USER_ID", balance: 10000 } } }

# 2. Find merchant's sell offer
GET /api/merchant/offers?merchant_id=MERCH_ID
→ { data: [{ id: "OFFER_ID", type: "sell", rate: 3.65, ... }] }

# 3. User creates BUY order (no buyer_wallet_address needed for in-app balance)
POST /api/orders {
  "user_id": "USER_ID",
  "offer_id": "OFFER_ID",
  "crypto_amount": 500,
  "type": "buy",
  "payment_method": "bank"
}
→ Order created: type="buy", status="pending"

# 4. Merchant accepts
PATCH /api/orders/{id} { "status": "accepted", "actor_type": "merchant", "actor_id": "MERCH_ID" }
→ Status: "accepted"

# 5. Merchant locks escrow (seller deposits USDC from in-app balance)
POST /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-lock-789",
  "actor_type": "merchant",
  "actor_id": "MERCH_ID",
  "escrow_trade_id": 12347
}
→ Status: "escrowed" | Merchant balance: 10000 → 9500

# 6. User marks fiat payment sent (sent AED offline)
PATCH /api/orders/{id} { "status": "payment_sent", "actor_type": "user", "actor_id": "USER_ID" }
→ Status: "payment_sent"

# 7. Merchant confirms fiat received
PATCH /api/orders/{id} { "status": "payment_confirmed", "actor_type": "merchant", "actor_id": "MERCH_ID" }
→ Status: "payment_confirmed"

# 8. Merchant releases escrow (USDC credited to user's in-app balance)
PATCH /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-release-789",
  "actor_type": "merchant",
  "actor_id": "MERCH_ID"
}
→ Status: "completed" | Merchant: 9500, User: 10500
```

### User SELL Flow — User Sells USDC to Merchant

User locks escrow (USDC from in-app balance), merchant pays fiat offline.

```
# 1. Find merchant's buy offer
GET /api/merchant/offers?merchant_id=MERCH_ID
→ { data: [{ id: "OFFER_ID", type: "buy", rate: 3.65, ... }] }

# 2. User creates SELL order
POST /api/orders {
  "user_id": "USER_ID",
  "offer_id": "OFFER_ID",
  "crypto_amount": 500,
  "type": "sell",
  "payment_method": "bank"
}
→ Order created: type="sell", status="pending"

# 3. Merchant accepts
PATCH /api/orders/{id} { "status": "accepted", "actor_type": "merchant", "actor_id": "MERCH_ID" }
→ Status: "accepted"

# 4. User locks escrow (seller deposits USDC from in-app balance)
POST /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-lock-012",
  "actor_type": "user",
  "actor_id": "USER_ID",
  "escrow_trade_id": 12348
}
→ Status: "escrowed" | User balance: 10000 → 9500

# 5. Merchant marks fiat payment sent (sent AED offline)
PATCH /api/orders/{id} { "status": "payment_sent", "actor_type": "merchant", "actor_id": "MERCH_ID" }
→ Status: "payment_sent"

# 6. User confirms fiat received
PATCH /api/orders/{id} { "status": "payment_confirmed", "actor_type": "user", "actor_id": "USER_ID" }
→ Status: "payment_confirmed"

# 7. User releases escrow (USDC credited to merchant's balance)
PATCH /api/orders/{id}/escrow {
  "tx_hash": "demo-tx-release-012",
  "actor_type": "user",
  "actor_id": "USER_ID"
}
→ Status: "completed" | Merchant: 10500, User: 9500
```

### Key User-to-Merchant Concepts

| Concept | User BUY | User SELL |
|---------|----------|-----------|
| User role | Buyer (pays fiat) | Seller (locks escrow) |
| Merchant role | Seller (locks escrow) | Buyer (pays fiat) |
| Who locks escrow | Merchant (`actor_type: "merchant"`) | User (`actor_type: "user"`) |
| Who sends fiat | User (`actor_type: "user"`) | Merchant (`actor_type: "merchant"`) |
| Who confirms fiat | Merchant (`actor_type: "merchant"`) | User (`actor_type: "user"`) |
| Who releases escrow | Merchant (`actor_type: "merchant"`) | User (`actor_type: "user"`) |
| `buyer_wallet_address` | Not needed (in-app balance) | N/A |
| Escrow lock deducts from | Merchant balance | User balance |
| Escrow release credits to | User balance | Merchant balance |

### User Allowed Status Transitions

Users can set these statuses via `PATCH /api/orders/{id}`:
- `payment_sent` — Mark fiat payment as sent (BUY flow: user pays merchant)
- `payment_confirmed` — Confirm fiat received (SELL flow: merchant paid user)
- `completed` — Mark order complete (after escrow release)
- `cancelled` — Cancel order
- `disputed` — Raise a dispute

### Comprehensive Balance Verification (All Flows)

All 4 flows verified in a single test run (48/48 tests passed):
```
Start: Merchant A=10000, Merchant B=10000, User=10000

Test A (Dashboard M2M):  A buys 500 from B, sells 500 to B → A=10000, B=10000  ✓
Test B (Bot M2M):        B sells 500 to A, A sells 500 to B → A=10000, B=10000  ✓
Test C (User BUY):       User buys 500 from A               → A=9500,  User=10500  ✓
Test D (User SELL):      User sells 500 to A                 → A=10000, User=10000  ✓

Final: All balances returned to 10000  ✓
```

Test script: `settle/scripts/test-all-flows.sh`

---

## Telegram Bot Testing Notes (2026-02-11)

### Buy Order Flow — Verified Working

Full lifecycle tested via API (simulating bot → settle server):

```
1. Register merchant (buyer)
   POST /api/auth/merchant { action: "register", ... }
   → merchant created with 10,000 USDC (MOCK_MODE)

2. Create BUY order
   POST /api/merchant/orders { merchant_id, type: "buy", crypto_amount: 100, payment_method: "bank", spread_preference: "fastest" }
   → Order created as type "sell" (inverted for storage), buyer_merchant_id = creating merchant
   → Status: "pending", rate: 3.65 AED/USDC, fiat: 365 AED
   → Auto-creates placeholder user and uses merchant's own buy offer

3. Seller accepts order
   PATCH /api/orders/{id} { status: "accepted", actor_type: "merchant", actor_id: seller_id }
   → Status: "accepted"

4. Seller locks escrow
   POST /api/orders/{id}/escrow { tx_hash: "demo-tx-...", actor_type: "merchant", actor_id: seller_id }
   → Status: "escrowed", 100 USDC deducted from seller (10000 → 9900)

5. Buyer marks payment sent
   PATCH /api/orders/{id} { status: "payment_sent", actor_type: "merchant", actor_id: buyer_id }
   → Status: "payment_sent"

6. Seller confirms payment received
   PATCH /api/orders/{id} { status: "payment_confirmed", actor_type: "merchant", actor_id: seller_id }
   → Status: "payment_confirmed"

7. Seller releases escrow
   PATCH /api/orders/{id}/escrow { tx_hash: "demo-tx-release-...", actor_type: "merchant", actor_id: seller_id }
   → Status: "completed", 100 USDC credited to buyer (10000 → 10100)
```

### Key Details

- **Type inversion**: Bot sends `type: "buy"` → stored as `type: "sell"` (from user perspective)
- **buyer_merchant_id**: Set to the creating merchant for buy orders
- **merchant_id**: Initially same as buyer, updated to seller on accept
- **Demo transactions**: `demo-tx-*` prefix skips on-chain verification
- **Offer auto-creation**: Registration auto-creates buy + sell bank offers
- **Balance**: Correctly tracked — escrow lock deducts from seller, release credits buyer

### Bugs Fixed

1. **Registration balance response**: Was hardcoding `balance: 0` instead of returning actual `MOCK_INITIAL_BALANCE` (10,000). Fixed in `auth/merchant/route.ts` for both email and wallet registration paths.

2. **Bot-created orders invisible on merchant dashboard**: When the bot creates a BUY order, `buyer_merchant_id = merchant_id` (same merchant). The `is_my_order` flag was `true`, and the merchant page filtered `pendingOrders` with `!isMyOrder`, hiding the order completely. Fixed by:
   - Removed `!isMyOrder` filter from `pendingOrders` so own orders appear in "New Orders"
   - Added "YOURS" badge on own orders to distinguish from others' orders
   - Shows "Waiting..." instead of profit/timer on own orders
   - "Go" (Accept) button correctly hidden for own orders (already worked)
   - Orders correctly show to ALL merchants via broadcast model (`include_all_pending=true`)

3. **Bot AI hallucinating order creation**: Claude Haiku was sometimes generating fake "Order Created" responses without actually calling the `create_buy_order` tool. Fixed in `telegram-bot/bot.js` by:
   - Added `detectForcedTool()` — detects clear action patterns (e.g., "buy 114 USDC") and forces `tool_choice` to the right tool
   - Fixed multiple tool_use handling bug (was pushing duplicate assistant messages)
   - Reduced conversation window from 20 to 10 messages to avoid stale context confusing the model
   - Added max iteration guard (5) to prevent infinite loops
   - Strengthened system prompt: "NEVER fabricate or invent order IDs, amounts, rates"

4. **Bot reporting fake success on failed orders**: The bot's `createOrder` would throw an error caught by the generic catch block at line 1055, but Claude Haiku would still format the error as a success message. Fixed in `telegram-bot/bot.js` by:
   - Added **order verification**: after API returns success, bot fetches `GET /api/orders/{id}` to confirm order exists in database
   - Added **per-tool try/catch** for `create_buy_order` and `create_sell_order` — returns explicit `{ success: false, verified: false, error: "..." }` on failure
   - Added `verified: true` field on success so Claude can distinguish verified vs unverified orders
   - Updated Claude system prompt with **ORDER CREATION VERIFICATION** section: must check `success` and `verified` fields, never report success if `success=false`
   - Common failure reasons now surfaced: insufficient liquidity, no matching corridor, rate limit exceeded
   - Added **hallucination fallback**: after Claude responds, checks if response claims order creation (contains order ID pattern + "created"/"successfully" + "USDC") but no `create_buy_order`/`create_sell_order` tool was actually called. If detected, replaces the hallucinated response with an error message asking user to retry. This is the last line of defense when Claude skips the tool entirely and fabricates a response.

### Order Limits per Merchant

- **No hard cap** on concurrent orders per merchant
- **Rate limit**: 20 order creations per minute (per merchant)
- **Liquidity limit**: Each order decrements `available_amount` on the merchant's offer. Default offer `available_amount` = 50,000 USDC
- If offer liquidity runs out, subsequent orders fail with "Insufficient liquidity" error

5. **All merchants receiving notifications for every status change**: Two problems — (a) server was broadcasting every status to `private-merchants-global`, (b) bot was notifying without checking if merchant is involved, (c) notification messages were not role-aware (buyer told to "lock escrow" when only seller should).

   **Server fix** (`lib/pusher/server.ts`):
   - Only broadcast to `private-merchants-global` for statuses that affect order availability: `accepted`, `cancelled`, `expired`
   - All other status updates (escrowed, payment_sent, etc.) only go to involved parties

   **Bot fix** (`telegram-bot/bot.js` — `handleOrderStatusUpdate`):
   - Added relevance check: skip notification if merchant is not `merchant_id` or `buyer_merchant_id` on the order
   - Determines role: `isBuyer` (buyer_merchant_id matches) vs `isSeller`
   - Role-aware next steps:
     - `accepted`: Seller sees "Lock escrow to proceed", Buyer sees "Waiting for seller to lock escrow"
     - `escrowed`: Buyer sees bank details (name, IBAN) + "Once sent, tell me and I'll mark it as paid", Seller sees "Waiting for buyer to send AED"
     - `payment_sent`: Seller sees "Verify and confirm", Buyer sees "Waiting for seller to confirm"
     - `payment_confirmed`: Seller sees "Release escrow", Buyer sees "Waiting for seller to release"

6. **Duplicate notifications (2-4x per event)**: Bot and dashboard both subscribe to merchant private channel AND global channel. Same Pusher event arrives on both channels, triggering handler twice. Plus `notifyOrderStatusUpdated` is called twice when `buyer_merchant_id` exists. Fixed with dedup:
   - **Bot** (`telegram-bot/bot.js`): Added `recentNotifications` Map with 5s dedup window. Key: `telegramId:orderId:status`. Duplicate events within window are silently skipped.
   - **Dashboard** (`hooks/useRealtimeOrders.ts`): Added `recentEvents` Map with 3s dedup window for both `ORDER_CREATED` and `STATUS_UPDATED` events.

7. **Balance audit (2026-02-11)** — Comprehensive audit of all escrow lock/release/refund operations. Found critical bugs:

   **Bug 7a: Transaction logging completely broken** (`lib/db/repositories/transactions.ts`):
   - `createTransaction()` used `result.rows[0]` on the return value of `query()`, but `query()` already returns rows directly (not the pg Result object).
   - This caused a TypeError on every call, silently caught by callers → `merchant_transactions` table had 0 rows.
   - **Fix**: Changed to use `rows[0]` directly since `query()` returns the unwrapped array. Also added `parseFloat(String(...))` for PostgreSQL numeric types.

   **Bug 7b: M2M sell order refund goes to wrong recipient** (3 locations):
   - In PATCH cancel, DELETE cancel, and `expireOldOrders()`, the refund logic was: `refundId = isBuyOrder ? order.merchant_id : order.user_id`.
   - For M2M sell orders (stored type=sell), this refunds `user_id` (a system/dummy user) instead of `merchant_id` (the actual seller who locked escrow).
   - **Fix**: Added M2M check — if `buyer_merchant_id` exists, always refund `merchant_id` (the seller in M2M trades). Only fall back to the buy/sell user logic for non-M2M trades.
   - Fixed in: `api/orders/[id]/route.ts` (PATCH + DELETE), `lib/db/repositories/orders.ts` (expireOldOrders).

   **Bug 7c: Escrow release not atomic** (`api/orders/[id]/escrow/route.ts` PATCH):
   - Balance credit, release_tx_hash update, and status update were 3 separate non-transactional operations.
   - If the credit failed (caught silently), the order still completed → buyer never received USDC.
   - If PATCH status=completed was called between credit and release_tx_hash set, buyer could be double-credited.
   - **Fix**: Wrapped balance credit + order update (release_tx_hash + status) in a single DB transaction via `dbTransaction()`. If anything fails, everything rolls back.

   **Bug 7d: Order completion without escrow** (BM-260211-9F4E):
   - Self-trade (Tap→Tap) completed with status=completed but no escrow_tx_hash or release_tx_hash.
   - For a payment app, this should never be possible — funds must be escrowed before completion.
   - **Fix**: Added guard in PATCH `/api/orders/[id]`: if status=completed and no escrow_tx_hash and buyer_merchant_id exists (M2M), return 400 error.

   **Balance state at time of audit** (Tap/Zoro/Red starting from 10000 each):
   - Tap: expected 9014, actual 8891, diff -123
   - Zoro: expected 9453, actual 4609, diff -4844
   - Red: expected 5933, actual 5933, matches ✓
   - Discrepancies may be from bugs 7a-7c affecting historical orders. With fixes applied, new orders will be tracked correctly.
