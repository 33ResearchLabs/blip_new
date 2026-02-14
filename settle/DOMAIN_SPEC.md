# Order Lifecycle Domain Specification

**Version**: 1.0
**Date**: 2026-02-12
**Status**: Canonical Reference

This document defines the complete contract for order state management in the Blip.money P2P trading platform. It serves as the single source of truth for all order-related business logic.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Status Definitions](#status-definitions)
3. [Actor Roles](#actor-roles)
4. [State Transition Matrix](#state-transition-matrix)
5. [Order Flows by Scenario](#order-flows-by-scenario)
6. [Timing & Expiration Rules](#timing--expiration-rules)
7. [Escrow Integration](#escrow-integration)
8. [Invariants & Business Rules](#invariants--business-rules)
9. [Extension System](#extension-system)
10. [Dispute Resolution](#dispute-resolution)
11. [Reconciliation & Canonical Decisions](#reconciliation--canonical-decisions)

---

## Executive Summary

The Blip.money order system supports three primary trading models:
1. **User-to-Merchant (U2M)**: Regular users trading with professional merchants
2. **Merchant-to-Merchant (M2M)**: Professional merchants trading with each other
3. **Broadcast Model**: Orders appear to all merchants until one accepts (Uber-like claiming)

Orders progress through a deterministic state machine with 12 statuses, enforcing role-based transitions and time-bound completion windows.

---

## Status Definitions

### Active Statuses

| Status | Description | Typical Duration | Who Acts Next |
|--------|-------------|------------------|---------------|
| `pending` | Order created, awaiting merchant acceptance | 15 min | Any merchant can accept |
| `accepted` | Merchant claimed the order | Variable | Seller locks escrow |
| `escrow_pending` | Escrow lock transaction submitted | ~30 sec | System (blockchain) |
| `escrowed` | Crypto locked in on-chain escrow | Until payment | Buyer sends fiat |
| `payment_pending` | Awaiting fiat payment from buyer | Variable | Buyer sends fiat |
| `payment_sent` | Buyer marked payment as sent | Variable | Seller confirms receipt |
| `payment_confirmed` | Seller confirmed fiat receipt | Variable | Seller releases escrow |
| `releasing` | Escrow release transaction in progress | ~30 sec | System (blockchain) |

### Terminal Statuses

| Status | Description | Reason |
|--------|-------------|--------|
| `completed` | Trade finished successfully | Normal completion |
| `cancelled` | Order cancelled before escrow lock | User/merchant cancellation, or timeout |
| `expired` | Order timed out | Global 15-minute timeout expired |
| `disputed` | Under arbitration | Conflict during active trade |

**Note**: `expired` is effectively a cancelled state but kept distinct for analytics and reputation tracking.

---

## Actor Roles

### Primary Actors

| Actor | Identifier | Capabilities |
|-------|------------|--------------|
| `user` | UUID | Create orders, send fiat, release escrow (sell orders) |
| `merchant` | UUID | Accept orders, lock escrow (buy orders), send fiat (sell orders) |
| `system` | N/A | Automatic state transitions (blockchain confirmations, timeouts) |
| `compliance` | UUID | Dispute resolution, forced cancellations |

### Role Determination in Orders

- **Buyer**: The party purchasing crypto (sending fiat)
  - In buy orders: `user_id` or `buyer_merchant_id` (M2M)
  - In sell orders: `merchant_id` (accepting merchant)

- **Seller**: The party selling crypto (locking escrow)
  - In buy orders: `merchant_id` (accepting merchant)
  - In sell orders: `user_id` or originating merchant

- **Order Creator**: Entity that initiated the order
  - Standard: `user_id`
  - M2M: `merchant_id` or `buyer_merchant_id`

---

## State Transition Matrix

### Transition Rules

Each transition is defined by:
- **Current Status** → **Target Status**
- **Allowed Actors**: Who can trigger this transition
- **Preconditions**: What must be true
- **Side Effects**: What happens atomically

### Pending

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `accepted` | merchant | Order not expired | Reassign `merchant_id` to acceptor; extend timer to 120 min |
| `escrowed` | user, merchant, system | Escrow lock succeeded | Store escrow details; extend timer to 120 min |
| `cancelled` | user, merchant, system | User/merchant request, or timeout | Restore liquidity to offer |
| `expired` | system | 15 min elapsed | Restore liquidity to offer |

### Accepted

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `escrow_pending` | merchant, system | Seller initiates escrow lock | Mark escrow transaction started |
| `escrowed` | user, merchant, system | Escrow lock confirmed | Store escrow details; extend timer |
| `payment_pending` | merchant | M2M: buyer signs to claim | Store acceptor wallet |
| `payment_sent` | merchant | Sell order with pre-locked escrow | Mark fiat sent timestamp |
| `cancelled` | user, merchant, system | Either party cancels | Restore liquidity to offer |
| `expired` | system | Timeout (15 min global) | Restore liquidity to offer |

### Escrow_Pending

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `escrowed` | system | Blockchain confirms escrow lock | Store tx hash, trade ID, PDAs |
| `cancelled` | system | Blockchain rejects transaction | Restore liquidity to offer |
| `expired` | system | Transaction timeout | Restore liquidity to offer |

### Escrowed

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `accepted` | merchant | Sell order: merchant accepts after escrow | Reassign merchant, set acceptor wallet |
| `payment_pending` | user, merchant, system | Awaiting fiat transfer | None |
| `payment_sent` | user, merchant | Buyer marks fiat as sent | Timestamp `payment_sent_at` |
| `completed` | user, merchant, system | Direct completion (buy orders) | Release escrow, update stats |
| `cancelled` | user, merchant, system | Mutual agreement, or pre-payment cancellation | Refund escrow to seller |
| `disputed` | user, merchant | Conflict raised | Lock order, notify compliance |
| `expired` | system | Global timeout (120 min after acceptance) | Auto-dispute if escrow locked |

### Payment_Pending

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `payment_sent` | user, merchant | Buyer marks payment sent | Timestamp `payment_sent_at` |
| `cancelled` | user, merchant, system | Mutual agreement | Refund escrow to seller |
| `disputed` | user, merchant | Conflict raised | Lock order, notify compliance |
| `expired` | system | Timeout | Auto-dispute if escrow locked |

### Payment_Sent

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `payment_confirmed` | user, merchant | Seller confirms fiat receipt | Timestamp `payment_confirmed_at` |
| `completed` | user, merchant, system | Sell orders: direct completion | Release escrow, update stats |
| `disputed` | user, merchant | Seller disputes non-receipt | Lock order, notify compliance |
| `expired` | system | Timeout | Auto-dispute (escrow locked) |

### Payment_Confirmed

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `releasing` | system | Escrow release initiated | Mark release transaction started |
| `completed` | user, merchant, system | Direct completion (alternative flow) | Release escrow, update stats |
| `disputed` | user, merchant | Last-minute conflict | Lock order, notify compliance |

### Releasing

| To | Actors | Precondition | Side Effects |
|----|--------|-------------|-------------|
| `completed` | system | Blockchain confirms release | Update balances, stats, reputation |
| `disputed` | user, merchant | Blockchain failure or conflict | Lock order, investigate |

### Terminal States

| Status | Transitions | Notes |
|--------|-------------|-------|
| `completed` | None | Final success state |
| `cancelled` | None | Final failure state (early) |
| `expired` | None | Final failure state (timeout) |
| `disputed` | `completed`, `cancelled` | Resolvable by compliance only |

---

## Order Flows by Scenario

### Scenario 1: Standard Buy Order (Happy Path)

**User wants to buy USDC from a merchant using bank transfer.**

```
pending (user creates order)
  ↓ [merchant accepts within 15 min]
accepted (merchant assigned)
  ↓ [merchant locks 100 USDC in escrow]
escrow_pending (TX submitted)
  ↓ [blockchain confirms ~30 sec]
escrowed (100 USDC locked)
  ↓ [user sends 367 AED to merchant's bank]
payment_sent (user marks as paid)
  ↓ [merchant verifies bank receipt]
payment_confirmed (merchant confirms)
  ↓ [merchant releases escrow to user's wallet]
releasing (TX submitted)
  ↓ [blockchain confirms ~30 sec]
completed (user receives 100 USDC)
```

**Roles**:
- Buyer: `user_id`
- Seller: `merchant_id` (accepting merchant)
- Escrow Creator: `merchant_id`

**Timeouts**:
- Pending → Accepted: 15 min max
- Accepted → Completed: 120 min max

---

### Scenario 2: Standard Sell Order (Escrow-First)

**User wants to sell USDC to a merchant for AED cash.**

```
pending (user creates order)
  ↓ [user locks 100 USDC in escrow immediately]
escrowed (100 USDC locked by user)
  ↓ [merchant accepts within 120 min]
accepted (merchant assigned, status stays 'escrowed')
  ↓ [merchant sends 367 AED cash to user]
payment_sent (merchant marks as paid)
  ↓ [user confirms receipt of cash]
payment_confirmed (user confirms)
  ↓ [user releases escrow to merchant]
releasing (TX submitted)
  ↓ [blockchain confirms]
completed (merchant receives 100 USDC)
```

**Alternative Flow (Direct Release)**:
After `payment_confirmed`, user may proceed directly to `completed` by releasing escrow in one step.

**Roles**:
- Buyer: `merchant_id` (accepting merchant)
- Seller: `user_id`
- Escrow Creator: `user_id`

**Key Difference**: Order goes `pending` → `escrowed` (user locks first) → merchant accepts.

---

### Scenario 3: M2M Trade (Merchant-to-Merchant)

**Merchant A wants to buy 1000 USDC from Merchant B using bank transfer.**

```
pending (Merchant A creates order with buyer_merchant_id set)
  ↓ [Merchant B accepts]
accepted (merchant_id stays as original, acceptor becomes seller)
  ↓ [Merchant B locks 1000 USDC in escrow]
escrowed (1000 USDC locked)
  ↓ [Merchant A sends AED to Merchant B's bank]
payment_sent (Merchant A marks as paid)
  ↓ [Merchant B confirms]
payment_confirmed
  ↓ [Merchant B releases escrow]
releasing
  ↓
completed (Merchant A receives 1000 USDC)
```

**Roles**:
- Buyer: `buyer_merchant_id` (Merchant A)
- Seller: `merchant_id` (Merchant B, after reassignment)
- Order Creator: Merchant A

**Reassignment Logic**:
- If `buyer_merchant_id` already set: acceptor becomes `merchant_id` (seller)
- If `buyer_merchant_id` null: acceptor becomes `buyer_merchant_id` (buyer)

---

### Scenario 4: Timeout → Cancellation

**Order expires before acceptance.**

```
pending (order created at 10:00:00)
  ↓ [15 minutes elapse, no merchant accepts]
expired (at 10:15:00)
```

**Side Effects**:
- Restore liquidity: `available_amount += crypto_amount` for `offer_id`
- Record reputation event: `order_timeout` for user and assigned merchant
- Send system message to chat

---

### Scenario 5: Timeout → Dispute

**Order expires after escrow lock.**

```
escrowed (escrow locked at 10:00:00)
  ↓ [120 minutes elapse, no completion]
disputed (at 12:00:00, system auto-disputes)
```

**Reasoning**: Money is locked on-chain; cannot simply cancel. Requires manual resolution.

**Compliance Actions**:
- Investigate blockchain state
- Contact both parties
- Decide: `completed` (release to buyer) or `cancelled` (refund to seller)

---

### Scenario 6: User-Initiated Dispute

**Buyer claims they sent payment but seller denies.**

```
payment_sent (user marked payment as sent)
  ↓ [user clicks "Dispute" before seller confirms]
disputed
  ↓ [compliance reviews evidence: bank receipt, chat logs]
completed (if evidence supports user)
  OR
cancelled (if evidence supports merchant, refund escrow)
```

**Evidence Collected**:
- Chat messages
- Image uploads (bank receipts, screenshots)
- Blockchain verification (escrow state)
- Historical behavior (ratings, previous disputes)

---

## Timing & Expiration Rules

### Global Timeout (Current Implementation)

**All orders must complete within 15 minutes from creation.**

- Timer starts: `created_at`
- Timer checked: Every order status
- Expiry condition: `NOW() > created_at + 15 minutes`

**Exception**: After acceptance, timer extends to **120 minutes** from `accepted_at`.

```sql
-- Pending orders: 15 min from creation
WHERE status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'

-- Accepted orders: 120 min from acceptance
WHERE status NOT IN ('pending')
  AND COALESCE(accepted_at, created_at) < NOW() - INTERVAL '120 minutes'
```

### Timeout Outcomes by Status

| Status | Timeout | Outcome | Escrow Action |
|--------|---------|---------|---------------|
| `pending` | 15 min | `cancelled` | Restore liquidity |
| `accepted` | 120 min | `cancelled` or `disputed` | Restore liquidity (if no escrow) |
| `escrowed` | 120 min | `disputed` | Lock escrow, await resolution |
| `payment_pending` | 120 min | `disputed` | Lock escrow, await resolution |
| `payment_sent` | 120 min | `disputed` | Lock escrow, await resolution |
| `payment_confirmed` | 120 min | `disputed` (rare) | Lock escrow, await resolution |

**Invariant**: Any order with `escrow_tx_hash` set that times out MUST go to `disputed`, not `cancelled`.

---

## Escrow Integration

### Escrow Lock (Seller Action)

**Who**: Seller (merchant in buy orders, user in sell orders)
**When**: After acceptance (buy) or immediately (sell)
**Status Transition**: `accepted` → `escrow_pending` → `escrowed`

**Data Stored**:
```typescript
{
  escrow_tx_hash: string;           // Solana transaction signature
  escrow_trade_id: number;          // On-chain trade ID
  escrow_trade_pda: string;         // Trade account PDA
  escrow_pda: string;               // Escrow vault PDA
  escrow_creator_wallet: string;    // Seller's wallet address
  escrowed_at: Date;                // Confirmation timestamp
}
```

**Side Effects**:
- Deduct from seller's balance (mock mode): `balance -= crypto_amount`
- Blockchain: Transfer tokens to escrow vault PDA

**Verification**:
```typescript
// Before transitioning to 'escrowed', system MUST verify:
const escrowAccount = await getEscrowAccount(escrow_trade_pda);
assert(escrowAccount.state === 'locked');
assert(escrowAccount.amount === order.crypto_amount);
assert(escrowAccount.seller === order.escrow_creator_wallet);
```

---

### Escrow Release (Seller Action)

**Who**: Seller (confirms payment received, releases funds)
**When**: After `payment_confirmed`
**Status Transition**: `payment_confirmed` → `releasing` → `completed`

**Data Stored**:
```typescript
{
  release_tx_hash: string;          // Solana transaction signature
  completed_at: Date;               // Completion timestamp
}
```

**Side Effects**:
- Credit buyer's balance (mock mode): `balance += crypto_amount`
- Blockchain: Transfer tokens from escrow vault to buyer's wallet
- Update stats: `total_trades += 1`, `total_volume += fiat_amount`
- Record reputation: `order_completed` events for both parties

**Critical Invariant**:
```typescript
// NEVER mark order as 'completed' if escrow_tx_hash exists but release_tx_hash is null
if (order.escrow_tx_hash && !order.release_tx_hash) {
  throw new Error('Cannot complete: escrow not released on-chain');
}
```

---

### Escrow Refund (Dispute Resolution)

**Who**: System (triggered by compliance decision)
**When**: Dispute resolved in favor of seller
**Status Transition**: `disputed` → `cancelled`

**Data Stored**:
```typescript
{
  refund_tx_hash: string;           // Solana transaction signature
  cancelled_at: Date;               // Cancellation timestamp
  cancellation_reason: string;      // Dispute resolution notes
}
```

**Side Effects**:
- Restore seller's balance (mock mode): `balance += crypto_amount`
- Blockchain: Transfer tokens from escrow vault back to seller
- Restore liquidity: `available_amount += crypto_amount` (if applicable)

---

## Invariants & Business Rules

### Immutability Rules

1. **Terminal Status Finality**: Once an order reaches `completed`, `cancelled`, or `expired`, its status CANNOT be changed.
2. **Escrow Integrity**: An order with `escrow_tx_hash` set can ONLY complete if `release_tx_hash` is also set.
3. **Actor Reassignment**: `merchant_id` can only be reassigned once (during acceptance). Subsequent changes are forbidden.

### Atomicity Rules

4. **Status + Timestamp**: Every status change MUST atomically update the corresponding timestamp field (e.g., `accepted_at`, `escrowed_at`).
5. **Liquidity Restoration**: When transitioning to `cancelled` or `expired` from `pending`, `accepted`, or `escrow_pending`, liquidity MUST be restored in the SAME transaction.
6. **Balance Updates**: Balance changes MUST occur in the same transaction as status changes (escrow lock, release, refund).

### Order Assignment Rules

7. **Broadcast Model**: Orders in `pending` or `escrowed` (without acceptance) are visible to ALL merchants.
8. **Claim-Once**: After a merchant accepts, the order is no longer visible in other merchants' "New Orders" feed.
9. **No Double-Claim**: Only the first merchant to execute `updateOrderStatus(orderId, 'accepted', ...)` succeeds. Concurrent attempts fail with row lock timeout.

### Payment Rules

10. **Fiat Before Crypto**: Buyer MUST mark `payment_sent` before seller can confirm payment.
11. **No Payment Skipping**: Buyer cannot go directly from `escrowed` to `completed` without passing through `payment_sent` and `payment_confirmed`.
12. **Seller Confirmation Required**: Only the seller can transition from `payment_sent` to `payment_confirmed`.

### Timeout Enforcement

13. **Global 15-Minute Cap**: All `pending` orders MUST be accepted within 15 minutes or auto-cancel.
14. **120-Minute Completion**: After acceptance, orders have 120 minutes to complete, or they timeout.
15. **Escrow-Locked Timeout = Dispute**: If an order times out after `escrowed`, it MUST transition to `disputed`, not `cancelled`.

---

## Extension System

### Overview

Orders can request time extensions to accommodate delays (e.g., slow bank transfers, merchant offline).

### Extension Limits

- **Max Extensions**: 3 per order
- **Extendable Statuses**: `pending`, `accepted`, `escrowed`, `payment_sent`
- **Extension Durations**:
  - `pending`: +15 minutes
  - `accepted`: +30 minutes
  - `escrowed`: +60 minutes
  - `payment_sent`: +120 minutes

### Extension Workflow

1. **Request**: Either party clicks "Request Extension" before timeout.
2. **Notification**: Counterparty receives real-time notification.
3. **Approval**: Counterparty has 5 minutes to approve or decline.
4. **Outcome**:
   - Approved: `expires_at` extended by duration, `extension_count += 1`
   - Declined: Order continues with original timer
   - No Response: Treated as declined

### Extension Expiry

If max extensions reached (3) and order still times out:
- Pre-escrow: `cancelled`
- Post-escrow: `disputed`

**Database Fields**:
```typescript
{
  extension_count: number;          // Current count (0-3)
  max_extensions: number;           // Configured limit (default 3)
  extension_requested_by: ActorType;
  extension_requested_at: Date;
  extension_minutes: number;        // Last granted duration
}
```

---

## Dispute Resolution

### Dispute Triggers

1. **User-Initiated**: User clicks "Dispute" button (available after `escrowed`)
2. **Merchant-Initiated**: Merchant clicks "Dispute" button (available after `escrowed`)
3. **System-Initiated**: Automatic on post-escrow timeout

### Dispute Statuses

| Status | Description |
|--------|-------------|
| `open` | Just created, awaiting compliance review |
| `investigating` | Compliance team assigned, gathering evidence |
| `resolved` | Decision made, order transitioned to terminal state |
| `escalated` | Requires senior review or external arbitration |

### Dispute Resolution Outcomes

**Compliance Decision** → **Order Status**

- **Favor Buyer**: `disputed` → `completed` (release escrow to buyer)
- **Favor Seller**: `disputed` → `cancelled` (refund escrow to seller)
- **Split Decision**: Partial refund (future feature, not implemented)
- **Escalation**: Transfer to external arbitration system (future)

### Evidence Collection

Disputes automatically collect:
- All chat messages (text and images)
- Order event log (full audit trail)
- Blockchain verification (escrow state, wallet balances)
- User/merchant reputation history
- Evidence URLs uploaded by parties

**Database Schema**:
```typescript
interface Dispute {
  id: string;
  order_id: string;
  raised_by: ActorType;
  raiser_id: string;
  reason: DisputeReason;
  description: string;
  evidence_urls: string[];
  status: DisputeStatus;
  resolution: string;
  resolved_in_favor_of: ActorType;
  created_at: Date;
  resolved_at: Date;
}
```

---

## Reconciliation & Canonical Decisions

### Current vs. Target Differences

#### 1. Actor Type Enum Mismatch

**Current**:
- Database schema: `('user', 'merchant', 'system')`
- TypeScript types: `'user' | 'merchant' | 'system' | 'compliance'`

**Decision**: Add `'compliance'` to database enum in next migration.

```sql
ALTER TYPE actor_type ADD VALUE IF NOT EXISTS 'compliance';
```

---

#### 2. Landing Page Status Mismatch

**Current**:
- `/Users/zeus/Documents/Vscode/BM/settle/src/app/page.tsx` defines:
  ```typescript
  type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";
  ```

**Canonical**:
- This is a UI-specific simplification for the landing page demo.
- **NO CHANGE NEEDED**: Landing page is not connected to real orders.
- Real order components MUST use the canonical 12-status enum.

**Action**: Add comment to landing page clarifying this is demo-only.

---

#### 3. Timeout System Migration

**Old System** (documented in legacy comments):
- Per-status timeouts (15 min for pending, 15 min for accepted, etc.)

**New System** (implemented):
- Global 15-minute timeout from creation for `pending`
- 120-minute timeout from `accepted_at` for all other statuses

**Status**: Migration complete. Old `STATUS_TIMEOUTS` constant kept for reference only.

**Documentation Update**: Mark old timeout constants as deprecated in `stateMachine.ts`.

---

#### 4. Balance Update Locations

**Issue**: Comments in `orders.ts` indicate balance updates happen during status changes, but actual logic is:
- **Escrow Lock**: Balance deducted in `POST /api/orders/[id]/escrow`
- **Escrow Release**: Balance credited in `PATCH /api/orders/[id]/escrow`
- **Status Change**: NO balance updates in `updateOrderStatus()`

**Decision**: This is correct. Balance updates MUST occur at escrow operations, not status changes, to prevent double-deduction bugs.

**Action**: Update comment block in `updateOrderStatus()` (line 682-686) to clarify this is intentional.

---

#### 5. Merchant Reassignment Logic

**Complexity**: Multiple reassignment paths for M2M trades:
- `buyer_merchant_id` already set: acceptor becomes `merchant_id` (seller)
- `buyer_merchant_id` null: acceptor becomes `buyer_merchant_id` (buyer)

**Current Implementation**: Lines 491-552 in `orders.ts`

**Decision**: This is correct but complex. No changes needed.

**Future Improvement**: Extract into separate function:
```typescript
function computeMerchantReassignment(
  order: Order,
  actorId: string
): { merchantId?: string; buyerMerchantId?: string }
```

---

### Canonical Status List (FINAL)

The authoritative order status enum, as defined in `database/schema.sql`:

```sql
CREATE TYPE order_status AS ENUM (
  'pending',
  'accepted',
  'escrow_pending',
  'escrowed',
  'payment_pending',
  'payment_sent',
  'payment_confirmed',
  'releasing',
  'completed',
  'cancelled',
  'disputed',
  'expired'
);
```

**Count**: 12 statuses

**Categories**:
- Active: 8 (`pending` through `releasing`)
- Terminal: 4 (`completed`, `cancelled`, `disputed`, `expired`)

**ALL code, documentation, and UI MUST use these exact strings. NO deviations.**

---

### Canonical Actions List (FINAL)

Actions that trigger state transitions (from `getNextStep.ts` and `orders.ts`):

| Action | Triggered By | Status Transition | Implementation |
|--------|--------------|-------------------|----------------|
| `accept` | Merchant | `pending` → `accepted` | `PATCH /api/orders/[id]` |
| `lock_escrow` | Seller | `accepted` → `escrow_pending` → `escrowed` | `POST /api/orders/[id]/escrow` |
| `sign_claim` | Buyer | `escrowed` → `payment_pending` (M2M) | `POST /api/orders/[id]/claim` |
| `sign_proceed` | Buyer | `accepted` → `payment_pending` (M2M) | `POST /api/orders/[id]/proceed` |
| `mark_paid` | Buyer | `escrowed` → `payment_sent` | `PATCH /api/orders/[id]` |
| `confirm_payment` | Seller | `payment_sent` → `payment_confirmed` | `PATCH /api/orders/[id]` |
| `release_escrow` | Seller | `payment_confirmed` → `releasing` → `completed` | `PATCH /api/orders/[id]/escrow` |
| `refund` | Seller or System | `expired` → (escrow refund) | `POST /api/orders/[id]/refund` |
| `cancel` | User or Merchant | `<any>` → `cancelled` | `DELETE /api/orders/[id]` |
| `dispute` | User or Merchant | `<any active>` → `disputed` | `POST /api/orders/[id]/dispute` |

**Total**: 10 canonical actions

---

### Top 5 Invariants (FINAL)

These rules MUST NEVER be violated. They are enforced at multiple layers (database constraints, application logic, UI validation).

#### 1. Escrow Integrity Invariant

**Rule**: If `escrow_tx_hash` is set, the order CANNOT complete without `release_tx_hash` or `refund_tx_hash`.

**Enforcement**:
```typescript
// In updateOrderStatus() before marking 'completed'
if (newStatus === 'completed' && order.escrow_tx_hash && !order.release_tx_hash) {
  return {
    success: false,
    error: 'Cannot complete order: escrow has not been released on-chain.'
  };
}
```

**Why**: Prevents crypto theft. User MUST receive funds before order completes.

---

#### 2. Terminal Status Finality Invariant

**Rule**: Once an order reaches `completed`, `cancelled`, or `expired`, it can NEVER transition to any other status (except `disputed` → `completed`/`cancelled` for resolution).

**Enforcement**:
```typescript
// In validateTransition()
if (TERMINAL_STATUSES.includes(currentStatus)) {
  return {
    valid: false,
    error: `Cannot transition from terminal status '${currentStatus}'`
  };
}
```

**Why**: Ensures accounting integrity. Completed trades cannot be "undone" and re-completed.

---

#### 3. Role-Based Transition Invariant

**Rule**: Each transition has an `allowedActors` list. Only those actor types can perform the transition.

**Example**:
- `pending` → `accepted`: Only `merchant` can do this
- `payment_sent` → `payment_confirmed`: Only `merchant` (seller) can confirm

**Enforcement**:
```typescript
// In validateTransition()
if (!transitionRule.allowedActors.includes(actorType)) {
  return {
    valid: false,
    error: `Actor type '${actorType}' is not allowed to transition from '${currentStatus}' to '${newStatus}'`
  };
}
```

**Why**: Prevents privilege escalation. Users cannot release escrow meant for merchants, etc.

---

#### 4. Single Merchant Claim Invariant

**Rule**: Only ONE merchant can accept a `pending` order. Concurrent acceptance attempts are serialized via database row locks.

**Enforcement**:
```typescript
// In updateOrderStatus()
const currentResult = await client.query(
  'SELECT * FROM orders WHERE id = $1 FOR UPDATE', // Row lock
  [orderId]
);
// First merchant to acquire lock wins
```

**Why**: Prevents double-booking. Same order cannot be assigned to two merchants.

---

#### 5. Escrow-Locked Timeout → Dispute Invariant

**Rule**: If an order has `escrow_tx_hash` set and times out, it MUST go to `disputed`, not `cancelled`.

**Enforcement**:
```typescript
// In expireOldOrders()
const isEscrowLocked = ['escrowed', 'payment_pending', 'payment_sent', 'payment_confirmed', 'releasing'].includes(order.status);

const newStatus = isEscrowLocked ? 'disputed' : 'cancelled';
```

**Why**: Protects both parties. Crypto is locked on-chain; cannot simply cancel without manual resolution.

---

### Open Questions / Future Work

#### Q1: Partial Refunds in Disputes

**Question**: Should compliance be able to split escrowed funds (e.g., 70% to buyer, 30% to seller)?

**Current State**: No. Disputes resolve to either full release or full refund.

**Future**: Add `partial_refund_amount` field and modify escrow release logic to support fractional transfers.

---

#### Q2: Multi-Currency Support

**Question**: How do we handle orders beyond USDC/AED?

**Current State**: `crypto_currency` and `fiat_currency` are varchar fields but always set to 'USDC' and 'AED'.

**Future**: Add currency selection in offer creation UI and validate rates against external APIs.

---

#### Q3: Automated Dispute Resolution

**Question**: Can we use reputation scores and evidence analysis to auto-resolve simple disputes?

**Current State**: All disputes require manual compliance review.

**Future**: Implement confidence scoring system:
- High confidence (>95%): Auto-resolve
- Medium confidence (70-95%): Suggest resolution to compliance
- Low confidence (<70%): Full manual review

---

#### Q4: Order Modification After Creation

**Question**: Should users be able to edit `crypto_amount` or `payment_method` after creating an order?

**Current State**: No. Orders are immutable after creation (except status changes).

**Decision**: Keep immutable. Users must cancel and create new order.

**Rationale**: Simplifies state machine. Modifications would require merchant re-approval, complicating the flow.

---

#### Q5: Recurring Orders

**Question**: Should merchants be able to set up recurring buy/sell orders (daily, weekly)?

**Current State**: No.

**Future**: Add `recurring_schedule` field and cron job to auto-create orders.

**Complexity**: High. Requires balance checks, rate updates, and failure handling.

---

### Migration Path (if needed)

#### Migration 1: Add Compliance Actor Type

**File**: `database/migrations/023_add_compliance_actor.sql`

```sql
-- Add 'compliance' to actor_type enum
ALTER TYPE actor_type ADD VALUE IF NOT EXISTS 'compliance';

-- No data migration needed (no existing 'compliance' actors yet)
```

**Impact**: Zero downtime. Enum extension is additive.

---

#### Migration 2: Clarify Landing Page Status Types

**File**: `settle/src/app/page.tsx` (line 87)

**Current**:
```typescript
type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";
```

**Update**:
```typescript
// DEMO ONLY: This is a simplified status enum for the landing page mockup.
// Real orders use the canonical 12-status enum from src/lib/types/database.ts
type LandingPageOrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";
```

**Impact**: Documentation only. No runtime changes.

---

#### Migration 3: Extract Merchant Reassignment Logic

**File**: `settle/src/lib/db/repositories/orders.ts`

**Current**: Inline logic (lines 491-552)

**Refactor**:
```typescript
function computeMerchantReassignment(
  order: Order,
  actorId: string,
  newStatus: OrderStatus
): {
  merchantId?: string;
  buyerMerchantId?: string;
  acceptorWallet?: string;
} {
  // Move logic from updateOrderStatus() here
  // Returns fields to update
}
```

**Impact**: Improves readability. No behavior change.

**Timeline**: Low priority. Consider for next refactor cycle.

---

### Testing Checklist

Before deploying changes based on this spec, verify:

- [ ] All 12 statuses have corresponding UI states in merchant and user dashboards
- [ ] State machine transitions pass unit tests (44 valid transitions + 100+ invalid ones)
- [ ] Timeout cron job correctly handles `pending` (15 min) and `accepted+` (120 min)
- [ ] Escrow lock/release flows work in both mock mode and on-chain (Solana devnet)
- [ ] Dispute creation triggers Pusher notifications to compliance team
- [ ] Extension requests show real-time approval UI to counterparty
- [ ] M2M merchant reassignment correctly handles both buy and sell orders
- [ ] Chat system messages appear for all status changes
- [ ] Reputation events recorded for completions, cancellations, and timeouts
- [ ] Liquidity restoration occurs atomically when orders cancel/expire

---

### Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | Agent D (Consistency Enforcer) | Initial canonical specification |

---

### Appendix: Quick Reference

#### Status Code → HTTP Analogy

| Order Status | HTTP Equivalent | Meaning |
|--------------|-----------------|---------|
| `pending` | 102 Processing | Request received, awaiting handler |
| `accepted` | 200 OK | Handler assigned, processing |
| `escrowed` | 201 Created | Resource locked, awaiting payment |
| `payment_sent` | 202 Accepted | Payment submitted, awaiting confirmation |
| `completed` | 200 OK | Success |
| `cancelled` | 409 Conflict | Client cancelled |
| `expired` | 408 Timeout | Request timeout |
| `disputed` | 500 Internal Error | Requires manual intervention |

---

**End of Domain Specification**
