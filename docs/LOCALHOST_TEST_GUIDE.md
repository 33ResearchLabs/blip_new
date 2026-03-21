# 🚀 Localhost Testing Guide - All Fixes Applied

All fixes have been pushed to GitHub. Pull and test locally.

## 📥 Pull Latest Changes

```bash
cd /Users/zeus/Documents/Vscode/BM
git pull origin main
```

**Latest commits:**
- `403ad5f` - Mock mode balance auto-initialization
- `b7e7b50` - MOCK_MODE constant fix
- `7068e3b` - Username retry logic

---

## 🔧 Setup & Start

### 1. Install Dependencies (if needed)
```bash
cd settle
npm install
```

### 2. Check Environment
```bash
cat .env.local | grep MOCK
# Should show: NEXT_PUBLIC_MOCK_MODE=true
```

### 3. Start Dev Server
```bash
npm run dev
# Server starts at http://localhost:3000
```

### 4. Initialize Balances (One-Time)
Open a new terminal:
```bash
curl -X POST http://localhost:3000/api/setup/init-balances
```

**Expected output:**
```json
{
  "success": true,
  "message": "Initialized X users and Y merchants with 10000 USDT",
  "data": {
    "usersUpdated": X,
    "merchantsUpdated": Y,
    "totalUsers": ...,
    "totalMerchants": ...,
    "totalUserBalance": ...,
    "totalMerchantBalance": ...
  }
}
```

---

## ✅ Test Flows

### Test 1: User Creates Buy Order
**URL:** http://localhost:3000

1. **Login as User**
   - If no user exists, connect wallet or use existing user ID from localStorage

2. **Check Balance Display**
   - Top of screen should show balance (10,000 USDT)
   - Open browser console: `localStorage.getItem('blip_user')`

3. **Create Buy Order**
   - Select "Buy" tab
   - Enter amount: 100
   - Click "Continue"
   - ✅ Should create order immediately (no balance check needed for buy)

4. **Check Browser Console**
   ```
   [API] Order created successfully
   ```

5. **Verify in Orders Tab**
   - Click "Activity" tab
   - Should see new order with status "pending"

---

### Test 2: Merchant Creates & Locks Order
**URL:** http://localhost:3000/merchant

1. **Login as Merchant**
   - Use merchant credentials or create new merchant

2. **Check Balance**
   - Should show 10,000 USDT at top

3. **Create Sell Offer (if not exists)**
   - Click "Corridors" → "Create Corridor"
   - Type: Sell, Amount: 1000, Rate: 3.67

4. **Create Order**
   - Go back to Orders tab
   - Click "Create Trade"
   - Enter amount: 100
   - Click "Create"
   - ✅ Should succeed (with better error if it fails)

5. **Check Console**
   ```javascript
   // Should see placeholder user created
   [Merchant] Created placeholder user: open_order_1707568463000_a3f8k9

   // Should see order created
   [Merchant] Order created successfully
   ```

6. **Lock Escrow**
   - Click "Lock Escrow" on the order
   - ✅ Should lock successfully
   - Balance: 10,000 → 9,900

---

### Test 3: User Sells (Locks Escrow)
**URL:** http://localhost:3000

1. **Login as User** (with 10,000 balance)

2. **Create Sell Order**
   - Select "Sell" tab
   - Enter amount: 50
   - Click "Continue"

3. **Balance Check Screen**
   - Should show: "Balance: 10,000 USDT" (green)
   - Should show: "Amount to Lock: 50 USDT"

4. **Lock Escrow**
   - Click "Lock Escrow"
   - ✅ Should succeed
   - Balance: 10,000 → 9,950

5. **Check Order Status**
   - Go to "Activity" tab
   - Order status should be "Escrowed"

---

## 🐛 Debug Issues

### Issue: "Insufficient balance"
**Check:**
```bash
# Get user/merchant ID from localStorage
# Then check their balance:
curl "http://localhost:3000/api/mock/balance?userId=USER_ID&type=user"
```

**Expected:**
```json
{"success": true, "balance": 10000}
```

