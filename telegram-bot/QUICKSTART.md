# Quick Start Guide - 5 Minutes! ⚡

## Step 1: Get Bot Token (2 mins)

1. Open Telegram
2. Search for [@BotFather](https://t.me/botfather)
3. Send: `/newbot`
4. Choose a name: "My Blip Bot"
5. Choose a username: "myblip_bot" (must end with _bot)
6. **Copy the token** (looks like: `7123456789:AAH...`)

## Step 2: Get Claude API Key (2 mins)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up (you get $5 free credits!)
3. Click "Get API Keys"
4. Create a new key
5. **Copy the key** (starts with `sk-ant-...`)

## Step 3: Setup Bot (1 min)

```bash
cd telegram-bot
./setup.sh
```

## Step 4: Configure

Edit `.env`:

```env
BOT_TOKEN=7123456789:AAH...  # Paste your bot token
ANTHROPIC_API_KEY=sk-ant-... # Paste your Claude key
API_BASE=http://localhost:3000/api
MOCK_MODE=true
```

## Step 5: Start!

**Terminal 1** - Start Blip Money Backend:
```bash
cd settle
npm run dev
```

**Terminal 2** - Start Telegram Bot:
```bash
cd telegram-bot
npm start
```

## Step 6: Use It!

1. Open Telegram
2. Search for your bot username
3. Send: `/start`
4. Try chatting: "What's my balance?"
5. Create an order: "I want to buy 100 USDC"

## 🎉 Done!

You now have an AI-powered trading bot!

## Common Issues

### "Error creating account"
- Make sure backend is running on port 3000
- Check API_BASE in .env

### "Bot not responding"
- Check BOT_TOKEN is correct
- Make sure bot is not already running

### "AI not working"
- Check ANTHROPIC_API_KEY is correct
- Make sure you have credits

## Cost

Claude 3.5 Haiku is **super cheap**:
- 1,000 messages ≈ $0.30
- Your $5 free credits = ~16,000 messages!

## What's Next?

- Deploy to production (see README.md)
- Add more features
- Customize the AI prompts
- Add payment notifications

## Support

Questions? Check the full README.md or open an issue!
