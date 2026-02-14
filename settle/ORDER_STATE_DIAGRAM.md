# Order State Diagram

Visual representation of the order state machine with all transitions.

---

## Full State Machine

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ORDER STATE MACHINE                              │
│                         (12 Statuses, 44 Transitions)                    │
└─────────────────────────────────────────────────────────────────────────┘

                                  [ORDER CREATED]
                                        │
                                        ▼
                    ┌───────────────────────────────────────┐
                    │           PENDING                      │
                    │  ⏱ 15 min timeout                     │
                    │  📢 Visible to ALL merchants          │
                    └───────────────────────────────────────┘
                                        │
                        ┌───────────────┼───────────────┬─────────────┐
                        │               │               │             │
                        │(merchant)     │(user/merchant)│(timeout)    │(cancel)
                        │               │(escrow-first) │             │
                        ▼               ▼               ▼             ▼
                    ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
                    │ACCEPTED │   │ ESCROWED │   │ EXPIRED  │   │CANCELLED │
                    │⏱ 120min│   │⏱ 120min │   │ 🔴 END  │   │ 🔴 END  │
                    └─────────┘   └──────────┘   └──────────┘   └──────────┘
                         │             │
                         │             │(merchant accepts)
                         │             └──────────────┐
                         │                            │
                         │(lock escrow)               │
                         ▼                            ▼
                  ┌────────────┐              ┌───────────┐
                  │ESCROW_PEND │              │ ACCEPTED  │
                  │⏱ ~30 sec  │              │(M2M flow) │
                  └────────────┘              └───────────┘
                         │                          │
                         │(blockchain confirm)      │(lock escrow)
                         ▼                          ▼
                  ┌─────────────────────────────────────────┐
                  │              ESCROWED                    │
                  │  🔒 Crypto locked on-chain              │
                  │  ⏱ 120 min timeout                     │
                  └─────────────────────────────────────────┘
                         │
                         │(buyer sends fiat)
                         ▼
                  ┌─────────────────────────────────────────┐
                  │          PAYMENT_PENDING                 │
                  │  💸 Awaiting fiat transfer              │
                  │  ⏱ 120 min timeout                     │
                  └─────────────────────────────────────────┘
                         │
                         │(buyer marks "I've Paid")
                         ▼
                  ┌─────────────────────────────────────────┐
                  │          PAYMENT_SENT                    │
                  │  ⏳ Seller verifying receipt            │
                  │  ⏱ 120 min timeout                     │
                  └─────────────────────────────────────────┘
                         │
                         │(seller confirms receipt)
                         ▼
                  ┌─────────────────────────────────────────┐
                  │        PAYMENT_CONFIRMED                 │
                  │  ✅ Fiat received, ready to release    │
                  │  ⏱ 120 min timeout                     │
                  └─────────────────────────────────────────┘
                         │
                         │(seller releases escrow)
                         ▼
                  ┌─────────────────────────────────────────┐
                  │           RELEASING                      │
                  │  🔓 Escrow release in progress          │
                  │  ⏱ ~30 sec                             │
                  └─────────────────────────────────────────┘
                         │
                         │(blockchain confirm)
                         ▼
                  ┌─────────────────────────────────────────┐
                  │          COMPLETED                       │
                  │  🎉 Trade successful                    │
                  │  🔴 TERMINAL STATE                      │
                  └─────────────────────────────────────────┘


                         DISPUTE PATH (from any active status):

                    ┌───────────────────────────────────────┐
                    │            DISPUTED                    │
                    │  ⚠️ Under compliance review           │
                    │  ⏱ 72 hour timeout (escalate)        │
                    └───────────────────────────────────────┘
                         │                      │
                         │(favor buyer)         │(favor seller)
                         ▼                      ▼
                    ┌──────────┐          ┌──────────┐
                    │COMPLETED │          │CANCELLED │
                    │🔴 END   │          │🔴 END   │
                    └──────────┘          └──────────┘
```

---

## Transition Legend

| Symbol | Meaning |
|--------|---------|
| `┌─┐` | Status node |
| `│` `▼` | Transition path |
| `⏱` | Timer active |
| `🔒` | Escrow locked |
| `🔓` | Escrow released |
| `🔴` | Terminal state (no further transitions) |
| `⚠️` | Requires manual intervention |
| `🎉` | Success outcome |
| `💸` | Fiat payment stage |
| `📢` | Broadcast to all merchants |

---

## Buy Order Flow (User → Merchant)

```
User wants to BUY crypto (user sends fiat, receives crypto)

PENDING (user creates order, any merchant can accept)
   │
   │ Merchant A accepts
   ▼
ACCEPTED (Merchant A assigned)
   │
   │ Merchant A locks 100 USDC in escrow
   ▼
