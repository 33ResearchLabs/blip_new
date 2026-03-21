# P2P Trade Flow Documentation

## Merchant-to-Merchant (M2M) Trade Flow

### Order Statuses
```
pending → accepted → escrowed → payment_sent → payment_confirmed → completed
                                      ↓
                                  disputed
```

---

## SELL Order Flow (Merchant A sells USDC to Merchant B)

### Merchant A (Seller):

**1. Create Sell Order**
- Opens "Open Trade" modal
- Selects: `Sell`, amount, payment method
- Clicks "Create"
- System finds matching merchant BUY offer
- Opens **Escrow Modal** IMMEDIATELY (before order is visible)

**2. Lock Escrow First**
- Merchant A locks USDC via `depositToEscrowOpen()` on-chain
- Creates escrow WITHOUT counterparty (open escrow)
- Order is only created in DB AFTER escrow succeeds
- Status: `pending` → `escrowed`
- Order now visible to other merchants

### Merchant B (Buyer):

**3. Accept Escrowed Order**
- Merchant B sees order in "New Orders" (shows "Escrowed by Merchant")
- Clicks "Go" to accept
- Calls `acceptTrade()` on-chain to join the escrow
- Status: `escrowed` → `accepted`
- Chat opens

**4. Send Fiat Payment**
- Merchant B sends bank transfer/cash to Merchant A
- Clicks "I've Paid"
- Status: `accepted` → `payment_sent`

**5. Confirm & Release**
- Merchant A confirms fiat received
- Merchant A clicks "Confirm & Release"
- Calls `releaseEscrow()` on-chain
- USDC sent to Merchant B's wallet
- Status: `payment_sent` → `completed`

---

## BUY Order Flow (Merchant A buys USDC from Merchant B)

### Merchant A (Buyer):

**1. Create Buy Order**
- Opens "Open Trade" modal
- Selects: `Buy`, amount, payment method
- Clicks "Create"
- Order created in DB immediately (no escrow needed yet)
- Status: `pending`
- Appears to all merchants in "New Orders"

### Merchant B (Seller):

**2. Accept & Lock Escrow**
- Merchant B sees buy order in "New Orders"
- Clicks "Go" to accept
- Status: `pending` → `accepted`
- Chat opens
- Merchant B clicks "Lock Escrow"
- Locks USDC via `depositToEscrowOpen()`
- Status: `accepted` → `escrowed`

**3. Send Fiat Payment**
- Merchant A sends bank transfer/cash to Merchant B
- Merchant A clicks "I've Paid"
- Status: `escrowed` → `payment_sent`

**4. Confirm & Release**
- Merchant B confirms fiat received
- Clicks "Confirm & Release"
- Calls `releaseEscrow()` on-chain
- USDC sent to Merchant A's wallet
- Status: `payment_sent` → `completed`

---

## Key Differences

### SELL Order (M2M):
- ✅ Escrow locked BEFORE order visible
- Creator locks escrow immediately
- Acceptor joins escrow on accept

### BUY Order (M2M):
- Order visible immediately
- Acceptor locks escrow after accepting
- Same flow as regular buy orders

### On-Chain Functions:
- `depositToEscrowOpen()` - Create open escrow
- `acceptTrade()` - Join existing escrow
- `releaseEscrow()` - Release to counterparty

---

## Matching Engine Specification

### Spread-Based Bidding System

When a merchant creates an order, they specify their **spread preference**:

**1. Spread Options:**
- **Best** (High Spread) - Willing to pay premium for instant match
- **Fastest** (Medium Spread) - Balanced speed and price
- **Cheap** (Low Spread) - Best price, may wait longer

### Order Matching Algorithm

**Priority Ranking:**
1. **Spread %** - Higher spread = higher priority
2. **Reputation Score** - Merchants with better ratings shown first
3. **Liquidity Depth** - Orders with more USDC funded
4. **Response Time** - Merchants with faster avg response time
5. **Timestamp** - Older orders (if all else equal)

### Order Book Management

**Order Lifecycle:**
- ✅ Orders remain open indefinitely
- ✅ NO automatic cancellation/expiration
- ✅ Only manual cancellation by creator
- ✅ Orders persist until matched or cancelled
- ✅ **Max 10 active orders per merchant** (includes pending, accepted, escrowed, payment_sent)

**Visibility Rules:**
- SELL orders: Visible ONLY after escrow is locked
- BUY orders: Visible immediately after creation
- Filter by: spread %, reputation, payment method, amount range

