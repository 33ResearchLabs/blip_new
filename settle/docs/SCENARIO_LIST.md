# Order Test Scenarios

## Overview

This document defines 12 comprehensive test scenarios for the Blip Money order system. These scenarios cover both BUY and SELL flows, including happy paths, cancellations, expirations, and dispute resolutions.

**Version:** 1.0
**Last Updated:** 2026-02-12

---

## Test Data Setup

### Test Users
- **User1 (Buyer):** `user-buyer-001`
  - Username: `alice`
  - Wallet: `ALICExxx...xxx` (mock)
  - Initial Balance: 1000 USDC

- **User2 (Seller):** `user-seller-001`
  - Username: `bob`
  - Wallet: `BOBxxx...xxx` (mock)
  - Initial Balance: 1000 USDC

### Test Merchants
- **Merchant1:** `merchant-001`
  - Display Name: `FastTrade Exchange`
  - Wallet: `MERCHANTxxx...001` (mock)
  - Initial Balance: 10000 USDC
  - Offers: BUY and SELL at 3.67 AED/USDC

- **Merchant2:** `merchant-002`
  - Display Name: `QuickSwap Pro`
  - Wallet: `MERCHANTxxx...002` (mock)
  - Initial Balance: 10000 USDC
  - Offers: BUY and SELL at 3.68 AED/USDC

### Admin
- **Admin1:** `admin-001`
  - Name: `Compliance Team`
  - Type: `compliance`

---

## BUY Flow Scenarios

User wants to buy USDC from a merchant (merchant sells USDC to user).

---

## Scenario 1: BUY - Happy Path

**Description:** User successfully buys 100 USDC from merchant with bank payment.

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)
- Payment Method: bank

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "user_id": "user-buyer-001",
    "offer_id": "offer-merchant1-sell",
    "type": "buy",
    "crypto_amount": 100,
    "payment_method": "bank",
    "buyer_wallet_address": "ALICExxx...xxx"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created` (actor: user, new_status: pending)
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4900 (liquidity reserved)
  - Order fields set: crypto_amount=100, fiat_amount=367, rate=3.67, expires_at=NOW+15min

#### Step 2: Merchant Accepts Order
- **Action:** `accept`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "accepted",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "acceptor_wallet_address": "MERCHANTxxx...001"
  }
  ```
- **Expected Status After:** `accepted`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_accepted` (actor: merchant, old_status: pending, new_status: accepted)
- **Expected Side Effects:**
  - accepted_at: NOW
  - expires_at: NOW+120min
  - acceptor_wallet_address: MERCHANTxxx...001
  - System message: "✓ Order accepted by merchant"
  - System message: "🏦 Payment Details - Send fiat to this account" (with bank details)

#### Step 3: Merchant Locks Escrow
- **Action:** `escrow`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "escrowed",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "escrow_tx_hash": "ESCROWxxx...001",
    "escrow_trade_id": 12345,
    "escrow_trade_pda": "TRADExxx...001",
    "escrow_pda": "PDA123xxx...001",
    "escrow_creator_wallet": "MERCHANTxxx...001"
  }
  ```
- **Expected Status After:** `escrowed`
- **Expected order_version After:** 3
- **Expected Events Emitted:**
  - `status_changed_to_escrowed` (actor: merchant, old_status: accepted, new_status: escrowed)
- **Expected Side Effects:**
  - escrowed_at: NOW
  - expires_at: NOW+120min
  - escrow_tx_hash: ESCROWxxx...001
  - escrow_trade_id: 12345
  - escrow_trade_pda: TRADExxx...001
  - escrow_pda: PDA123xxx...001
  - escrow_creator_wallet: MERCHANTxxx...001
  - Merchant balance: 10000 → 9900 (100 USDC locked)
  - System message: "🔒 100 USDC locked in escrow"

