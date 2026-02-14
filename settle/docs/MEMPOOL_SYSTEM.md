# AED Mempool + Gas Pricing System

## Overview

The AED Mempool system implements an Ethereum-like priority fee market for USDT→AED trades. Orders enter a "mempool" where they compete for merchant attention using dynamic priority fees (measured in basis points). This creates a transparent, market-driven pricing mechanism where users can pay higher premiums to get faster fills.

## Core Concepts

### 1. Mempool
- Orders start in "pending" status and enter the mempool
- Visible to all merchants who can choose which orders to accept
- Orders sorted by priority (premium_bps_current) descending
- Expired orders are automatically removed

### 2. Priority Fees (Gas)
- **premium_bps_current**: Current priority fee in basis points (1 bp = 0.01%)
- **premium_bps_cap**: Maximum priority fee user is willing to pay
- **bump_step_bps**: Amount to increase premium each bump
- **bump_interval_sec**: Time between automatic bumps

Example: Order with 100 bps premium on 3.67 AED/USDT reference price:
- Offer price = 3.67 × (1 + 100/10000) = 3.6737 AED/USDT

### 3. Reference Price
- **corridor_prices table**: Stores reference price for each corridor (e.g., USDT_AED)
- Updated every 30 seconds by refprice-updater worker
- Calculated using trimmed median of recent completed trades (last 5 minutes)
- Protects against outliers and manipulation

### 4. Replace-by-Fee (Bump)
Users can increase their order's priority to jump ahead in the queue:
- **Manual Bump**: User clicks "Bump Priority" button
- **Auto-Bump**: Automatically increases premium every N seconds until cap reached
- Each bump increases premium_bps_current by bump_step_bps

### 5. Merchant Quotes
Merchants publish their pricing preferences per corridor:
- **min_price_aed_per_usdt**: Minimum price they'll accept
- **min_size_usdt / max_size_usdt**: Order size range
- **available_liquidity_usdt**: How much USDT they can sell
- **sla_minutes**: Commitment to fulfill within N minutes
- **is_online**: Whether currently accepting orders

### 6. Order Acceptance (Mining)
Merchants "mine" orders by accepting them:
- Must meet merchant's quote requirements (price, size, liquidity)
- Uses optimistic locking to prevent double-acceptance
- Atomic: reserves liquidity and assigns winner_merchant_id
- First merchant to successfully lock the order wins

## Architecture

### Database Schema

#### Tables
1. **corridor_prices** - Reference prices and market stats per corridor
2. **orders** (extended) - Added mempool fields (premium_bps_*, corridor_id, etc.)
3. **merchant_quotes** - Merchant pricing preferences
4. **order_events** - Audit log of all order events (bumps, accepts, etc.)

#### Functions
- `calculate_offer_price()` - Calculates current offer price from ref price + premium
- `is_order_mineable()` - Checks if merchant can accept a specific order

#### Views
- `v_mempool_orders` - Real-time view of pending orders with computed fields

### API Endpoints

#### GET /api/mempool
Query parameters:
- `type=orders`: Get mempool orders with filters
- `type=mineable&merchant_id=X`: Get orders merchant can accept
- `type=corridor`: Get corridor price data
- `type=quotes`: Get merchant quotes
- `type=events&order_id=X`: Get order event history

#### POST /api/mempool
Actions:
- `action=bump&order_id=X`: Manually bump order priority
- `action=accept&order_id=X&merchant_id=Y`: Accept order

#### GET /api/merchant-quotes
Get merchant's current quote

#### POST /api/merchant-quotes
Create or update merchant quote

### Background Workers

#### 1. Auto-Bump Worker (`src/workers/auto-bump-worker.ts`)
- Runs every 10 seconds
- Finds orders with `auto_bump_enabled=TRUE` and `next_bump_at <= NOW()`
- Bumps their priority by `bump_step_bps`
- Stops when `premium_bps_current >= premium_bps_cap`

Run: `ts-node src/workers/auto-bump-worker.ts`

#### 2. Reference Price Updater (`src/workers/refprice-updater.ts`)
- Runs every 30 seconds
- Calculates trimmed median of last 5 minutes of completed trades
- Updates corridor_prices table with:
  - ref_price
  - volume_5m (5-minute trading volume)
  - avg_fill_time_sec (average time to complete)
  - active_merchants_count

Run: `ts-node src/workers/refprice-updater.ts`

### UI Components

#### 1. Market Snapshot (`MarketSnapshot.tsx`)
- Shows current ref price with trend indicator
- Displays 5m volume, avg fill time, active merchants
- Auto-refreshes every 30s

#### 2. Mempool Widget (`MempoolWidget.tsx`)
- Lists all pending orders sorted by priority
- Color-coded priority badges (HIGH/MED/LOW)
- Shows premium %, time remaining, auto-bump status
- Auto-refresh toggle
- Click order to open inspector

#### 3. Order Inspector (`OrderInspector.tsx`)
- Slide-in drawer showing detailed order info
- "Bump Priority" button (if not at cap)
- "Accept Order" button (for merchants)
- Event history timeline
- All prices and premiums displayed

#### 4. Merchant Quote Control (`MerchantQuoteControl.tsx`)
- Online/Offline toggle
- Configure min price, size range, SLA, liquidity
- Saves to merchant_quotes table
- Determines which orders merchant sees as "mineable"

