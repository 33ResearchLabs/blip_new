# Testing BUY Order Flow (Merchant-to-Merchant)

## Prerequisites
- Two merchant accounts (Merchant A and Merchant B)
- Both merchants have active BUY corridors created
- Testing in MOCK_MODE for easy escrow simulation

## Full Flow Test

### Step 1: Merchant A Creates BUY Order

**As Merchant A:**
1. Open merchant dashboard
2. Click "Open Trade"
3. Select "BUY" (Merchant A wants to buy USDC)
4. Enter amount: 100 USDC
5. Select payment method: bank
6. Click "Open Trade"

**Expected Result:**
- ✅ Order created with status `pending`
- ✅ Order appears in Merchant A's "My Orders" (pending)
- ✅ Order appears in ALL OTHER merchants' "New Orders" section

**API Call:**
```
POST /api/merchant/orders
{
  "merchant_id": "merchant-a-id",
  "type": "buy",
  "crypto_amount": 100,
  "payment_method": "bank"
}
```

---

### Step 2: Merchant B Sees the Order

**As Merchant B:**
1. Open merchant dashboard
2. Look at "New Orders" section
3. Should see Merchant A's BUY order

**Expected Display:**
```
🔵 BUY 100 USDC
   @ 3.67 AED/USDC
   Payment: Bank Transfer
   [Accept] button
```

---

### Step 3: Merchant B Accepts the Order

**As Merchant B:**
1. Click on Merchant A's order in "New Orders"
2. Click "Accept" or "Go"

**Expected Result:**
- ✅ Status changes from `pending` → `accepted`
- ✅ Merchant B becomes the "acceptor" of the order
- ✅ Order moves from "New Orders" to "Active Orders" for Merchant B

**API Call:**
```
PATCH /api/orders/{order_id}
{
  "status": "accepted",
  "actor_type": "merchant",
  "actor_id": "merchant-b-id"
}
```

---

### Step 4: Merchant B Locks USDC in Escrow

**As Merchant B:**
1. UI should prompt: "Lock 100 USDC to escrow"
2. Connect Solana wallet
3. Click "Lock Escrow"
4. Confirm transaction

**Expected Result:**
- ✅ USDC locked on-chain (or balance deducted in mock mode)
- ✅ Status changes from `accepted` → `escrowed`
- ✅ TX hash and escrow details saved to DB
- ✅ Escrow PDA created (trade_id, trade_pda, escrow_pda)

**API Call:**
```
POST /api/orders/{order_id}/escrow
{
  "tx_hash": "transaction_hash_from_solana",
  "actor_type": "merchant",
  "actor_id": "merchant-b-id",
  "escrow_trade_id": 123,
  "escrow_trade_pda": "pda_address",
  "escrow_pda": "escrow_address",
  "escrow_creator_wallet": "merchant_b_wallet"
}
```

**In MOCK_MODE:**
- Merchant B's balance is deducted by 100 USDC
- No actual blockchain transaction

---

### Step 5: Merchant A Sends Fiat Payment

**As Merchant A (the buyer):**
1. See bank details of Merchant B
2. Send fiat payment to Merchant B's bank account
3. Click "Mark as Paid"

**Expected Result:**
- ✅ Status changes to `payment_sent`
- ✅ Notification sent to Merchant B

**API Call:**
```
PATCH /api/orders/{order_id}
{
  "status": "payment_sent",
  "actor_type": "merchant",
  "actor_id": "merchant-a-id"
}
```

---

### Step 6: Merchant B Confirms Fiat Received

**As Merchant B:**
1. Verify fiat payment received in bank
2. Click "Confirm Received"

**Expected Result:**
- ✅ Status changes to `payment_confirmed`
- ✅ Escrow release is triggered
- ✅ USDC sent to Merchant A

**API Call:**
```
PATCH /api/orders/{order_id}
{
  "status": "payment_confirmed",
  "actor_type": "merchant",
  "actor_id": "merchant-b-id"
}
```

---

### Step 7: Escrow Released (Automatic or Manual)

**Expected Result:**
- ✅ Status changes to `releasing` → `completed`
- ✅ USDC released from escrow to Merchant A's wallet
- ✅ Both merchants see "Completed" status

**In MOCK_MODE:**
- Merchant A's balance increases by 100 USDC
- No actual blockchain transaction

---

## Current Status Transitions

```
pending
  ↓ (Merchant B accepts)
accepted
  ↓ (Merchant B locks escrow)
escrowed
  ↓ (Merchant A marks payment sent)
payment_sent
  ↓ (Merchant B confirms received)
payment_confirmed
  ↓ (System releases escrow)
releasing
  ↓
completed
```

---

## Troubleshooting

### Issue: "No lock and release on buy order"

**Problem:** You created a BUY order as Merchant A, but don't see any escrow lock/release flow.

**Reason:**
- The order is sitting in `pending` status
- No other merchant has accepted it yet
- You need Merchant B to accept the order first

**Solution:**
1. Create a second merchant account (Merchant B)
2. Log in as Merchant B
3. Look for Merchant A's order in "New Orders"
4. Accept it and lock escrow

### Issue: "Can't see the order in New Orders"

**Problem:** Merchant B doesn't see Merchant A's BUY order.

**Check:**
1. Verify the order was created successfully
2. Check if API call uses `include_all_pending=true`
3. Look at browser console for Pusher notifications
4. Refresh the merchant dashboard

**API Debug:**
```bash
# Check if order exists
curl http://localhost:3000/api/merchant/orders?merchant_id=merchant-b-id&include_all_pending=true
```

### Issue: "Order stuck in 'pending'"

**Problem:** Order stays in pending status.

**Reason:** No merchant has accepted it yet.

**Solution:** Have Merchant B accept the order.

---

## Quick Test Script

Run this to see all pending orders:

```bash
cd settle
node scripts/diagnose-order-creation.js <merchant_id> buy bank
```

Or check orders directly:

```bash
# Check all pending orders for a merchant
curl "http://localhost:3000/api/merchant/orders?merchant_id=<merchant_id>&include_all_pending=true"
```

---

## Summary

**For BUY orders (merchant wants to buy USDC):**
1. Creating merchant (A) creates order → `pending`
2. Accepting merchant (B) accepts order → `accepted`
3. **Accepting merchant (B) locks USDC** → `escrowed` ⚠️ **This is the key step!**
4. Creating merchant (A) sends fiat → `payment_sent`
5. Accepting merchant (B) confirms → `payment_confirmed`
6. System releases USDC to merchant A → `completed`

**The person who locks escrow = The person selling USDC = The accepting merchant**