#### Step 4: User Sends Fiat Payment
- **Action:** `send_payment`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "status": "payment_sent",
    "actor_type": "user",
    "actor_id": "user-buyer-001"
  }
  ```
- **Expected Status After:** `payment_sent`
- **Expected order_version After:** 4
- **Expected Events Emitted:**
  - `status_changed_to_payment_sent` (actor: user, old_status: escrowed, new_status: payment_sent)
- **Expected Side Effects:**
  - payment_sent_at: NOW
  - System message: "💸 Payment of 367 AED marked as sent"

#### Step 5: Merchant Confirms Payment
- **Action:** `confirm_payment`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "payment_confirmed",
    "actor_type": "merchant",
    "actor_id": "merchant-001"
  }
  ```
- **Expected Status After:** `payment_confirmed`
- **Expected order_version After:** 5
- **Expected Events Emitted:**
  - `status_changed_to_payment_confirmed` (actor: merchant, old_status: payment_sent, new_status: payment_confirmed)
- **Expected Side Effects:**
  - payment_confirmed_at: NOW
  - System message: "✓ Payment confirmed"

#### Step 6: Merchant Releases Escrow
- **Action:** `complete`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "completed",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "release_tx_hash": "RELEASExxx...001"
  }
  ```
- **Expected Status After:** `completed`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_completed` (actor: merchant, old_status: payment_confirmed, new_status: completed)
- **Expected Side Effects:**
  - completed_at: NOW
  - release_tx_hash: RELEASExxx...001
  - User balance: 1000 → 1100 (received 100 USDC)
  - Merchant balance: 9900 (no change - escrow released to user)
  - User total_trades: +1, total_volume: +367
  - Merchant total_trades: +1, total_volume: +367
  - Reputation events: order_completed for both
  - Merchant contact added for alice
  - System message: "✅ Trade completed successfully! 100 USDC released"
  - System message: "✅ 100 USDC released" (escrow release details)

### Final State
- User: alice (balance: 1100 USDC, total_trades: 1, total_volume: 367 AED)
- Merchant: FastTrade Exchange (balance: 9900 USDC, offer available: 4900 USDC, total_trades: 1, total_volume: 367 AED)
- Order: status=completed, escrow released
- Chat: 9 system messages documenting the flow

---

## Scenario 2: BUY - Buyer Cancels (before accepted)

**Description:** User creates buy order but cancels before merchant accepts.

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "user_id": "user-buyer-001",
    "offer_id": "offer-merchant1-sell",
    "type": "buy",
    "crypto_amount": 50,
    "payment_method": "bank",
    "buyer_wallet_address": "ALICExxx...xxx"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created` (actor: user, new_status: pending)
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4950
  - expires_at: NOW+15min

#### Step 2: User Cancels Order
- **Action:** `cancel`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "user",
    "actor_id": "user-buyer-001",
    "reason": "Changed my mind"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_cancelled` (actor: user, old_status: pending, new_status: cancelled)
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: user
  - cancellation_reason: "Changed my mind"
  - Offer available_amount: 4950 → 5000 (liquidity restored)
  - Reputation events: order_cancelled for both
  - System message: "❌ Order cancelled: Changed my mind"

### Final State
- User: alice (balance: 1000 USDC - unchanged)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 5000 USDC - restored)
- Order: status=cancelled, reason="Changed my mind"
- Chat: 2 system messages

---

## Scenario 3: BUY - Merchant Cancels (after accepted)

**Description:** Merchant accepts order but cancels before locking escrow.

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "user_id": "user-buyer-001",
    "offer_id": "offer-merchant1-sell",
    "type": "buy",
    "crypto_amount": 75,
    "payment_method": "bank",
    "buyer_wallet_address": "ALICExxx...xxx"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created`
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4925

#### Step 2: Merchant Accepts Order
- **Action:** `accept`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "accepted",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "acceptor_wallet_address": "MERCHANTxxx...001"
  }
  ```