**If balance is 0:**
```bash
# Re-run init-balances
curl -X POST http://localhost:3000/api/setup/init-balances
```

---

### Issue: "Failed to create order"
**Check Browser Console:**
- Should now show actual error instead of "Internal server error"
- Examples:
  - `"Error: duplicate key value violates unique constraint"`
  - `"Error: Merchant not found"`
  - `"Error: No matching offer found"`

**Check Server Logs:**
```bash
# In terminal where npm run dev is running
# Look for:
[API] Error creating merchant order: {
  name: 'Error',
  message: 'actual error here',
  ...
}
```

**Common Fixes:**
1. **Merchant not found:** Make sure merchant exists in DB
2. **No matching offer:** Create a corridor first
3. **Username conflict:** Fixed with retry logic (should auto-retry)

---

### Issue: Balance not loading (shows "...")
**Wait 5 seconds** - MockWalletContext polls every 5s

**Force refresh:**
```javascript
// In browser console
window.location.reload()
```

**Check if mock mode enabled:**
```javascript
// In browser console
console.log('Mock mode:', localStorage.getItem('NEXT_PUBLIC_MOCK_MODE'))
```

---

## 📊 Verify Database State

### Check Balances
```bash
# If you have psql access:
psql $DATABASE_URL -c "
  SELECT 'Users' as type, COUNT(*), SUM(balance) as total FROM users
  UNION ALL
  SELECT 'Merchants', COUNT(*), SUM(balance) FROM merchants;
"
```

### Check Recent Orders
```bash
psql $DATABASE_URL -c "
  SELECT id, order_number, status, crypto_amount, type, created_at
  FROM orders
  ORDER BY created_at DESC
  LIMIT 10;
"
```

### Check Placeholder Users
```bash
psql $DATABASE_URL -c "
  SELECT id, username, name, balance, created_at
  FROM users
  WHERE username LIKE 'open_order_%' OR username LIKE 'm2m_%'
  ORDER BY created_at DESC
  LIMIT 5;
"
```

---

## 🎯 What Should Work Now

| Flow | Status | Notes |
|------|--------|-------|
| User buy order | ✅ | No balance check, instant |
| User sell order | ✅ | Balance check + refresh logic |
| Merchant create order | ✅ | Unique username with retry |
| Merchant lock escrow | ✅ | Balance check + refresh |
| M2M trading | ✅ | Same fixes apply |
| Balance auto-init | ✅ | All 0 balances → 10,000 |
| Error messages | ✅ | Shows actual errors now |

---

## 🔥 Quick Commands Summary

```bash
# Pull latest
git pull origin main

# Start server
cd settle && npm run dev

# Init balances (one-time)
curl -X POST http://localhost:3000/api/setup/init-balances

# Check balance
curl "http://localhost:3000/api/mock/balance?userId=YOUR_ID&type=user"

# Tail dev logs
tail -f .next/trace  # or check terminal where dev is running
```

---

## ✅ Success Indicators

**1. Balance Display:**
- Shows "10,000" instead of "..." or "0"
- Updates after transactions

**2. Order Creation:**
- No "Internal server error"
- Clear error messages if something fails
- Orders appear in Activity/Orders tab

**3. Escrow Lock:**
- Balance decreases correctly
- Order status changes to "Escrowed"
- No "Insufficient balance" if you have funds

**4. Console Output:**
- `[Mock Balance] Auto-initialized user/merchant balance to 10000`
- `[Merchant] Created placeholder user for merchant order`
- No red errors unless expected validation errors

---

## 📱 For Your Presentation

### Before Demo:
1. `git pull origin main`
2. `npm run dev`
3. `curl -X POST http://localhost:3000/api/setup/init-balances`
4. Open http://localhost:3000 in browser
5. ✅ Ready to demo!

### During Demo:
- All flows work smoothly
- Balances show correctly
- No mysterious errors
- Professional experience 🎉

---

**Status:** ✅ ALL FIXES PUSHED TO MAIN
**Last Updated:** ${new Date().toISOString()}
**Ready for Testing:** YES 🚀
