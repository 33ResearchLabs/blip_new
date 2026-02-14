# Order State Transition Matrix

## Overview

This document defines the complete state transition matrix for the Blip Money order system. It serves as the authoritative specification for all valid state transitions, including which actors can perform each action, required payload fields, and the resulting next state.

**Version:** 1.0
**Last Updated:** 2026-02-12

---

## Order Statuses

The system supports the following order statuses:

1. `pending` - Order created, awaiting merchant acceptance
2. `accepted` - Merchant accepted the order
3. `escrow_pending` - Escrow transaction in progress (not confirmed yet)
4. `escrowed` - Crypto locked in escrow
5. `payment_pending` - Awaiting fiat payment to be sent
6. `payment_sent` - Fiat payment marked as sent
7. `payment_confirmed` - Fiat payment confirmed by receiver
8. `releasing` - Escrow release in progress
9. `completed` - Trade successfully completed (TERMINAL)
10. `cancelled` - Order cancelled (TERMINAL)
11. `disputed` - Order under dispute
12. `expired` - Order timed out (TERMINAL)

**Terminal States:** completed, cancelled, expired (no further transitions allowed)

---

## Actions

The system supports the following actions:

1. `create` - Create a new order
2. `accept` - Merchant accepts an order
3. `escrow` - Lock crypto in escrow
4. `send_payment` - Mark fiat payment as sent
5. `confirm_payment` - Confirm fiat payment received
6. `release` - Release escrowed crypto
7. `complete` - Mark order as completed
8. `cancel` - Cancel the order
9. `dispute` - Raise a dispute
10. `resolve` - Resolve a dispute (admin only)
11. `expire` - Timeout expiration (system only)

---

## Actor Types

- `user` - Regular user (buyer or seller)
- `merchant` - Merchant (liquidity provider)
- `system` - Automated system processes
- `compliance` - Admin/compliance team

---

## Complete Transition Matrix

### Format

For each status, we list all possible transitions in this format:

**Status → Action → Next Status**
- **Allowed Actors:** [actor1, actor2, ...]
- **Required Payload Fields:** field1, field2, ...
- **Notes:** Additional context

---

## 1. PENDING Status

Initial status when an order is created.

### pending → accept → accepted
- **Allowed Actors:** merchant
- **Required Payload:**
  - `actor_type`: "merchant"
  - `actor_id`: merchant UUID
  - `acceptor_wallet_address` (optional): Solana wallet address for receiving crypto (sell orders)
- **Side Effects:**
  - Sets `accepted_at` timestamp
  - Extends `expires_at` to +120 minutes from acceptance
  - For Uber-like model: reassigns `merchant_id` if accepting merchant differs from initial merchant
  - For M2M: sets `buyer_merchant_id` if accepting merchant is buyer
- **Notes:** Merchant claims the order from the broadcast pool

### pending → escrow → escrowed
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `escrow_tx_hash`: Solana transaction hash
  - `escrow_trade_id`: Trade ID from escrow program
  - `escrow_trade_pda`: Trade PDA address
  - `escrow_pda`: Escrow PDA address
  - `escrow_creator_wallet`: Wallet that created the escrow
- **Side Effects:**
  - Sets `escrowed_at` timestamp
  - Extends `expires_at` to +120 minutes
  - Stores all escrow-related fields
- **Notes:** Sell orders: user locks escrow before merchant accepts. Buy orders: merchant locks after acceptance.

### pending → cancel → cancelled
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `reason` (optional): Cancellation reason string
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to actor_type
  - Sets `cancellation_reason`
  - Restores liquidity to offer's `available_amount`
  - Records reputation event (order_cancelled)
- **Notes:** Can be cancelled by either party before acceptance

### pending → expire → expired
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to "system"
  - Sets `cancellation_reason` to "Order timeout - no one accepted within 15 minutes"
  - Restores liquidity to offer's `available_amount`
  - Records reputation event (order_timeout)
- **Notes:** Triggered automatically after 15 minutes if no merchant accepts

---

## 2. ACCEPTED Status

Merchant has accepted the order.

### accepted → escrow_pending → escrow_pending
- **Allowed Actors:** merchant, system
- **Required Payload:**
  - `actor_type`: "merchant" | "system"
  - `actor_id`: UUID of actor
