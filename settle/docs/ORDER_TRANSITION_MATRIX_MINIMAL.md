# Order Transition Matrix - Minimal (8-State System)

**Version:** 2.0
**Last Updated:** 2026-02-12

---

## Overview

This document provides a comprehensive matrix of all allowed order state transitions in the **minimal 8-state settlement layer**. Use this as a reference for implementing the state machine logic.

**Key Changes from Original:**
- **24 transitions** (down from 44)
- **8 statuses** (down from 12)
- **6 public actions** (down from ~10)
- **Atomic operations**: `confirm_and_release` combines payment confirmation + escrow release

---

## Quick Reference: Status & Action Counts

| Element | Count | List |
|---------|-------|------|
| **Statuses** | 8 | `open`, `accepted`, `escrowed`, `payment_sent`, `completed`, `cancelled`, `expired`, `disputed` |
| **Public Actions** | 6 | `accept`, `lock_escrow`, `mark_paid`, `confirm_and_release`, `cancel`, `dispute` |
| **Total Transitions** | 24 | See matrix below |
| **Terminal States** | 3 | `completed`, `cancelled`, `expired` |

---

## Transition Matrix: Status × Action

**Legend:**
- ✅ = Allowed transition
- ❌ = Not allowed
- ⚠️ = Conditional (see preconditions)
- 🔒 = Terminal status (no transitions)

| From Status ↓ | `accept` | `lock_escrow` | `mark_paid` | `confirm_and_release` | `cancel` | `dispute` | System Timer | Total |
|---------------|----------|---------------|-------------|----------------------|----------|-----------|--------------|-------|
| **`open`** | ✅ → `accepted` | ✅ → `escrowed` | ❌ | ❌ | ✅ → `cancelled` | ❌ | ⏱️ → `expired` | **4** |
| **`accepted`** | ❌ | ✅ → `escrowed` | ⚠️ → `payment_sent` | ❌ | ⚠️ → `cancelled` | ❌ | ⏱️ → `expired`/`disputed` | **5** |
| **`escrowed`** | ✅ → `accepted` | ❌ | ✅ → `payment_sent` | ✅ → `completed` | ⚠️ → `cancelled` | ✅ → `disputed` | ⏱️ → `disputed` | **6** |
| **`payment_sent`** | ❌ | ❌ | ❌ | ✅ → `completed` | ❌ | ✅ → `disputed` | ⏱️ → `disputed` | **3** |
| **`disputed`** | ❌ | ❌ | ❌ | ✅ → `completed` | ✅ → `cancelled` | ❌ | ⏱️ Escalate | **2** |
| **`completed`** | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | - | **0** |
| **`cancelled`** | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | - | **0** |
| **`expired`** | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | - | **0** |

**Total Transitions: 24**

---

## Detailed Transition Rules

### From `open` (4 transitions)

| # | To Status | Action | Allowed Actors | Preconditions | Side Effects | Events Emitted |
|---|-----------|--------|----------------|---------------|--------------|----------------|
| 1 | `accepted` | `accept` | `merchant` | Merchant has liquidity | Set `accepted_at`, extend timer to 120min, assign `merchant_id` | `order_accepted` |
| 2 | `escrowed` | `lock_escrow` | `user`, `merchant` | Escrow tx confirmed on-chain | Set `escrow_tx_hash`, `escrowed_at`, extend timer to 120min, deduct seller balance | `escrow_locked` |
| 3 | `cancelled` | `cancel` | `user`, `merchant`, `system` | - | Restore offer liquidity, set `cancelled_at`, `cancelled_by` | `order_cancelled` |
| 4 | `expired` | (timer) | `system` | 15min elapsed since creation | Restore offer liquidity, set `cancelled_at` | `order_expired` |

**Key Rules:**
- **`open` → `accepted`**: Any merchant can claim (Uber model)
- **`open` → `escrowed`**: Escrow-first model (sell orders) - user locks escrow before merchant accepts
- **Timer**: 15 minutes for unassigned orders

---