ESCROW_PENDING (TX submitted)
   │
   │ Blockchain confirms
   ▼
ESCROWED (100 USDC locked)
   │
   │ User sends 367 AED to Merchant A's bank
   ▼
PAYMENT_SENT (user marks "I've Paid")
   │
   │ Merchant A confirms bank receipt
   ▼
PAYMENT_CONFIRMED (fiat verified)
   │
   │ Merchant A releases escrow to user's wallet
   ▼
RELEASING (TX submitted)
   │
   │ Blockchain confirms
   ▼
COMPLETED (user receives 100 USDC)

ROLES:
  Buyer: user_id (sends fiat, receives crypto)
  Seller: merchant_id (locks escrow, receives fiat)
  Escrow Creator: merchant_id
```

---

## Sell Order Flow (User → Merchant, Escrow-First)

```
User wants to SELL crypto (user locks escrow, receives fiat)

PENDING (user creates order)
   │
   │ User locks 100 USDC in escrow immediately
   ▼
ESCROWED (100 USDC locked by user)
   │
   │ Merchant B accepts
   ▼
ACCEPTED (status stays ESCROWED, merchant assigned)
   │
   │ Merchant B sends 367 AED to user's bank
   ▼
PAYMENT_SENT (merchant marks "I've Paid")
   │
   │ User confirms bank receipt
   ▼
PAYMENT_CONFIRMED (fiat verified)
   │
   │ User releases escrow to Merchant B
   ▼
RELEASING (TX submitted)
   │
   │ Blockchain confirms
   ▼
COMPLETED (Merchant B receives 100 USDC)

ROLES:
  Buyer: merchant_id (sends fiat, receives crypto)
  Seller: user_id (locks escrow, receives fiat)
  Escrow Creator: user_id
```

---

## M2M Trade Flow (Merchant → Merchant)

```
Merchant A wants to BUY 1000 USDC from Merchant B

PENDING (Merchant A creates order, sets buyer_merchant_id = Merchant A)
   │
   │ Merchant B accepts (becomes seller)
   ▼
ACCEPTED (merchant_id = Merchant B, buyer_merchant_id = Merchant A)
   │
   │ Merchant B locks 1000 USDC in escrow
   ▼
ESCROWED (1000 USDC locked)
   │
   │ Merchant A sends AED to Merchant B's bank
   ▼
PAYMENT_SENT (Merchant A marks "I've Paid")
   │
   │ Merchant B confirms bank receipt
   ▼
PAYMENT_CONFIRMED (fiat verified)
   │
   │ Merchant B releases escrow to Merchant A
   ▼
RELEASING (TX submitted)
   │
   │ Blockchain confirms
   ▼
COMPLETED (Merchant A receives 1000 USDC)

ROLES:
  Buyer: buyer_merchant_id (Merchant A)
  Seller: merchant_id (Merchant B, after reassignment)
  Escrow Creator: Merchant B
```

---

## Timeout Flows

### Early Timeout (No Acceptance)

```
PENDING (created at 10:00:00)
   │
   │ 15 minutes elapse, no merchant accepts
   ▼
EXPIRED (at 10:15:00)

SIDE EFFECTS:
  - Restore liquidity to offer
  - Record reputation event: order_timeout
  - Send system message to chat
```

### Post-Escrow Timeout (Dispute)

```
ESCROWED (escrow locked at 10:00:00)
   │
   │ 120 minutes elapse, no completion
   ▼
DISPUTED (at 12:00:00, system auto-disputes)

RATIONALE:
  - Crypto locked on-chain, cannot simply cancel
  - Requires compliance review
  - Protects both parties

COMPLIANCE ACTIONS:
  - Investigate blockchain state
  - Review chat logs and evidence
  - Decide: COMPLETED (release to buyer) or CANCELLED (refund to seller)
```

---

## Dispute Resolution Paths

```
[Any Active Status]
   │
   │ User or Merchant raises dispute
   ▼
DISPUTED (status = 'open')
   │
   │ Compliance assigned (status = 'investigating')
   ▼
[Evidence Review]
   │
   ├─────────────────┬─────────────────┐
   │                 │                 │
   │(favor buyer)    │(favor seller)   │(need escalation)
   ▼                 ▼                 ▼
COMPLETED        CANCELLED        ESCALATED
(release escrow) (refund escrow)  (external review)

EVIDENCE COLLECTED:
  - Chat message history
  - Image uploads (bank receipts, screenshots)
  - Blockchain verification (escrow state)
  - Reputation history (ratings, previous disputes)
  - Order event log (full audit trail)
```

---

## Extension Request Flow

```
[Any Extendable Status: pending, accepted, escrowed, payment_sent]
   │
   │ Party A requests extension (5 min before timeout)
   ▼