- **Expected Status After:** `accepted`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_accepted`
- **Expected Side Effects:**
  - accepted_at: NOW
  - expires_at: NOW+120min
  - System messages: acceptance and bank details

#### Step 3: Merchant Cancels Order
- **Action:** `cancel`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "reason": "Insufficient liquidity"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 3
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: merchant
  - cancellation_reason: "Insufficient liquidity"
  - Offer available_amount: 4925 → 5000 (liquidity restored)
  - Reputation events: order_cancelled for both
  - System message: "❌ Order cancelled: Insufficient liquidity"

### Final State
- User: alice (balance: 1000 USDC - unchanged)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 5000 USDC - restored)
- Order: status=cancelled, cancelled_by=merchant
- Chat: 4 system messages

---

## Scenario 4: BUY - Expires (no acceptance)

**Description:** User creates order but no merchant accepts within 15 minutes.

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "user_id": "user-buyer-001",
    "offer_id": "offer-merchant1-sell",
    "type": "buy",
    "crypto_amount": 200,
    "payment_method": "bank",
    "buyer_wallet_address": "ALICExxx...xxx"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created`
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4800
  - expires_at: NOW+15min

#### Step 2: System Expires Order (15 minutes elapsed)
- **Action:** `expire`
- **Actor:** system
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "system",
    "actor_id": "order-id"
  }
  ```
- **Expected Status After:** `cancelled` (pending orders expire to cancelled)
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: system
  - cancellation_reason: "Order timeout - no one accepted within 15 minutes"
  - Offer available_amount: 4800 → 5000 (liquidity restored)
  - Reputation events: order_timeout for user and merchant
  - System message: "⏰ Order expired - no one accepted within 15 minutes"

### Final State
- User: alice (balance: 1000 USDC - unchanged)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 5000 USDC - restored)
- Order: status=cancelled, cancelled_by=system
- Chat: 2 system messages

---

## Scenario 5: BUY - Dispute + Admin Resolves (refund)

**Description:** User claims payment sent but merchant denies receiving it. Admin investigates and resolves in favor of seller (refund).

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Steps 1-3: Order Created, Accepted, Escrowed
(Same as Scenario 1, Steps 1-3)
- **Expected Status After Step 3:** `escrowed`
- **Expected order_version After Step 3:** 3
- **Merchant balance after escrow:** 9900 USDC

#### Step 4: User Sends Payment
- **Action:** `send_payment`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "status": "payment_sent",
    "actor_type": "user",
    "actor_id": "user-buyer-001"
  }
  ```
- **Expected Status After:** `payment_sent`
- **Expected order_version After:** 4
- **Expected Events Emitted:**
  - `status_changed_to_payment_sent`
- **Expected Side Effects:**
  - payment_sent_at: NOW