### From `accepted` (5 transitions)

| # | To Status | Action | Allowed Actors | Preconditions | Side Effects | Events Emitted |
|---|-----------|--------|----------------|---------------|--------------|----------------|
| 1 | `escrowed` | `lock_escrow` | `merchant` (buy), `user` (sell) | Escrow tx confirmed | Set `escrow_tx_hash`, `escrowed_at`, extend timer, deduct seller balance | `escrow_locked` |
| 2 | `payment_sent` | `mark_paid` | Fiat sender | **Escrow MUST be locked** (`escrow_tx_hash IS NOT NULL`) | Set `payment_sent_at` | `payment_sent` |
| 3 | `cancelled` | `cancel` | `user`, `merchant`, `system` | **Escrow NOT locked** (`escrow_tx_hash IS NULL`) | Restore liquidity, set `cancelled_at` | `order_cancelled` |
| 4 | `expired` | (timer) | `system` | 120min elapsed, escrow NOT locked | Restore liquidity, set `cancelled_at` | `order_expired` |
| 5 | `disputed` | (timer) | `system` | 120min elapsed, escrow IS locked | Create dispute record | `order_disputed` |

**Key Rules:**
- **`accepted` → `payment_sent`**: Only allowed if escrow locked (prevents fiat payment before crypto secured)
- **`accepted` → `cancelled`**: Only allowed if escrow NOT locked (pre-escrow cancellation)
- **Timer behavior**: 120min timeout has two outcomes:
  - No escrow → `expired` (safe to cancel)
  - Escrow locked → `disputed` (protect both parties, NEVER silent refund)

---

### From `escrowed` (6 transitions)

| # | To Status | Action | Allowed Actors | Preconditions | Side Effects | Events Emitted |
|---|-----------|--------|----------------|---------------|--------------|----------------|
| 1 | `accepted` | `accept` | `merchant` | Sell order in unassigned pool | Set `accepted_at`, `acceptor_wallet_address`, assign merchant | `order_accepted` |
| 2 | `payment_sent` | `mark_paid` | Fiat sender | - | Set `payment_sent_at` | `payment_sent` |
| 3 | `completed` | `confirm_and_release` | Fiat receiver | `release_tx_hash` provided (atomic) | Set `payment_confirmed_at` (event), `release_tx_hash`, `completed_at`, credit buyer balance | `payment_confirmed`, `escrow_released`, `order_completed` |
| 4 | `cancelled` | `cancel` | `user`, `merchant` | **Both parties agree** (mutual cancellation) | Refund escrow to creator, set `refund_tx_hash`, restore liquidity | `escrow_refunded`, `order_cancelled` |
| 5 | `disputed` | `dispute` | `user`, `merchant` | - | Create dispute record, assign to compliance | `order_disputed` |
| 6 | `disputed` | (timer) | `system` | 120min elapsed | Create dispute record | `order_disputed` |

**Key Rules:**
- **`escrowed` → `accepted`**: Allows merchants to claim escrowed sell orders (escrow-first model)
- **`escrowed` → `completed`**: Direct path if both payment confirmation and escrow release happen atomically
- **`escrowed` → `cancelled`**: Requires mutual agreement (both parties sign off)
- **Timer**: 120min timeout always creates dispute (escrow locked)

---

### From `payment_sent` (3 transitions)

| # | To Status | Action | Allowed Actors | Preconditions | Side Effects | Events Emitted |
|---|-----------|--------|----------------|---------------|--------------|----------------|
| 1 | `completed` | `confirm_and_release` | Fiat receiver | `release_tx_hash` provided (atomic) | Set `payment_confirmed_at` (event), `release_tx_hash`, `completed_at`, credit buyer balance, update trade stats | `payment_confirmed`, `escrow_released`, `order_completed` |
| 2 | `disputed` | `dispute` | `user`, `merchant` | - | Create dispute record | `order_disputed` |
| 3 | `disputed` | (timer) | `system` | 120min elapsed | Create dispute record | `order_disputed` |

