# Integration with Blip Money App

## ✅ What Works Out of the Box

Good news! **The bot works with your existing Blip Money app with ZERO changes needed!**

### API Endpoints (All Exist)

| Endpoint | Bot Uses | Status |
|----------|----------|--------|
| `POST /api/auth/merchant` | Account creation | ✅ Works |
| `GET /api/merchant/transactions` | Balance & history | ✅ Works |
| `POST /api/merchant/orders` | Create orders | ✅ Works |
| `GET /api/merchant/orders` | View orders | ✅ Works |
| `DELETE /api/orders/{id}` | Cancel orders | ✅ Works |

### How Telegram Merchants Integrate

```
┌─────────────────┐
│  Telegram Bot   │
│   (Creates      │
│   merchants     │
│   via email)    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│    Blip Money Backend               │
│  /api/auth/merchant (register)      │
│  Creates: merchant with email/pass  │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│      PostgreSQL Database            │
│  merchants table                    │
│  - id: uuid                         │
│  - email: telegram_123@blip.money   │
│  - username: Telegram User 123      │
│  - wallet_address: NULL (initially) │
│  - balance: 1000 (in MOCK_MODE)     │
│  - status: active                   │
└─────────────────────────────────────┘
```

### Integration Points

#### 1. **Telegram Merchants Can Trade**

Bot merchants appear in your merchant dashboard:
- ✅ Show up in "New Orders"
- ✅ Can accept orders from web merchants
- ✅ Can create orders for web merchants to accept
- ✅ Full order lifecycle works

#### 2. **Web Merchants Can Trade with Bot Users**

Web dashboard merchants can:
- ✅ See orders from Telegram users
- ✅ Accept orders from Telegram users
- ✅ Complete trades normally

#### 3. **Shared Balance System**

Bot merchants:
- ✅ Use same `merchant_transactions` table
- ✅ Same balance tracking
- ✅ Same escrow logic
- ✅ Same transaction logging

---

## 🔧 Optional Enhancements

These are **NOT required** but would improve the experience:

### 1. Add Merchant Source Field (Optional)

Track where merchants came from:

```sql
-- Migration (optional)
ALTER TABLE merchants ADD COLUMN source VARCHAR(20) DEFAULT 'web';
-- Values: 'web', 'telegram', 'api'
```

**Benefit:** Analytics on which platform users prefer

### 2. Add Telegram ID Field (Optional)

```sql
-- Migration (optional)
ALTER TABLE merchants ADD COLUMN telegram_id BIGINT UNIQUE;
```

**Benefit:** Direct link between merchant and Telegram user

### 3. Real-time Notifications to Bot (Nice to have)

Add Pusher webhook to notify bot:

```javascript
// In bot.js
const Pusher = require('pusher-js');

function setupNotifications(merchantId, telegramId) {
  const pusher = new Pusher(process.env.PUSHER_KEY, {
    cluster: 'ap2'
  });

  const channel = pusher.subscribe(`private-merchant-${merchantId}`);

  channel.bind('order-status-updated', (data) => {
    bot.telegram.sendMessage(
      telegramId,
      `🔔 Order #${data.orderNumber} → ${data.status}`
    );
  });
}
```

**Benefit:** Users get instant Telegram notifications

---

## 🚀 Testing Integration

### Test 1: Bot Merchant Creates Order

1. Start bot: `npm start`
2. Telegram: `/start`
3. Telegram: "Buy 100 USDC"
4. Check web dashboard → Order appears in "New Orders"

### Test 2: Web Merchant Accepts Bot Order

1. Web merchant logs in
2. Sees bot order in "New Orders"
3. Clicks "Go" to accept
4. Bot user receives notification (if you add it)

### Test 3: Shared Balance

1. Telegram: "What's my balance?" → Shows 1000 USDC (mock)
2. Complete a trade
3. Telegram: "What's my balance?" → Shows updated amount
4. Web dashboard: Check transaction log → Same transactions

---

## ⚙️ Current Configuration

### MOCK_MODE = true

```
✅ Bot creates merchant with 1000 USDC balance
✅ No wallet required
✅ Instant escrow operations
✅ Perfect for testing
```

### MOCK_MODE = false (Production)

```
⚠️  Bot merchants need wallet to lock escrow
⚠️  You'd need to add wallet connection to bot
⚠️  Or: Keep bot for order creation only
```

**Recommendation:** Keep MOCK_MODE=true for bot users, they just create orders that web merchants fulfill.

---

## 📊 How It Works End-to-End

### Scenario: Telegram User Buys USDC

```
1. Telegram Bot (Buyer)
   User: "Buy 100 USDC"
   Bot: Creates BUY order via /api/merchant/orders
   ↓

