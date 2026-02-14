# Order Flow Scenarios - Minimal (8-State System)

**Version:** 2.0
**Last Updated:** 2026-02-12

---

## Overview

This document provides comprehensive scenario walkthroughs for the **minimal 8-state settlement layer**. Each scenario shows the complete flow from order creation to terminal state, using only the 8 statuses and 6 public actions.

**Scenario Coverage:**
- **12 scenarios** (same as original, simplified flows)
- **BUY orders**: 4 scenarios (happy, cancel, expire, dispute)
- **SELL orders**: 4 scenarios (happy, cancel, expire, dispute)
- **M2M orders**: 4 scenarios (happy, cancel, expire, dispute)

**Key Simplifications:**
- No micro-statuses (`escrow_pending`, `payment_pending`, `payment_confirmed`, `releasing`)
- Payment confirmation is an event (timestamp), not a status
- `confirm_and_release` is atomic (single operation)
- Clearer happy paths: 5 transitions per flow (down from 7-9)

---

## Scenario Index

| # | Category | Scenario | Happy Path? | Transitions | Terminal Status |
|---|----------|----------|-------------|-------------|-----------------|
| 1 | BUY | Accept-first happy path | ✅ | 5 | `completed` |
| 2 | BUY | Early cancellation | ❌ | 2 | `cancelled` |
| 3 | BUY | Expiration (unassigned) | ❌ | 1 | `expired` |
| 4 | BUY | Dispute resolution | ❌ | 6 | `completed` (via dispute) |
| 5 | SELL | Escrow-first happy path | ✅ | 5 | `completed` |
| 6 | SELL | Accept-first happy path | ✅ | 6 | `completed` |
| 7 | SELL | Early cancellation | ❌ | 2 | `cancelled` |
| 8 | SELL | Expiration (unassigned) | ❌ | 1 | `expired` |
| 9 | SELL | Dispute resolution | ❌ | 6 | `completed` (via dispute) |
| 10 | M2M | Escrow-first happy path | ✅ | 5 | `completed` |
| 11 | M2M | Early cancellation | ❌ | 2 | `cancelled` |
| 12 | M2M | Dispute resolution | ❌ | 6 | `completed` (via dispute) |

---

## BUY Order Scenarios

**Context:** User wants to buy crypto from merchant.
- **Buyer**: User
- **Seller**: Merchant
- **Fiat Sender**: User
- **Fiat Receiver**: Merchant
- **Escrow Locker**: Merchant

---

### Scenario 1: BUY - Accept-First Happy Path ✅

**Flow:** User creates order → Merchant accepts → Merchant locks escrow → User sends fiat → Merchant confirms and releases

**Status Progression:**
```
open → accepted → escrowed → payment_sent → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects | Events |
|------|-------|--------|-------------|-----------|-----------|--------------|--------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity from offer | `order_created` |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Extend timer to 120min, assign `merchant_id` | `order_accepted` |
| 3 | Merchant | `lock_escrow` | `accepted` | `escrowed` | `escrowed_at` | Deduct merchant balance, set `escrow_tx_hash` | `escrow_locked` |
| 4 | User | `mark_paid` | `escrowed` | `payment_sent` | `payment_sent_at` | - | `payment_sent` |
| 5 | Merchant | `confirm_and_release` | `payment_sent` | `completed` | `payment_confirmed_at`, `completed_at` | **ATOMIC**: Set `release_tx_hash`, credit user balance, update stats | `payment_confirmed`, `escrow_released`, `order_completed` |

**Total Transitions: 5**

**Timeline:**
```
T+0:00  User creates order (status: open, expires: T+15min)
T+0:30  Merchant accepts order (status: accepted, expires: T+120min)
T+2:00  Merchant locks escrow (status: escrowed)
T+5:00  User sends bank transfer and marks paid (status: payment_sent)
T+10:00 Merchant confirms fiat received, releases escrow (status: completed)
```

**Key Points:**
- **Payment confirmation is an event**: `payment_confirmed_at` timestamp set, but status goes directly to `completed`
- **Atomic operation**: `confirm_and_release` combines payment confirmation + escrow release + balance credit
- **No intermediate statuses**: No `payment_confirmed` or `releasing` status

**Database Changes:**

```sql
-- Step 5: confirm_and_release (ATOMIC)
UPDATE orders SET
  payment_confirmed_at = NOW(),
  release_tx_hash = '0x...',
  completed_at = NOW(),
  status = 'completed',
  order_version = order_version + 1
