# Run Railway Database Migration

## The Issue
Your Railway PostgreSQL is missing columns from migrations 017-019:
- `spread_preference`
- `protocol_fee_percentage`
- `protocol_fee_amount`
- etc.

This causes the error: **"column spread_preference of relation orders does not exist"**

---

## Quick Fix (2 minutes)

### Option 1: Using Railway CLI (Recommended)

```bash
# 1. Login to Railway (if not already)
railway login

# 2. Link to your project (if not already)
railway link

# 3. Run the migration script
cd /Users/zeus/Documents/Vscode/BM/settle
bash scripts/apply-railway-migration.sh
```

### Option 2: Using Node.js Directly

```bash
# 1. Get DATABASE_URL from Railway dashboard
#    Go to: https://railway.app → Your Project → PostgreSQL → Variables
#    Copy the DATABASE_URL value

# 2. Run migration
cd /Users/zeus/Documents/Vscode/BM/settle
DATABASE_URL="postgresql://postgres:..." node scripts/apply-migration-to-railway.js
```

### Option 3: Manual via Railway Dashboard

1. Go to https://railway.app
2. Open your project
3. Click PostgreSQL service
4. Click "Data" tab → "Query" button
5. Copy contents of `settle/database/railway-migration.sql`
6. Paste into query editor
7. Click "Run Query"

---

## What Gets Added

The migration adds these columns to the `orders` table:
- `spread_preference` VARCHAR(20) DEFAULT 'fastest'
- `protocol_fee_percentage` DECIMAL(5,2) DEFAULT 2.50
- `protocol_fee_amount` DECIMAL(20,8)
- `merchant_spread_percentage` DECIMAL(5,2)
- `is_auto_cancelled` BOOLEAN DEFAULT FALSE
- `escrow_trade_id` changed to BIGINT

Plus these new tables:
- `merchant_contacts` (M2M contacts)
- `platform_balance` (fee collection tracking)
- `platform_fee_transactions` (fee transaction log)
- `merchant_transactions` (balance audit log)

---

## Verify Migration Worked

After running, check with:

```bash
railway run psql $DATABASE_URL -c "SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name IN ('spread_preference', 'protocol_fee_percentage');"
```

Should show both columns.

---

## Troubleshooting

**Error: "Unauthorized"**
- Run `railway login` first

**Error: "relation orders does not exist"**
- Wrong database or need to run base schema first
- Check you're connected to the right Railway project

**Error: "column already exists"**
- Migration already ran (safe to ignore)
- Verify columns exist with query above

**Still getting "column does not exist" after migration**
- Railway may need to restart
- Check Railway logs to see if new deployment picked up changes
