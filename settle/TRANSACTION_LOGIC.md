# Transaction Logic & Balance Flow

## Overview
This document explains the correct balance flow for merchant-initiated orders in MOCK_MODE.

---

## Merchant-Initiated BUY Order

**Scenario:** Merchant A wants to buy 100 USDC from Merchant B

### Initial State
```
Merchant A (Buyer): 1000 USDC
Merchant B (Seller): 5000 USDC
```

### Step 1: Order Creation
**Action:** Merchant A creates BUY order for 100 USDC

**Database:**
- `type`: 'sell' (inverted - from user perspective)
- `buyer_merchant_id`: Merchant A (identifies the buyer)
- `merchant_id`: Merchant A (order creator)

**Balance Changes:**
- Merchant A: 1000 USDC (no change - paying fiat, not crypto)
- Merchant B: 5000 USDC (no change - hasn't accepted yet)

**Transaction Log:** None

---

### Step 2: Order Acceptance
**Action:** Merchant B accepts the order

**Database:**
- Status: `pending` → `accepted`
- `acceptor_wallet_address`: Merchant B's wallet

**Balance Changes:**
- Merchant A: 1000 USDC (no change)
- Merchant B: 5000 USDC (no change - not locked yet)

**Transaction Log:** None

---

### Step 3: Escrow Lock
**Action:** Merchant B locks 100 USDC in escrow

**API:** `POST /api/orders/{id}/escrow`
```json
{
  "tx_hash": "mock_tx_hash",
  "actor_type": "merchant",
  "actor_id": "merchant_b_id"
}
```

**Code:** `settle/src/app/api/orders/[id]/escrow/route.ts:173-195`
```javascript
// Deduct from seller (Merchant B)
UPDATE merchants SET balance = balance - 100 WHERE id = merchant_b_id
```

**Balance Changes:**
- Merchant A: 1000 USDC (no change)
- **Merchant B: 5000 → 4900 USDC** ✅ DEBIT

**Transaction Log:**
```
ID: uuid
merchant_id: merchant_b_id
order_id: order_id
type: escrow_lock
amount: -100
balance_before: 5000
balance_after: 4900
description: "Locked 100 USDC in escrow for order #12345"
```

---

### Step 4: Payment Sent
**Action:** Merchant A marks fiat payment as sent

**API:** `PATCH /api/orders/{id}` with `status: 'payment_sent'`

**Balance Changes:** None

**Transaction Log:** None

---

### Step 5: Escrow Release
**Action:** Merchant B confirms fiat received and releases escrow

**API:** `PATCH /api/orders/{id}/escrow` (release=true)
```json
{
  "tx_hash": "mock_release_tx",
  "actor_type": "merchant",
  "actor_id": "merchant_b_id"
}
```

**Code:** `settle/src/app/api/orders/[id]/escrow/route.ts:341-371`
```javascript
// Credit buyer (Merchant A via buyer_merchant_id)
const isBuyOrder = order.type === 'buy'; // false (type='sell')
const recipientId = order.buyer_merchant_id || order.merchant_id; // merchant_a_id
UPDATE merchants SET balance = balance + 100 WHERE id = merchant_a_id
```

**Balance Changes:**
- **Merchant A: 1000 → 1100 USDC** ✅ CREDIT
- Merchant B: 4900 USDC (no change - already deducted)

**Transaction Log:**
```
ID: uuid
merchant_id: merchant_a_id
order_id: order_id
type: escrow_release
amount: +100
balance_before: 1000
balance_after: 1100
description: "Received 100 USDC from escrow release for order #12345"
```

**Database:**
- Status: → `completed`
- `release_tx_hash`: set
- `completed_at`: NOW()

---

### Final State
```
Merchant A (Buyer): 1100 USDC (+100) ✅
Merchant B (Seller): 4900 USDC (-100) ✅
```

---

## Transaction Log Summary

| Step | Actor | Action | Merchant A | Merchant B | Transaction Type |
|------|-------|--------|------------|------------|------------------|
| 1 | Merchant A | Create BUY order | 1000 | 5000 | - |
| 2 | Merchant B | Accept order | 1000 | 5000 | - |
| 3 | Merchant B | Lock escrow | 1000 | 4900 (-100) | `escrow_lock` (DEBIT) |
| 4 | Merchant A | Mark paid | 1000 | 4900 | - |
| 5 | Merchant B | Release escrow | 1100 (+100) | 4900 | `escrow_release` (CREDIT) |

---

## Merchant-Initiated SELL Order

**Scenario:** Merchant A wants to sell 100 USDC to User B

### Flow

1. **Order Creation + Escrow Lock**
   - Merchant A creates SELL order
   - Merchant A locks 100 USDC immediately
   - **Merchant A: -100 USDC** (DEBIT - `escrow_lock`)

2. **User Accepts**
   - User B accepts order
   - No balance change

3. **User Pays Fiat**
   - User B sends fiat payment
   - User B marks as paid

4. **Merchant Confirms**
   - Merchant A confirms fiat received
   - **User B: +100 USDC** (CREDIT - `escrow_release`)

---

## Key Points

### ✅ CORRECT Behavior

1. **SELLER always locks escrow** → Balance DEDUCTED
   - BUY order: Accepting merchant locks → Their balance deducted
   - SELL order: Creating merchant locks → Their balance deducted

2. **BUYER always receives crypto** → Balance CREDITED
   - BUY order: Creating merchant receives → Their balance credited
   - SELL order: User receives → Their balance credited

3. **buyer_merchant_id identifies the buyer**
   - Set for M2M trades AND merchant-initiated BUY orders
   - Used to credit the correct merchant on completion

### ❌ WRONG Behavior to Avoid

1. ❌ Deducting from buyer when creating BUY order
2. ❌ Crediting seller instead of buyer on completion
3. ❌ Double deduction (at creation AND at escrow lock)
4. ❌ Not logging transactions
5. ❌ **Updating balances during order completion** - Balance updates ONLY happen during escrow lock/release, NOT during status changes to 'completed'

---

## Transaction Types

| Type | Amount | Description |
|------|--------|-------------|
| `escrow_lock` | Negative | Balance deducted when locking funds in escrow |
| `escrow_release` | Positive | Balance credited when escrow released to buyer |
| `escrow_refund` | Positive | Balance credited when escrow refunded to seller |
| `order_completed` | Positive | Balance credited when order completed without explicit release |
| `order_cancelled` | Positive | Balance refunded when order cancelled after escrow lock |
| `manual_adjustment` | +/- | Manual balance adjustment by admin |

---

## Database Schema

```sql
CREATE TABLE merchant_transactions (
  id UUID PRIMARY KEY,
  merchant_id UUID REFERENCES merchants(id),
  user_id UUID REFERENCES users(id),
  order_id UUID REFERENCES orders(id),
  type VARCHAR(50) NOT NULL,
  amount DECIMAL(18, 6) NOT NULL, -- Positive = credit, Negative = debit
  balance_before DECIMAL(18, 6) NOT NULL,
  balance_after DECIMAL(18, 6) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### Get Transaction History
```
GET /api/merchant/transactions?merchant_id={id}&limit=50&offset=0
```

### Get Order Transactions
```
GET /api/merchant/transactions?order_id={id}
```

### Get Balance Summary
```
GET /api/merchant/balance-summary?merchant_id={id}
```

Returns:
```json
{
  "current_balance": 1100,
  "total_credits": 500,
  "total_debits": 400,
  "total_transactions": 25
}
```

---

## Debugging

If balance is wrong, check transaction log:

```sql
SELECT
  created_at,
  type,
  amount,
  balance_before,
  balance_after,
  description
FROM merchant_transactions
WHERE merchant_id = 'merchant_id'
ORDER BY created_at DESC;
```

This will show:
- When balance changed
- By how much (+/-)
- What caused it (escrow_lock, escrow_release, etc.)
- Balance before and after each transaction
