# Blip Money - Transaction Flow

---

## SELL Order (M2M)

> Merchant A wants to **sell** crypto. Merchant B buys it.

```
Seller (Merchant A)                  Buyer (Merchant B)
  |                                   |
  |-- 1. Create SELL order           |  DB: pending
  |      (posted to all merchants)   |  Socket: order:created → all merchants
  |                                   |
  |                    2. Buyer accepts|  DB: accepted
  |                    (merchant_id   |  Socket: order:status-updated → both merchants
  |                     stays as A)   |
  |                                   |
  |-- 3. Lock escrow                 |  DB: escrowed
  |      (seller balance: -amount)   |  Socket: order:status-updated → both merchants
  |                                   |
  |                    4. Buyer sees  |
  |                       bank info   |
  |                    5. Pays fiat   |
  |                    6. "I've Paid" |  DB: payment_sent
  |                                   |  Socket: order:status-updated → both merchants
  |                                   |
  |-- 7. Confirm payment             |  DB: payment_confirmed
  |                                   |  Socket: order:status-updated → both merchants
  |-- 8. Release escrow              |  DB: completed
  |      (buyer balance: +amount)    |  Socket: order:status-updated → both merchants
  |                                   |
  Done.                              Done.
```

---

## BUY Order (M2M)

> Merchant A wants to **buy** crypto. Merchant B sells it.

```
Buyer (Merchant A)                   Seller (Merchant B)
  |                                   |
  |-- 1. Create BUY order            |  DB: pending
  |      (posted to all merchants)   |  Socket: order:created → all merchants
  |                                   |
  |                    2. Seller      |  DB: accepted
  |                    matches &      |  merchant_id reassigned to B (seller)
  |                    accepts        |  Socket: order:status-updated → both merchants
  |                                   |
  |                    3. Lock escrow |  DB: escrowed
  |                    (seller bal:   |  Socket: order:status-updated → both merchants
  |                     -amount)      |
  |                                   |
  |-- 4. Buyer sees bank info        |
  |-- 5. Pays fiat (offchain)        |
  |-- 6. "I've Paid"                 |  DB: payment_sent
  |                                   |  Socket: order:status-updated → both merchants
  |                                   |
  |                    7. Confirm     |  DB: payment_confirmed
  |                    payment        |  Socket: order:status-updated → both merchants
  |                    8. Release     |  DB: completed
  |                    escrow         |  Socket: order:status-updated → both merchants
  |      (buyer balance: +amount)    |
  |                                   |
  Done.                              Done.
```

---

## DB Status Lifecycle

```
pending → accepted → escrowed → payment_sent → payment_confirmed → releasing → completed
                                                                              ↘ cancelled
                                                                              ↘ disputed
                                                                              ↘ expired
```

## UI Section Mapping

| DB Status | UI Section |
|---|---|
| `pending` | New Orders |
| `accepted` (no escrow) | Active |
| `accepted` (has escrow) | Ongoing |
| `escrowed`, `payment_sent`, `payment_confirmed`, `releasing` | Ongoing |
| `completed` | Completed |
| `cancelled`, `expired` | Cancelled |
| `disputed` | Disputed |

## Socket (Pusher) Channels

| Channel | Who subscribes | Events |
|---|---|---|
| `private-merchants-global` | All merchants | `order:created`, `order:status-updated` (accepted/cancelled/expired only) |
| `private-merchant-{id}` | Specific merchant | `order:status-updated` (all statuses for their orders) |
| `private-user-{id}` | Buyer (non-merchant) | `order:status-updated` |
| `private-order-{id}` | Anyone viewing that order | `order:status-updated`, `chat:*` |

**Key:** Both `merchant_id` AND `buyer_merchant_id` receive notifications on escrow lock, release, and all status changes.

---

## Balance Rules

| Event | Who | Change |
|---|---|---|
| Escrow lock | Seller | **-amount** |
| Escrow release | Buyer | **+amount** |

**Rule:** Whoever sells crypto gets `-`. Whoever buys crypto gets `+`. Nothing else touches balances.

## TL;DR

| | Who locks escrow? | Who gets paid crypto? |
|---|---|---|
| **SELL** | Seller (order creator) | Buyer (acceptor) |
| **BUY** | Seller (acceptor) | Buyer (order creator) |