WHERE id = 'order_uuid';

-- Credit buyer balance (exactly once)
UPDATE users SET balance = balance + 100.50 WHERE id = 'user_uuid';

-- Update stats
UPDATE users SET total_trades = total_trades + 1, total_volume = total_volume + 500 WHERE id = 'user_uuid';
UPDATE merchants SET total_trades = total_trades + 1, total_volume = total_volume + 500 WHERE id = 'merchant_uuid';

-- Log events
INSERT INTO order_events (order_id, event_type, metadata) VALUES
  ('order_uuid', 'payment_confirmed', '{"confirmed_at": "2026-02-12T10:00:00Z"}'),
  ('order_uuid', 'escrow_released', '{"release_tx_hash": "0x..."}'),
  ('order_uuid', 'order_completed', '{"completed_at": "2026-02-12T10:00:00Z"}');
```

---

### Scenario 2: BUY - Early Cancellation ❌

**Flow:** User creates order → Merchant accepts → User cancels (before escrow)

**Status Progression:**
```
open → accepted → cancelled
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant |
| 3 | User | `cancel` | `accepted` | `cancelled` | `cancelled_at` | Restore liquidity, set `cancelled_by='user'` |

**Total Transitions: 3**

**Preconditions for Cancellation:**
- Escrow NOT locked (`escrow_tx_hash IS NULL`)
- Status is `open` or `accepted`

**Key Points:**
- Cancellation only allowed before escrow locked
- After escrow locked, must complete or dispute (no unilateral cancellation)
- Liquidity restored to offer

---

### Scenario 3: BUY - Expiration (Unassigned) ❌

**Flow:** User creates order → No merchant accepts → Timer expires

**Status Progression:**
```
open → expired
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity, set `expires_at = created_at + 15min` |
| 2 | System | Timer expires | `open` | `expired` | `cancelled_at` | Restore liquidity, set `cancelled_by='system'` |

**Total Transitions: 2**

**Timeline:**
```
T+0:00  User creates order (status: open, expires: T+15:00)
T+15:01 Timer expires, no merchant accepted (status: expired)
```

**Key Points:**
- 15 minute timer for unassigned orders
- Safe to expire (no escrow locked, no funds at risk)
- Liquidity restored to offer

---

### Scenario 4: BUY - Dispute Resolution ❌

**Flow:** User creates order → Merchant accepts → Merchant locks escrow → User sends fiat → Merchant disputes → Compliance resolves in favor of user

**Status Progression:**
```
open → accepted → escrowed → payment_sent → disputed → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant |
| 3 | Merchant | `lock_escrow` | `accepted` | `escrowed` | `escrowed_at` | Deduct merchant balance |
| 4 | User | `mark_paid` | `escrowed` | `payment_sent` | `payment_sent_at` | - |
| 5 | Merchant | `dispute` | `payment_sent` | `disputed` | - | Create dispute record, assign to compliance |
| 6 | Compliance | `confirm_and_release` | `disputed` | `completed` | `completed_at` | Release escrow to user (buyer), credit user balance |

**Total Transitions: 6**

**Dispute Reason (Example):**
```json
{
  "reason": "payment_not_received",
  "description": "User claims to have sent bank transfer, but merchant denies receiving it.",
  "evidence_urls": ["https://cdn.example.com/bank-receipt.jpg"],
  "raised_by": "merchant",
  "raiser_id": "merchant_uuid"
}
```

**Dispute Resolution:**
```json
{
  "resolution": "Evidence reviewed. User provided valid bank receipt showing transfer. Bank confirmed transaction cleared. Resolving in favor of user (buyer).",
  "resolved_in_favor_of": "user",
  "resolved_by": "compliance",
  "resolved_at": "2026-02-12T12:00:00Z"
}
```