**Key Rules:**
- **`confirm_and_release` is ATOMIC**:
  - Sets `payment_confirmed_at` timestamp (event, NOT a status)
  - Submits escrow release transaction (`release_tx_hash`)
  - Transitions to `completed` when blockchain confirms
  - Updates buyer balance exactly once
- **No separate `payment_confirmed` status**: It's an event emitted during `confirm_and_release`
- **Timer**: 120min timeout creates dispute (fiat sent but not confirmed)

---

### From `disputed` (2 transitions)

| # | To Status | Action | Allowed Actors | Preconditions | Side Effects | Events Emitted |
|---|-----------|--------|----------------|---------------|--------------|----------------|
| 1 | `completed` | `confirm_and_release` | `system`, `compliance` | Dispute resolved in favor of buyer | Release escrow to buyer, set `release_tx_hash`, `completed_at`, credit buyer balance | `dispute_resolved`, `escrow_released`, `order_completed` |
| 2 | `cancelled` | `cancel` | `system`, `compliance` | Dispute resolved in favor of seller | Refund escrow to seller, set `refund_tx_hash`, `cancelled_at`, restore liquidity | `dispute_resolved`, `escrow_refunded`, `order_cancelled` |

**Key Rules:**
- **Only `system` or `compliance` can resolve disputes** (not user/merchant)
- **Two outcomes**:
  - Favor buyer → `completed` (release escrow to buyer)
  - Favor seller → `cancelled` (refund escrow to seller)
- **Timer**: 72 hours → escalate to senior compliance (not auto-resolve)

---

### From `completed`, `cancelled`, `expired` (0 transitions)

**Terminal states - NO further transitions allowed.**

| Status | Final Timestamp | Escrow Resolution | Notes |
|--------|----------------|-------------------|-------|
| `completed` | `completed_at` | `release_tx_hash` set | Successful trade, buyer received crypto |
| `cancelled` | `cancelled_at` | `refund_tx_hash` set (if escrowed) | Trade cancelled, seller refunded (if applicable) |
| `expired` | `cancelled_at` | N/A (no escrow locked) | Timed out before escrow locked |

---

## Action-Specific Rules

### Action: `accept`

**Purpose:** Merchant claims an order from the unassigned pool.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `open` | `accepted` | `merchant` | Merchant has liquidity | Assign `merchant_id`, set `accepted_at`, extend timer to 120min |
| `escrowed` | `accepted` | `merchant` | Sell order (escrow-first model) | Set `acceptor_wallet_address`, assign `merchant_id` |

**Business Rules:**
- Any merchant can accept broadcast orders (Uber model)
- Accepting order assigns/reassigns `merchant_id` to acceptor
- For M2M orders, sets `buyer_merchant_id` instead

---

### Action: `lock_escrow`

**Purpose:** Lock crypto in on-chain escrow contract.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `open` | `escrowed` | `user` (sell), `merchant` (buy) | Escrow tx confirmed | Set `escrow_tx_hash`, `escrowed_at`, deduct seller balance, extend timer to 120min |
| `accepted` | `escrowed` | `merchant` (buy), `user` (sell) | Escrow tx confirmed | Set `escrow_tx_hash`, `escrowed_at`, deduct seller balance |

**Business Rules:**
- **BUY orders**: Merchant locks escrow (merchant is seller)
- **SELL orders**: User locks escrow (user is seller)
- Can happen before OR after merchant accepts (two models supported)
- Deducts seller's offchain balance exactly once

**Required Payload:**
```json
{
  "escrow_tx_hash": "0x...",
  "escrow_trade_id": 123456,
  "escrow_pda": "SolanaAddress...",
  "escrow_creator_wallet": "SolanaAddress..."
}
```

---

### Action: `mark_paid`

**Purpose:** Fiat sender marks payment as sent.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `accepted` | `payment_sent` | Fiat sender | Escrow MUST be locked | Set `payment_sent_at` |
| `escrowed` | `payment_sent` | Fiat sender | - | Set `payment_sent_at` |

