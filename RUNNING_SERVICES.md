# 🚀 All Services Running!

## ✅ Services Status

All Blip Money services are now running on localhost:

### 1. **Blip Money Main App**
- **URL**: http://localhost:3000
- **Description**: Main P2P trading app for users
- **Features**:
  - User authentication with wallet signatures
  - P2P crypto-to-cash trading
  - Real-time chat
  - Escrow management
  - Order tracking
  - Bank account management

### 2. **Merchant Dashboard**
- **URL**: http://localhost:3000/merchant
- **Description**: Merchant interface for managing orders
- **Features**:
  - Merchant authentication with wallet
  - Order management
  - Real-time order notifications
  - Chat with users
  - Performance analytics

### 3. **Compliance Portal**
- **URL**: http://localhost:3000/compliance
- **Description**: Dispute resolution and compliance management
- **Features**:
  - Compliance team authentication
  - Dispute management
  - Evidence review
  - Resolution tools

### 4. **BlipScan Explorer**
- **URL**: http://localhost:3001
- **Description**: Blockchain explorer for on-chain escrow transactions
- **Features**:
  - Real-time transaction indexing
  - Trade history and details
  - Merchant profiles and stats
  - Analytics and metrics

---

## 📊 Service Details

### Blip Money App (Port 3000)

**Directory**: `/Users/zeus/Documents/Vscode/BM/settle`

**Log File**: `/tmp/blip-money.log`

**Database**: `blip` (PostgreSQL)

**Routes**:
- `/` - Main user app (home, trading, orders)
- `/merchant` - Merchant dashboard
- `/compliance` - Compliance portal

**APIs**:
- `/api/auth/user` - User wallet authentication
- `/api/auth/merchant` - Merchant wallet authentication
- `/api/auth/compliance` - Compliance team authentication
- `/api/orders` - Order management
- `/api/offers` - Merchant offers
- `/api/chat` - Real-time messaging
- `/api/disputes` - Dispute management

### BlipScan (Port 3001)

**Directory**: `/Users/zeus/Documents/Vscode/BM/blipscan`

**Log Files**:
- Indexer: `/tmp/blipscan-indexer.log`
- Web UI: `/tmp/blipscan-web.log`

**Database**: `blipscan` (PostgreSQL)

**Components**:
- **Indexer**: Monitors Solana blockchain, indexes escrow transactions
- **Web UI**: Next.js app displaying indexed data

---

## 🔧 Management Commands

### Check Service Status

```bash
# Check what's running
lsof -i :3000 -i :3001

# Check logs
tail -f /tmp/blip-money.log
tail -f /tmp/blipscan-indexer.log
tail -f /tmp/blipscan-web.log

# Check databases
psql blip -c "SELECT COUNT(*) FROM users;"
psql blipscan -c "SELECT COUNT(*) FROM trades;"
```

### Stop Services

```bash
# Stop all Next.js processes
pkill -f "next dev"

# Or stop specific ports
lsof -ti:3000 | xargs kill
lsof -ti:3001 | xargs kill
```

### Restart Services

```bash
# Restart Blip Money App
cd /Users/zeus/Documents/Vscode/BM/settle
npm run dev > /tmp/blip-money.log 2>&1 &

# Restart BlipScan Indexer
cd /Users/zeus/Documents/Vscode/BM/blipscan/indexer
npm run dev > /tmp/blipscan-indexer.log 2>&1 &

# Restart BlipScan Web UI
cd /Users/zeus/Documents/Vscode/BM/blipscan/web
npm run dev > /tmp/blipscan-web.log 2>&1 &
```

### Startup Script

Create `/Users/zeus/Documents/Vscode/BM/start-all.sh`:

```bash
#!/bin/bash

echo "🚀 Starting all Blip Money services..."

# Kill existing processes
pkill -f "next dev" 2>/dev/null
sleep 2

# Start BlipScan Indexer
echo "📡 Starting BlipScan Indexer..."
cd /Users/zeus/Documents/Vscode/BM/blipscan/indexer
npm run dev > /tmp/blipscan-indexer.log 2>&1 &
INDEXER_PID=$!

# Start BlipScan Web UI
echo "🌐 Starting BlipScan Web UI..."
cd /Users/zeus/Documents/Vscode/BM/blipscan/web
npm run dev > /tmp/blipscan-web.log 2>&1 &
WEB_PID=$!

# Start Blip Money App
echo "💰 Starting Blip Money App..."
cd /Users/zeus/Documents/Vscode/BM/settle
npm run dev > /tmp/blip-money.log 2>&1 &
APP_PID=$!

sleep 8

echo ""
echo "✅ All services started!"
echo ""
echo "📱 Blip Money App:     http://localhost:3000"
echo "🔍 BlipScan Explorer:  http://localhost:3001"
echo ""
echo "Process IDs:"
echo "  - BlipScan Indexer: $INDEXER_PID"
echo "  - BlipScan Web UI:  $WEB_PID"
echo "  - Blip Money App:   $APP_PID"
echo ""
echo "📋 View logs:"
echo "  tail -f /tmp/blip-money.log"
echo "  tail -f /tmp/blipscan-indexer.log"
echo "  tail -f /tmp/blipscan-web.log"
```

