# Settle App - Testing Guide

## ✅ Current Status

**Server:** ✅ Running on http://localhost:3000
**TypeScript:** ✅ Compiles without errors
**Production Hardening:** ✅ Added (verification, idempotency, retry)

---

## 🧪 Testing Checklist

### 1. Basic App Loading ✅ (DONE)
- [x] Server starts without crashing
- [x] App loads in browser
- [x] No critical console errors

### 2. Wallet Connection (DO NOW)

#### Expected Behavior:
- ⚠️ You WILL see "Unexpected error" for some wallet adapters - **THIS IS NORMAL**
- ✅ These errors are caught and handled gracefully
- ✅ You can still connect with Phantom or other installed wallets

#### How to Test:
1. Open http://localhost:3000
2. Look for "Connect Wallet" button
3. Click it
4. **Ignore errors for wallets you don't have installed**
5. Select Phantom (if you have it installed)
6. Approve connection in Phantom popup

#### What to Check:
```
✅ Wallet button appears
✅ Modal opens when clicked
✅ Can see list of wallets
✅ Errors are shown but don't crash app
✅ Can close modal and try again
```

#### Console Logs to Look For:
```javascript
// Good signs:
[SolanaWallet] Module loaded
[SolanaWallet] Creating AnchorProvider
✅ Program created successfully

// Expected errors (IGNORE THESE):
[WalletConnect] Connection error: WalletConnectionError
// ^ This just means that specific adapter failed - totally normal!
```

---

### 3. Successful Wallet Connection

#### Once Connected:
```
✅ Wallet address displayed in UI
✅ SOL balance shown
✅ USDT balance shown (or 0 if no USDT)
✅ Console shows: [SolanaWallet] State changed: { connected: true }
```

#### What You Should See:
```javascript
[SolanaWallet] State changed: {
  connected: true,
  publicKey: "ABC123...",
  walletName: "Phantom",
  hasSignTransaction: true,
  hasAnchorWallet: true
}
```

---

### 4. Escrow Operations Testing

#### Prerequisites:
- ✅ Wallet connected
- ✅ Have some SOL for gas (~0.01 SOL)
- ✅ Have some USDT (devnet test tokens)

#### Test Release Escrow:

**Scenario:** Merchant releases funds to buyer

```typescript
// This now includes:
// 1. Verification (checks on-chain state)
// 2. Idempotency (prevents duplicates)
// 3. Retry (handles network issues)

await releaseEscrow({
  creatorPubkey: "...",
  tradeId: 123,
  counterparty: "..."
});
```

**Expected Console Output:**
```
[releaseEscrow] Starting with params: {...}
[releaseEscrow] Verifying on-chain state...
[Verification] Checking if trade can be released...
[Verification] Trade account fetched: {...}
[Verification] Escrow account verified: {...}
[Verification] ✅ All checks passed - can release
[releaseEscrow] ✅ Verification passed
[releaseEscrow] Building transaction...
[releaseEscrow] Signing transaction...
[releaseEscrow] Sending transaction...
[releaseEscrow] Confirming transaction: <signature>
[releaseEscrow] ✅ Transaction confirmed: <signature>
```

**What Could Go Wrong:**
```javascript
// If trade doesn't exist:
❌ Verification failed: Trade account not found

// If already released:
❌ Verification failed: Trade status is "released", must be "locked"

// If not authorized:
❌ Verification failed: Only the creator can release

// Network issues (auto-retries):
⚠️ Send failed (attempt 1), retrying in 1000ms...
⚠️ Send failed (attempt 2), retrying in 2000ms...
✅ Transaction confirmed (on attempt 3)
```

---

### 5. Idempotency Testing

**Test:** Click release button twice rapidly

**Expected:**
```
First click:
[releaseEscrow] Starting...
[releaseEscrow] ✅ Transaction confirmed: ABC123

Second click (within 5 minutes):
[releaseEscrow] Starting...
[Idempotency] Returning cached result for: release_escrow_...
[releaseEscrow] ⚡ Using cached transaction (idempotency): ABC123
```

**Result:** ✅ Same transaction signature, NO duplicate transaction sent!

---

### 6. Verification Testing

**Test:** Try to release a trade that's already released

