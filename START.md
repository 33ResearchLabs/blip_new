# Blip Money - Quick Start Guide

This guide shows you how to start all services for local development.

## Prerequisites

Before starting, ensure you have:
- PostgreSQL 14 installed
- Node.js installed
- All dependencies installed (`npm install` in both `settle/` and `telegram-bot/`)

## Services Overview

The Blip Money platform consists of:
1. **PostgreSQL Database** - Stores all application data
2. **Next.js Web App** - Main web interface (settle/)
3. **Telegram Bot** - Telegram interface for trading (telegram-bot/)

---

## Starting Services

### 1. Start PostgreSQL Database

```bash
brew services start postgresql@14
```

**Verify it's running:**
```bash
pg_isready
# Should output: /tmp:5432 - accepting connections
```

**Check database exists:**
```bash
psql -U zeus -l | grep settle
```

---

### 2. Start Next.js Web Application

```bash
cd settle
npm run dev
```

**Access the app:**
- **HTTP:** http://localhost:3000
- **WebSocket:** ws://localhost:3000/ws/chat

**Features available:**
- Merchant dashboard
- Customer interface
- Real-time chat
- Order management
- Mock wallet (NEXT_PUBLIC_MOCK_MODE=true)

**Alternative (HTTPS with SSL certs):**
```bash
npm run dev:https
# Requires localhost+3-key.pem and localhost+3.pem
# Uses wss:// for WebSocket
```

---

### 3. Start Telegram Bot

```bash
cd telegram-bot
node bot.js
```

**Or use npm:**
```bash
npm start
```

**Configuration:**
- Edit `telegram-bot/.env` for bot configuration
- API endpoint: http://localhost:3000/api
- Mock mode: true (default)
- Pusher for real-time updates

**Verify it's running:**
You should see:
```
Blip Money Bot Started!
API: http://localhost:3000/api
Mock Mode: true
```

---

## Quick Start (All Services)

To start everything at once:

```bash
# 1. Start PostgreSQL
brew services start postgresql@14

# 2. Start web app (in one terminal)
cd settle && npm run dev

# 3. Start telegram bot (in another terminal)
cd telegram-bot && node bot.js
```

---

## Stopping Services

### Stop Web App
Press `Ctrl+C` in the terminal running `npm run dev`

### Stop Telegram Bot
Press `Ctrl+C` in the terminal running the bot

### Stop PostgreSQL
```bash
brew services stop postgresql@14
```

---

## Common Issues

### Database Connection Refused (ECONNREFUSED)
**Problem:** PostgreSQL is not running
**Solution:**
```bash
brew services start postgresql@14
```

### Port 3000 Already in Use
**Problem:** Another process is using port 3000
**Solution:**
```bash
# Find the process
lsof -i :3000

# Kill it (replace PID with actual process ID)
kill -9 PID

# Or use a different port
PORT=3001 npm run dev
```

### WebSocket Not Connecting
**Problem:** Wrong protocol (ws:// vs wss://)
**Solution:**
- With `npm run dev` → use `ws://`
- With `npm run dev:https` → use `wss://`
- The app auto-detects based on page protocol

### Telegram Bot Pusher Errors (403 Forbidden)
**Problem:** Pusher auth endpoint not working
**Solution:** This is a known issue - basic bot functionality works, but real-time notifications are limited

---

## Environment Files

### settle/.env.local
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=settle
DB_USER=zeus
NEXT_PUBLIC_MOCK_MODE=true
```

### telegram-bot/.env
```env
BOT_TOKEN=your_bot_token
ANTHROPIC_API_KEY=your_api_key
API_BASE=http://localhost:3000/api
MOCK_MODE=true
```

---

## URLs Reference

| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| WebSocket | ws://localhost:3000/ws/chat |
| Merchant Dashboard | http://localhost:3000/merchant |
| Customer View | http://localhost:3000 |
| API | http://localhost:3000/api |
| Blipscan | http://localhost:3003 (if running) |

---

## Development Mode Features

- **Hot Reload:** Code changes auto-reload
- **Mock Mode:** Fake wallets and USDT (no real blockchain)
- **Fast Refresh:** React components update without page reload
- **WebSocket:** Real-time chat and order updates
- **Database Logging:** SQL queries logged in dev mode

---

## Production Mode

To run in production mode (not recommended for local dev):

```bash
cd settle
npm run build
npm start
```

This uses HTTP (not HTTPS) and expects SSL termination from a proxy like Railway/Vercel.

---

## Need Help?

- Check server logs in the terminal running `npm run dev`
- Check database: `psql -U zeus settle`
- View running processes: `ps aux | grep node`
- Check ports: `lsof -i :3000`

---

**Last Updated:** 2026-02-12