[Extension Request Sent]
   │
   │ Party B receives real-time notification
   ▼
[Party B Approval Window: 5 minutes]
   │
   ├───────────────┬─────────────────┐
   │               │                 │
   │(approve)      │(decline)        │(no response)
   ▼               ▼                 ▼
[Extend Timer]  [Continue]      [Continue]
extension_count += 1

EXTENSION DURATIONS:
  - pending: +15 minutes
  - accepted: +30 minutes
  - escrowed: +60 minutes
  - payment_sent: +120 minutes

MAX EXTENSIONS: 3

IF MAX REACHED AND TIMEOUT:
  - Pre-escrow: CANCELLED
  - Post-escrow: DISPUTED
```

---

## Actor Permissions Matrix

| Transition | User | Merchant | System | Compliance |
|------------|------|----------|--------|------------|
| pending → accepted | ❌ | ✅ | ❌ | ❌ |
| pending → escrowed | ✅ | ✅ | ✅ | ❌ |
| accepted → escrowed | ✅ | ✅ | ✅ | ❌ |
| escrowed → payment_sent | ✅ | ✅ | ❌ | ❌ |
| payment_sent → payment_confirmed | ✅ | ✅ | ❌ | ❌ |
| payment_confirmed → releasing | ❌ | ❌ | ✅ | ❌ |
| releasing → completed | ❌ | ❌ | ✅ | ❌ |
| any → cancelled | ✅ | ✅ | ✅ | ✅ |
| any → disputed | ✅ | ✅ | ✅ | ✅ |
| disputed → completed | ❌ | ❌ | ✅ | ✅ |
| disputed → cancelled | ❌ | ❌ | ✅ | ✅ |

**Legend**:
- ✅ Allowed
- ❌ Forbidden

---

## Critical Decision Points

### Decision Point 1: Escrow-First vs. Acceptance-First

```
USER CREATES SELL ORDER
   │
   ├─ Option A: Lock escrow immediately
   │     └─> PENDING → ESCROWED (awaiting merchant acceptance)
   │
   └─ Option B: Wait for merchant acceptance
         └─> PENDING → ACCEPTED → ESCROWED
```

**Current Implementation**: Both supported. User can choose.

---

### Decision Point 2: Payment Confirmation Flow

```
BUYER MARKS PAYMENT SENT
   │
   ├─ Normal Flow: Seller confirms → PAYMENT_CONFIRMED → RELEASING
   │
   └─ Direct Flow: Seller releases immediately → COMPLETED
      (skips PAYMENT_CONFIRMED status)
```

**Current Implementation**: Both supported. Direct flow preferred for simplicity.

---

### Decision Point 3: Timeout Handling

```
ORDER TIMES OUT
   │
   ├─ Pre-escrow: CANCELLED (restore liquidity)
   │
   └─ Post-escrow: DISPUTED (manual resolution)
```

**Rationale**: Escrow locked = manual review required.

---

## State Machine Properties

### Determinism
✅ Each status has a defined set of valid next statuses.
✅ Transitions are deterministic (no race conditions with row locks).

### Safety
✅ Terminal statuses cannot transition (except dispute resolution).
✅ Escrow integrity enforced (cannot complete without release).
✅ Role-based transitions prevent privilege escalation.

### Liveness
✅ All active orders will eventually reach a terminal state (via timeout).
✅ Disputes have escalation path (72-hour timeout).

### Atomicity
✅ Status changes + timestamp updates occur in one transaction.
✅ Balance updates + status changes occur in one transaction (escrow ops).
✅ Liquidity restoration + cancellation occur in one transaction.

---

## Quick Reference Table

| Status | Next Statuses | Typical Actor | Timer |
|--------|---------------|---------------|-------|
| pending | accepted, escrowed, cancelled, expired | Merchant accepts | 15 min |
| accepted | escrow_pending, escrowed, payment_pending, cancelled, expired | Seller locks escrow | 120 min |
| escrow_pending | escrowed, cancelled, expired | System (blockchain) | ~30 sec |
| escrowed | payment_pending, payment_sent, completed, cancelled, disputed, expired | Buyer pays | 120 min |
| payment_pending | payment_sent, cancelled, disputed, expired | Buyer marks paid | 120 min |
| payment_sent | payment_confirmed, completed, disputed, expired | Seller confirms | 120 min |
| payment_confirmed | releasing, completed, disputed | System releases | 120 min |
| releasing | completed, disputed | System (blockchain) | ~30 sec |
| completed | (none) | N/A | N/A |
| cancelled | (none) | N/A | N/A |
| disputed | completed, cancelled | Compliance decides | 72 hours |
| expired | (none) | N/A | N/A |

---

**End of State Diagram**