**Expected:**
```
[releaseEscrow] Starting...
[releaseEscrow] Verifying on-chain state...
[Verification] Checking if trade can be released...
[Verification] Trade account fetched: { status: { released: {} } }
❌ Verification failed: Trade status is "released", must be "locked"

ERROR THROWN (no TX sent!)
```

**Result:** ✅ Error caught BEFORE wasting gas on invalid transaction!

---

## 🐛 Troubleshooting

### Issue: "WalletConnectionError: Unexpected error"

**Status:** ⚠️ Expected and handled

**Explanation:**
- This happens for wallet adapters you don't have installed
- Example: If you don't have Solflare, you'll see this error for Solflare
- It's caught by the error handler and doesn't break the app

**Fix:**
- ✅ Ignore it - try connecting with a different wallet
- ✅ Install the wallet extension if you want to use it

---

### Issue: "Cannot read properties of undefined"

**Status:** ✅ Fixed

**What was wrong:** PDA destructuring issue
**Fixed in:** verification.ts (lines 95, 190)

---

### Issue: Wallet connects but balance doesn't show

**Possible causes:**
1. RPC endpoint is slow (devnet can be slow)
2. Token account doesn't exist yet (shows 0 USDT - normal)

**Check console for:**
```
[SolanaWallet] Fetching balances...
SOL: 0.5
USDT: 0
```

---

### Issue: Transaction fails with "blockhash not found"

**Status:** ⚠️ Common on devnet

**What happens:**
```
❌ Transaction failed: Blockhash not found

THEN (automatic retry):
⚠️ Retry attempt 1 after 1000ms
⚠️ Retry attempt 2 after 2000ms
✅ Success on attempt 3!
```

**Fix:** ✅ Already handled by retry logic!

---

## 📊 Success Criteria

### Minimum Viable:
- [x] App loads
- [ ] Wallet connects (Phantom/Solflare)
- [ ] Can see wallet address
- [ ] Can see balances

### Full Testing:
- [ ] Create trade works
- [ ] Lock escrow works
- [ ] Release escrow works (with verification)
- [ ] Refund escrow works (with verification)
- [ ] Idempotency prevents duplicates
- [ ] Retry handles network failures
- [ ] Verification catches invalid operations

---

## 🎯 What to Test First

### 1. Right Now (5 minutes):
- [ ] Open http://localhost:3000
- [ ] Check console for critical errors
- [ ] Try connecting wallet
- [ ] Verify you see wallet address after connecting

### 2. Next (10 minutes):
- [ ] Check balance display
- [ ] Navigate around the app
- [ ] Check all pages load

### 3. When Ready (30 minutes):
- [ ] Test creating a trade
- [ ] Test locking funds in escrow
- [ ] Test release operation
- [ ] Test refund operation

---

## 💬 What to Report

### If Something Works:
✅ "Wallet connected successfully! Address: ABC123..."
✅ "Release escrow worked - signature: XYZ789"

### If Something Breaks:
❌ Include the full error from console
❌ Include what you were trying to do
❌ Include any relevant wallet/trade info

**Example:**
```
❌ Error when trying to release escrow

What I did:
1. Connected Phantom wallet
2. Clicked "Release Order #123"
3. Approved transaction in wallet
4. Got error

Console output:
[releaseEscrow] Starting...
❌ Error: Verification failed: Trade status is "created", must be "locked"
```

---

## 🚀 Ready to Test!

**Current status:**
- ✅ Server running
- ✅ Code compiles
- ✅ Production hardening added
- ⚠️ Wallet connection error is NORMAL

**Next step:**
Connect your wallet and let me know what happens! 🎉

---

## 📝 Quick Reference

### Wallet Errors (Expected)
```javascript
// IGNORE THESE - they're normal:
WalletConnectionError: Unexpected error
WalletNotReadyError
WalletDisconnectedError
User rejected the request
```

### Success Logs (Look for these)
```javascript
✅ Program created successfully
✅ Verification passed
✅ Transaction confirmed
⚡ Using cached transaction
```

### Failure Logs (Need investigation)
```javascript
❌ Verification failed: <reason>
❌ TypeError: Cannot read...
❌ ReferenceError: ... is not defined
```