#### Step 5: Merchant Disputes (claims payment not received)
- **Action:** `dispute`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "disputed",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "reason": "payment_not_received",
    "description": "No payment received in my bank account after 2 hours",
    "evidence_urls": ["https://example.com/bank-statement.png"]
  }
  ```
- **Expected Status After:** `disputed`
- **Expected order_version After:** 5
- **Expected Events Emitted:**
  - `status_changed_to_disputed`
- **Expected Side Effects:**
  - Dispute record created: reason=payment_not_received, status=open
  - Reputation events: order_disputed for both
  - System message: "⚠️ Order is now under dispute"

#### Step 6: Admin Resolves in Favor of Merchant (refund escrow to merchant)
- **Action:** `resolve`
- **Actor:** admin (system)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "system",
    "actor_id": "admin-001",
    "resolved_in_favor_of": "merchant",
    "resolution": "Investigation confirmed no payment received. Bank statement verified. Refunding merchant.",
    "refund_tx_hash": "REFUNDxxx...001"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: system
  - refund_tx_hash: REFUNDxxx...001
  - Merchant balance: 9900 → 10000 (escrow refunded)
  - User balance: 1000 (no change)
  - Dispute record updated: status=resolved, resolved_in_favor_of=merchant, resolution set
  - Reputation events: dispute resolution for both
  - System message: Resolution details with refund info

### Final State
- User: alice (balance: 1000 USDC - no crypto received)
- Merchant: FastTrade Exchange (balance: 10000 USDC - escrow refunded)
- Order: status=cancelled, refund_tx_hash set
- Dispute: status=resolved, resolved_in_favor_of=merchant
- Chat: 7+ system messages

---

## Scenario 6: BUY - Dispute + Admin Resolves (complete)

**Description:** Merchant claims payment not confirmed but user has proof. Admin resolves in favor of buyer (release escrow).

### Initial State
- User: alice (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: sell 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Steps 1-4: Order Created, Accepted, Escrowed, Payment Sent
(Same as Scenario 5, Steps 1-4)
- **Expected Status After Step 4:** `payment_sent`
- **Expected order_version After Step 4:** 4

#### Step 5: User Disputes (merchant not confirming payment)
- **Action:** `dispute`
- **Actor:** alice (user)
- **Payload:**
  ```json
  {
    "status": "disputed",
    "actor_type": "user",
    "actor_id": "user-buyer-001",
    "reason": "payment_not_received",
    "description": "I sent payment 3 hours ago with proof but merchant won't confirm",
    "evidence_urls": ["https://example.com/transfer-receipt.png"]
  }
  ```
- **Expected Status After:** `disputed`
- **Expected order_version After:** 5
- **Expected Events Emitted:**
  - `status_changed_to_disputed`
- **Expected Side Effects:**
  - Dispute record created: reason=payment_not_received, status=open
  - Reputation events: order_disputed for both
  - System message: "⚠️ Order is now under dispute"

#### Step 6: Admin Resolves in Favor of User (release escrow to user)
- **Action:** `resolve`
- **Actor:** admin (system)
- **Payload:**
  ```json
  {
    "status": "completed",
    "actor_type": "system",
    "actor_id": "admin-001",
    "resolved_in_favor_of": "user",
    "resolution": "Bank transfer receipt verified. Payment confirmed. Releasing escrow to buyer.",
    "release_tx_hash": "RELEASExxx...002"
  }
  ```
- **Expected Status After:** `completed`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_completed`
- **Expected Side Effects:**
  - completed_at: NOW
  - release_tx_hash: RELEASExxx...002
  - User balance: 1000 → 1100 (received 100 USDC)
  - Merchant balance: 9900 (escrow released to user)
  - User total_trades: +1, total_volume: +367
  - Merchant total_trades: +1, total_volume: +367
  - Dispute record updated: status=resolved, resolved_in_favor_of=user, resolution set
  - Reputation events: dispute resolution and order_completed for both
  - Merchant contact added for alice
  - System message: Resolution and completion details

### Final State
- User: alice (balance: 1100 USDC - received crypto)
- Merchant: FastTrade Exchange (balance: 9900 USDC - escrow released)
- Order: status=completed, release_tx_hash set
- Dispute: status=resolved, resolved_in_favor_of=user
- Chat: 7+ system messages

---

## SELL Flow Scenarios

User wants to sell USDC to a merchant (user sells USDC, merchant buys from user).

---

## Scenario 7: SELL - Happy Path

**Description:** User successfully sells 100 USDC to merchant with bank payment.

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)
- Payment Method: bank

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "user_id": "user-seller-001",
    "offer_id": "offer-merchant1-buy",
    "type": "sell",
    "crypto_amount": 100,
    "payment_method": "bank",
    "user_bank_account": "AE070331234567890123456"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created`
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4900
  - Order fields: crypto_amount=100, fiat_amount=367, rate=3.67

#### Step 2: User Locks Escrow (sell flow: user locks first)
- **Action:** `escrow`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "escrowed",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "escrow_tx_hash": "ESCROWxxx...002",
    "escrow_trade_id": 12346,
    "escrow_trade_pda": "TRADExxx...002",
    "escrow_pda": "PDA123xxx...002",
    "escrow_creator_wallet": "BOBxxx...xxx"
  }
  ```
- **Expected Status After:** `escrowed`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_escrowed`
- **Expected Side Effects:**
  - escrowed_at: NOW
  - expires_at: NOW+120min
  - User balance: 1000 → 900 (100 USDC locked)
  - All escrow fields set
  - System message: "🔒 100 USDC locked in escrow"

#### Step 3: Merchant Accepts Order
- **Action:** `accept`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "accepted",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "acceptor_wallet_address": "MERCHANTxxx...001"
  }
  ```
