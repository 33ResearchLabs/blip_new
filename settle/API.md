# Blip Money — API Reference

> Base URL: `http://localhost:3000/api` (Next.js) | `http://localhost:4010/v1` (Core API)

---

# Transaction Lifecycle — 100% Event Coverage

Every possible path an order can take, from creation to terminal state.

## Order Statuses (12 DB → 8 API)

| # | DB Status | API Status | Terminal? | Description |
|---|-----------|------------|-----------|-------------|
| 1 | `pending` | `open` | No | Created, waiting for counterparty |
| 2 | `accepted` | `accepted` | No | Counterparty accepted |
| 3 | `escrow_pending` | `accepted` | No | On-chain escrow tx submitted |
| 4 | `escrowed` | `escrowed` | No | Crypto locked in escrow |
| 5 | `payment_pending` | `escrowed` | No | M2M buyer signed to claim |
| 6 | `payment_sent` | `payment_sent` | No | Fiat marked as sent |
| 7 | `payment_confirmed` | `payment_sent` | No | Fiat receipt confirmed |
| 8 | `releasing` | `completed` | No | On-chain release in progress |
| 9 | `completed` | `completed` | YES | Trade done, crypto released |
| 10 | `cancelled` | `cancelled` | YES | Cancelled (refund if escrowed) |
| 11 | `disputed` | `disputed` | No | Under dispute review |
| 12 | `expired` | `expired` | YES | Timed out |

## Escrow States (Derived from Fields)

| State | Fields | Meaning |
|-------|--------|---------|
| No escrow | `escrow_tx_hash = NULL` | Pre-escrow phase |
| Locked | `escrow_tx_hash` set, no release/refund | Crypto held in escrow |
| Released | `release_tx_hash` set | Buyer received crypto → `completed` |
| Refunded | `refund_tx_hash` set | Seller got crypto back → `cancelled` |
| Stuck | `escrow_tx_hash` set, `cancelled`/`expired`, no `refund_tx_hash` | Needs manual withdrawal |

**Who pays escrow:**
- BUY order (user buys crypto): `merchant_id` (seller) pays
- SELL order (user sells crypto): `user_id` (seller) pays
- M2M trade: `merchant_id` (always the seller) pays

---

## All Valid Transitions

```
FROM             → TO                    WHO CAN TRIGGER         NOTES
─────────────────────────────────────────────────────────────────────────
pending          → accepted              merchant                Counterparty accepts
pending          → escrowed              user, merchant, system  Direct escrow (sell orders)
pending          → cancelled             user, merchant, system  Cancel before any work
pending          → expired               system                  15-min timeout

accepted         → pending               merchant                RELIST (cancel before escrow, back to marketplace)
accepted         → escrow_pending        merchant, system        On-chain escrow initiated
accepted         → escrowed              user, merchant, system  Escrow locked
accepted         → payment_pending       merchant                M2M: buyer signs to claim
accepted         → payment_sent          merchant                Sell order: merchant sends fiat
accepted         → cancelled             user, merchant, system
accepted         → expired               system

escrow_pending   → escrowed              system                  On-chain confirmation
escrow_pending   → cancelled             system                  Escrow tx failed
escrow_pending   → expired               system

escrowed         → accepted              merchant                Sell: merchant accepts after user locks
escrowed         → payment_pending       user, merchant, system
escrowed         → payment_sent          user, merchant          Fiat payment sent
escrowed         → completed             user, merchant, system  Direct completion (release)
escrowed         → cancelled             user, merchant, system  Triggers refund
escrowed         → disputed              user, merchant          Open dispute
escrowed         → expired               system

payment_pending  → payment_sent          user, merchant
payment_pending  → cancelled             user, merchant, system
payment_pending  → disputed              user, merchant
payment_pending  → expired               system

payment_sent     → payment_confirmed     user, merchant          Fiat receipt confirmed
payment_sent     → completed             user, merchant, system  Direct completion
payment_sent     → disputed              user, merchant
payment_sent     → expired               system

payment_confirmed→ releasing             system                  On-chain release initiated
payment_confirmed→ completed             user, merchant, system  Release + complete
payment_confirmed→ disputed              user, merchant

releasing        → completed             system                  On-chain release confirmed
releasing        → disputed              user, merchant

disputed         → completed             system                  Resolved: user wins (release)
disputed         → cancelled             system                  Resolved: merchant wins (refund)

completed        → (TERMINAL)
cancelled        → (TERMINAL)
expired          → (TERMINAL)
```

---

## Case 1: BUY Order — Happy Path

> Buyer wants to buy crypto. Seller (merchant) locks escrow.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates BUY order               ORDER_CREATED          none
2     accepted         seller   Accepts the order               ORDER_ACCEPTED         none
3     escrowed         seller   Locks crypto into escrow        ORDER_ESCROWED         LOCKED (seller debited)
4     payment_sent     buyer    Sends fiat, clicks "I've Sent"  ORDER_PAYMENT_SENT     locked
5     completed        seller   Confirms fiat, releases escrow  ORDER_COMPLETED        RELEASED (buyer credited)
```

**DB writes per step:**
- orders, order_events, notification_outbox, chat_messages (every step)
- ledger_entries + merchant_transactions (step 3: escrow_lock)
- merchants.balance deducted (step 3), buyer balance credited (step 5)
- reputation_events: +5 both parties (step 5)

---

## Case 2: SELL Order — Happy Path

> Seller locks escrow BEFORE offer goes live. Buyer accepts from marketplace.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending→escrowed seller   Creates SELL, escrow pre-locked ORDER_CREATED+ESCROWED LOCKED (seller debited)
2     escrowed         buyer    Accepts from marketplace        ORDER_ACCEPTED         locked
3     payment_sent     buyer    Sends fiat, clicks "I've Sent"  ORDER_PAYMENT_SENT     locked
4     completed        seller   Confirms fiat, releases escrow  ORDER_COMPLETED        RELEASED
```

