# 🚀 START YOUR BOT - 2 COMMANDS!

## ✅ Your bot is configured and ready!

All you need to do is run these 2 commands:

---

## Step 1: Start Backend (if not running)

**Terminal 1:**
```bash
cd /Users/zeus/Documents/Vscode/BM/settle
npm run dev
```

Wait until you see:
```
✓ Ready in 3.2s
○ Local:   http://localhost:3000
```

---

## Step 2: Start Bot

**Terminal 2 (new terminal):**
```bash
cd /Users/zeus/Documents/Vscode/BM/telegram-bot
./start.sh
```

Or manually:
```bash
cd /Users/zeus/Documents/Vscode/BM/telegram-bot
npm install
npm start
```

You should see:
```
🤖 Blip Money Bot Started!
📡 API: http://localhost:3000/api
🧠 AI: Claude 3.5 Haiku
🔧 Mock Mode: true
```

---

## Step 3: Test It!

1. **Open Telegram** (phone or desktop)
2. **Search** for your bot
3. **Start chat**
4. Send: `/start`

You should get:
```
👋 Welcome to Blip Money!

I'm your AI trading assistant powered by Claude.

✅ Account Created
🆔 Merchant ID: abc-123

You can chat with me naturally! Try:
• "What's my balance?"
• "I want to buy 100 USDC"
• "Show my orders"
```

---

## 🎯 Try These Commands

```
You: What's my balance?
Bot: 💰 Your Balance
     Current: 1000 USDC (mock mode)

You: Buy 100 USDC
Bot: Creating buy order for 100 USDC...
     ✅ Order created!

You: Show my orders
Bot: 📊 Your Orders
     ⏳ BUY 100 USDC - Status: pending
```

---

## 🔍 Check Integration

After bot creates an order:

1. **Open Web Dashboard**: http://localhost:3000/merchant
2. **Login** as a different merchant
3. **Check "New Orders"** → You should see the bot's order!
4. **Click "Go"** to accept it
5. **Lock Escrow**
6. **Back in Telegram** → Bot will show order accepted!

---

## ⚠️ Troubleshooting

### "Cannot find module"
```bash
cd telegram-bot
npm install
```

### "ECONNREFUSED localhost:3000"
Backend not running. Start it:
```bash
cd settle
npm run dev
```

### "Invalid bot token"
Check `.env` file has correct token

### Bot not responding in Telegram
- Wait 30 seconds after starting
- Restart the bot (Ctrl+C, then `npm start`)
- Check bot username is correct

---

## 🎉 You're Ready!

Everything is configured. Just run the commands above and start trading! 🚀

**Your credentials are already set:**
✅ Bot Token: Configured
✅ Claude API Key: Configured
✅ Backend URL: http://localhost:3000/api
✅ Mock Mode: Enabled

**Just run:**
```bash
cd telegram-bot
./start.sh
```