**Key Points:**
- Disputes can be opened from `escrowed` or `payment_sent` status
- Only `system` or `compliance` can resolve disputes
- Resolution in favor of buyer → `completed` (release escrow to buyer)
- Resolution in favor of seller → `cancelled` (refund escrow to seller)

---

## SELL Order Scenarios

**Context:** User wants to sell crypto to merchant.
- **Buyer**: Merchant
- **Seller**: User
- **Fiat Sender**: Merchant
- **Fiat Receiver**: User
- **Escrow Locker**: User

---

### Scenario 5: SELL - Escrow-First Happy Path ✅

**Flow:** User creates order → User locks escrow → Merchant accepts → Merchant sends fiat → User confirms and releases

**Status Progression:**
```
open → escrowed → accepted → payment_sent → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects | Events |
|------|-------|--------|-------------|-----------|-----------|--------------|--------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity from offer | `order_created` |
| 2 | User | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct user balance, set `escrow_tx_hash`, extend timer to 120min | `escrow_locked` |
| 3 | Merchant | `accept` | `escrowed` | `accepted` | `accepted_at` | Set `acceptor_wallet_address`, assign `merchant_id` | `order_accepted` |
| 4 | Merchant | `mark_paid` | `accepted` | `payment_sent` | `payment_sent_at` | - | `payment_sent` |
| 5 | User | `confirm_and_release` | `payment_sent` | `completed` | `payment_confirmed_at`, `completed_at` | **ATOMIC**: Set `release_tx_hash`, credit merchant balance, update stats | `payment_confirmed`, `escrow_released`, `order_completed` |

**Total Transitions: 5**

**Timeline:**
```
T+0:00  User creates order (status: open, expires: T+15min)
T+0:30  User locks escrow (status: escrowed, expires: T+120min)
T+2:00  Merchant accepts escrowed order (status: accepted)
T+5:00  Merchant sends bank transfer and marks paid (status: payment_sent)
T+10:00 User confirms fiat received, releases escrow (status: completed)
```

**Key Points:**
- **Escrow-first model**: User locks crypto BEFORE merchant accepts (safer for user)
- Order sits in pool as `escrowed` status (any merchant can accept)
- Same atomic `confirm_and_release` operation as BUY orders
- User (fiat receiver) confirms and releases to merchant (buyer)

**Alternative Flow (Step 2-3):**
```
Step 2: User locks escrow (open → escrowed)
Step 3: Merchant accepts (escrowed → accepted)
OR
Step 3: Merchant accepts (escrowed → escrowed) - status may stay escrowed if design choice
```

---

### Scenario 6: SELL - Accept-First Happy Path ✅

**Flow:** User creates order → Merchant accepts → User locks escrow → Merchant sends fiat → User confirms and releases

**Status Progression:**
```
open → accepted → escrowed → payment_sent → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects | Events |
|------|-------|--------|-------------|-----------|-----------|--------------|--------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity | `order_created` |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant, extend timer to 120min | `order_accepted` |
| 3 | User | `lock_escrow` | `accepted` | `escrowed` | `escrowed_at` | Deduct user balance, set `escrow_tx_hash` | `escrow_locked` |
| 4 | Merchant | `mark_paid` | `escrowed` | `payment_sent` | `payment_sent_at` | - | `payment_sent` |
| 5 | User | `confirm_and_release` | `payment_sent` | `completed` | `payment_confirmed_at`, `completed_at` | **ATOMIC**: Set `release_tx_hash`, credit merchant balance, update stats | `payment_confirmed`, `escrow_released`, `order_completed` |

**Total Transitions: 6**

**Timeline:**
```
T+0:00  User creates order (status: open, expires: T+15min)
T+0:30  Merchant accepts order (status: accepted, expires: T+120min)
T+2:00  User locks escrow (status: escrowed)
T+5:00  Merchant sends bank transfer and marks paid (status: payment_sent)
T+10:00 User confirms fiat received, releases escrow (status: completed)
```

**Key Points:**
- **Accept-first model**: Merchant commits before user locks escrow (traditional flow)
- Merchant has 120min to wait for user to lock escrow
- If user doesn't lock escrow in 120min → `cancelled` (timer expires, no escrow locked)

