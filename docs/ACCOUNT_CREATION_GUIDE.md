# 🎯 How to Create an Account - Blip Money

## Quick Start

**URL**: http://localhost:3000

There are **TWO ways** to create an account:

1. ✅ **Wallet-based (Recommended)** - Sign with your Solana wallet
2. ⚠️ **Demo Mode** - Email/password (old system, being phased out)

---

## Option 1: Create Account with Wallet (Recommended) ✅

### Step-by-Step Guide

#### **Step 1: Open Blip Money**
- Navigate to http://localhost:3000
- You'll see the welcome screen

#### **Step 2: Click "Connect Solana Wallet"**
- Look for the purple/blue button that says "Connect Solana Wallet"
- Click it

#### **Step 3: Select Your Wallet**
- Choose from:
  - **Phantom** (recommended)
  - **Solflare**
  - **Coinbase Wallet**
  - **Backpack**
  - Or any other Solana wallet

#### **Step 4: Approve Connection**
- Your wallet will open
- Click "Connect" to approve
- This links your wallet to Blip Money

#### **Step 5: Sign Authentication Message**
- Your wallet will prompt you to sign a message
- This proves you own the wallet
- Click "Sign" or "Approve"
- **No gas fees** - it's just a signature!

#### **Step 6: Create Your Username** (First Time Only)
- A modal will appear asking for a username
- Enter a unique username (3-20 characters)
- Only letters, numbers, and underscores
- Real-time check if it's available
- **Important**: Username cannot be changed later!

#### **Step 7: Sign to Confirm Username**
- Sign another message to confirm your username
- Again, no gas fees

#### **Step 8: Done!** 🎉
- You're now logged in!
- Your session is saved automatically
- Next time you connect, no username needed

---

## What You Need

### For Wallet Authentication:

1. **Solana Wallet** (one of these):
   - Phantom: https://phantom.app/
   - Solflare: https://solflare.com/
   - Coinbase Wallet: https://www.coinbase.com/wallet
   - Backpack: https://backpack.app/

2. **Devnet SOL** (optional, for testing transactions):
   - Get free devnet SOL: https://faucet.solana.com/
   - Or use: https://solfaucet.com/

---

## Visual Flow

```
┌─────────────────────────────────────┐
│   Welcome to Blip Money             │
│                                     │
│   [Connect Solana Wallet]  ← Click │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   Select Wallet                     │
│   ○ Phantom                         │
│   ○ Solflare                        │
│   ○ Coinbase Wallet                 │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   Phantom (in browser extension)    │
│   Connect to blip.money?            │
│   [Cancel]  [Connect] ← Click       │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   Phantom                           │
│   Sign message to authenticate?     │
│   "Sign this message to..."         │
│   [Cancel]  [Sign] ← Click          │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   Choose Your Username              │
│   [your_username____]               │
│   ✓ Username is available!          │
│   [Continue]                        │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   Sign to confirm username          │
│   [Sign] ← Click                    │
└─────────────────────────────────────┘
                ↓
┌─────────────────────────────────────┐
│   ✅ Welcome!                       │
│   You're logged in as @username     │
└─────────────────────────────────────┘
```

---

## Option 2: Demo Mode (Old System) ⚠️

**Note**: This system is being phased out. Use wallet authentication instead!

### Create Test Account

The old system had test accounts, but they've been cleared. To use wallet auth:
1. Get a Solana wallet (Phantom recommended)
2. Follow Option 1 above

---

## Returning Users

### If You Already Have an Account:

1. **Open** http://localhost:3000
2. **Click** "Connect Solana Wallet"
3. **Select** your wallet
4. **Sign** the message
5. **Done!** No username needed - you're logged in

Your session is automatically restored if:
- You're using the same wallet
- You haven't cleared browser data
- Your session hasn't expired

---

## Merchant Account Creation

### For Merchants Who Want to Accept Orders:

1. **Navigate to**: http://localhost:3000/merchant
2. **Click**: "Connect Wallet"
3. **Sign**: Authentication message
4. **First Time**: You'll be prompted to create a merchant account
5. **Enter**:
   - Username (unique, cannot change)
   - Business name (optional)
6. **Sign** to confirm
7. **Done!** You're now a merchant

---

## Troubleshooting

### "Wallet does not support message signing"

**Solution**: Use a different wallet
- ✅ Phantom - Fully supported
- ✅ Solflare - Fully supported
- ✅ Coinbase Wallet - Fully supported
- ❌ Some wallets don't support `signMessage`