- **Side Effects:** None
- **Notes:** Intermediate state while escrow transaction is being confirmed

### accepted → escrow → escrowed
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `escrow_tx_hash`: Solana transaction hash
  - `escrow_trade_id`: Trade ID from escrow program
  - `escrow_trade_pda`: Trade PDA address
  - `escrow_pda`: Escrow PDA address
  - `escrow_creator_wallet`: Wallet that created the escrow
- **Side Effects:**
  - Sets `escrowed_at` timestamp
  - Extends `expires_at` to +120 minutes
  - Stores all escrow-related fields
  - Auto-sends escrow info system message to chat
- **Notes:** For buy orders, merchant locks escrow after accepting

### accepted → payment_pending → payment_pending
- **Allowed Actors:** merchant
- **Required Payload:**
  - `actor_type`: "merchant"
  - `actor_id`: merchant UUID
- **Side Effects:** None
- **Notes:** M2M flow: buyer merchant signs to claim after accepting

### accepted → send_payment → payment_sent
- **Allowed Actors:** merchant
- **Required Payload:**
  - `actor_type`: "merchant"
  - `actor_id`: merchant UUID
- **Side Effects:**
  - Sets `payment_sent_at` timestamp
  - Auto-sends system message to chat
- **Notes:** For sell orders where user already locked escrow: merchant can send fiat payment immediately after accepting

### accepted → cancel → cancelled
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `reason` (optional): Cancellation reason string
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to actor_type
  - Sets `cancellation_reason`
  - Restores liquidity to offer's `available_amount`
  - Records reputation event (order_cancelled)
- **Notes:** Can still be cancelled after acceptance if no escrow locked

### accepted → expire → expired
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to "system"
  - Sets `cancellation_reason` to timeout reason
  - Restores liquidity to offer's `available_amount`
  - Records reputation event (order_timeout)
- **Notes:** Expires after 120 minutes from acceptance if not completed

---

## 3. ESCROW_PENDING Status

Escrow transaction submitted but not yet confirmed.

### escrow_pending → escrow → escrowed
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
  - `escrow_tx_hash`: Solana transaction hash (already stored)
- **Side Effects:**
  - Sets `escrowed_at` timestamp
  - Auto-sends escrow locked system message to chat
- **Notes:** System confirms escrow transaction on-chain

### escrow_pending → cancel → cancelled
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
  - `reason`: "Escrow transaction failed"
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Restores liquidity to offer's `available_amount`
- **Notes:** If escrow transaction fails or times out

### escrow_pending → expire → expired
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Restores liquidity to offer's `available_amount`
- **Notes:** If escrow transaction doesn't confirm in time

---

## 4. ESCROWED Status

Crypto is locked in escrow.

### escrowed → accept → accepted (NO-OP, stays escrowed)
- **Allowed Actors:** merchant
- **Required Payload:**
  - `actor_type`: "merchant"
  - `actor_id`: merchant UUID
  - `acceptor_wallet_address` (optional): Solana wallet address