---

## Case 3: M2M BUY — Merchant Buys from Merchant

```
Step  Status           Who       Action                         Event                  Escrow State
────  ───────────────  ────────  ─────────────────────────────  ─────────────────────  ────────────
1     pending          buyer(A)  Creates BUY order              ORDER_CREATED          none
2     accepted         seller(B) Accepts the order              ORDER_ACCEPTED         none
3     escrowed         seller(B) Locks crypto                   ORDER_ESCROWED         LOCKED (B debited)
4     payment_sent     buyer(A)  Sends fiat                     ORDER_PAYMENT_SENT     locked
5     completed        seller(B) Confirms fiat, releases        ORDER_COMPLETED        RELEASED (A credited)
```

**Note:** Type inversion — merchant creates BUY → stored as `type=sell` in DB.

---

## Case 4: M2M SELL — Merchant Sells to Merchant

```
Step  Status           Who       Action                         Event                  Escrow State
────  ───────────────  ────────  ─────────────────────────────  ─────────────────────  ────────────
1     escrowed         seller(A) Creates SELL, pre-locks escrow ORDER_CREATED+ESCROWED LOCKED (A debited)
2     escrowed         buyer(B)  Accepts order                  ORDER_ACCEPTED         locked
3     payment_sent     buyer(B)  Sends fiat                     ORDER_PAYMENT_SENT     locked
4     completed        seller(A) Confirms fiat, releases        ORDER_COMPLETED        RELEASED (B credited)
```

---

## Case 5: Cancel — Pre-Escrow (Clean)

> Either party cancels before escrow is locked.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
2     accepted         seller   Accepts                         ORDER_ACCEPTED         none
3     cancelled        either   Cancels before escrow           ORDER_CANCELLED        none (no refund needed)
```

**Side effects:**
- Liquidity restored to `merchant_offers.available_amount`
- No balance operations
- Reputation: -2 both parties

---

## Case 6: Cancel — Post-Escrow (Atomic Refund)

> Cancel after escrow is locked — requires atomic balance refund.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
2     accepted         seller   Accepts                         ORDER_ACCEPTED         none
3     escrowed         seller   Locks escrow                    ORDER_ESCROWED         LOCKED
4     cancelled        either   Cancels (triggers refund)       ORDER_CANCELLED        REFUNDED
```

**Atomic refund (single DB transaction):**
1. Lock order row `FOR UPDATE`
2. Read `escrow_debited_entity_type/id/amount`
3. Credit exact amount back to debited entity
4. Insert ledger_entries (ESCROW_REFUND, positive)
5. Insert merchant_transactions (escrow_refund)
6. Update order: `cancelled`, `refund_tx_hash`

---

## Case 7: Relist — Merchant Cancels Accepted Order (No Escrow)

> Special: accepted → pending (not cancelled). Order goes back to marketplace.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
2     accepted         seller   Accepts                         ORDER_ACCEPTED         none
3     pending          seller   Cancels → RELIST                ORDER_RELISTED         none
```

**Relist resets:**
- `accepted_at`, `buyer_merchant_id`, `acceptor_wallet_address` → NULL
- `merchant_id` → original offer's merchant
- `expires_at` → NOW() + 15 min
- `available_amount` restored on offer

---

## Case 8: Expiry — Pending (15 min, No Accept)

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
      ...15 min pass, no one accepts...
2     expired          system   Timer expires                   ORDER_EXPIRED          none
```

- Reputation: -5 both parties

---

## Case 9: Expiry — Active, No Escrow (→ Cancelled)

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
2     accepted         seller   Accepts                         ORDER_ACCEPTED         none
      ...120 min pass, no escrow lock...
3     cancelled        system   Timer expires, no escrow        ORDER_CANCELLED        none
```

---

## Case 10: Expiry — Active, WITH Escrow (→ Disputed)

> Escrow exists but order timed out. Auto-escalated to dispute to protect both parties.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1     pending          buyer    Creates order                   ORDER_CREATED          none
2     accepted         seller   Accepts                         ORDER_ACCEPTED         none
3     escrowed         seller   Locks escrow                    ORDER_ESCROWED         LOCKED
      ...120 min pass, fiat never sent...
4     disputed         system   Timer expires + escrow exists   ORDER_DISPUTED         locked (held)
```

---

## Case 11: Dispute — Manual, Resolved for Buyer (User)