- **Expected Status After:** `escrowed` (stays escrowed, doesn't regress)
- **Expected order_version After:** 3
- **Expected Events Emitted:**
  - `status_changed_to_accepted` (but status remains escrowed)
- **Expected Side Effects:**
  - accepted_at: NOW
  - acceptor_wallet_address: MERCHANTxxx...001
  - System message: "✓ Order accepted by merchant"
  - System message: "🏦 Payment Details - Merchant will send fiat here" (user's bank)

#### Step 4: Merchant Sends Fiat Payment
- **Action:** `send_payment`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "payment_sent",
    "actor_type": "merchant",
    "actor_id": "merchant-001"
  }
  ```
- **Expected Status After:** `payment_sent`
- **Expected order_version After:** 4
- **Expected Events Emitted:**
  - `status_changed_to_payment_sent`
- **Expected Side Effects:**
  - payment_sent_at: NOW
  - System message: "💸 Payment of 367 AED marked as sent"

#### Step 5: User Confirms Payment
- **Action:** `confirm_payment`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "payment_confirmed",
    "actor_type": "user",
    "actor_id": "user-seller-001"
  }
  ```
- **Expected Status After:** `payment_confirmed`
- **Expected order_version After:** 5
- **Expected Events Emitted:**
  - `status_changed_to_payment_confirmed`
- **Expected Side Effects:**
  - payment_confirmed_at: NOW
  - System message: "✓ Payment confirmed"

#### Step 6: User Releases Escrow
- **Action:** `complete`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "completed",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "release_tx_hash": "RELEASExxx...003"
  }
  ```
- **Expected Status After:** `completed`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_completed`
- **Expected Side Effects:**
  - completed_at: NOW
  - release_tx_hash: RELEASExxx...003
  - User balance: 900 (no change - already deducted)
  - Merchant balance: 10000 → 10100 (received 100 USDC)
  - User total_trades: +1, total_volume: +367
  - Merchant total_trades: +1, total_volume: +367
  - Reputation events: order_completed for both
  - Merchant contact added for bob
  - System messages: completion and release details

### Final State
- User: bob (balance: 900 USDC, total_trades: 1, total_volume: 367 AED)
- Merchant: FastTrade Exchange (balance: 10100 USDC, offer available: 4900 USDC, total_trades: 1, total_volume: 367 AED)
- Order: status=completed, escrow released to merchant
- Chat: 9+ system messages

---

## Scenario 8: SELL - User Cancels (before accepted)

**Description:** User creates sell order and locks escrow but cancels before merchant accepts.

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "user_id": "user-seller-001",
    "offer_id": "offer-merchant1-buy",
    "type": "sell",
    "crypto_amount": 50,
    "payment_method": "bank",
    "user_bank_account": "AE070331234567890123456"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created`
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4950

#### Step 2: User Locks Escrow
- **Action:** `escrow`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "escrowed",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "escrow_tx_hash": "ESCROWxxx...003",
    "escrow_trade_id": 12347,
    "escrow_trade_pda": "TRADExxx...003",
    "escrow_pda": "PDA123xxx...003",
    "escrow_creator_wallet": "BOBxxx...xxx"
  }
  ```
