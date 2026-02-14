# Blip Money Telegram Bot 🤖

AI-powered Telegram bot for P2P USDC trading using Claude 3.5 Haiku.

## Features

✅ **Natural Language Interface** - Chat naturally with AI
✅ **Auto Account Creation** - Instant merchant account on /start
✅ **Buy/Sell USDC** - Create orders with simple commands
✅ **Balance Checking** - Real-time USDC balance
✅ **Order Management** - View, track, and cancel orders
✅ **Transaction History** - Complete audit trail
✅ **Claude AI** - Powered by Claude 3.5 Haiku (~$0.25/1M tokens)

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Telegram account
- Anthropic API key
- Blip Money backend running

### 2. Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow instructions to create your bot
4. Copy the bot token

### 3. Get Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account (get $5 free credits)
3. Generate an API key
4. Copy the key

### 4. Install Dependencies

```bash
cd telegram-bot
npm install
```

### 5. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=7123456789:AAH... # Your bot token from BotFather
ANTHROPIC_API_KEY=sk-ant-... # Your Anthropic API key
API_BASE=http://localhost:3000/api # Blip Money API URL
MOCK_MODE=true # Set to false for production
```

### 6. Start the Bot

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### 7. Use the Bot

Open Telegram and search for your bot, then send:
```
/start
```

## Usage Examples

### Natural Language (Recommended)

Just chat naturally:

```
You: Hi, what's my balance?
Bot: 💰 Your current balance is 0 USDC...

You: I want to buy 100 USDC
Bot: I can help you create a buy order for 100 USDC...
     ✅ Order created! #ORD-12345

You: Show me my orders
Bot: 📊 Here are your orders:
     ⏳ BUY 100 USDC - Status: pending

You: Cancel that order
Bot: ✅ Order #ORD-12345 cancelled successfully
```

### Quick Commands

```
/balance - Check USDC balance
/buy - Quick buy USDC
/sell - Quick sell USDC
/orders - View all orders
/history - Transaction history
/help - Show help
```

## AI Features

The bot uses Claude 3.5 Haiku with **function calling** to:

1. **Understand Intent** - Parses natural language requests
2. **Execute Actions** - Calls the right API endpoints
3. **Provide Context** - Explains trades and platform features
4. **Ask Clarifications** - Confirms amounts before executing

### Supported Tools

- `check_balance` - Get current USDC balance
- `create_buy_order` - Create new buy order
- `create_sell_order` - Create new sell order
- `view_orders` - List all orders
- `cancel_order` - Cancel pending orders
- `view_transaction_history` - Recent transactions

## Architecture

```
┌─────────────┐
│   Telegram  │
│    User     │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Telegraf   │
│   (Bot)     │
└──────┬──────┘
       │
       ▼
┌─────────────┐      ┌─────────────┐
│   Claude    │──────│  Function   │
│  3.5 Haiku  │      │   Calling   │
└─────────────┘      └──────┬──────┘
                            │
                            ▼
                     ┌─────────────┐
                     │ Blip Money  │
                     │     API     │
                     └─────────────┘
```

## Cost Estimation

### Claude 3.5 Haiku Pricing
- Input: $0.25 per 1M tokens
- Output: $1.25 per 1M tokens

### Typical Usage (per user/month)
- 100 messages = ~$0.03
- 1,000 messages = ~$0.30
- 10,000 messages = ~$3.00

**Much cheaper than GPT-4!** 💰

## Production Deployment

### 1. Use Process Manager

```bash
npm install -g pm2
pm2 start bot.js --name blip-bot
pm2 save
pm2 startup
```

### 2. Use Redis for Sessions

Replace `Map` with Redis:

```javascript
const Redis = require('ioredis');
const redis = new Redis();

async function getSession(telegramId) {
  const data = await redis.get(`session:${telegramId}`);
  return JSON.parse(data);
}

async function saveSession(telegramId, data) {
  await redis.set(`session:${telegramId}`, JSON.stringify(data));
}
```

### 3. Add Logging

```bash
npm install winston
```

### 4. Set Webhook (for production)

Instead of polling, use webhooks:

```javascript
// Instead of bot.launch()
const domain = 'https://yourdomain.com';
bot.telegram.setWebhook(`${domain}/bot${BOT_TOKEN}`);

// In Express app
app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
```

## Security Best Practices

1. ✅ Never commit `.env` file
2. ✅ Use webhook in production (not polling)
3. ✅ Validate user inputs
4. ✅ Rate limit API calls
5. ✅ Store API keys in environment variables
6. ✅ Use HTTPS for webhooks
7. ✅ Implement user authentication (Telegram ID whitelist if needed)

## Troubleshooting

### Bot not responding
- Check bot token is correct
- Ensure backend is running on correct port
- Check API_BASE URL

### AI responses slow
- Claude Haiku is very fast (~1-2s)
- Check network latency
- Consider using webhooks instead of polling

### Tool execution fails
- Check API endpoints are working
- Verify merchant account was created
- Check logs for errors

## Advanced Features

### Add Real-time Notifications

```javascript
// Listen to Pusher events
const Pusher = require('pusher-js');
const pusher = new Pusher(PUSHER_KEY, { cluster: 'ap2' });

const channel = pusher.subscribe(`private-merchant-${merchantId}`);
channel.bind('order-status-updated', (data) => {
  bot.telegram.sendMessage(telegramId,
    `🔔 Order #${data.orderNumber} updated: ${data.status}`
  );
});
```

### Add Payment Confirmations

```javascript
// Interactive buttons
const keyboard = Markup.inlineKeyboard([
  [
    Markup.button.callback('✅ Confirm', 'confirm_payment'),
    Markup.button.callback('❌ Cancel', 'cancel_payment')
  ]
]);

ctx.reply('Did you receive the payment?', keyboard);
```

## License

MIT

## Support

For issues or questions:
- GitHub Issues
- Telegram: @yourusername
- Email: support@blipmoney.com
