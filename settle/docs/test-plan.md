# Test Plan - Settle P2P Crypto Settlement App

**Version**: 1.0
**Date**: 2024-01-16

---

## 1. Test Environment Setup

### Prerequisites
- PostgreSQL running locally
- Database `blip_test` created
- Schema applied from `/database/schema.sql`
- Seed data loaded
- App running on localhost:3000

### Test Users
| Role | Wallet Address | Description |
|------|---------------|-------------|
| User | 0xUserWallet123456789abcdef | Demo User (from seed) |
| Merchant | 0xMerchant1Address123456789 | QuickSwap merchant |
| Merchant 2 | 0xMerchant2Address987654321 | DesertGold merchant |

---

## 2. Manual Test Scripts

### TC-001: User Wallet Connection
**Preconditions**: Fresh browser session
**Steps**:
1. Open user app (localhost:3000)
2. App should auto-connect with demo wallet
3. Verify user profile loads

**Expected**:
- User ID populated
- No errors in console
- Bank accounts fetched

---

### TC-002: Merchant Wallet Connection
**Preconditions**: Fresh browser session
**Steps**:
1. Open merchant dashboard (localhost:3000/merchant)
2. App should auto-connect with merchant wallet
3. Verify merchant ID loads

**Expected**:
- Merchant ID populated
- Orders list fetched (may be empty)
- No errors in console

---

### TC-003: Create Order - Bank Transfer
**Preconditions**: User logged in, merchant online with bank offer
**Steps**:
1. In user app, enter amount (e.g., 100 USDC)
2. Select "Bank" payment method
3. Select "Best" preference
4. Click "Continue"
5. Observe matching screen

**Expected**:
- Order created in DB
- Order appears in user's order list
- Order appears in merchant's pending orders
- Status is "pending"
- Liquidity reserved from offer

---

### TC-004: Merchant Accepts Order
**Preconditions**: TC-003 completed, order pending
**Steps**:
1. In merchant dashboard, find pending order
2. Click "Accept" button
3. Observe status change

**Expected**:
- Order status changes to "accepted" then "escrow"
- Order event created
- Chat opens automatically
- Timer updates (30 min for accepted)

---

### TC-005: User Marks Payment Sent
**Preconditions**: TC-004 completed, order in escrow
**Steps**:
1. In user app, view active order
2. Click "I've Sent Payment" button
3. Confirm action

**Expected**:
- Order status changes to "payment_sent"
- Order event created
- Merchant sees notification/status update

---

### TC-006: Merchant Confirms Payment
**Preconditions**: TC-005 completed
**Steps**:
1. In merchant dashboard, find order
2. Click "Confirm Payment Received"
3. Confirm action

**Expected**:
- Order status changes to "payment_confirmed"
- Order event created

---

### TC-007: Complete Order
**Preconditions**: TC-006 completed
**Steps**:
1. In merchant dashboard, click "Complete Order"
2. Confirm action

**Expected**:
- Order status changes to "completed"
- Order event created
- User stats updated
- Merchant stats updated
- Review prompt appears

---

### TC-008: Submit Review
**Preconditions**: TC-007 completed
**Steps**:
1. In user app, rate merchant (1-5 stars)
2. Add optional comment
3. Submit review

**Expected**:
- Review created in DB
- Merchant rating recalculated
- Cannot submit duplicate review

---

### TC-009: Cancel Order - User
**Preconditions**: New pending order created
**Steps**:
1. In user app, view pending order
2. Click "Cancel Order"
3. Confirm cancellation

**Expected**:
- Order status changes to "cancelled"
- cancelled_by = "user"
- Order event created
- Liquidity restored to offer

---

### TC-010: Cancel Order - Merchant
**Preconditions**: New pending order created
**Steps**:
1. In merchant dashboard, find pending order
2. Click "Decline" or "Cancel"
3. Enter reason
4. Confirm

**Expected**:
- Order status changes to "cancelled"
- cancelled_by = "merchant"
- cancellation_reason saved
- Order event created
- Liquidity restored

---

### TC-011: Chat - Send Message
**Preconditions**: Active order (accepted or later)
**Steps**:
1. Open chat in user app
2. Type message
3. Send

**Expected**:
- Message appears in chat
- Message persists in DB
- Merchant sees message on next poll

---

### TC-012: Chat - Receive Message
**Preconditions**: TC-011 completed
**Steps**:
1. In merchant dashboard, open chat
2. Type reply
3. Send

**Expected**:
- Message appears in merchant chat
- User sees message on next poll
- Unread count updates

---

### TC-013: Raise Dispute
**Preconditions**: Order in payment_sent status
**Steps**:
1. In user app, click "Raise Dispute"
2. Select reason (e.g., "payment_not_received")
3. Add description
4. Submit