- **Expected Status After:** `escrowed`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_escrowed`
- **Expected Side Effects:**
  - User balance: 1000 → 950 (50 USDC locked)
  - escrowed_at: NOW
  - System message: escrow locked

#### Step 3: User Cancels Order (refund required)
- **Action:** `cancel`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "reason": "Changed my mind",
    "refund_tx_hash": "REFUNDxxx...002"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 3
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: user
  - cancellation_reason: "Changed my mind"
  - refund_tx_hash: REFUNDxxx...002
  - User balance: 950 → 1000 (escrow refunded)
  - Offer available_amount: 4950 → 5000 (liquidity restored - escrow was locked)
  - Reputation events: order_cancelled for both
  - System message: cancellation with refund details

### Final State
- User: bob (balance: 1000 USDC - refunded)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 5000 USDC - restored)
- Order: status=cancelled, refund_tx_hash set
- Chat: 3+ system messages

---

## Scenario 9: SELL - Merchant Cancels (after accepted)

**Description:** User locks escrow, merchant accepts, but merchant cancels before sending payment.

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Steps 1-3: Order Created, Escrowed, Accepted
(Same as Scenario 7, Steps 1-3)
- **Expected Status After Step 3:** `escrowed`
- **Expected order_version After Step 3:** 3
- **User balance after escrow:** 925 USDC (75 locked)

#### Step 4: Merchant Cancels Order
- **Action:** `cancel`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "reason": "Bank account verification failed",
    "refund_tx_hash": "REFUNDxxx...003"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 4
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: merchant
  - cancellation_reason: "Bank account verification failed"
  - refund_tx_hash: REFUNDxxx...003
  - User balance: 925 → 1000 (escrow refunded)
  - Offer available_amount: restored (escrow refunded, so add back to available)
  - Reputation events: order_cancelled for both
  - System message: cancellation details

### Final State
- User: bob (balance: 1000 USDC - refunded)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 5000 USDC)
- Order: status=cancelled, cancelled_by=merchant, refund_tx_hash set
- Chat: 5+ system messages

---

## Scenario 10: SELL - Expires (no acceptance)

**Description:** User locks escrow but no merchant accepts within timeout period.

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Step 1: User Creates Order
- **Action:** `create`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "user_id": "user-seller-001",
    "offer_id": "offer-merchant1-buy",
    "type": "sell",
    "crypto_amount": 200,
    "payment_method": "bank",
    "user_bank_account": "AE070331234567890123456"
  }
  ```
- **Expected Status After:** `pending`
- **Expected order_version After:** 1
- **Expected Events Emitted:**
  - `order_created`
- **Expected Side Effects:**
  - Offer available_amount: 5000 → 4800