**Comparison: Escrow-First vs Accept-First**

| Aspect | Escrow-First (Scenario 5) | Accept-First (Scenario 6) |
|--------|---------------------------|--------------------------|
| **User Risk** | Lower (crypto locked before merchant commitment) | Higher (merchant may back out before escrow) |
| **Merchant Risk** | Higher (commits fiat to escrowed order) | Lower (sees commitment before accepting) |
| **Transitions** | 5 | 6 |
| **Timer Extension** | At escrow lock (step 2) | At merchant accept (step 2) |
| **Preferred Use Case** | High-value orders, untrusted merchants | Low-value orders, trusted merchants |

---

### Scenario 7: SELL - Early Cancellation ❌

**Flow:** User creates order → Merchant accepts → Merchant cancels (before escrow)

**Status Progression:**
```
open → accepted → cancelled
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant |
| 3 | Merchant | `cancel` | `accepted` | `cancelled` | `cancelled_at` | Restore liquidity, set `cancelled_by='merchant'` |

**Total Transitions: 3**

**Preconditions for Cancellation:**
- Escrow NOT locked (`escrow_tx_hash IS NULL`)
- Status is `open` or `accepted`

**Key Points:**
- Same rules as BUY cancellation
- Merchant can cancel if they realize they don't have liquidity, wrong payment method, etc.

---

### Scenario 8: SELL - Expiration (Unassigned) ❌

**Flow:** User creates order → No merchant accepts → Timer expires

**Status Progression:**
```
open → expired
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity, set `expires_at = created_at + 15min` |
| 2 | System | Timer expires | `open` | `expired` | `cancelled_at` | Restore liquidity, set `cancelled_by='system'` |

**Total Transitions: 2**

**Key Points:**
- Identical to BUY expiration (Scenario 3)
- 15 minute timer for unassigned orders in pool

---

### Scenario 9: SELL - Dispute Resolution ❌

**Flow:** User creates order → User locks escrow → Merchant accepts → Merchant sends fiat → User disputes → Compliance resolves in favor of merchant

**Status Progression:**
```
open → escrowed → accepted → payment_sent → disputed → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | User | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct user balance |
| 3 | Merchant | `accept` | `escrowed` | `accepted` | `accepted_at` | Assign merchant |
| 4 | Merchant | `mark_paid` | `accepted` | `payment_sent` | `payment_sent_at` | - |
| 5 | User | `dispute` | `payment_sent` | `disputed` | - | Create dispute record, assign to compliance |
| 6 | Compliance | `confirm_and_release` | `disputed` | `completed` | `completed_at` | Release escrow to merchant (buyer), credit merchant balance |

**Total Transitions: 6**

**Dispute Reason (Example):**
```json
{
  "reason": "payment_not_received",
  "description": "Merchant claims to have sent bank transfer, but I haven't received it.",
  "evidence_urls": ["https://cdn.example.com/bank-statement.jpg"],
  "raised_by": "user",
  "raiser_id": "user_uuid"
}
```

**Dispute Resolution:**
```json
{
  "resolution": "Evidence reviewed. Merchant provided valid bank receipt showing transfer. User's bank confirmed transaction is pending (3-5 days). User agreed to wait. Order completed successfully.",
  "resolved_in_favor_of": "merchant",
  "resolved_by": "compliance",
  "resolved_at": "2026-02-12T12:00:00Z"
}
```

**Key Points:**
- User (seller) disputes payment not received
- Compliance reviews evidence from both parties
- Resolution in favor of merchant (buyer) → `completed` (release escrow to merchant)
- If resolution favored user → `cancelled` (refund escrow to user)

---

## M2M (Merchant-to-Merchant) Scenarios

**Context:** Two merchants trading with each other.
- **Seller Merchant**: `merchant_id`
- **Buyer Merchant**: `buyer_merchant_id`
- **Fiat Sender**: Buyer Merchant
- **Fiat Receiver**: Seller Merchant
- **Escrow Locker**: Seller Merchant

---

### Scenario 10: M2M - Escrow-First Happy Path ✅

**Flow:** Seller creates order → Seller locks escrow → Buyer accepts → Buyer sends fiat → Seller confirms and releases

**Status Progression:**
```
open → escrowed → accepted → payment_sent → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects | Events |
|------|-------|--------|-------------|-----------|-----------|--------------|--------|
| 1 | Seller Merchant | Create order (M2M) | - | `open` | `created_at` | Reserve liquidity, set `user_id` to placeholder | `order_created` |
| 2 | Seller Merchant | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct seller merchant balance, extend timer to 120min | `escrow_locked` |
| 3 | Buyer Merchant | `accept` | `escrowed` | `accepted` | `accepted_at` | Set `buyer_merchant_id`, assign buyer merchant | `order_accepted` |
| 4 | Buyer Merchant | `mark_paid` | `accepted` | `payment_sent` | `payment_sent_at` | - | `payment_sent` |
| 5 | Seller Merchant | `confirm_and_release` | `payment_sent` | `completed` | `payment_confirmed_at`, `completed_at` | **ATOMIC**: Set `release_tx_hash`, credit buyer merchant balance, update stats | `payment_confirmed`, `escrow_released`, `order_completed` |

