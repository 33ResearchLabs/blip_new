# Balance & Escrow Fixes

## Issue 1: Integer Overflow on Order Creation ✅ FIXED

### Problem
Error: `"Escrow locked but order creation failed: value "1770740284866" is out of range for type integer"`

### Root Cause
- `escrow_trade_id` column in production database was `integer` type (max ~2.1 billion)
- [MockWalletContext.tsx:137](settle/src/context/MockWalletContext.tsx#L137) sets `tradeId: Date.now()`
- `Date.now()` returns timestamp in milliseconds (e.g., 1770740284866)
- This exceeds PostgreSQL `integer` range but fits in `bigint`

### Solution
Created migration [018_fix_escrow_trade_id_bigint.sql](settle/database/migrations/018_fix_escrow_trade_id_bigint.sql)

**To apply:**
```bash
cd settle
node scripts/run-migration.js database/migrations/018_fix_escrow_trade_id_bigint.sql
```

This changes the column from `integer` to `bigint` (safe, no data loss).

---

## Issue 2: Double Balance Update on Completion ✅ FIXED

### Problem
When order is completed, balance was being added to BOTH buyer and seller.

### Root Cause
Two separate balance updates were happening:

1. **Escrow release** ([route.ts:366-369](settle/src/app/api/orders/[id]/escrow/route.ts#L366-L369))
   - Credits buyer ✅ CORRECT

2. **Order completion** ([orders.ts:650-651](settle/src/lib/db/repositories/orders.ts#L650-L651))
   - Also updated merchant balance ✗ WRONG!

### Solution
Removed balance update from order completion logic in [orders.ts:642-658](settle/src/lib/db/repositories/orders.ts#L642-L658).

**Correct Balance Flow:**
- **Escrow lock** (POST /api/orders/[id]/escrow) → Deducts from seller
- **Escrow release** (PATCH /api/orders/[id]/escrow) → Credits buyer
- **Order completion** (updateOrderStatus) → Updates stats ONLY (total_trades, total_volume)

### Example (BUY Order)
**Merchant A wants to buy 100 USDC from Merchant B:**

| Step | Action | Merchant A (Buyer) | Merchant B (Seller) |
|------|--------|-------------------|---------------------|
| 1. Create order | No balance change | 1000 | 5000 |
| 2. Accept order | No balance change | 1000 | 5000 |
| 3. **Lock escrow** | **Deduct from seller** | 1000 | **4900 (-100)** ✅ |
| 4. Mark paid | No balance change | 1000 | 4900 |
| 5. **Release escrow** | **Credit to buyer** | **1100 (+100)** ✅ | 4900 |

**Final:** Merchant A gains 100 USDC, Merchant B loses 100 USDC ✅ Correct!

---

## Files Changed

1. ✅ [settle/database/migrations/018_fix_escrow_trade_id_bigint.sql](settle/database/migrations/018_fix_escrow_trade_id_bigint.sql) - NEW
2. ✅ [settle/src/lib/db/repositories/orders.ts](settle/src/lib/db/repositories/orders.ts#L642-L658) - Removed duplicate balance update
3. ✅ [settle/TRANSACTION_LOGIC.md](settle/TRANSACTION_LOGIC.md) - Updated docs

---

## Next Steps

1. **Run the migration:**
   ```bash
   cd settle
   node scripts/run-migration.js database/migrations/018_fix_escrow_trade_id_bigint.sql
   ```

2. **Test order creation with escrow:**
   - Create a sell order as merchant
   - Lock escrow first
   - Verify no integer overflow error

3. **Test balance flow:**
   - Create and complete a full order
   - Check both buyer and seller balances
   - Verify only one party gains, one party loses (net zero)

---

## Prevention

- Schema already defines `escrow_trade_id BIGINT` in [schema.sql:181](settle/database/schema.sql#L181)
- Production database just needed migration to match schema
- Balance updates now centralized in escrow lock/release only
