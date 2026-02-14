# Order Debug Panel - Usage Guide

## Overview

The Order Debug Panel is a **DEV-ONLY, READ-ONLY** tool for debugging orders in development and staging environments. It provides comprehensive visibility into order state, transitions, and diagnostics.

## Security Features

- ✅ **Production-Blocked**: Automatically returns 404 in production (NODE_ENV === 'production')
- ✅ **Key-Protected**: Requires `DEV_DEBUG_KEY` environment variable to access
- ✅ **Read-Only**: No mutations possible - all endpoints are GET only
- ✅ **404 on Denial**: Returns 404 (not 401/403) to avoid revealing endpoint existence

## Setup

### 1. Configure Debug Key

Add to your `.env.local`:

```bash
# Generate a secure key
DEV_DEBUG_KEY=$(openssl rand -hex 32)

# Or set manually
DEV_DEBUG_KEY=your_secret_debug_key_here
```

### 2. Ensure Non-Production Environment

```bash
NODE_ENV=development  # or 'staging', just NOT 'production'
```

## Access URLs

### Search & List View
```
http://localhost:3002/dev/orders?debug_key=YOUR_DEBUG_KEY
```

### Order Detail View
```
http://localhost:3002/dev/orders/[ORDER_ID]?debug_key=YOUR_DEBUG_KEY
```

## Features

### Search & List View (`/dev/orders`)

Filter orders by:
- **Order ID** (partial match)
- **Corridor** (fiat currency like AED, USD)
- **Raw Status** (12-state DB status)
- **Minimal Status** (8-state API status)
- **User ID** (partial match)
- **Merchant ID** (partial match)
- **Buyer Merchant ID** (for M2M orders)

Results show:
- Order ID (clickable to detail view)
- Order number
- Raw status (12-state)
- Minimal status (8-state)
- Type/Corridor
- Amount
- Created timestamp
- Participant IDs

### Order Detail View (`/dev/orders/[orderId]`)

#### A) Order Summary
- Order number
- Raw status (DB 12-state) + minimal status (API 8-state)
- Micro-status warning if applicable
- Order type (BUY/SELL)
- Corridor and amounts
- Rate and fees
- Timestamps (created, accepted, expires, completed, cancelled)
- **Timer remaining** (calculated from expires_at)

#### B) Participants
- User ID
- Merchant ID
- Buyer Merchant ID (M2M trades)
- Offer ID
- Wallet addresses (buyer, acceptor)

#### C) Escrow / Mock Balances
- Escrow transaction hash
- Escrow address, PDAs, trade ID
- Escrow creator wallet
- Release transaction hash
- Refund transaction hash
- Mock mode indicator

#### D) Order Events (Last 30)
- Timestamp
- Event type
- State transition (from → to)
- Actor type and ID
- Metadata payload

#### E) Diagnostics
- ✓/✗ Has micro-status (transient state)
- ✓/✗ Terminal is final (no transitions after completion)
- ✓/✗ Has required timestamps
- ✓/✗ Escrow transaction exists (MOCK_MODE)
- Extension count and status
- Manual message flag
- Compliance assignment

#### Payment Details
- Full payment_details JSON (if present)

## Examples

### Search for all pending orders in AED corridor
```
http://localhost:3002/dev/orders?debug_key=YOUR_KEY&raw_status=pending&corridor=AED
```

### Find orders for a specific merchant
```
http://localhost:3002/dev/orders?debug_key=YOUR_KEY&merchant_id=abc123
```

### Debug a specific order
```
http://localhost:3002/dev/orders/550e8400-e29b-41d4-a716-446655440000?debug_key=YOUR_KEY
```

## Production Safety

The panel is **completely inaccessible** in production due to:

1. Environment check: `process.env.NODE_ENV !== 'production'`
2. No production deployment of debug routes
3. 404 response (not revealing endpoint exists)
4. No fallback or bypass mechanism

## Troubleshooting

### Getting 404
- ✓ Verify `NODE_ENV` is NOT 'production'
- ✓ Check `DEV_DEBUG_KEY` is set in `.env.local`
- ✓ Ensure `?debug_key=YOUR_KEY` matches env variable
- ✓ Try using header: `x-debug-key: YOUR_KEY` instead

### No orders showing
- ✓ Check database has orders
- ✓ Try clearing all filters
- ✓ Verify search criteria matches actual data

### Diagnostics showing warnings
- ⚠ **Micro-status present**: Order uses transient state (escrow_pending, payment_pending, etc.)
- ⚠ **Terminal not final**: Order has transitions after completion/cancellation (data issue)

## Files Changed

```
settle/src/lib/debugAuth.ts                        # Auth helper
settle/src/app/dev/orders/page.tsx                 # Search & list view
settle/src/app/dev/orders/[orderId]/page.tsx       # Detail view
settle/.env.example                                 # Added DEV_DEBUG_KEY
```

## API Routes Used

The debug panel uses **existing API infrastructure** (read-only):
- Database queries via `query()` and `queryOne()`
- No new backend endpoints required
- Direct database reads for orders and order_events tables

## Notes

- Maximum 50 results per search
- Last 30 events shown per order
- All timestamps in local timezone
- Status normalization uses `statusNormalizer` utility
- Timer calculations are real-time