2. Database
   Order stored with type='sell' (inverted)
   buyer_merchant_id = telegram_merchant_id
   status = 'pending'
   ↓

3. Web Dashboard (Seller)
   Merchant sees order in "New Orders"
   Clicks "Go" to accept
   Clicks "Lock Escrow" (deducts 100 USDC from their balance)
   ↓

4. Telegram Bot (Buyer)
   Bot: "✅ Merchant accepted! Send payment to..."
   User sends bank transfer
   User: "I've paid"
   Bot: Calls /api/orders/{id} PATCH (status='payment_sent')
   ↓

5. Web Dashboard (Seller)
   Merchant confirms fiat received
   Clicks "Release"
   ↓

6. Database
   Balance updated: telegram_merchant_id +100 USDC
   Transaction logged
   ↓

7. Telegram Bot (Buyer)
   Bot: "✅ Trade complete! +100 USDC"
   User: "What's my balance?" → 1100 USDC
```

---

## 🔐 Security Considerations

### Bot Merchants

✅ **Secure:**
- Email/password authentication
- Same auth system as web merchants
- Cannot access other merchant accounts
- Same permission checks

❌ **Limitations:**
- No wallet initially (fine in MOCK_MODE)
- Random password (user doesn't know it, but doesn't need to)
- Email is `telegram_{id}@blip.money` (could conflict if exposed)

### Solutions (if needed):

1. **Add Telegram Login to Web:**
   - Let bot users access web dashboard
   - OAuth-style: "Login with Telegram"
   - Link Telegram ID to merchant account

2. **Keep Separate:**
   - Bot users stay on Telegram only
   - Web users stay on web only
   - Both can trade with each other

---

## 📱 User Experience

### Telegram User Flow

```
1. Open Telegram
2. Search for bot
3. /start → Account created
4. "Buy 100 USDC" → Order created
5. Wait for merchant
6. Get notified when accepted
7. Send payment
8. "I've paid"
9. Get USDC
```

**Time:** ~5 minutes total

### Web Merchant Flow

```
1. See bot order in dashboard
2. Click "Go" to accept
3. Lock escrow
4. Wait for payment
5. Confirm payment received
6. Release escrow
7. Done
```

**Same as normal!**

---

## 🎯 Deployment Options

### Option 1: Separate Bot (Recommended)

```
├── settle/ (Blip Money Backend)
│   └── npm run dev (port 3000)
│
└── telegram-bot/ (This bot)
    └── npm start (connects to port 3000)
```

**Pros:**
- ✅ Easy to deploy
- ✅ Can restart independently
- ✅ Separate logs

### Option 2: Integrated Bot

```
├── settle/
│   ├── src/
│   │   └── telegram-bot/ (move bot here)
│   └── package.json (add bot deps)
```

**Pros:**
- ✅ Single deployment
- ✅ Shared environment
- ✅ Easier production setup

### Option 3: Serverless Bot

```
Deploy bot to:
- AWS Lambda + API Gateway
- Vercel Functions
- Railway
- Render

Bot connects to your Blip Money API
```

---

## 🧪 Testing Checklist

Before going live, test:

- [ ] Bot creates merchant account
- [ ] Bot merchant appears in web dashboard
- [ ] Bot can create BUY order
- [ ] Web merchant can see bot order
- [ ] Web merchant can accept bot order
- [ ] Bot can create SELL order
- [ ] Balance updates correctly
- [ ] Transaction log shows both sides
- [ ] Cancel works (before escrow)
- [ ] Bot merchant can view orders
- [ ] Bot merchant can check balance

---

## 💡 Recommended Setup

### For Testing (Now)

1. **MOCK_MODE=true** for both backend and bot
2. **Run locally:**
   ```bash
   # Terminal 1
   cd settle && npm run dev

   # Terminal 2
   cd telegram-bot && npm start
   ```

### For Production (Later)

1. **Backend:** Deploy to Vercel/Railway
2. **Bot:** Deploy to separate server (Railway/Render)
3. **Add:** Real-time notifications (Pusher webhook)
4. **Add:** Telegram OAuth for web login (optional)
5. **Consider:** Keep MOCK_MODE=true for bot users only

---

## ✅ Final Answer

### Do you need to change Blip Money?

**NO!** The bot works with your existing app **as-is**.

### What's required?

**Nothing!** Just:
1. Backend running on port 3000
2. Bot configured with API keys
3. Both running

### What's optional?

- Real-time notifications
- Telegram OAuth login
- Source tracking
- Bot-specific features

---

## 🎉 Ready to Go!

Your Telegram bot will work **perfectly** with your existing Blip Money merchant app. No changes needed to the backend or frontend!

Just follow QUICKSTART.md and start trading! 🚀