**Total Transitions: 5**

**M2M-Specific Fields:**
```json
{
  "user_id": "placeholder_uuid", // Placeholder for broadcast model
  "merchant_id": "seller_merchant_uuid",
  "buyer_merchant_id": "buyer_merchant_uuid", // Set on step 3 (acceptance)
  "type": "sell",
  "escrow_creator_wallet": "seller_merchant_wallet",
  "acceptor_wallet_address": "buyer_merchant_wallet"
}
```

**Key Points:**
- Seller merchant creates order and locks escrow
- Order broadcasts to all merchants (Uber model)
- Buyer merchant accepts and completes trade
- Same flow as SELL escrow-first, but both parties are merchants

---

### Scenario 11: M2M - Early Cancellation ❌

**Flow:** Seller creates order → Seller locks escrow → Seller cancels (mutual agreement with potential buyer)

**Status Progression:**
```
open → escrowed → cancelled
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | Seller Merchant | Create order (M2M) | - | `open` | `created_at` | Reserve liquidity |
| 2 | Seller Merchant | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct seller merchant balance |
| 3 | Seller Merchant | `cancel` | `escrowed` | `cancelled` | `cancelled_at` | **Requires mutual agreement**, refund escrow to seller, restore liquidity |

**Total Transitions: 3**

**Preconditions for Cancellation from `escrowed`:**
- Both parties agree (requires both `merchant_id` and `buyer_merchant_id` to sign off)
- OR dispute resolution

**Key Points:**
- Cancellation after escrow locked requires mutual consent
- Escrow refunded to seller merchant
- Liquidity restored to offer

---

### Scenario 12: M2M - Dispute Resolution ❌

**Flow:** Seller creates order → Seller locks escrow → Buyer accepts → Buyer sends fiat → Timeout → Compliance resolves in favor of buyer

**Status Progression:**
```
open → escrowed → accepted → payment_sent → disputed → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | Seller Merchant | Create order (M2M) | - | `open` | `created_at` | Reserve liquidity |
| 2 | Seller Merchant | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct seller merchant balance |
| 3 | Buyer Merchant | `accept` | `escrowed` | `accepted` | `accepted_at` | Set `buyer_merchant_id` |
| 4 | Buyer Merchant | `mark_paid` | `accepted` | `payment_sent` | `payment_sent_at` | - |
| 5 | System | Timer expires (120min) | `payment_sent` | `disputed` | - | Create dispute record, assign to compliance |
| 6 | Compliance | `confirm_and_release` | `disputed` | `completed` | `completed_at` | Release escrow to buyer merchant, credit buyer merchant balance |

**Total Transitions: 6**

**Dispute Reason (Automatic Timer):**
```json
{
  "reason": "payment_not_received",
  "description": "System automatically created dispute due to 120min timeout. Seller merchant did not confirm payment receipt.",
  "raised_by": "system",
  "raiser_id": null
}
```

**Dispute Resolution:**
```json
{
  "resolution": "Compliance reviewed transaction logs. Buyer merchant provided valid proof of payment. Seller merchant acknowledged delay in checking bank account. Resolving in favor of buyer.",
  "resolved_in_favor_of": "merchant", // buyer_merchant_id
  "resolved_by": "compliance",
  "resolved_at": "2026-02-12T14:00:00Z"
}
```