### "Username already taken"

**Solution**: Usernames are globally unique
- Try a different username
- Check if you used this username before
- Usernames are unique across users AND merchants

### "Cannot connect wallet"

**Solution**: Check your setup
1. Make sure wallet extension is installed
2. Unlock your wallet
3. Switch to Devnet (if testing)
4. Refresh the page and try again

### "Sign message failed"

**Solution**:
1. Make sure you clicked "Sign" not "Cancel"
2. Try reconnecting your wallet
3. Check wallet is unlocked
4. Refresh page if needed

### Session not restoring

**Solution**:
1. Check you're using the same wallet address
2. Try clearing localStorage: `localStorage.clear()`
3. Reconnect wallet
4. Sign message again

---

## Username Rules

✅ **Valid Usernames**:
- `alice` - Simple lowercase
- `bob_trader` - With underscore
- `merchant123` - With numbers
- `CryptoKing` - Mixed case (saved as lowercase)

❌ **Invalid Usernames**:
- `ab` - Too short (min 3 chars)
- `this_is_a_very_long_username_test` - Too long (max 20 chars)
- `user@name` - Special characters not allowed
- `user name` - Spaces not allowed
- `alice` - Already taken by someone else

---

## Security Notes

### What We Store:
- ✅ Your wallet address (public)
- ✅ Your username
- ✅ Session data in localStorage

### What We DON'T Store:
- ❌ Your private keys
- ❌ Your seed phrase
- ❌ Passwords (wallet auth has none)

### How Signing Works:
1. You're asked to sign a message
2. This proves you own the wallet
3. No transaction fees
4. No blockchain transaction
5. Just a cryptographic signature
6. Message expires after 5 minutes

---

## Demo Accounts Status

⚠️ **All demo accounts have been removed**

Previous test accounts (alice@test.com, bob@test.com, etc.) are no longer available.

**To test the app:**
1. Create a real account with your Solana wallet
2. Or install Phantom wallet for testing
3. Get devnet SOL from faucet if needed

---

## Next Steps After Account Creation

Once you've created your account:

### As a User:
1. ✅ Browse available merchants
2. ✅ Create buy/sell orders
3. ✅ Chat with merchants
4. ✅ Track your trades
5. ✅ Add bank accounts
6. ✅ View transaction history

### As a Merchant:
1. ✅ Create offers (buy/sell USDC)
2. ✅ Set your rates and margins
3. ✅ Accept orders
4. ✅ Chat with users
5. ✅ Manage your reputation
6. ✅ Track earnings

---

## FAQ

**Q: Do I need to install anything?**
A: Yes, you need a Solana wallet browser extension (Phantom recommended).

**Q: Does it cost money to create an account?**
A: No! Signing messages is free. No gas fees.

**Q: Can I change my username later?**
A: No, usernames are permanent once set. Choose carefully!

**Q: Can I use the same username as a merchant?**
A: No, usernames are globally unique across all users and merchants.

**Q: What if I lose access to my wallet?**
A: Your account is tied to your wallet. If you lose wallet access, you lose account access. Keep your seed phrase safe!

**Q: Can I have multiple accounts?**
A: Yes, one account per wallet address. Use different wallets for different accounts.

**Q: Is my data secure?**
A: Yes! We never see your private keys. Wallet authentication is cryptographically secure.

**Q: What network should I use?**
A: Currently on **Devnet** for testing. Mainnet coming soon.

---

## Support

### Need Help?

1. **Check logs**: Open browser console (F12)
2. **Check wallet**: Make sure it's unlocked
3. **Try again**: Refresh page and reconnect
4. **Different wallet**: Try Phantom if others fail

### Common Issues:

| Issue | Solution |
|-------|----------|
| Wallet won't connect | Unlock wallet, refresh page |
| Can't sign message | Check wallet is open and unlocked |
| Username taken | Try a different one |
| Page won't load | Check http://localhost:3000 is running |
| No wallet option | Install Phantom extension |

---

## Quick Reference

**Main App**: http://localhost:3000
**Merchant**: http://localhost:3000/merchant
**BlipScan**: http://localhost:3001

**Install Phantom**: https://phantom.app/
**Get Devnet SOL**: https://faucet.solana.com/

**Steps**:
1. Connect wallet
2. Sign message
3. Create username (first time)
4. Start trading!

---

That's it! You're ready to start using Blip Money! 🚀
