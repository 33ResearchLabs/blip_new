# 🇦🇪 Synthetic AED (sAED) Setup Guide

Complete setup guide for the Synthetic AED balance system.

---

## 🚀 Quick Setup

### Step 1: Run the Migration

```bash
cd /Users/zeus/Documents/Vscode/BM/settle
psql -d blip_money -f database/migrations/028_synthetic_inr_system.sql
```

**Expected output:**
```
ALTER TABLE
ALTER TABLE
CREATE TABLE
CREATE INDEX
...
DO
```

### Step 2: Verify Migration

```sql
-- Check merchants table has new columns
\d merchants

-- Should show:
-- sinr_balance           | bigint (stores fils, 100 fils = 1 AED)
-- max_sinr_exposure      | bigint (max fils allowed)
-- synthetic_rate         | numeric(10,4) (default: 3.6700)

-- Check default rate
SELECT synthetic_rate FROM merchants LIMIT 1;
-- Should show: 3.6700
```

### Step 3: Restart Next.js Server

```bash
# Kill existing server
lsof -ti :3000 | xargs kill -9

# Start fresh
cd /Users/zeus/Documents/Vscode/BM/settle
pnpm dev
```

### Step 4: Hard Refresh Browser

Open `http://localhost:3000/merchant` and press **Cmd+Shift+R**

You should see a **purple panel** titled "Synthetic AED" with:
- USDT Balance
- sAED Balance
- Rate: 1 USDT = AED3.67
- Two conversion buttons

---

## 💰 Understanding the System

### Currency Units

**USDT:**
- Stored in DECIMAL(20,6)
- Smallest unit: micro-USDT (1 USDT = 1,000,000 micro-USDT)

**sAED (Synthetic AED):**
- Stored as BIGINT (fils)
- Smallest unit: fils (100 fils = 1 AED)
- Example: 367 fils = 3.67 AED

### Conversion Rate

**Default:** 1 USDT = 3.67 AED (current market rate)

The rate is configurable per merchant:
```sql
-- Update a merchant's rate
UPDATE merchants
SET synthetic_rate = 3.68
WHERE id = 'merchant-uuid';
```

### Conversion Formula

**USDT → sAED:**
```javascript
fils_out = floor(micro_usdt_in * rate / 100)

Example:
Input:  1 USDT (1,000,000 micro-USDT)
Rate:   3.67
Output: floor(1,000,000 * 3.67 / 100) = 36,700 fils (367 AED)
```

**sAED → USDT:**
```javascript
micro_usdt_out = floor(fils_in * 100 / rate)

Example:
Input:  367 AED (36,700 fils)
Rate:   3.67
Output: floor(36,700 * 100 / 3.67) = 1,000,000 micro-USDT (1 USDT)
```

---

## 🧪 Testing

### Test 1: List Accounts with Balance

```bash
cd /Users/zeus/Documents/Vscode/BM/settle/scripts
./list-accounts.sh
```

### Test 2: Mint sAED for a Merchant

```bash
# Get merchant ID from list-accounts output
MERCHANT_ID="your-merchant-uuid"

# Mint 100 USDT → sAED
./mint-sinr.sh merchant "$MERCHANT_ID" 100
```

**Expected output:**
```json
{
  "conversion_id": "uuid-here",
  "amount_in_usdt": 100,
  "amount_out_inr": 367,        # 100 * 3.67 = 367 AED
  "rate": 3.67,
  "usdt_balance_after": 900,
  "sinr_balance_after_inr": 367
}
```

### Test 3: Verify in Database

```sql
SELECT
  id,
  business_name,
  balance as usdt,
  (sinr_balance / 100.0) as saed,
  synthetic_rate
FROM merchants
WHERE id = 'your-merchant-uuid';
```

### Test 4: Check Conversion History

```sql
SELECT
  created_at,
  direction,
  (amount_in / 1000000.0) as usdt_in,
  (amount_out / 100.0) as aed_out,
  rate
FROM synthetic_conversions
ORDER BY created_at DESC
LIMIT 5;
```

---

## 🎨 UI Components

### Synthetic AED Panel Location

Found in merchant dashboard (`/merchant`), left sidebar:

```
┌─ Left Sidebar ───────────┐
│ 💵 USDT Balance Card     │
│ 💱 Synthetic AED Panel   │  ← NEW! (Purple)
│ 📝 Create Order Panel    │
└──────────────────────────┘
```

### Panel Features

1. **Balance Display**
   - Shows USDT and sAED balances
   - Real-time updates every 30 seconds

2. **Conversion Rate**
   - Displays: "1 USDT = AED3.67"

3. **Conversion Buttons**
   - "USDT → sAED" - Convert USDT to synthetic AED
   - "sAED → USDT" - Convert back to USDT