#### 5. Mempool Filters (`MempoolFilters.tsx`)
- Filter by premium range (bps)
- Filter by amount range (USDT)
- Reset button
- Collapsible panel

#### 6. Mempool Page (`/merchant/mempool`)
- Full-page view combining all widgets
- 3-column layout:
  - Left: Market Snapshot + Quote Control + Filters
  - Right: Mempool Widget (order list)
  - Overlay: Order Inspector (when order selected)

## User Flow

### User Creates Order
1. User creates order with premium settings:
   - Initial premium: 0-500 bps
   - Premium cap: max they'll pay
   - Auto-bump: enabled/disabled
   - Bump interval: 30s default
2. Order enters mempool with `ref_price_at_create` from current corridor price
3. Order appears in mempool widget, visible to all merchants

### Order Bumping
**Manual:**
1. User opens order inspector
2. Clicks "Bump Priority"
3. premium_bps_current increases by bump_step_bps
4. Order moves up in mempool ranking

**Automatic:**
1. Auto-bump worker runs every 10s
2. Finds orders with next_bump_at <= NOW()
3. Bumps premium, updates next_bump_at
4. Continues until premium_bps_cap reached

### Merchant Accepts Order
1. Merchant configures quote (min price, liquidity, etc.)
2. Views mineable orders (those meeting their quote)
3. Clicks "Accept Order" in inspector
4. System:
   - Locks order (prevents double-accept)
   - Checks order still mineable
   - Reserves liquidity in merchant_quotes
   - Sets winner_merchant_id
   - Logs ORDER_ACCEPTED event
5. Order proceeds to normal fulfillment flow

## Configuration

### Environment Variables
None required - system uses existing database connection.

### Default Values
- Initial corridor ref price: 3.67 AED/USDT
- Auto-bump interval: 10s
- Refprice update interval: 30s
- Refprice lookback window: 5 minutes
- Default premium cap: 500 bps (5%)
- Default bump step: 10 bps (0.1%)

## Monitoring & Metrics

### Key Metrics (shown in Market Snapshot)
- Reference price and trend
- 5-minute trading volume
- Average fill time
- Number of active merchants

### Order Events (audit log)
All order state changes logged to order_events:
- ORDER_CREATED
- MANUAL_BUMP
- AUTO_BUMP
- ORDER_ACCEPTED
- ORDER_FILLED
- ORDER_EXPIRED

Query events: `GET /api/mempool?type=events&order_id=X`

## Security Considerations

### Race Conditions
- Order acceptance uses optimistic locking (`FOR UPDATE NOWAIT`)
- First merchant to lock order wins
- Losers receive immediate "order being processed" message

### Liquidity Reservation
- Accepting order atomically decreases merchant's available_liquidity_usdt
- Prevents over-selling
- Liquidity returned on order cancel/expire

### Price Manipulation
- Reference price uses trimmed median (removes top/bottom 10%)
- Only uses last 5 minutes of trades (prevents stale data)
- Requires minimum number of trades for update

## Future Enhancements

### Phase 2
- [ ] Multi-corridor support (USDT_AED, USDC_AED, etc.)
- [ ] WebSocket/SSE real-time mempool feed
- [ ] Gas price estimator ("Slow/Medium/Fast" presets)
- [ ] Order prioritization analytics
- [ ] Merchant reputation in mineable order ranking

### Phase 3
- [ ] MEV protection (private mempool for large orders)
- [ ] Batch order acceptance (accept multiple orders at once)
- [ ] Dynamic bump step (increase faster as expiry approaches)
- [ ] Cross-corridor arbitrage detection

## Testing

### Manual Testing Checklist
- [ ] Create order with 0 premium, bump manually, verify price increase
- [ ] Create order with auto-bump, wait for automatic bumps
- [ ] Configure merchant quote, verify mineable orders update
- [ ] Two merchants try to accept same order, verify only one succeeds
- [ ] Order expires, verify removed from mempool
- [ ] Reference price updates, verify Market Snapshot reflects change

### Test Scripts
TODO: Add automated test scripts for:
- Concurrent order acceptance
- Auto-bump worker
- Refprice calculation
- Liquidity reservation

## Deployment

### Database Migration
**Local (SQLite/PostgreSQL with UUID):**
```bash
psql -d your_db -f database/migrations/021_aed_mempool_system.sql
```

**Railway (PostgreSQL with VARCHAR):**
```bash
# Already included in database/railway-migration.sql
# Run full migration script
```

### Start Workers
```bash
# Terminal 1: Auto-bump worker
ts-node src/workers/auto-bump-worker.ts

# Terminal 2: Reference price updater
ts-node src/workers/refprice-updater.ts
```

For production, use PM2 or similar process manager:
```bash
pm2 start src/workers/auto-bump-worker.ts --name mempool-autobump
pm2 start src/workers/refprice-updater.ts --name mempool-refprice
```

### Deploy UI
```bash
# UI components already integrated in main merchant dashboard
# Navigate to /merchant/mempool to access
```

## Support

For issues or questions about the mempool system:
1. Check this documentation
2. Review order_events table for debugging
3. Check worker logs for background job errors
4. Verify merchant_quotes table for acceptance issues

## Changelog

### v1.0.0 (2026-02-12)
- Initial implementation
- ETH-like mempool with priority fees
- Replace-by-fee (manual and auto-bump)
- Merchant quote system
- Reference price from trimmed median
- Atomic order acceptance with optimistic locking
- Console-style UI widgets
- Background workers (auto-bump, refprice)