**Business Rules:**
- **BUY orders**: User sends fiat → user marks paid
- **SELL orders**: Merchant sends fiat → merchant marks paid
- Cannot mark paid if escrow not locked (safety check)

**Required Payload:**
```json
{
  "payment_details": {
    "method": "bank" | "cash",
    "reference": "Transaction reference",
    "notes": "Optional notes"
  }
}
```

---

### Action: `confirm_and_release` (ATOMIC)

**Purpose:** Fiat receiver confirms payment AND releases escrow in single atomic operation.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `escrowed` | `completed` | Fiat receiver | `release_tx_hash` provided | Set `payment_confirmed_at` (event), `release_tx_hash`, `completed_at`, credit buyer balance |
| `payment_sent` | `completed` | Fiat receiver | `release_tx_hash` provided | Set `payment_confirmed_at` (event), `release_tx_hash`, `completed_at`, credit buyer balance |
| `disputed` | `completed` | `system`, `compliance` | Dispute resolved in favor of buyer | Release escrow to buyer, credit buyer balance |

**Business Rules:**
- **ATOMIC OPERATION**: Cannot confirm payment without releasing escrow
- **BUY orders**: Merchant receives fiat → merchant confirms and releases to user
- **SELL orders**: User receives fiat → user confirms and releases to merchant
- **Payment confirmed is an EVENT**, not a status:
  - Sets `payment_confirmed_at` timestamp
  - Emits `payment_confirmed` event
  - Order status goes directly to `completed`
- Credits buyer's offchain balance exactly once

**Required Payload:**
```json
{
  "release_tx_hash": "0x...", // Blockchain transaction hash
  "actor_id": "uuid",
  "actor_type": "user" | "merchant" | "system"
}
```

**Removed from Original System:**
- No separate `confirm_payment` action
- No `payment_confirmed` status (collapsed into event)
- No separate `release_escrow` action
- No `releasing` status (happens atomically)

---

### Action: `cancel`

**Purpose:** Cancel order before completion.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `open` | `cancelled` | `user`, `merchant`, `system` | - | Restore liquidity, set `cancelled_at`, `cancelled_by` |
| `accepted` | `cancelled` | `user`, `merchant`, `system` | Escrow NOT locked | Restore liquidity, set `cancelled_at`, `cancelled_by` |
| `escrowed` | `cancelled` | `user`, `merchant` | **Both parties agree** | Refund escrow to seller, set `refund_tx_hash`, restore liquidity |
| `disputed` | `cancelled` | `system`, `compliance` | Dispute resolved in favor of seller | Refund escrow to seller, set `refund_tx_hash`, restore liquidity |

**Business Rules:**
- **Pre-escrow**: Any party can cancel unilaterally
- **Post-escrow**: Requires mutual agreement OR dispute resolution
- Cannot cancel after `payment_sent` (must complete or dispute)
- Restores offer liquidity if cancelled before escrow

**Required Payload:**
```json
{
  "reason": "Cancellation reason text",
  "cancelled_by": "user" | "merchant" | "system"
}
```

---

### Action: `dispute`

**Purpose:** Open dispute for contested order.

| From Status | To Status | Actor | Preconditions | Side Effects |
|-------------|-----------|-------|---------------|--------------|
| `escrowed` | `disputed` | `user`, `merchant` | Escrow locked | Create dispute record, assign to compliance |
| `payment_sent` | `disputed` | `user`, `merchant` | Escrow locked | Create dispute record, assign to compliance |

**Business Rules:**
- Only allowed after escrow locked (pre-escrow: just cancel)
- Cannot dispute terminal statuses
- One dispute per order (unique constraint on `disputes.order_id`)
- Dispute must be resolved by `system` or `compliance` (not parties themselves)

**Required Payload:**
```json
{
  "reason": "payment_not_received" | "crypto_not_received" | "wrong_amount" | "fraud" | "other",
  "description": "Detailed explanation",
  "evidence_urls": ["https://...", "https://..."],
  "raised_by": "user" | "merchant",
  "raiser_id": "uuid"
}
```