```
Step  Status           Who        Action                        Event                  Escrow State
────  ───────────────  ─────────  ────────────────────────────  ─────────────────────  ────────────
1-3   ...              ...        (normal flow up to escrowed+) ...                    LOCKED
4     disputed         buyer      Opens dispute (fiat sent,     ORDER_DISPUTED         locked
                                  crypto not released)
5     disputed         compliance Investigates, proposes        (internal)             locked
                                  resolution: "user"
6     disputed         buyer      Accepts proposed resolution   (internal)             locked
7     disputed         seller     Accepts proposed resolution   (internal)             locked
8     cancelled        system     Both confirmed → refund       ORDER_CANCELLED        REFUNDED (buyer gets crypto back)
```

**Wait** — resolution "user" means user wins. For BUY order where buyer sent fiat:
- `user` resolution → crypto released to buyer → order `completed`
- `merchant` resolution → escrow refunded to seller → order `cancelled`

---

## Case 12: Dispute — Manual, Resolved for Seller (Merchant)

```
Step  Status           Who        Action                        Event                  Escrow State
────  ───────────────  ─────────  ────────────────────────────  ─────────────────────  ────────────
1-3   ...              ...        (normal flow up to escrowed+) ...                    LOCKED
4     disputed         seller     Opens dispute (claims no      ORDER_DISPUTED         locked
                                  fiat received)
5     disputed         compliance Proposes resolution:          (internal)             locked
                                  "merchant"
6-7   ...              both       Both confirm                  ...                    locked
8     completed        system     Escrow released to seller     ORDER_COMPLETED        RELEASED
```

---

## Case 13: Dispute — Split Resolution

```
Step  Status           Who        Action                        Event                  Escrow State
────  ───────────────  ─────────  ────────────────────────────  ─────────────────────  ────────────
1-4   ...              ...        (dispute opened)              ...                    LOCKED
5     disputed         compliance Proposes "split"              (internal)             locked
                                  {user: 60, merchant: 40}
6-7   ...              both       Both confirm                  ...                    locked
8     completed        system     Split executed                ORDER_COMPLETED        RELEASED (partial)
```

---

## Case 14: Dispute — Resolution Rejected, Re-proposed

```
Step  Status           Who        Action                        Event                  Escrow State
────  ───────────────  ─────────  ────────────────────────────  ─────────────────────  ────────────
1-4   ...              ...        (dispute opened)              ...                    LOCKED
5     disputed         compliance Proposes "user"               (internal)             locked
6     disputed         seller     REJECTS resolution            (internal)             locked
                                  → reverts to 'investigating'
                                  → proposed_resolution cleared
7     disputed         compliance Proposes "split"              (internal)             locked
8-9   ...              both       Both confirm                  ...                    ...
10    completed        system     Split executed                ORDER_COMPLETED        RELEASED
```

---

## Case 15: Dispute — Compliance Force-Finalize (Override)

> No party confirmation needed. Compliance has final say.

```
Step  Status           Who        Action                        Event                  Escrow State
────  ───────────────  ─────────  ────────────────────────────  ─────────────────────  ────────────
1-4   ...              ...        (dispute opened)              ...                    LOCKED
5     completed/       compliance POST finalize with            ORDER_COMPLETED/       RELEASED or
      cancelled                   escrow_action: release|refund ORDER_CANCELLED        REFUNDED
```

---

## Case 16: Extension — Requested & Accepted

```
Step  Status           Who      Action                          Event                  Timer
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ─────────
1-3   ...escrowed...   ...      (normal flow)                   ...                    120 min
4     escrowed         buyer    Requests extension              EXTENSION_REQUESTED    (paused)
5     escrowed         seller   Accepts extension               EXTENSION_ACCEPTED     +60 min
```

**Extension durations by status:**
| Status | Extension |
|--------|-----------|
| pending | +15 min |
| accepted | +30 min |
| escrowed | +60 min |
| payment_sent | +120 min |

Max 3 extensions per order.

---

## Case 17: Extension — Declined (→ Cancelled, Pre-Max)

```
Step  Status           Who      Action                          Event                  Timer
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ─────────
1-3   ...escrowed...   ...      (normal flow)                   ...                    120 min
4     escrowed         buyer    Requests extension              EXTENSION_REQUESTED    (paused)
5     cancelled        seller   Declines (extensions < max,     ORDER_CANCELLED        —
                                or pre-escrow status)
```

---

## Case 18: Extension — Declined at Max Extensions (→ Disputed)

> Post-escrow + max extensions reached → auto-dispute.

```
Step  Status           Who      Action                          Event                  Timer
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ─────────
1-3   ...escrowed...   ...      (extensions 1,2 used already)   ...                    extended
4     escrowed         buyer    Requests 3rd extension          EXTENSION_REQUESTED    (paused)
5     disputed         seller   Declines (max reached + escrow) ORDER_DISPUTED         72h dispute
```

---

## Case 19: Stuck Escrow — Cancelled but Not Refunded

> Edge case: order cancelled/expired with on-chain escrow but no refund tx.

```
Step  Status           Who      Action                          Event                  Escrow State
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ────────────
1-3   ...escrowed...   ...      (normal flow)                   ...                    LOCKED
4     cancelled        system   Cancelled but refund failed     ORDER_CANCELLED        STUCK
                                (or on-chain only, no mock)
5     (UI shows)       seller   Sees "Withdraw Escrow" button   —                      STUCK
                                Order NOT marked terminal in UI
```

Detected by: `GET /api/sync/escrow` (scans for DB cancelled + on-chain vault has funds)

---

## Case 20: Corridor/sAED Bridge Order