### Spread Calculation

```
spread = (offered_rate - market_rate) / market_rate * 100

Example:
- Market rate: 3.67 AED/USDC
- Merchant offers: 3.75 AED/USDC
- Spread: (3.75 - 3.67) / 3.67 * 100 = 2.18%
```

### Matching Process

**For SELL Orders (Merchant selling USDC):**
1. Merchant submits sell order with spread preference
2. System finds matching BUY offers sorted by:
   - Highest spread first
   - Best reputation second
   - Fastest response time third
3. Merchant locks escrow before order becomes visible
4. Order appears in marketplace for buyers

**For BUY Orders (Merchant buying USDC):**
1. Merchant submits buy order with spread preference
2. Order appears immediately in marketplace
3. System ranks order by spread % offered
4. Sellers see best-paying buyers first
5. First seller to accept gets the trade

### Future Enhancements

**Filtering Options:**
- Sort by spread % (high to low)
- Filter by reputation tier (diamond, gold, silver, bronze)
- Filter by payment method (bank, cash)
- Filter by amount range
- Filter by location (for cash trades)

**Advanced Matching:**
- Partial fills (split large orders)
- Time-weighted matching (reward long-standing orders)
- Volume discounts (better rates for larger trades)
- Preferred partners (whitelist specific merchants)

---

## Trade Settlement Times & Protocol Fees

### Best (High Spread) - Premium Service
- **Settlement:** Instant match + 5-30min (bank) / 15-60min (cash)
- **Protocol Fee:** 2.0% per trade
- **Merchant Spread:** Any spread above 2% is merchant profit
- **Best For:** Urgent trades, high-volume merchants

### Fastest (Medium Spread) - Balanced
- **Settlement:** <5min match + 10-60min (bank) / <10min + 30-90min (cash)
- **Protocol Fee:** 2.5% per trade
- **Merchant Spread:** Any spread above 2.5% is merchant profit
- **Best For:** Regular trading, predictable timing

### Cheap (Low Spread) - Economy
- **Settlement:** Variable match + 10-60min (bank) / Variable + 30-120min (cash)
- **Protocol Fee:** 1.5% per trade
- **Merchant Spread:** Any spread above 1.5% is merchant profit
- **Best For:** Large orders, price-conscious merchants

### Protocol Revenue Model
```
Trade Example: 1,000 USDC @ 3.75 AED rate (2.18% spread)
Market Rate: 3.67 AED/USDC

If "Best" tier selected:
- Total spread: 2.18%
- Protocol fee: 2.0%
- Merchant profit: 0.18%

If "Cheap" tier selected:
- Total spread: 2.18%
- Protocol fee: 1.5%
- Merchant profit: 0.68%
```

---

## Implementation Notes

### Current Status:
- ✅ M2M flow implemented
- ✅ Escrow-before-visibility for SELL orders
- ✅ On-chain escrow integration
- ⏳ Spread-based matching engine (TODO)
- ⏳ Order book persistence (TODO)
- ⏳ Advanced filtering (TODO)

### Database Schema Changes Needed:
```sql
-- Add spread column to orders
ALTER TABLE orders ADD COLUMN spread_percentage DECIMAL(5,2);
ALTER TABLE orders ADD COLUMN spread_preference VARCHAR(20); -- 'best', 'fastest', 'cheap'

-- Add indices for matching
CREATE INDEX idx_orders_spread ON orders(spread_percentage DESC, created_at);
CREATE INDEX idx_orders_status_type ON orders(status, type, payment_method);

-- Remove auto-expiry (orders never expire automatically)
-- Future: Add manual cancellation tracking
ALTER TABLE orders ADD COLUMN cancelled_by_user BOOLEAN DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN cancellation_reason TEXT;
```

### API Endpoints to Implement:
```
POST   /api/orders/match         - Find best matching order
GET    /api/orders/orderbook     - Get order book with filtering
PATCH  /api/orders/:id/cancel    - Manually cancel order
GET    /api/orders/spread-stats  - Get current spread statistics
```

---

## Security Considerations

1. **Escrow-First for SELL:** Prevents fake liquidity/spam orders
2. **Reputation Gating:** Low-rep merchants may need to offer higher spreads
3. **Max Spread Limits:** Prevent predatory pricing (e.g., max 10% spread)
4. **Rate Limiting:** Prevent order spam/DoS attacks
5. **Cancellation Tracking:** Monitor merchants who cancel frequently

---

## User Experience Flow

### Creating an Order:

```
1. Click "Open Trade"
2. Select BUY or SELL
3. Enter amount (USDC)
4. Select payment method (Bank/Cash)
5. Choose spread preference:
   [●] Best    - Instant match, pay premium
   [ ] Fastest - Quick match, fair price
   [ ] Cheap   - Best price, may wait
6. Preview:
   - You get: X AED
   - Spread: +2.5%
   - Estimated match: <1 min
7. Confirm
   - SELL: Lock escrow first → Order visible
   - BUY: Order visible immediately
```

### Viewing Order Book:

```
Filter: [All ▼] [Bank Transfer ▼] [Any Amount ▼]
Sort: [Highest Spread First ▼]

┌─────────────────────────────────────────┐
│ SELL 1,000 USDC → 3,720 AED            │
│ Spread: +3.2% 🔥 • ⭐⭐⭐⭐⭐ Gold       │
│ Payment: Bank • Avg Response: 2 min    │
│ Escrow: Locked ✅                       │
│ [Accept →]                              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ SELL 500 USDC → 1,850 AED              │
│ Spread: +2.8% • ⭐⭐⭐⭐ Silver          │
│ Payment: Bank • Avg Response: 5 min    │
│ Escrow: Locked ✅                       │
│ [Accept →]                              │
└─────────────────────────────────────────┘
```

---

## Timeout & Extension System

### Current Rules:
- Global 15-minute timeout from order creation
- Max 3 extensions allowed
- Extensions available in: `pending`, `accepted`, `escrowed`, `payment_sent`

### Proposed Changes for Open Orders:
- ❌ Remove automatic expiry for PENDING orders
- ✅ Keep 15-min timeout AFTER order is accepted (active trade)
- ✅ Orders in `pending` status remain open indefinitely
- ✅ Only active trades (accepted → completed) have timeouts

---

## Admin Dashboard

### Purpose
Centralized monitoring and revenue tracking for protocol operations.

### Key Features

**1. Protocol Revenue Tracking**
- Real-time revenue from all completed trades
- Breakdown by tier (Best: 2%, Fastest: 2.5%, Cheap: 1.5%)
- Daily/Weekly/Monthly revenue charts
- Total volume processed

**2. Trade Analytics**
- Total trades by tier preference
- Average settlement times
- Completion rate vs cancellation rate
- Most active merchants

**3. Merchant Management**
- List of all registered merchants
- Individual merchant performance metrics
- Suspension/moderation controls
- Reputation score distribution

**4. Order Book Monitoring**
- Live pending orders count
- Active escrow amounts locked
- Average spread by payment method
- Geographic distribution (if applicable)

**5. Dispute Resolution**
- Open disputes requiring admin review
- Dispute history and outcomes
- Merchant dispute frequency

### Admin Dashboard Endpoints (To Implement)
```
POST   /api/admin/auth              - Admin login
GET    /api/admin/revenue           - Revenue statistics
GET    /api/admin/analytics         - Platform-wide analytics
GET    /api/admin/merchants         - Merchant list and stats
GET    /api/admin/orders            - All orders overview
GET    /api/admin/disputes          - Dispute management
PATCH  /api/admin/merchants/:id     - Update merchant status
```

### Revenue Calculation Logic
```sql
-- Calculate protocol revenue from completed orders
SELECT
  DATE(completed_at) as date,
  spread_preference,
  COUNT(*) as trade_count,
  SUM(crypto_amount) as volume,
  SUM(
    CASE
      WHEN spread_preference = 'best' THEN crypto_amount * 0.02
      WHEN spread_preference = 'fastest' THEN crypto_amount * 0.025
      WHEN spread_preference = 'cheap' THEN crypto_amount * 0.015
      ELSE 0
    END
  ) as protocol_revenue
FROM orders
WHERE status = 'completed'
GROUP BY DATE(completed_at), spread_preference
ORDER BY date DESC;
```

### Access Control
- **Admin login:** Separate from merchant/user authentication
- **Role-based permissions:** Super admin, moderator, analyst
- **Audit logs:** Track all admin actions
- **2FA required:** For all admin accounts

---

## Glossary

- **Spread:** Difference between offered rate and market rate (%)
- **Order Book:** List of all open buy/sell orders
- **Liquidity:** Amount of USDC available for trading
- **M2M:** Merchant-to-Merchant trading (both parties are merchants)
- **Escrow-First:** Locking USDC before order becomes visible (SELL orders only)
- **Open Order:** Order that remains visible until manually cancelled