---

## Timer-Based Transitions (System Actions)

**Timers are triggered by background workers, not user actions.**

| From Status | Timer Duration | Conditions | Outcome Status | Rationale |
|-------------|----------------|------------|----------------|-----------|
| `open` | 15 min | Always | `expired` | No merchant claimed order, safe to cancel |
| `accepted` | 120 min | Escrow NOT locked | `expired` | Trade didn't progress, safe to cancel |
| `accepted` | 120 min | Escrow IS locked | `disputed` | Funds at risk, require resolution |
| `escrowed` | 120 min | Always | `disputed` | Funds locked, protect both parties |
| `payment_sent` | 120 min | Always | `disputed` | Fiat sent but not confirmed, require resolution |
| `disputed` | 72 hours | Always | (Escalate to senior compliance) | Complex dispute, needs human review |

**Critical Rule:**
- **NEVER auto-refund after escrow locked**: Always create dispute for manual resolution
- **Before escrow**: Safe to auto-cancel/expire
- **After escrow**: Always require human review

---

## Special Cases & Edge Conditions

### Case 1: Escrow-First Sell Orders

**Flow:**
```
open → escrowed (user locks escrow) → accepted (merchant claims) → payment_sent → completed
```

**Allowed Transitions:**
- `open` → `escrowed`: User locks escrow before merchant accepts
- `escrowed` → `accepted`: Merchant accepts already-escrowed order

**Business Logic:**
- User locks crypto first (safer for user)
- Order sits in pool as `escrowed` status
- Any merchant can accept and proceed with fiat payment

---

### Case 2: Accept-First Buy Orders

**Flow:**
```
open → accepted (merchant claims) → escrowed (merchant locks) → payment_sent → completed
```

**Allowed Transitions:**
- `open` → `accepted`: Merchant accepts first
- `accepted` → `escrowed`: Merchant locks escrow after accepting

**Business Logic:**
- Merchant commits to trade first
- Merchant locks crypto after accepting
- User sends fiat payment

---

### Case 3: Direct Completion from Escrowed

**Flow:**
```
escrowed → completed (rare, if payment confirmed and released atomically)
```

**Allowed Transition:**
- `escrowed` → `completed`: Direct path via `confirm_and_release`

**Business Logic:**
- Happens when fiat payment and escrow release occur simultaneously
- Example: Cash trade where confirmation and release happen in-person
- Still atomic: `payment_confirmed_at` + `release_tx_hash` + `completed_at` set together

---

### Case 4: Mutual Cancellation After Escrow

**Flow:**
```
escrowed → cancelled (both parties agree to cancel)
```

**Allowed Transition:**
- `escrowed` → `cancelled`: Requires both `user` and `merchant` to sign off

**Business Logic:**
- Escrow refunded to seller
- Liquidity restored to offer
- Requires explicit confirmation from both parties (not unilateral)

---

### Case 5: Timer Expiry After Escrow

**Flow:**
```
accepted (escrowed) → disputed (120min timeout)
escrowed → disputed (120min timeout)
payment_sent → disputed (120min timeout)
```

**Business Logic:**
- If timer expires and escrow is locked → ALWAYS create dispute
- Never auto-refund (prevents gaming the system)
- Compliance reviews and decides outcome

---

## Validation Rules

### Pre-Transition Checks

**Before executing any transition:**

1. **Status Check**: Verify current status matches expected `from` status
2. **Actor Authorization**: Verify actor has permission for this action
3. **Preconditions**: Check all preconditions are met
4. **Idempotency**: If already at target status, return success (no-op)
5. **Terminal Status**: Reject if current status is terminal (`completed`, `cancelled`, `expired`)

### Post-Transition Checks

**After executing transition:**

1. **Status Updated**: Verify status changed to expected `to` status
2. **Timestamps Set**: Verify appropriate timestamps set (e.g., `accepted_at`, `escrowed_at`)
3. **Version Incremented**: Verify `order_version` incremented
4. **Event Logged**: Verify `order_events` entry created
5. **Side Effects Applied**: Verify balances updated, liquidity restored, etc.