> Payment via sAED corridor — additional sAED lock/refund on cancel.

```
Step  Status           Who      Action                          Event                  Escrow + sAED
────  ───────────────  ───────  ──────────────────────────────  ─────────────────────  ──────────────
1     pending          buyer    Creates order (payment_via=     ORDER_CREATED          none + sAED locked
                                saed_corridor)
2     accepted         LP       Corridor provider accepts       ORDER_ACCEPTED         none + sAED locked
3     escrowed         LP       Locks crypto escrow             ORDER_ESCROWED         LOCKED + sAED locked
4     payment_sent     LP       Marks fiat sent                 ORDER_PAYMENT_SENT     locked
5     completed        buyer    Confirms fiat, releases         ORDER_COMPLETED        RELEASED + LP sinr_balance credited
```

**On cancel:** `refundBuyerSaed()` returns locked sAED to buyer.

---

## Case 21: Self-Referencing Order Guard

> Orders where `merchant_id === buyer_merchant_id` — fundamentally broken.

```
ALL transitions BLOCKED except → cancelled or → accepted.
Must cancel and recreate.
```

---

## Case 22: On-Chain Escrow (Production, Non-Mock)

```
Step  Status            Who      Action                         Event                  Escrow State
────  ────────────────  ───────  ─────────────────────────────  ─────────────────────  ────────────
1     pending           buyer    Creates order                  ORDER_CREATED          none
2     accepted          seller   Accepts                        ORDER_ACCEPTED         none
3     escrow_pending    seller   Submits on-chain tx            (transient)            TX_PENDING
4     escrowed          system   On-chain confirmation          ORDER_ESCROWED         LOCKED (on-chain PDA)
5     payment_sent      buyer    Sends fiat                     ORDER_PAYMENT_SENT     locked
6     payment_confirmed seller   Confirms fiat                  ORDER_PAYMENT_CONFIRMED locked
7     releasing         system   On-chain release tx submitted  (transient)            RELEASING
8     completed         system   On-chain release confirmed     ORDER_COMPLETED        RELEASED
```

---

## Timer Rules

| Status | Timeout | Outcome |
|--------|---------|---------|
| `pending` | 15 min from `created_at` | → `expired` |
| `accepted` (no escrow) | 120 min from `accepted_at` | → `cancelled` |
| `accepted` (with escrow) | 120 min | → `disputed` |
| `escrowed` | 120 min from escrow lock | → `disputed` |
| `payment_sent` | 120 min | → `disputed` |
| `payment_confirmed` | 120 min | → `disputed` |
| `disputed` | 72 hours | compliance must act |

Escrow lock resets `expires_at` to NOW() + 120 min.
Extensions push `expires_at` by duration per status.

---

## All Event Types

### Order Events (audit trail → `order_events` table)

| event_type | Trigger |
|------------|---------|
| `order.created` | Order created |
| `order.accepted` | Counterparty accepts |
| `order.escrow_pending` | On-chain tx submitted |
| `order.escrowed` | Escrow locked |
| `order.payment_pending` | M2M buyer signs |
| `order.payment_sent` | Fiat marked sent |
| `order.payment_confirmed` | Fiat receipt confirmed |
| `order.releasing` | On-chain release submitted |
| `order.completed` | Trade done |
| `order.cancelled` | Cancelled |
| `order.expired` | Timed out |
| `order.disputed` | Dispute opened |
| `order.dispute_resolved` | Dispute resolved |
| `order.extension_requested` | Extension requested |
| `order.extension_responded` | Extension accepted/declined |
| `merchant_relisted` | Relist back to pending |
| `extension_accepted` | Extension accepted |
| `extension_declined` | Extension declined |

### Notification Outbox (→ Telegram, push)

| event_type | When |
|------------|------|
| `ORDER_CREATED` | New order |
| `ORDER_ACCEPTED` | Accepted |
| `ORDER_ESCROWED` | Escrow locked |
| `ORDER_PAYMENT_SENT` | Fiat sent |
| `ORDER_PAYMENT_PENDING` | M2M buyer signs |
| `ORDER_COMPLETED` | Done |
| `ORDER_CANCELLED` | Cancelled |
| `ORDER_EXPIRED` | Timed out |
| `ORDER_DISPUTED` | Dispute opened |
| `ORDER_RELISTED` | Back to marketplace |
| `ORDER_BUMPED` | Auto-bump premium |
| `EXTENSION_REQUESTED` | Extension request |
| `EXTENSION_ACCEPTED` | Extension accepted |
| `CORRIDOR_TIMEOUT` | LP missed deadline |

### Reputation Events

| event_type | Score |
|------------|-------|
| `order_completed` | +5 |
| `order_cancelled` | -2 |
| `order_disputed` | -5 |
| `order_timeout` | -5 |

### Pusher Events (realtime)

| Event | Channel |
|-------|---------|
| `order:created` | `private-merchants-global` + involved parties |
| `order:status-updated` | involved parties + order channel |
| `order:cancelled` | involved + `private-merchants-global` |
| `order:expired` | involved + `private-merchants-global` |
| `order:extension-requested` | involved parties |
| `order:extension-response` | involved parties |
| `chat:message-new` | `private-order-{id}` |
| `chat:messages-read` | `private-order-{id}` |
| `chat:typing-start` | `private-order-{id}` |
| `chat:typing-stop` | `private-order-{id}` |
| `notification:new` | `private-merchant-{id}` / `private-user-{id}` |