#### Step 2: User Locks Escrow
- **Action:** `escrow`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "escrowed",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "escrow_tx_hash": "ESCROWxxx...004",
    "escrow_trade_id": 12348,
    "escrow_trade_pda": "TRADExxx...004",
    "escrow_pda": "PDA123xxx...004",
    "escrow_creator_wallet": "BOBxxx...xxx"
  }
  ```
- **Expected Status After:** `escrowed`
- **Expected order_version After:** 2
- **Expected Events Emitted:**
  - `status_changed_to_escrowed`
- **Expected Side Effects:**
  - User balance: 1000 → 800 (200 USDC locked)
  - escrowed_at: NOW
  - expires_at: NOW+120min

#### Step 3: System Expires Order (120 minutes elapsed, no acceptance)
- **Action:** `expire`
- **Actor:** system
- **Payload:**
  ```json
  {
    "status": "disputed",
    "actor_type": "system",
    "actor_id": "order-id"
  }
  ```
- **Expected Status After:** `disputed` (escrowed orders expire to disputed, not cancelled)
- **Expected order_version After:** 3
- **Expected Events Emitted:**
  - `status_changed_to_disputed`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: system
  - cancellation_reason: "Order timeout - not completed within 120 minutes after acceptance (was in escrowed status)"
  - Dispute record created: auto-generated dispute
  - User balance: 800 (escrow still locked - admin must resolve)
  - Reputation events: order_disputed for both
  - System message: "⏰ Order expired - moved to dispute for resolution (escrow was locked)"

### Final State
- User: bob (balance: 800 USDC - escrow still locked)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer available: 4800 USDC)
- Order: status=disputed, cancelled_by=system
- Dispute: auto-created, status=open
- Chat: 3+ system messages
- **Note:** Admin must resolve dispute to refund escrow to user

---

## Scenario 11: SELL - Dispute + Admin Resolves (refund)

**Description:** Merchant claims never received fiat but user disputes. Admin investigates and resolves in favor of seller (refund escrow to user).

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Steps 1-4: Order Created, Escrowed, Accepted, Payment Sent
(Same as Scenario 7, Steps 1-4)
- **Expected Status After Step 4:** `payment_sent`
- **Expected order_version After Step 4:** 4
- **User balance after escrow:** 900 USDC

#### Step 5: Merchant Disputes (claims no payment received)
- **Action:** `dispute`
- **Actor:** FastTrade Exchange (merchant)
- **Payload:**
  ```json
  {
    "status": "disputed",
    "actor_type": "merchant",
    "actor_id": "merchant-001",
    "reason": "payment_not_received",
    "description": "User marked payment as sent 4 hours ago but I have not received any fiat in my bank account",
    "evidence_urls": ["https://example.com/bank-statement-merchant.png"]
  }
  ```
- **Expected Status After:** `disputed`
- **Expected order_version After:** 5
- **Expected Events Emitted:**
  - `status_changed_to_disputed`
- **Expected Side Effects:**
  - Dispute record created: reason=payment_not_received, status=open
  - Reputation events: order_disputed for both
  - System message: "⚠️ Order is now under dispute"

#### Step 6: Admin Resolves in Favor of User (refund escrow to user)
- **Action:** `resolve`
- **Actor:** admin (system)
- **Payload:**
  ```json
  {
    "status": "cancelled",
    "actor_type": "system",
    "actor_id": "admin-001",
    "resolved_in_favor_of": "user",
    "resolution": "Investigation found user's bank statement shows payment was sent to wrong account due to merchant's incorrect IBAN. Refunding seller.",
    "refund_tx_hash": "REFUNDxxx...004"
  }
  ```
- **Expected Status After:** `cancelled`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_cancelled`
- **Expected Side Effects:**
  - cancelled_at: NOW
  - cancelled_by: system
  - refund_tx_hash: REFUNDxxx...004
  - User balance: 900 → 1000 (escrow refunded)
  - Merchant balance: 10000 (no change)
  - Dispute record updated: status=resolved, resolved_in_favor_of=user, resolution set
  - Reputation events: dispute resolution for both
  - System message: Resolution with refund details

### Final State
- User: bob (balance: 1000 USDC - escrow refunded)
- Merchant: FastTrade Exchange (balance: 10000 USDC)
- Order: status=cancelled, refund_tx_hash set
- Dispute: status=resolved, resolved_in_favor_of=user
- Chat: 7+ system messages

---

## Scenario 12: SELL - Dispute + Admin Resolves (complete)

**Description:** User refuses to release escrow claiming no payment. Admin verifies payment and releases escrow to merchant.

### Initial State
- User: bob (balance: 1000 USDC)
- Merchant: FastTrade Exchange (balance: 10000 USDC, offer: buy 5000 USDC @ 3.67 AED/USDC)

### Step-by-Step Actions

#### Steps 1-5: Order Created, Escrowed, Accepted, Payment Sent, Payment Confirmed
(Same as Scenario 7, Steps 1-5)
- **Expected Status After Step 5:** `payment_confirmed`
- **Expected order_version After Step 5:** 5

#### Step 6: User Disputes (refuses to release, claims issue)
- **Action:** `dispute`
- **Actor:** bob (user)
- **Payload:**
  ```json
  {
    "status": "disputed",
    "actor_type": "user",
    "actor_id": "user-seller-001",
    "reason": "wrong_amount",
    "description": "Payment received but amount is 350 AED instead of 367 AED",
    "evidence_urls": ["https://example.com/bank-receipt-user.png"]
  }
  ```
- **Expected Status After:** `disputed`
- **Expected order_version After:** 6
- **Expected Events Emitted:**
  - `status_changed_to_disputed`
- **Expected Side Effects:**
  - Dispute record created: reason=wrong_amount, status=open
  - Reputation events: order_disputed for both
  - System message: "⚠️ Order is now under dispute"