---

## Example Validation Function

```typescript
async function executeAction(
  orderId: string,
  action: OrderAction,
  actorType: ActorType,
  actorId: string,
  payload: any
): Promise<Order> {
  // 1. Fetch order with row lock
  const order = await db.orders.findUnique({
    where: { id: orderId },
    // Row-level lock for concurrent safety
    lock: 'FOR UPDATE',
  });

  // 2. Check terminal status
  if (['completed', 'cancelled', 'expired'].includes(order.status)) {
    throw new Error(`Cannot perform action on terminal status: ${order.status}`);
  }

  // 3. Validate transition
  const validation = validateTransition(order.status, action, actorType);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // 4. Check preconditions
  if (action === 'mark_paid' && !order.escrow_tx_hash) {
    throw new Error('Cannot mark paid: escrow not locked');
  }
  if (action === 'cancel' && order.status === 'accepted' && order.escrow_tx_hash) {
    throw new Error('Cannot cancel: escrow locked, must dispute');
  }

  // 5. Execute transition in transaction
  return await db.transaction(async (tx) => {
    // Apply side effects based on action
    const updates = await applySideEffects(tx, order, action, payload);

    // Update order
    const updated = await tx.orders.update({
      where: { id: orderId },
      data: {
        ...updates,
        status: validation.nextStatus,
        order_version: { increment: 1 },
      },
    });

    // Log event
    await tx.order_events.create({
      data: {
        order_id: orderId,
        event_type: `${action}_executed`,
        actor_type: actorType,
        actor_id: actorId,
        old_status: order.status,
        new_status: validation.nextStatus,
        metadata: payload,
      },
    });

    // Send notifications
    await notifyParties(updated, action);

    return updated;
  });
}
```

---

## Comparison: 12-Status vs 8-Status Matrix

| Metric | Original (12-Status) | Minimal (8-Status) | Reduction |
|--------|---------------------|-------------------|-----------|
| **Total Statuses** | 12 | 8 | -33% |
| **Total Transitions** | 44 | 24 | -45% |
| **Transitions from `pending`/`open`** | 4 | 4 | 0% |
| **Transitions from `accepted`** | 6 | 5 | -17% |
| **Transitions from `escrow_pending`** | 3 | **0** (status removed) | -100% |
| **Transitions from `escrowed`** | 7 | 6 | -14% |
| **Transitions from `payment_pending`** | 4 | **0** (status removed) | -100% |
| **Transitions from `payment_sent`** | 4 | 3 | -25% |
| **Transitions from `payment_confirmed`** | 3 | **0** (status removed, now event) | -100% |
| **Transitions from `releasing`** | 2 | **0** (status removed, atomic) | -100% |
| **Transitions from `disputed`** | 2 | 2 | 0% |

**Eliminated Transitions:**
- All transitions involving `escrow_pending` (3)
- All transitions involving `payment_pending` (4)
- All transitions involving `payment_confirmed` (3)
- All transitions involving `releasing` (2)
- Some redundant transitions from `accepted` and `payment_sent`

**Total Removed: 20 transitions**

---

## Glossary

| Term | Definition |
|------|------------|
| **Atomic Operation** | Single action that combines multiple steps (e.g., `confirm_and_release`) |
| **Event** | Logged occurrence that doesn't change status (e.g., `payment_confirmed`) |
| **Precondition** | Requirement that must be true before transition executes |
| **Side Effect** | State change that accompanies transition (balance updates, etc.) |
| **Terminal Status** | Status with no further transitions (completed, cancelled, expired) |
| **Timer Transition** | System-triggered transition based on time elapsed |

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 2.0 | 2026-02-12 | Minimal 8-status matrix (24 transitions) |
| 1.0 | 2026-02-12 | Original 12-status matrix (44 transitions) |

---

**END OF TRANSITION MATRIX**

**Use this matrix as the canonical reference for implementing the state machine.**