**Expected**:
- Dispute created in DB
- Order status changes to "disputed"
- Dispute status is "open"

---

### TC-014: Order Expiry
**Preconditions**: Pending order with short timeout
**Steps**:
1. Create new order
2. Wait for timeout (or modify DB expires_at)
3. Trigger expiry check

**Expected**:
- Order status changes to "expired"
- Liquidity restored
- Order event created

---

### TC-015: Invalid State Transition
**Preconditions**: Completed order
**Steps**:
1. Via API, try to change completed order to "pending"
2. Observe response

**Expected**:
- Request rejected with 400 error
- Order unchanged
- Clear error message

---

### TC-016: Authorization - User Access
**Preconditions**: Two users with orders
**Steps**:
1. As User A, try to access User B's order via API
2. `GET /api/orders/{user_b_order_id}`

**Expected**:
- Request rejected with 403 Forbidden
- Order details not returned

---

### TC-017: Authorization - Merchant Access
**Preconditions**: Order assigned to Merchant A
**Steps**:
1. As Merchant B, try to accept the order
2. `PATCH /api/orders/{order_id}` with Merchant B's ID

**Expected**:
- Request rejected with 403 Forbidden
- Order unchanged

---

### TC-018: Rate Limiting
**Preconditions**: App running
**Steps**:
1. Send 20 rapid order creation requests
2. Observe responses

**Expected**:
- First N requests succeed
- Subsequent requests return 429 Too Many Requests

---

### TC-019: Input Validation - Invalid Amount
**Preconditions**: User logged in
**Steps**:
1. Try to create order with amount = -100
2. Observe response

**Expected**:
- Request rejected with 400 Bad Request
- Clear validation error message

---

### TC-020: Input Validation - Invalid UUID
**Preconditions**: User logged in
**Steps**:
1. `GET /api/orders/not-a-uuid`
2. Observe response

**Expected**:
- Request rejected with 400 Bad Request
- "Invalid order ID format" message

---

## 3. Automated Test Cases

### Unit Tests (Jest)

```
tests/unit/
├── stateMachine.test.ts
│   ├── should allow pending → accepted
│   ├── should allow accepted → escrowed
│   ├── should allow escrowed → payment_sent
│   ├── should allow payment_sent → payment_confirmed
│   ├── should allow payment_confirmed → completed
│   ├── should allow pending → cancelled
│   ├── should reject completed → pending
│   ├── should reject cancelled → accepted
│   └── should reject same-status transition
├── validation.test.ts
│   ├── should validate order creation schema
│   ├── should reject negative amounts
│   ├── should reject invalid UUIDs
│   └── should validate message schema
```

### API Integration Tests

```
tests/integration/
├── orders.test.ts
│   ├── POST /api/orders - creates order
│   ├── GET /api/orders/:id - returns order
│   ├── PATCH /api/orders/:id - updates status
│   ├── DELETE /api/orders/:id - cancels order
│   ├── rejects unauthorized access
│   └── enforces state transitions
├── chat.test.ts
│   ├── POST /api/orders/:id/messages - sends message
│   ├── GET /api/orders/:id/messages - lists messages
│   ├── PATCH /api/orders/:id/messages - marks read
│   └── rejects messages on non-existent order
├── disputes.test.ts
│   ├── POST /api/orders/:id/dispute - raises dispute
│   ├── GET /api/disputes/:id - gets dispute
│   └── rejects duplicate disputes
├── reviews.test.ts
│   ├── POST /api/orders/:id/review - submits review
│   ├── GET /api/orders/:id/review - gets review
│   └── rejects duplicate reviews
```

---

## 4. Performance Tests

### Load Test Scenarios
1. **Concurrent Orders**: 50 users creating orders simultaneously
2. **Message Storm**: 100 messages per minute in single chat
3. **Polling Load**: 200 clients polling every 2 seconds

### Acceptance Criteria
- Order creation < 500ms p95
- Message send < 200ms p95
- Poll response < 100ms p95
- No errors under load

---

## 5. Security Tests

### Test Cases
1. SQL injection attempts in all string inputs
2. XSS payloads in chat messages
3. IDOR attempts (accessing other users' data)
4. Rate limit bypass attempts
5. Large payload attacks

---

## 6. Test Data Reset

```bash
# Reset test database
psql -U postgres -c "DROP DATABASE IF EXISTS blip_test"
psql -U postgres -c "CREATE DATABASE blip_test"
psql -U postgres -d blip_test -f database/schema.sql
```

---

## 7. Bug Reporting Template

```
**Bug ID**: BUG-XXX
**Test Case**: TC-XXX
**Severity**: Critical/High/Medium/Low
**Summary**: Brief description
**Steps to Reproduce**:
1.
2.
3.
**Expected Result**:
**Actual Result**:
**Screenshots/Logs**:
**Environment**:
```