- **Side Effects:**
  - Sets `accepted_at` timestamp
  - Sets `acceptor_wallet_address`
  - For M2M: sets `buyer_merchant_id` or reassigns `merchant_id`
  - Status remains `escrowed` (doesn't regress to accepted)
- **Notes:** For sell orders: merchant accepts after user locks escrow. Status stays escrowed.

### escrowed → payment_pending → payment_pending
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
- **Side Effects:** None
- **Notes:** Transition to explicit payment waiting state

### escrowed → send_payment → payment_sent
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
- **Side Effects:**
  - Sets `payment_sent_at` timestamp
  - Auto-sends payment sent system message to chat
- **Notes:**
  - Buy orders: merchant sends fiat to user
  - Sell orders: user sends fiat to merchant

### escrowed → complete → completed
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `release_tx_hash`: Solana transaction hash for escrow release
- **Side Effects:**
  - Sets `completed_at` timestamp
  - Sets `release_tx_hash`
  - Increments total_trades and total_volume for user and merchant
  - Records reputation event (order_completed)
  - Adds user to merchant's contacts
  - Auto-sends completion and release system messages to chat
- **Notes:** Only allowed if escrow has been released on-chain (release_tx_hash must be set)

### escrowed → cancel → cancelled
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `reason` (optional): Cancellation reason string
  - `refund_tx_hash` (required): Solana transaction hash for escrow refund
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to actor_type
  - Sets `cancellation_reason`
  - Sets `refund_tx_hash`
  - Does NOT restore liquidity (already locked in escrow)
  - Records reputation event (order_cancelled)
- **Notes:** Requires on-chain refund transaction. Both parties can cancel if they agree.

### escrowed → dispute → disputed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
  - `reason`: Dispute reason enum (payment_not_received, crypto_not_received, wrong_amount, fraud, other)
  - `description`: Detailed description (min 10 chars)
  - `evidence_urls` (optional): Array of evidence URLs
- **Side Effects:**
  - Creates dispute record in disputes table
  - Auto-sends dispute system message to chat
  - Records reputation event (order_disputed)
- **Notes:** Either party can raise a dispute

### escrowed → expire → disputed OR cancelled
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - If escrow locked: sets status to `disputed` (requires admin resolution)
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to "system"
  - Sets `cancellation_reason`
  - Records reputation event (order_timeout or order_disputed)
- **Notes:** After 120 minutes from acceptance, orders with locked escrow go to disputed state

---

## 5. PAYMENT_PENDING Status

Waiting for fiat payment to be sent.

### payment_pending → send_payment → payment_sent
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
- **Side Effects:**
  - Sets `payment_sent_at` timestamp
  - Auto-sends payment sent system message to chat
- **Notes:** Either party can mark payment as sent

### payment_pending → cancel → cancelled
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `reason` (optional): Cancellation reason string
  - `refund_tx_hash` (required if escrow locked): Solana transaction hash
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `cancelled_by` to actor_type
  - Sets `cancellation_reason`
  - Sets `refund_tx_hash` if applicable
  - Records reputation event (order_cancelled)
- **Notes:** Requires mutual agreement or admin intervention

### payment_pending → dispute → disputed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
  - `reason`: Dispute reason enum
  - `description`: Detailed description
  - `evidence_urls` (optional): Array of evidence URLs
- **Side Effects:**
  - Creates dispute record
  - Auto-sends dispute system message to chat
  - Records reputation event (order_disputed)
- **Notes:** Can dispute if payment not being sent

### payment_pending → expire → disputed
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - Sets status to `disputed`
  - Records reputation event (order_disputed)
- **Notes:** Automatic dispute if timeout reached

---

## 6. PAYMENT_SENT Status

Fiat payment marked as sent, awaiting confirmation.

### payment_sent → confirm_payment → payment_confirmed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor (must be the receiver)
- **Side Effects:**
  - Sets `payment_confirmed_at` timestamp
  - Auto-sends payment confirmed system message to chat
- **Notes:**
  - Buy orders: user confirms receiving fiat from merchant
  - Sell orders: merchant confirms receiving fiat from user

### payment_sent → complete → completed
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `release_tx_hash`: Solana transaction hash for escrow release
- **Side Effects:**
  - Sets `completed_at` timestamp
  - Sets `release_tx_hash`
  - Increments total_trades and total_volume for user and merchant
  - Records reputation event (order_completed)
  - Adds user to merchant's contacts
  - Auto-sends completion and release system messages to chat
- **Notes:** For sell orders: user can complete directly after releasing escrow (payment already sent)

### payment_sent → dispute → disputed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
  - `reason`: Dispute reason enum (e.g., payment_not_received, wrong_amount)
  - `description`: Detailed description
  - `evidence_urls` (optional): Array of evidence URLs
- **Side Effects:**
  - Creates dispute record
  - Auto-sends dispute system message to chat
  - Records reputation event (order_disputed)
- **Notes:** Receiver can dispute if payment not received or incorrect

### payment_sent → expire → disputed
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:**
  - Sets status to `disputed`
  - Records reputation event (order_disputed)
- **Notes:** Automatic dispute if timeout reached

---

## 7. PAYMENT_CONFIRMED Status

Fiat payment confirmed by receiver.

### payment_confirmed → release → releasing
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
- **Side Effects:** None
- **Notes:** Intermediate state while escrow release transaction is being confirmed

### payment_confirmed → complete → completed
- **Allowed Actors:** user, merchant, system
- **Required Payload:**
  - `actor_type`: "user" | "merchant" | "system"
  - `actor_id`: UUID of actor
  - `release_tx_hash`: Solana transaction hash for escrow release
- **Side Effects:**
  - Sets `completed_at` timestamp
  - Sets `release_tx_hash`
  - Increments total_trades and total_volume for user and merchant
  - Records reputation event (order_completed)
  - Adds user to merchant's contacts
  - Auto-sends completion and release system messages to chat
- **Notes:** User can complete by releasing escrow for sell orders

### payment_confirmed → dispute → disputed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
  - `reason`: Dispute reason enum
  - `description`: Detailed description
  - `evidence_urls` (optional): Array of evidence URLs
- **Side Effects:**
  - Creates dispute record
  - Auto-sends dispute system message to chat
  - Records reputation event (order_disputed)
- **Notes:** Still possible to dispute even after confirmation

---

## 8. RELEASING Status

Escrow release transaction in progress.

### releasing → complete → completed
- **Allowed Actors:** system
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: order ID
  - `release_tx_hash`: Solana transaction hash (already stored)
- **Side Effects:**
  - Sets `completed_at` timestamp
  - Increments total_trades and total_volume for user and merchant
  - Records reputation event (order_completed)
  - Adds user to merchant's contacts
  - Auto-sends completion system message to chat
- **Notes:** System confirms release transaction on-chain

### releasing → dispute → disputed
- **Allowed Actors:** user, merchant
- **Required Payload:**
  - `actor_type`: "user" | "merchant"
  - `actor_id`: UUID of actor
  - `reason`: Dispute reason enum
  - `description`: Detailed description
  - `evidence_urls` (optional): Array of evidence URLs
- **Side Effects:**
  - Creates dispute record
  - Auto-sends dispute system message to chat
- **Notes:** Can dispute if release transaction fails or incorrect

---

## 9. COMPLETED Status (TERMINAL)

Trade successfully completed. **No transitions allowed.**

- **Side Effects of Reaching This State:**
  - User and merchant stats updated (total_trades, total_volume)
  - Ratings can be submitted by both parties
  - Chat remains accessible for historical reference
  - Order appears in transaction history

---

## 10. CANCELLED Status (TERMINAL)

Order cancelled. **No transitions allowed.**

- **Side Effects of Reaching This State:**
  - Liquidity restored to offer (if cancelled before escrow)
  - Escrow refunded on-chain (if cancelled after escrow)
  - Cancellation reason and actor stored
  - Reputation event recorded
  - Chat remains accessible for historical reference

---

## 11. DISPUTED Status

Order under dispute, awaiting admin resolution.

### disputed → resolve (complete) → completed
- **Allowed Actors:** system (admin via compliance interface)
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: compliance team member ID
  - `resolved_in_favor_of`: "user" or "merchant"
  - `resolution`: Resolution description
  - `release_tx_hash`: Solana transaction hash for escrow release to winner
- **Side Effects:**
  - Sets `completed_at` timestamp
  - Sets `release_tx_hash`
  - Updates dispute record (status: resolved, resolution, resolved_in_favor_of)
  - Increments stats for winner
  - Records reputation event for both parties
  - Auto-sends resolution system message to chat
- **Notes:** Admin resolves in favor of buyer - escrow released to buyer

### disputed → resolve (cancel) → cancelled
- **Allowed Actors:** system (admin via compliance interface)
- **Required Payload:**
  - `actor_type`: "system"
  - `actor_id`: compliance team member ID
  - `resolved_in_favor_of`: "user" or "merchant"
  - `resolution`: Resolution description
  - `refund_tx_hash`: Solana transaction hash for escrow refund to seller
- **Side Effects:**
  - Sets `cancelled_at` timestamp
  - Sets `refund_tx_hash`
  - Updates dispute record (status: resolved, resolution, resolved_in_favor_of)
  - Records reputation event for both parties
  - Auto-sends resolution system message to chat
- **Notes:** Admin resolves in favor of seller - escrow refunded to seller

---

## 12. EXPIRED Status (TERMINAL)

Order timed out. **No transitions allowed.**

- **Side Effects of Reaching This State:**
  - Automatically transitioned by system after timeout
  - Liquidity restored if in early stage
  - Moved to disputed if escrow was locked
  - Cancellation reason set to timeout message
  - Reputation event recorded

---

## Summary Table

| From Status | To Status | Actors | Key Payload Fields |
|-------------|-----------|--------|-------------------|
| pending | accepted | merchant | acceptor_wallet_address |
| pending | escrowed | user, merchant, system | escrow_tx_hash, escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet |
| pending | cancelled | user, merchant, system | reason |
| pending | expired | system | - |
| accepted | escrow_pending | merchant, system | - |
| accepted | escrowed | user, merchant, system | escrow_tx_hash, escrow_trade_id, escrow_trade_pda, escrow_pda, escrow_creator_wallet |
| accepted | payment_pending | merchant | - |
| accepted | payment_sent | merchant | - |
| accepted | cancelled | user, merchant, system | reason |
| accepted | expired | system | - |
| escrow_pending | escrowed | system | - |
| escrow_pending | cancelled | system | reason |
| escrow_pending | expired | system | - |
| escrowed | accepted | merchant | acceptor_wallet_address |
| escrowed | payment_pending | user, merchant, system | - |
| escrowed | payment_sent | user, merchant | - |
| escrowed | completed | user, merchant, system | release_tx_hash |
| escrowed | cancelled | user, merchant, system | reason, refund_tx_hash |
| escrowed | disputed | user, merchant | reason, description, evidence_urls |
| escrowed | expired | system | - |
| payment_pending | payment_sent | user, merchant | - |
| payment_pending | cancelled | user, merchant, system | reason, refund_tx_hash |
| payment_pending | disputed | user, merchant | reason, description, evidence_urls |
| payment_pending | expired | system | - |
| payment_sent | payment_confirmed | user, merchant | - |
| payment_sent | completed | user, merchant, system | release_tx_hash |
| payment_sent | disputed | user, merchant | reason, description, evidence_urls |
| payment_sent | expired | system | - |
| payment_confirmed | releasing | system | - |
| payment_confirmed | completed | user, merchant, system | release_tx_hash |
| payment_confirmed | disputed | user, merchant | reason, description, evidence_urls |
| releasing | completed | system | - |
| releasing | disputed | user, merchant | reason, description, evidence_urls |
| disputed | completed | system | resolved_in_favor_of, resolution, release_tx_hash |
| disputed | cancelled | system | resolved_in_favor_of, resolution, refund_tx_hash |

---

## Invalid Transitions

Any transition not listed in the matrix above is **NOT ALLOWED** and will be rejected by the state machine.

Examples of invalid transitions:
- `completed → *` (any transition from completed)
- `cancelled → *` (any transition from cancelled)
- `expired → *` (any transition from expired)
- `pending → payment_sent` (must go through acceptance and escrow first)
- `disputed → disputed` (idempotent - already in that state)
- User attempting merchant-only transitions
- System attempting user/merchant-only transitions

---

## Notes

1. **Timeouts:**
   - Pending orders: 15 minutes from creation
   - Accepted/in-progress orders: 120 minutes from acceptance
   - Orders can be extended (see extension system)

2. **Escrow Requirements:**
   - Buy orders: merchant locks escrow AFTER accepting
   - Sell orders: user locks escrow BEFORE or AFTER merchant accepts
   - Cannot complete without `release_tx_hash` set
   - Cannot cancel with escrow without `refund_tx_hash` set

3. **M2M Trading:**
   - `buyer_merchant_id` identifies merchant acting as buyer
   - `merchant_id` is always the seller
   - Both merchants can perform user/merchant actions

4. **Liquidity Restoration:**
   - Happens on cancel/expire from pending, accepted, or escrow_pending
   - Does NOT happen if escrow locked (crypto already removed from offer)

5. **Reputation Events:**
   - Recorded on: order_created, order_completed, order_cancelled, order_timeout, order_disputed
   - Affects rating calculation for both parties

6. **Auto-Messages:**
   - System auto-sends chat messages for status changes
   - Bank info auto-sent when order accepted with bank payment method
   - Escrow info auto-sent when crypto locked
   - Release info auto-sent when crypto released

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-12 | Initial comprehensive state transition matrix |