**Key Points:**
- Timer-triggered dispute (seller didn't confirm within 120min)
- Compliance reviews evidence
- Resolution in favor of buyer merchant → `completed`
- M2M disputes follow same rules as U2M disputes

---

## Special Flow Variations

### Variation A: Direct Completion from Escrowed

**Scenario:** Both parties meet in person for cash trade, complete trade atomically.

**Status Progression:**
```
open → escrowed → completed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order (cash) | - | `open` | `created_at` | Reserve liquidity |
| 2 | User | `lock_escrow` | `open` | `escrowed` | `escrowed_at` | Deduct user balance |
| 3 | User + Merchant | `confirm_and_release` | `escrowed` | `completed` | `payment_confirmed_at`, `completed_at` | **ATOMIC**: Both parties confirm, set `release_tx_hash`, credit merchant balance |

**Total Transitions: 3**

**Key Points:**
- Skips `accepted` and `payment_sent` statuses
- Happens when fiat payment and escrow release occur simultaneously
- Common for in-person cash trades
- Still atomic: `payment_confirmed_at` + `release_tx_hash` + `completed_at` set together

---

### Variation B: Mutual Cancellation After Escrow

**Scenario:** Both parties agree to cancel trade after escrow locked (rare).

**Status Progression:**
```
open → accepted → escrowed → cancelled
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant |
| 3 | Merchant | `lock_escrow` | `accepted` | `escrowed` | `escrowed_at` | Deduct merchant balance |
| 4 | User + Merchant | `cancel` | `escrowed` | `cancelled` | `cancelled_at` | **Requires both signatures**, refund escrow, restore liquidity |

**Total Transitions: 4**

**Preconditions:**
- Both `user` and `merchant` must sign cancellation request
- Compliance can facilitate if needed

**Key Points:**
- Rare scenario (both parties agree to cancel after commitment)
- Escrow refunded to seller
- Liquidity restored to offer
- Requires explicit confirmation from both parties

---

### Variation C: Timer Expiry After Escrow Locked

**Scenario:** Trade doesn't progress, timer expires with escrow locked.

**Status Progression:**
```
open → accepted → escrowed → disputed
```

**Detailed Steps:**

| Step | Actor | Action | From Status | To Status | Timestamp | Side Effects |
|------|-------|--------|-------------|-----------|-----------|--------------|
| 1 | User | Create order | - | `open` | `created_at` | Reserve liquidity |
| 2 | Merchant | `accept` | `open` | `accepted` | `accepted_at` | Assign merchant, set `expires_at = accepted_at + 120min` |
| 3 | Merchant | `lock_escrow` | `accepted` | `escrowed` | `escrowed_at` | Deduct merchant balance |
| 4 | System | Timer expires (120min) | `escrowed` | `disputed` | - | Create dispute record, assign to compliance |

**Total Transitions: 4**

**Key Points:**
- **CRITICAL RULE**: Timer expiry with escrow locked ALWAYS creates dispute
- NEVER auto-refund (prevents gaming the system)
- Compliance reviews situation and decides outcome
- Protects both parties (buyer may have sent fiat off-platform)

**Dispute Resolution Options:**
- **Favor buyer** (if fiat sent) → `completed` (release escrow to buyer)
- **Favor seller** (if fiat not sent) → `cancelled` (refund escrow to seller)

---

## Event Timeline Examples

### Example 1: Fast Happy Path (BUY Order)

```
00:00:00 | User creates BUY order (100 USDC for 500 AED)
         | Status: open
         | Expires: 00:15:00
         | Event: order_created

00:00:45 | Merchant accepts order
         | Status: accepted
         | Expires: 02:00:45 (120min from now)
         | Event: order_accepted

00:02:00 | Merchant locks escrow (100 USDC)
         | Status: escrowed
         | Balance: merchant.balance -= 100 USDC
         | Event: escrow_locked

00:05:30 | User sends bank transfer (500 AED)
         | User marks payment sent
         | Status: payment_sent
         | Event: payment_sent

00:10:00 | Merchant confirms fiat received (500 AED in bank)
         | Merchant releases escrow (100 USDC)
         | Status: completed
         | Balance: user.balance += 100 USDC
         | Event: payment_confirmed (NOT a status)
         | Event: escrow_released
         | Event: order_completed

Trade completed in 10 minutes.
```

---

### Example 2: Disputed Path (SELL Order)

```
00:00:00 | User creates SELL order (50 USDC for 250 AED)
         | Status: open
         | Event: order_created

00:01:00 | User locks escrow (50 USDC)
         | Status: escrowed
         | Balance: user.balance -= 50 USDC
         | Event: escrow_locked

00:02:00 | Merchant accepts order
         | Status: accepted
         | Event: order_accepted

00:05:00 | Merchant marks payment sent (250 AED)
         | Status: payment_sent
         | Event: payment_sent

00:20:00 | User checks bank, no transfer received
         | User opens dispute
         | Status: disputed
         | Event: order_disputed

01:00:00 | Compliance reviews evidence:
         | - User: Bank statement (no incoming transfer)
         | - Merchant: Bank receipt (transfer sent)
         | Compliance contacts merchant's bank

02:00:00 | Bank confirms transfer delayed (technical issue)
         | Transfer arrives in user's account
         | Compliance resolves in favor of merchant
         | Status: completed
         | Balance: merchant.balance += 50 USDC
         | Event: dispute_resolved
         | Event: escrow_released
         | Event: order_completed

Trade completed in 2 hours (with dispute resolution).
```

---

### Example 3: Expiration Path (Unassigned)

```
00:00:00 | User creates BUY order (200 USDC for 1000 AED)
         | Status: open
         | Expires: 00:15:00
         | Event: order_created

00:05:00 | No merchant accepts (all busy)

00:10:00 | Still no merchant accepts

00:15:01 | Timer expires (15min timeout)
         | Status: expired
         | Liquidity restored to offers pool
         | Event: order_expired

Order expired without assignment.
```

---

## Payment Confirmed: Event vs Status

### Original System (12-Status)

**Flow:**
```
payment_sent → payment_confirmed → releasing → completed
```

**Issues:**
- `payment_confirmed` is a full status (requires transition)
- `releasing` is a micro-status (short-lived, blockchain waiting)
- Two extra transitions (increases complexity)

---

### Minimal System (8-Status)

**Flow:**
```
payment_sent → completed (with payment_confirmed event)
```

**Benefits:**
- `payment_confirmed` is an EVENT (timestamp: `payment_confirmed_at`)
- No `releasing` status (atomic operation)
- One transition (simpler)

**Example Event Emission:**

```typescript
// When merchant calls confirm_and_release
const result = await confirmAndRelease(orderId, releaseTxHash, 'merchant', merchantId);

// Events emitted during atomic transaction:
[
  {
    event_type: 'payment_confirmed',
    order_id: orderId,
    metadata: {
      confirmed_at: '2026-02-12T10:00:00Z',
      confirmed_by: 'merchant',
    },
  },
  {
    event_type: 'escrow_released',
    order_id: orderId,
    metadata: {
      release_tx_hash: releaseTxHash,
      released_at: '2026-02-12T10:00:05Z',
    },
  },
  {
    event_type: 'order_completed',
    order_id: orderId,
    old_status: 'payment_sent',
    new_status: 'completed',
  },
];

// Order status changes directly from payment_sent → completed
// payment_confirmed_at timestamp is set (event), but NOT a status
```

**Chat/UI Display:**

```
[10:00:00] System: Merchant confirmed receiving 500 AED
[10:00:05] System: Escrow released (100 USDC → User)
[10:00:05] System: Order completed successfully ✓
```

---

## Comparison Summary

### Transition Counts by Scenario

| Scenario | Original (12-Status) | Minimal (8-Status) | Reduction |
|----------|---------------------|-------------------|-----------|
| **BUY Happy Path** | 7-9 transitions | 5 transitions | -29% to -44% |
| **SELL Happy Path (Escrow-First)** | 7-9 transitions | 5 transitions | -29% to -44% |
| **SELL Happy Path (Accept-First)** | 8-10 transitions | 6 transitions | -25% to -40% |
| **Cancellation** | 2-3 transitions | 2-3 transitions | No change |
| **Expiration** | 1-2 transitions | 1-2 transitions | No change |
| **Dispute** | 6-8 transitions | 6 transitions | -25% to 0% |

---

### Status Usage Frequency (Estimated)

| Status | Usage in 12 Scenarios | % of Total Flows |
|--------|----------------------|------------------|
| `open` | 12/12 | 100% |
| `accepted` | 11/12 | 92% |
| `escrowed` | 9/12 | 75% |
| `payment_sent` | 7/12 | 58% |
| `completed` | 10/12 | 83% |
| `cancelled` | 4/12 | 33% |
| `expired` | 2/12 | 17% |
| `disputed` | 3/12 | 25% |

**Removed Statuses (from original):**
- `escrow_pending`: 0% (eliminated, happens in `accepted`)
- `payment_pending`: 0% (eliminated, implicit after `escrowed`)
- `payment_confirmed`: 0% (eliminated, now event in `payment_sent`)
- `releasing`: 0% (eliminated, atomic in `completed`)

---

## Testing Checklist

### Core Scenarios (Must Pass)

- [ ] **Scenario 1**: BUY accept-first happy path (5 transitions)
- [ ] **Scenario 2**: BUY early cancellation (3 transitions)
- [ ] **Scenario 3**: BUY expiration unassigned (2 transitions)
- [ ] **Scenario 4**: BUY dispute resolution (6 transitions)
- [ ] **Scenario 5**: SELL escrow-first happy path (5 transitions)
- [ ] **Scenario 6**: SELL accept-first happy path (6 transitions)
- [ ] **Scenario 7**: SELL early cancellation (3 transitions)
- [ ] **Scenario 8**: SELL expiration unassigned (2 transitions)
- [ ] **Scenario 9**: SELL dispute resolution (6 transitions)
- [ ] **Scenario 10**: M2M escrow-first happy path (5 transitions)
- [ ] **Scenario 11**: M2M early cancellation (3 transitions)
- [ ] **Scenario 12**: M2M dispute resolution (6 transitions)

### Special Cases (Should Pass)

- [ ] **Variation A**: Direct completion from escrowed (3 transitions)
- [ ] **Variation B**: Mutual cancellation after escrow (4 transitions)
- [ ] **Variation C**: Timer expiry after escrow locked (4 transitions)

### Event Verification (Must Pass)

- [ ] `payment_confirmed_at` timestamp set during `confirm_and_release`
- [ ] `payment_confirmed` event emitted (not a status transition)
- [ ] Order status goes directly from `payment_sent` to `completed`
- [ ] No orders stuck in removed statuses (`payment_confirmed`, `releasing`)

### Balance Consistency (Must Pass)

- [ ] Escrow lock deducts seller balance exactly once
- [ ] Escrow release credits buyer balance exactly once
- [ ] No double-spending or double-crediting
- [ ] Balance updates happen atomically with status change

### Timer Behavior (Must Pass)

- [ ] 15min timer expires unassigned orders (`open` → `expired`)
- [ ] 120min timer creates dispute if escrow locked
- [ ] 120min timer cancels if escrow NOT locked
- [ ] No silent auto-refunds after escrow locked

---

## Glossary

| Term | Definition |
|------|------------|
| **Accept-First** | Merchant accepts order before escrow locked (traditional flow) |
| **Atomic Operation** | Single action combining multiple steps (e.g., `confirm_and_release`) |
| **Escrow-First** | Escrow locked before merchant accepts (safer for seller) |
| **Event** | Logged occurrence without status change (e.g., `payment_confirmed`) |
| **Happy Path** | Successful flow with no disputes or cancellations |
| **Terminal Status** | Final status with no further transitions (completed, cancelled, expired) |
| **Transition** | Change from one status to another |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-12 | Minimal 8-status scenarios (simplified from 12-status) |
| 1.0 | 2026-02-12 | Original scenarios with 12 statuses |

---

**END OF SCENARIO LIST**

**Use these scenarios for testing, documentation, and onboarding new developers.**