Make it executable:
```bash
chmod +x /Users/zeus/Documents/Vscode/BM/start-all.sh
```

Run it:
```bash
/Users/zeus/Documents/Vscode/BM/start-all.sh
```

---

## 🧪 Testing the Apps

### Test User Authentication

1. **Open**: http://localhost:3000
2. **Click**: "Connect Wallet" button
3. **Select**: Phantom or another Solana wallet
4. **Sign**: Authentication message
5. **Create Username**: If first time, modal will appear
6. **Done**: You're logged in!

### Test Merchant Dashboard

1. **Open**: http://localhost:3000/merchant
2. **Connect Wallet**
3. **Sign Message**
4. **Create Merchant Account**: If new, enter username
5. **Dashboard**: View orders, manage trades

### Test BlipScan

1. **Open**: http://localhost:3001
2. **View**: Real-time trade data
3. **Click**: On any trade for details
4. **Explore**: Merchant profiles, analytics

---

## 🗄️ Database Access

### Blip Money Database

```bash
psql blip

# View users
SELECT id, username, wallet_address FROM users;

# View merchants
SELECT id, username, business_name FROM merchants;

# View orders
SELECT id, status, amount, created_at FROM orders;
```

### BlipScan Database

```bash
psql blipscan

# View indexed trades
SELECT * FROM trades LIMIT 10;

# View merchant stats
SELECT * FROM merchant_stats;

# Check indexer status
SELECT * FROM indexer_cursor;
```

---

## 🔒 Authentication Flow

### User Flow
1. Connect wallet → Sign message
2. First time: Create username (3-20 chars, unique)
3. Returning: Automatically logged in
4. Session stored in localStorage

### Merchant Flow
1. Connect wallet → Sign message
2. New merchant: Create account with username
3. Existing: Login to dashboard
4. Manage orders and trades

---

## 📱 Features Available

### User App
✅ Wallet-based authentication
✅ Username system (unique, immutable)
✅ P2P trading interface
✅ Real-time chat
✅ Order management
✅ Bank account linking
✅ Escrow with Solana smart contracts
✅ Dispute resolution

### Merchant Dashboard
✅ Merchant authentication
✅ Order management
✅ Real-time notifications
✅ Chat with users
✅ Performance tracking

### BlipScan
✅ Real-time blockchain indexing
✅ Trade history
✅ Merchant profiles
✅ Transaction details
✅ Analytics dashboard

---

## 🐛 Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i :3000
lsof -i :3001

# Kill the process
lsof -ti:3000 | xargs kill
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
brew services list | grep postgresql

# Restart PostgreSQL
brew services restart postgresql

# Test connection
psql blip -c "SELECT 1;"
psql blipscan -c "SELECT 1;"
```

### Wallet Signature Fails

- Ensure wallet supports `signMessage` method
- Check that message format is correct
- Verify wallet is connected properly
- Try reconnecting wallet

### Session Not Restoring

```bash
# Clear browser localStorage
# In browser console:
localStorage.clear()

# Then reconnect wallet
```

---

## 🎉 You're All Set!

All services are running and ready to use:

- **Main App**: http://localhost:3000
- **Merchant**: http://localhost:3000/merchant
- **Compliance**: http://localhost:3000/compliance
- **BlipScan**: http://localhost:3001

**Next Steps:**
1. Connect your wallet
2. Create username
3. Start trading!

**Documentation:**
- [WALLET_AUTH_SETUP.md](settle/WALLET_AUTH_SETUP.md) - Auth guide
- [INTEGRATION_GUIDE.md](settle/INTEGRATION_GUIDE.md) - Integration steps
- [SETUP_COMPLETE.md](settle/SETUP_COMPLETE.md) - Setup summary
