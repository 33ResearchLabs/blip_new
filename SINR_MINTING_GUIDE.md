# 🪙 Synthetic INR (sINR) Minting Guide

Quick guide to mint sINR tokens for users and merchants.

---

## 🚀 Quick Start

### Step 1: List available accounts

```bash
cd /Users/zeus/Documents/Vscode/BM/settle/scripts
./list-accounts.sh
```

This shows all users and merchants with USDT balance available for conversion.

### Step 2: Mint sINR

**For a User:**
```bash
./mint-sinr.sh user "<user-id>" 10.5
```

**For a Merchant:**
```bash
./mint-sinr.sh merchant "<merchant-id>" 50
```

### Step 3: Verify

Check the database:
```bash
psql -d blip_money -c "SELECT id, username, balance, (sinr_balance/100.0) as sinr_inr FROM users WHERE id='<user-id>';"
```

---

## 📖 Examples

### Mint 10 USDT → sINR for a user

```bash
# Find a user with balance
./list-accounts.sh

# Mint sINR (replace with actual user ID)
./mint-sinr.sh user "abc-123-def-456" 10

# Output:
# ✅ SUCCESS!
# {
#   "conversion_id": "uuid-here",
#   "amount_in_usdt": 10,
#   "amount_out_inr": 920,      # At rate 92
#   "rate": 92,
#   "usdt_balance_after": 90,
#   "sinr_balance_after_inr": 920
# }
```

### Mint 100 USDT → sINR for a merchant

```bash
./mint-sinr.sh merchant "def-456-ghi-789" 100

# Output:
# ✅ SUCCESS!
# {
#   "amount_in_usdt": 100,
#   "amount_out_inr": 9200,     # 100 * 92
#   "usdt_balance_after": 900,
#   "sinr_balance_after_inr": 9200
# }
```

---

## 🔍 Manual API Call

If you prefer calling the API directly:

```bash
# Get your credentials
CORE_API_SECRET=$(grep CORE_API_SECRET /Users/zeus/Documents/Vscode/BM/settle/.env.local | cut -d'=' -f2)

# Mint for a user
curl -X POST http://localhost:4010/v1/convert/usdt-to-sinr \
  -H "Content-Type: application/json" \
  -H "x-core-api-secret: $CORE_API_SECRET" \
  -d '{
    "account_type": "user",
    "account_id": "your-user-uuid",
    "amount": 10000000,
    "idempotency_key": "unique-key-123"
  }'
```

---

## 💾 Database Queries

### Check balances

```sql
-- User balances
SELECT
  id,
  username,
  balance as usdt,
  (sinr_balance/100.0) as sinr_inr
FROM users
WHERE balance > 0;

-- Merchant balances
SELECT
  id,
  business_name,
  balance as usdt,
  (sinr_balance/100.0) as sinr_inr,
  synthetic_rate
FROM merchants
WHERE balance > 0;
```

### View conversion history

```sql
SELECT
  created_at,
  account_type,
  direction,
  (amount_in / 1000000.0) as usdt_in,
  (amount_out / 100.0) as inr_out,
  rate
FROM synthetic_conversions
ORDER BY created_at DESC
LIMIT 10;
```

### Set exposure limits

```sql
-- Limit merchant to max 100,000 INR
UPDATE merchants
SET max_sinr_exposure = 10000000  -- 100,000 INR in paisa
WHERE id = 'merchant-uuid';

-- Remove limit (unlimited)
UPDATE merchants
SET max_sinr_exposure = NULL
WHERE id = 'merchant-uuid';
```

### Change conversion rate

```sql
-- Update merchant's conversion rate
UPDATE merchants
SET synthetic_rate = 93.50
WHERE id = 'merchant-uuid';
```

---

## ⚙️ How It Works

### Conversion Formula

**USDT → sINR:**
```
amount_out_paisa = floor(amount_in_micro_usdt * rate / 100)
```

**Example:**
- Input: 1 USDT (1,000,000 micro-USDT)
- Rate: 92 INR/USDT
- Output: floor(1,000,000 × 92 / 100) = 920,000 paisa (9,200 INR)

**sINR → USDT:**
```
amount_out_micro_usdt = floor(amount_in_paisa * 100 / rate)
```

### Safety Guarantees

1. **Atomic** - All changes in single transaction
2. **Idempotent** - Safe to retry with same key
3. **Floor rounding** - Prevents money creation
4. **Exposure limits** - Caps unbacked minting (default: 90% of USDT)
5. **Audit trail** - All conversions logged

---

## 🐛 Troubleshooting

### Error: "Insufficient balance"
User/merchant doesn't have enough USDT.

```bash
# Check balance
psql -d blip_money -c "SELECT balance FROM users WHERE id='<user-id>';"
```

### Error: "Exposure limit exceeded"
Merchant trying to mint more sINR than allowed.

```sql
-- Check limit
SELECT max_sinr_exposure, sinr_balance, balance
FROM merchants
WHERE id = 'merchant-id';

-- Increase or remove limit
UPDATE merchants SET max_sinr_exposure = NULL WHERE id = 'merchant-id';
```

### Error: "Account not found"
Invalid user/merchant ID.

```bash
# List valid accounts
./list-accounts.sh
```

### Server not running
```bash
# Start core-api
cd /Users/zeus/Documents/Vscode/BM/apps/core-api
pnpm dev
```

---

## 📊 Scripts Reference

| Script | Purpose |
|--------|---------|
| `list-accounts.sh` | Show users/merchants with USDT balance |
| `mint-sinr.sh` | Mint sINR for user or merchant |
| `mint-user-sinr.js` | Node.js script for users only |

---

## 🎯 Common Tasks

### Give a user 100 USDT, then mint sINR

```bash
# 1. Add USDT balance
psql -d blip_money -c "UPDATE users SET balance = balance + 100 WHERE username = 'testuser';"

# 2. Get user ID
USER_ID=$(psql -d blip_money -t -c "SELECT id FROM users WHERE username = 'testuser';")

# 3. Mint sINR
./mint-sinr.sh user "$USER_ID" 50
```

### Bulk mint for multiple users

```bash
# Get all user IDs with balance
psql -d blip_money -t -c "SELECT id FROM users WHERE balance > 10;" | while read user_id; do
  if [ ! -z "$user_id" ]; then
    echo "Minting for user: $user_id"
    ./mint-sinr.sh user "$user_id" 5
    sleep 1
  fi
done
```

---

**That's it! Users can now mint sINR using their USDT balance.** 🚀