### System Chat Messages (auto-posted to order chat)

| Event | Message |
|-------|---------|
| `order.created` | "Order created for {amount} {currency}" |
| `order.accepted` | "Order accepted by merchant/counterparty" |
| `order.escrowed` | "{amount} {currency} locked in escrow" + escrow card |
| `order.payment_sent` | "Payment of {fiatAmount} marked as sent" |
| `order.payment_confirmed` | "Payment confirmed" |
| `order.completed` | "Trade completed! {amount} released" + release card |
| `order.cancelled` | "Order cancelled: {reason}" + refund info |
| `order.expired` | "Order expired" or "escalated to dispute" |
| `order.disputed` | "Order under dispute: {reason}" |
| `order.dispute_resolved` | "Dispute resolved: {resolution}" |
| `order.extension_requested` | "Extension requested (+{min} min)" |
| `order.extension_responded` | "Extension approved/declined" |

---

## DB Tables Written During Lifecycle

| Table | What | When |
|-------|------|------|
| `orders` | Status, timestamps, escrow fields | Every transition |
| `order_events` | Audit trail | Every transition |
| `chat_messages` | System messages | Every major transition |
| `notification_outbox` | Async delivery queue | Every transition |
| `ledger_entries` | ESCROW_LOCK (-), ESCROW_REFUND (+) | Lock / refund |
| `merchant_transactions` | escrow_lock, escrow_refund | Lock / refund |
| `disputes` | Dispute record | Dispute lifecycle |
| `merchants` / `users` | balance, total_trades, total_volume | Escrow / completion |
| `merchant_offers` | available_amount restoration | Cancel / expire / relist |
| `reputation_events` | Score changes | Terminal states |
| `direct_messages` | Order receipt DM updates | Accept, cancel |
| `corridor_fulfillments` | Provider status | Corridor complete / cancel |

---

## Visual: Complete State Machine

```
                                  ┌──────────────────────────┐
                                  │        CREATED           │
                                  │        pending           │
                                  └────────┬───────┬─────────┘
                                15min      │       │
                              timeout      │       │ seller accepts
                                  │        │       │
                                  ▼        │       ▼
                              expired      │   accepted ──────────── seller cancels ──► RELIST (→pending)
                                           │       │                 (no escrow)
                              seller       │       │ seller locks
                              pre-locks    │       │ escrow
                              (SELL order) │       │
                                  │        │       ▼
                                  └────────┴──► escrowed
                                                   │
                                    ┌──────────────┼──────────────┐
                                    │              │              │
                                 cancel         dispute      buyer sends
                                 (refund)                      fiat
                                    │              │              │
                                    ▼              ▼              ▼
                               cancelled      disputed     payment_sent
                               (REFUNDED)        │              │
                                           ┌─────┼─────┐       │
                                           │     │     │    seller confirms
                                        user  split  merch     fiat
                                        wins         wins      │
                                           │     │     │       ▼
                                           ▼     ▼     ▼   completed
                                       cancelled│  completed (RELEASED)
                                       (REFUND) │  (RELEASE)
                                                 ▼
                                             completed
                                             (SPLIT)
```

---

## Health



### `GET /api/health`
Simple health check.
- **Response:** `{ status: "ok", timestamp: "<ISO>" }`

---

## Auth

### `POST /api/auth/wallet`
Wallet-based auth and account creation.
- **Body:** `{ wallet_address, type: "merchant" | "user", name? }`
- **Response:** `{ user | merchant, created: boolean }`

### `GET | POST /api/auth/user`
Multi-action user auth. Rate limited.
- **POST actions:**
  - `wallet_login` — `{ action, wallet_address }` → user
  - `set_username` — `{ action, user_id, username }` → updated user
  - `check_username` — `{ action, username }` → `{ available }`
  - `login` — `{ action, email, password }` → user
  - `register` — `{ action, email, password, name }` → user
  - `link_wallet` — `{ action, user_id, wallet_address }` → user
- **GET:** `?id=<uuid>` → user | `?action=check_session&user_id=<uuid>` → session status

### `GET | POST | PATCH /api/auth/merchant`
Multi-action merchant auth. Auto-creates default offers on creation.
- **POST actions:**
  - `wallet_login` — `{ action, wallet_address }` → merchant
  - `create_merchant` — `{ action, wallet_address, name, username }` → merchant + default offers
  - `set_username` / `update_username` — `{ action, merchant_id, username }` → merchant
  - `check_username` — `{ action, username }` → `{ available }`
  - `login` — `{ action, email, password }` → merchant
  - `register` — `{ action, email, password, name, username }` → merchant
- **GET:** `?action=wallet_login&wallet_address=<addr>` | `?action=check_session&merchant_id=<id>`
- **PATCH:** `{ merchant_id, wallet_address }` → updated merchant

### `GET | POST /api/auth/admin`
Admin auth with JWT.
- **POST:** `{ username, password }` → `{ token, admin: { id, username, role } }`
- **GET:** Bearer token or `?token=<jwt>` → `{ valid, admin }`