4. **Conversion Modal**
   - Input amount field
   - Preview: "You will receive AED..."
   - Success/error notifications

---

## 🔧 Configuration

### Set Exposure Limits

Limit how much sAED a merchant can mint:

```sql
-- Limit to max 10,000 AED (1,000,000 fils)
UPDATE merchants
SET max_sinr_exposure = 1000000
WHERE id = 'merchant-uuid';

-- Unlimited (default)
UPDATE merchants
SET max_sinr_exposure = NULL
WHERE id = 'merchant-uuid';
```

**Default behavior:** If `max_sinr_exposure` is NULL, the system uses:
```
max_saed = usdt_balance * rate * 100 * 0.9
```

### Update Conversion Rate

```sql
-- Update to new AED rate
UPDATE merchants
SET synthetic_rate = 3.68
WHERE id = 'merchant-uuid';

-- Or for all merchants
UPDATE merchants
SET synthetic_rate = 3.68;
```

---

## 📊 Database Schema

### Key Tables

**merchants:**
```sql
- sinr_balance BIGINT           -- sAED in fils
- max_sinr_exposure BIGINT      -- Max fils allowed (NULL = unlimited)
- synthetic_rate DECIMAL(10,4)  -- 1 USDT = X AED (default: 3.6700)
```

**users:**
```sql
- sinr_balance BIGINT           -- sAED in fils
```

**synthetic_conversions:**
```sql
- id UUID                       -- Conversion ID
- account_type VARCHAR          -- 'merchant' or 'user'
- account_id UUID               -- Merchant/user ID
- direction VARCHAR             -- 'usdt_to_sinr' or 'sinr_to_usdt'
- amount_in BIGINT              -- Input (micro-USDT or fils)
- amount_out BIGINT             -- Output (fils or micro-USDT)
- rate DECIMAL(10,4)            -- Rate used
- idempotency_key VARCHAR       -- For safe retries
- created_at TIMESTAMP          -- When converted
```

---

## 🐛 Troubleshooting

### UI Doesn't Show sAED Panel

1. **Check MOCK_MODE:**
   ```bash
   grep NEXT_PUBLIC_MOCK_MODE /Users/zeus/Documents/Vscode/BM/settle/.env.local
   # Should be: NEXT_PUBLIC_MOCK_MODE=true
   ```

2. **Restart Next.js:**
   ```bash
   lsof -ti :3000 | xargs kill -9
   cd /Users/zeus/Documents/Vscode/BM/settle
   pnpm dev
   ```

3. **Hard Refresh Browser:**
   Press `Cmd+Shift+R` in browser

4. **Check Browser Console:**
   Open DevTools (F12) → Console tab
   Look for errors

### Migration Already Run

If you see "column already exists":
```sql
-- Check current values
SELECT synthetic_rate FROM merchants LIMIT 1;

-- Update to AED rate if still showing INR rate (92)
UPDATE merchants SET synthetic_rate = 3.67 WHERE synthetic_rate = 92;
```

### Balance Showing Wrong Values

```sql
-- View raw data
SELECT
  balance as usdt_raw,
  sinr_balance as fils_raw,
  (sinr_balance / 100.0) as aed_display
FROM merchants
WHERE id = 'your-uuid';
```

---

## 🎯 Quick Reference

| Action | Command |
|--------|---------|
| List accounts | `./scripts/list-accounts.sh` |
| Mint for merchant | `./scripts/mint-sinr.sh merchant <id> <amount>` |
| Mint for user | `./scripts/mint-sinr.sh user <id> <amount>` |
| Check balances | `SELECT * FROM merchants WHERE balance > 0;` |
| View conversions | `SELECT * FROM synthetic_conversions;` |
| Update rate | `UPDATE merchants SET synthetic_rate = 3.67;` |

---

## 🌟 Examples

### Scenario 1: Merchant Mints 100 USDT → sAED

```bash
./scripts/mint-sinr.sh merchant "abc-123" 100

# Result:
# - USDT balance: 1000 → 900
# - sAED balance: 0 → 367 AED (36,700 fils)
```

### Scenario 2: User Converts Back sAED → USDT

```bash
./scripts/mint-sinr.sh user "def-456" 183.5

# Using API directly for reverse:
curl -X POST http://localhost:4010/v1/convert/sinr-to-usdt \
  -H "x-core-api-secret: $SECRET" \
  -d '{
    "account_type": "user",
    "account_id": "def-456",
    "amount": 18350
  }'

# Result:
# - sAED balance: 367 → 183.5 AED
# - USDT balance: 900 → 950 USDT
```

---

**Everything is ready! The system uses AED (United Arab Emirates Dirham) as the synthetic currency.** 🇦🇪