#### Step 7: Admin Resolves in Favor of Merchant (release escrow to merchant)
- **Action:** `resolve`
- **Actor:** admin (system)
- **Payload:**
  ```json
  {
    "status": "completed",
    "actor_type": "system",
    "actor_id": "admin-001",
    "resolved_in_favor_of": "merchant",
    "resolution": "Merchant's bank statement shows 367 AED sent. User's screenshot shows 350 AED due to bank fees on user's side, not merchant's fault. Releasing escrow to merchant.",
    "release_tx_hash": "RELEASExxx...004"
  }
  ```
- **Expected Status After:** `completed`
- **Expected order_version After:** 7
- **Expected Events Emitted:**
  - `status_changed_to_completed`
- **Expected Side Effects:**
  - completed_at: NOW
  - release_tx_hash: RELEASExxx...004
  - User balance: 900 (no change)
  - Merchant balance: 10000 → 10100 (received 100 USDC)
  - User total_trades: +1, total_volume: +367
  - Merchant total_trades: +1, total_volume: +367
  - Dispute record updated: status=resolved, resolved_in_favor_of=merchant, resolution set
  - Reputation events: dispute resolution and order_completed for both
  - Merchant contact added for bob
  - System message: Resolution and release details

### Final State
- User: bob (balance: 900 USDC - escrow released to merchant)
- Merchant: FastTrade Exchange (balance: 10100 USDC - received crypto)
- Order: status=completed, release_tx_hash set
- Dispute: status=resolved, resolved_in_favor_of=merchant
- Chat: 8+ system messages

---

## Summary Table

| # | Scenario | Type | Outcome | Final Status | Escrow Action |
|---|----------|------|---------|--------------|---------------|
| 1 | BUY - Happy Path | BUY | Success | completed | Released to buyer |
| 2 | BUY - Buyer Cancels | BUY | Cancelled | cancelled | None (before escrow) |
| 3 | BUY - Merchant Cancels | BUY | Cancelled | cancelled | None (before escrow) |
| 4 | BUY - Expires | BUY | Timeout | cancelled | None (before escrow) |
| 5 | BUY - Dispute Refund | BUY | Dispute | cancelled | Refunded to seller |
| 6 | BUY - Dispute Complete | BUY | Dispute | completed | Released to buyer |
| 7 | SELL - Happy Path | SELL | Success | completed | Released to merchant |
| 8 | SELL - User Cancels | SELL | Cancelled | cancelled | Refunded to user |
| 9 | SELL - Merchant Cancels | SELL | Cancelled | cancelled | Refunded to user |
| 10 | SELL - Expires | SELL | Timeout | disputed | Locked (admin resolve) |
| 11 | SELL - Dispute Refund | SELL | Dispute | cancelled | Refunded to user |
| 12 | SELL - Dispute Complete | SELL | Dispute | completed | Released to merchant |

---

## Key Differences: BUY vs SELL

### BUY Flow (User buys USDC from Merchant)
1. Order created → pending
2. Merchant accepts → accepted
3. **Merchant locks escrow** → escrowed
4. User sends fiat → payment_sent
5. Merchant confirms → payment_confirmed
6. **Merchant releases escrow to user** → completed

### SELL Flow (User sells USDC to Merchant)
1. Order created → pending
2. **User locks escrow** → escrowed (can happen before or after acceptance)
3. Merchant accepts → escrowed (status doesn't regress)
4. Merchant sends fiat → payment_sent
5. User confirms → payment_confirmed
6. **User releases escrow to merchant** → completed

---

## Implementation Notes

1. **order_version:** Increments on every status change for optimistic locking
2. **Event Emission:** Every status change emits an order_events record
3. **System Messages:** Auto-generated for transparency in chat
4. **Balance Updates:** Occur at escrow lock and release, not at completion
5. **Reputation:** Events recorded for completed, cancelled, disputed, timeout
6. **Liquidity:** Restored on cancel/expire only if no escrow locked
7. **Timeouts:**
   - Pending: 15 minutes → cancelled
   - Escrowed (no acceptance): 120 minutes → disputed
   - Accepted/in-progress: 120 minutes → disputed (if escrow locked) or cancelled

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-12 | Initial 12 core test scenarios |