### `GET | POST | PUT | PATCH /api/auth/compliance`
Compliance team auth and management.
- **POST:** `{ action: "wallet_login" | "login", ... }` → compliance member
- **PUT:** Setup compliance_team table + seed initial members
- **GET:** List authorized compliance wallets
- **PATCH:** `{ wallet_address, name, role }` (admin only)

---

## Users

### `GET | PATCH /api/users/[id]`
User profile. Owner-only.
- **GET:** user object
- **PATCH:** `{ username?, name?, email?, ... }` → updated user

### `GET | POST /api/users/[id]/bank-accounts`
User bank accounts.
- **GET:** `{ bank_accounts: [...] }`
- **POST:** `{ bank_name, account_name, iban, is_default? }` → created account

---

## Merchant

### `GET | PATCH /api/merchant/[id]`
Merchant profile read/update.

### `PATCH /api/merchant/[id]/telegram`
Update Telegram chat ID for notifications.
- **Body:** `{ telegram_chat_id }`

### `GET /api/merchant/[id]/public-stats`
Public merchant stats. No auth. Cached 30s.
- **Response:** `{ recent_orders, reviews, active_offers, stats }`

### `GET | POST /api/merchant/offers`
Offer management.
- **GET:** `?merchant_id=<id>` → `{ offers: [...] }`
- **POST:** `{ merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name?, iban?, location? }`

### `GET | PATCH | DELETE /api/merchant/offers/[id]`
Single offer CRUD.

### `GET | POST /api/merchant/orders`
Merchant order listing + merchant-initiated creation. **~523 lines. Complex.**
- Type inversion: merchant SELL → DB `type=buy`, merchant BUY → DB `type=sell`
- Price engine with corridor ref price, market_margin, signed proofs
- M2M support with `m2m_*` placeholder users
- **GET:** `?merchant_id`, `?include_all_pending=true`, `?view=big_orders`, `?status`
- **POST:** `{ merchant_id, type, crypto_amount, payment_method, rate_type?, custom_rate?, counterparty_merchant_id?, bank_name?, iban?, auto_bump?, decay_bps? }`

### `GET /api/merchant/analytics`
Full analytics dashboard.
- **Params:** `?merchant_id`, `?period=7d|30d|90d|all`
- **Response:** `{ summary, daily_volume, hourly_heatmap, top_customers, status_breakdown, payment_breakdown, avg_completion_time }`

### `GET /api/merchant/messages`
Conversations grouped by order with unread counts.
- **Params:** `?merchant_id`, `?tab=direct|automated|dispute`, `?search`, `?limit`, `?offset`
- **Response:** `{ conversations, tabCounts }`

### `GET | POST | PATCH | DELETE /api/merchant/contacts`
Merchant contact (friend) management.
- **GET:** `?merchant_id` → `{ contacts }`
- **POST:** `{ merchant_id, contact_id, contact_type }`
- **PATCH:** `{ id, nickname?, notes?, favorite? }`
- **DELETE:** `{ id }`

### `GET | POST /api/merchant/direct-messages`
M2M and M2U direct messaging.
- **GET:** `?merchant_id`, `?other_id`, `?other_type=merchant|user`
- **POST:** `{ sender_merchant_id, recipient_id, recipient_type, content }`

### `GET /api/merchant/transactions`
Transaction history.
- **Params:** `?merchant_id`, `?order_id`, `?summary=true`, `?limit`, `?offset`

### `GET /api/merchant/notifications`
Recent notifications from outbox.
- **Params:** `?merchant_id`

---

## Merchants (plural)

### `GET /api/merchants/[merchantId]/orders`
Serialized orders for a merchant. Auth required.

### `GET /api/merchants/leaderboard`
Top 20 merchants by volume, trades, rating.

---

## Offers & Marketplace

### `GET /api/offers`
Active offers with filters. Cached 5s.
- **Params:** `?type`, `?payment_method`, `?amount`, `?preference`

### `GET /api/marketplace/offers`
All active offers with BlipScore rankings.
- **Params:** `?type`, `?payment_method`, `?sort=best|cheapest|fastest|reliable`, `?exclude_merchant_id`
- **Response:** offers with merchant stats, corridor scores, BlipScore

---

## Orders

### `GET | POST /api/orders`
User order listing + creation. Rate limited.
- **GET:** `?user_id` → `{ orders }`
- **POST:** `{ user_id, type, crypto_amount, offer_id?, payment_method? }` → order (finds best offer or uses specified)

### `GET | POST /api/orders/match`
Order matching engine.
- **GET:** `?type`, `?payment_method`, `?crypto_amount` → ranked matches
- **POST:** `{ spread_preference }` → order book stats

### `GET | POST /api/orders/expire`
Expire stale orders. Proxied to core-api.

### `GET | PATCH | DELETE /api/orders/[id]`
Order CRUD. **~548 lines. Complex.**
- Mock cancellation with `atomicCancelWithRefund`, merchant relist, Pusher notifications
- **GET:** `?source=core-api` → full order with computed fields, `minimal_status`
- **PATCH:** `{ status, actor_type, actor_id, tx_hash?, payment_details? }`
- **DELETE:** `{ actor_type, actor_id }` → cancellation with escrow refund if applicable

### `GET | POST | PATCH /api/orders/[id]/escrow`
Escrow operations.
- **GET:** escrow status `{ order_id, status, escrow_tx_hash, is_escrowed, is_released, ... }`
- **POST:** Record deposit — `{ tx_hash, actor_type, actor_id, escrow_address?, escrow_trade_id?, ... }`
  - Mock mode: `mockEscrowLock` | Production: proxied to core-api
- **PATCH:** Record release — `{ tx_hash, actor_type, actor_id }`

### `GET | POST | PATCH /api/orders/[id]/messages`
Order chat.
- **GET:** `{ messages }`
- **POST:** `{ sender_type, sender_id, content, image_url? }` — validates access, blocks terminal orders
- **PATCH:** `{ reader_type, reader_id }` — mark read

### `GET /api/orders/[id]/events`
Order event timeline with enriched context.
- **Response:** `{ events, orderContext: { payment_details, escrow_info } }`

### `POST /api/orders/[id]/typing`
Typing indicator via Pusher.
- **Body:** `{ actor_type, is_typing }`

### `GET | POST | PUT /api/orders/[id]/extension`
Time extension management.
- **POST:** Request extension (proxied to core-api)
- **PUT:** `{ action: "accept" | "decline" }` — respond to request
- **GET:** `{ canExtend, extensionCount, maxExtensions, pendingRequest }`

### `GET | POST /api/orders/[id]/dispute`
Dispute creation/retrieval.
- **POST:** `{ reason, description, initiated_by, user_id, merchant_id }` → proxied to core-api
- **GET:** dispute object with status, resolution, evidence

### `POST /api/orders/[id]/dispute/confirm`
Confirm/reject proposed dispute resolution.
- **Body:** `{ party, action: "accept" | "reject", partyId }` → proxied to core-api

---

## Mempool

### `GET | POST /api/mempool`
Mempool data and actions.
- **GET types:** `?type=orders|mineable|corridor|quotes|events`
  - `orders` — mempool order list
  - `mineable` — orders available for mining/acceptance
  - `corridor` — corridor price + ref price, params: `?corridor_id`
  - `quotes` — merchant quotes, params: `?order_id`, `?merchant_id`
  - `events` — order events
- **POST actions:**
  - `bump` — `{ action, order_id, merchant_id }`
  - `accept` — `{ action, order_id, merchant_id }` (self-accept guard)
  - `upsert_quote` — `{ action, ...quote_fields }` (validates price/size)

---

## Ledger

### `GET | POST /api/ledger`
Ledger entries.
- **GET:** `?merchant_id` or `?user_id`, `?limit`, `?offset` → entries from ledger views
- **POST:** `{ entity_type, entity_id, entry_type, amount, currency, description?, reference_id? }` — manual entry (admin/testing)

---

## Convert

### `GET | POST /api/convert`
USDT ↔ sAED conversion.
- **POST:** `{ userId, from: "usdt" | "saed", to: "usdt" | "saed", amount }` → proxied to core-api
- **GET:** `?userId` → `{ usdt_balance, saed_balance, rate }`

---

## Ratings

### `GET | POST /api/ratings`
- **GET types:** `?type=top-sellers|top-users|for-entity|pending|status`
  - `top-sellers` / `top-users` — leaderboards
  - `for-entity` — `?entity_type`, `?entity_id` → ratings for entity
  - `pending` — `?entity_type`, `?entity_id` → unrated completed orders
  - `status` — `?order_id` → rating status for order
- **POST:** `{ order_id, rater_type, rater_id, rated_type, rated_id, rating: 1-5, review? }`

---

## Reputation

### `GET | POST | PUT /api/reputation`
Reputation scoring. Tiers: newcomer → bronze → silver → gold → platinum → diamond.
- **GET types:** `?type=score|leaderboard|history|events`
  - `score` — `?entity_type`, `?entity_id` → `{ score, breakdown, tier, badges, rank }`
  - `leaderboard` — top entities
  - `history` — score over time
  - `events` — reputation-affecting events
- **POST:** `{ action: "recalculate" | "recalculate_all", entity_type?, entity_id? }`
- **PUT:** Initialize reputation tables (migration)

---

## Disputes & Arbitration

### `GET /api/disputes/resolved`
Resolved disputes for an actor.
- **Params:** `?actor_type=user|merchant`, `?actor_id`

### `GET | POST | PATCH /api/disputes/[id]/arbitration`
Arbitration panel management.
- **GET:** Arbitration details (individual votes hidden until concluded)
- **POST:** `{ exclude_parties: [...] }` — start arbitration, select eligible arbiters
- **PATCH:** Check + conclude arbitration (tally votes, determine outcome)

### `GET | POST /api/disputes/[id]/arbitration/members`
Panel member management.
- **GET:** panel members list
- **POST:** `{ wallet_address }` — add wallet to panel

### `GET | POST | PUT /api/arbiters`
Arbiter registration.
- **GET types:** `?type=info|leaderboard|eligible|check_eligibility`, `?wallet_address`
- **POST:** `{ wallet_address }` — register as arbiter
- **PUT:** Initialize arbiter tables (migration)

### `GET | POST /api/arbiters/[id]/votes`
Arbiter voting.
- **GET:** `{ pending, history }`
- **POST:** `{ decision: "user" | "merchant" | "split", reasoning }`

---

## Compliance

### `GET /api/compliance/disputes`
All disputed orders. Compliance auth required.
- **Params:** `?status`, `?limit`, `?offset`
- **Response:** `{ disputes, total }`

### `POST | PATCH /api/compliance/disputes/[id]/resolve`
Dispute resolution.
- **POST:** `{ resolution: "user" | "merchant" | "split", notes }` — propose (needs 2 confirmations)
- **PATCH:** `{ status: "investigating" | "pending_evidence" | "escalated" }` — update status

### `POST /api/compliance/disputes/[id]/finalize`
Force-resolve dispute with escrow action.
- **Body:** `{ escrow_action: "release" | "refund" }`

---

## Corridor

### `GET /api/corridor/dynamic-rate`
Current USDT_AED corridor reference price.
- **Params:** `?corridor_id` (default: `USDT_AED`)
- **Response:** `{ rate, source, updated_at }` (fallback: 3.67)

### `GET /api/corridor/fulfillments`
Active corridor fulfillments.
- **Params:** `?provider_merchant_id` or `?order_id`

### `GET | POST /api/corridor/providers`
Liquidity provider config.
- **GET:** `?merchant_id` → provider config
- **POST:** `{ merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept }`

---

## Sync (Dev Only)

### `GET | POST /api/sync/balances`
Balance sync: DB vs on-chain Solana.
- **GET:** Dry-run comparison
- **POST:** Apply corrections

### `GET /api/sync/escrow`
Scan for stuck escrows (DB cancelled but on-chain vault has funds).

---

## Mock (Mock Mode Only)

### `GET | POST /api/mock/balance`
Mock balance management.
- **GET:** `?merchant_id` → balance (auto-inits to 10000)
- **POST:** `{ merchant_id, amount, operation: "deduct" | "credit" }`

---

## Ops (Dev Only)

### `GET /api/ops`
Ops debug dashboard.
- **Params:** `?tab=outbox|stuck|heartbeats|search`, `?search_term`

---

## Upload

### `POST /api/upload/signature`
Cloudinary upload signature for chat images.
- **Body:** `{ folder?, orderId? }`
- **Response:** `{ signature, timestamp, apiKey, cloudName, folder }`

---

## Pusher

### `POST /api/pusher/auth`
Authenticate Pusher channel subscriptions.
- **Body:** `{ socket_id, channel_name }`
- **Headers:** `x-actor-type`, `x-actor-id`
- **Channels:** `user-*`, `merchant-*`, `merchants-global`, `private-order-*`, `presence-order-*`

---

## Transactions

### `GET /api/transactions`
Unified transaction view (order events + on-chain + in-app balance).
- **Params:** `?merchant_id` or `?user_id`, `?tab=all|orders|onchain|inapp|disputed`, `?status`, `?search`, `?limit`, `?offset`
- **Response:** `{ transactions, summary, total, hasMore }`

---

## Admin

### `GET /api/admin/orders`
All orders with names. Admin auth required.
- **Params:** `?status`, `?min_amount`

### `GET /api/admin/activity`
Unified activity feed.
- **Response:** completed trades, escrow events, disputes, new users, merchants online

### `GET /api/admin/balance`
Platform fee balance and breakdown.

### `GET /api/admin/merchants`
All merchants sorted by volume/trades/rating.

### `GET /api/admin/stats`
Platform statistics.
- **Response:** `{ trades, volume, escrow, disputes, success_rate, avg_time, revenue, tx_per_min, hourly_chart, peak_hours, platform_balance }`

### `GET /api/admin/reconciliation`
Balance reconciliation. Compares `merchants.balance` vs `ledger_entries` vs `merchant_transactions`.

---

## Setup (Dev Only)

### `GET | POST /api/setup/clear-orders`
Delete all orders and related records.

### `GET /api/setup/seed`
Seed test accounts (users, merchants, offers, compliance team).

### `GET /api/setup/disputes`
Run dispute-related migrations.

### `POST /api/setup/init-balances`
Initialize all merchant balances to `MOCK_INITIAL_BALANCE`.

---

## Test (Dev Only)

### `GET | POST /api/test/reset`
Truncate all tables.
- **POST:** `{ confirm: true }` (required)

### `GET | POST /api/test/seed`
Seed deterministic test data (2 users, 2 merchants, 3 offers).

---

## Summary

| Category | Endpoints | Notes |
|----------|-----------|-------|
| Health | 1 | |
| Auth | 5 | wallet, user, merchant, admin, compliance |
| Users | 2 | profile, bank accounts |
| Merchant | 12 | profile, offers, orders, analytics, messages, contacts, DMs, transactions, notifications |
| Merchants | 2 | orders, leaderboard |
| Offers/Marketplace | 2 | |
| Orders | 11 | CRUD, escrow, messages, events, typing, extension, dispute |
| Mempool | 1 | multi-type GET + multi-action POST |
| Ledger | 1 | |
| Convert | 1 | USDT ↔ sAED |
| Ratings | 1 | |
| Reputation | 1 | |
| Disputes/Arbitration | 4 | |
| Arbiters | 2 | |
| Compliance | 3 | |
| Corridor | 3 | |
| Sync | 2 | dev only |
| Mock | 1 | mock mode only |
| Ops | 1 | dev only |
| Upload | 1 | Cloudinary |
| Pusher | 1 | |
| Transactions | 1 | |
| Admin | 6 | |
| Setup | 4 | dev only |
| Test | 2 | dev only |
| **Total** | **~65** | **~120+ HTTP handlers** |
