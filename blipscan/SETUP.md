# BlipScan Setup Guide

Complete step-by-step setup instructions for BlipScan.

## Prerequisites

- **Node.js**: v18+ (check with `node --version`)
- **PostgreSQL**: v14+ (check with `psql --version`)
- **Solana CLI**: Optional, for program verification
- **Git**: For cloning and version control

## Part 1: Database Setup

### 1.1 Install PostgreSQL

**macOS:**
```bash
brew install postgresql@14
brew services start postgresql@14
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**Windows:**
Download from https://www.postgresql.org/download/windows/

### 1.2 Create Database and User

```bash
# Connect as postgres user
sudo -u postgres psql

# Or on macOS
psql postgres
```

In the PostgreSQL console:
```sql
-- Create database
CREATE DATABASE blipscan;

-- Create user (optional, for security)
CREATE USER blipscan_user WITH PASSWORD 'your_secure_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE blipscan TO blipscan_user;

-- Exit
\q
```

### 1.3 Apply Schema

```bash
# Navigate to project
cd /path/to/blipscan

# Apply schema
psql blipscan < database/schema.sql

# Or if using custom user
psql -U blipscan_user -d blipscan < database/schema.sql
```

### 1.4 Verify Database

```bash
# Connect to database
psql blipscan

# List tables
\dt

# Expected output:
#  Schema |      Name       | Type  |  Owner
# --------+-----------------+-------+----------
#  public | indexer_cursor  | table | postgres
#  public | merchant_stats  | table | postgres
#  public | trade_events    | table | postgres
#  public | trades          | table | postgres

# Check indexer cursor
SELECT * FROM indexer_cursor;

# Exit
\q
```

## Part 2: Indexer Setup

### 2.1 Navigate to Indexer

```bash
cd indexer
```

### 2.2 Install Dependencies

```bash
npm install
```

This will install:
- `@solana/web3.js` - Solana blockchain interaction
- `@coral-xyz/anchor` - Program account parsing
- `pg` - PostgreSQL client
- `dotenv` - Environment variables
- TypeScript and dev tools

### 2.3 Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit with your settings
nano .env  # or use your preferred editor
```

**`.env` file contents:**
```env
# Solana RPC - Choose based on your needs
# Devnet (free, for testing)
SOLANA_RPC_URL=https://api.devnet.solana.com

# Mainnet (free, rate limited)
# SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Mainnet with paid RPC (recommended for production)
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY
# SOLANA_RPC_URL=https://your-endpoint.quiknode.pro/YOUR_KEY/

# PostgreSQL Connection
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres           # or blipscan_user if created
DB_PASSWORD=your_password  # your actual password

# Or use DATABASE_URL (Supabase, Railway, etc.)
# DATABASE_URL=postgresql://user:password@host:port/database
```

### 2.4 Build and Test

```bash
# Build TypeScript
npm run build

# Test connection (development mode)
npm run dev
```

Expected output:
```
🚀 BlipScan Indexer Starting...
📡 RPC: https://api.devnet.solana.com
🔗 V1 Program: HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq
🔗 V2 Program: 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87
📍 V1 resuming from slot 0
📍 V2 resuming from slot 0
📥 [v1] Found 3 new transactions
  📝 CREATE_ESCROW - a1b2c3d4...
```

If you see this, the indexer is working!

### 2.5 Run in Production

```bash
# Build
npm run build

# Start
npm start

# Or use PM2 for auto-restart
npm install -g pm2
pm2 start npm --name "blipscan-indexer" -- start
pm2 save
pm2 startup  # Follow instructions for auto-start on boot
```

## Part 3: Web UI Setup

### 3.1 Navigate to Web

```bash
cd ../web  # from indexer directory
```

### 3.2 Install Dependencies

```bash
npm install
```

This will install:
- `next` - React framework
- `react` & `react-dom` - UI library
- `tailwindcss` - Styling
- `lucide-react` - Icons
- `pg` - PostgreSQL client
- TypeScript and dev tools

### 3.3 Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit with your settings
nano .env
```

**`.env` file contents:**
```env
# PostgreSQL Connection (same as indexer)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres
DB_PASSWORD=your_password

# Or use DATABASE_URL
# DATABASE_URL=postgresql://user:password@host:port/database
```

### 3.4 Run Development Server

```bash
npm run dev
```

Expected output:
```
▲ Next.js 14.2.0
- Local:        http://localhost:3001
- Ready in 2.3s
```

Open http://localhost:3001 in your browser!

### 3.5 Build for Production

```bash
# Build static files
npm run build

# Start production server
npm start

# Or deploy to Vercel
npm install -g vercel
vercel --prod
```

## Part 4: Verification

### 4.1 Check Indexer Progress

```bash
# In a new terminal
psql blipscan -c "SELECT COUNT(*) FROM trades;"
psql blipscan -c "SELECT COUNT(*) FROM trade_events;"
psql blipscan -c "SELECT * FROM indexer_cursor;"
```

### 4.2 View Recent Trades

```bash
psql blipscan -c "SELECT escrow_address, status, amount, created_at FROM trades ORDER BY created_at DESC LIMIT 5;"
```

### 4.3 Test API Endpoints

```bash
# Get all trades
curl http://localhost:3001/api/trades

# Get stats
curl http://localhost:3001/api/stats

# Get specific trade
curl http://localhost:3001/api/trades/YOUR_ESCROW_ADDRESS
```

## Part 5: Production Deployment

### 5.1 Database (Supabase - Free)

1. Create account at https://supabase.com
2. Create new project
3. Go to Database > SQL Editor
4. Paste contents of `database/schema.sql`
5. Run query
6. Copy connection string from Settings > Database
7. Update `.env` with:
   ```env
   DATABASE_URL=postgresql://postgres.[PROJECT]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
   ```

### 5.2 Indexer (Railway - Free Tier)

1. Create account at https://railway.app
2. New Project > Deploy from GitHub
3. Select your repo
4. Add environment variables from `.env`
5. Set start command: `npm start`
6. Deploy!

Or use a VPS:
```bash
# On Ubuntu server
sudo apt update
sudo apt install nodejs npm postgresql-client

# Clone repo
git clone https://github.com/yourusername/blipscan.git
cd blipscan/indexer

# Install dependencies
npm install

# Setup .env
nano .env

# Build
npm run build

# Install PM2
sudo npm install -g pm2

# Start indexer
pm2 start npm --name "blipscan-indexer" -- start

# Auto-start on boot
pm2 startup
pm2 save
```

### 5.3 Web UI (Vercel - Free)

1. Create account at https://vercel.com
2. Import Git Repository
3. Set root directory to `web/`
4. Add environment variables
5. Deploy!

Or manual:
```bash
cd web
npm install -g vercel
vercel --prod
```

## Part 6: Monitoring & Maintenance

### 6.1 Monitor Indexer

```bash
# With PM2
pm2 logs blipscan-indexer
pm2 status
pm2 monit

# Check last indexed slot
psql blipscan -c "SELECT program_id, last_processed_slot, last_indexed_at FROM indexer_cursor;"
```

### 6.2 Monitor Database

```bash
# Database size
psql blipscan -c "SELECT pg_size_pretty(pg_database_size('blipscan'));"

# Table sizes
psql blipscan -c "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC;"

# Active connections
psql blipscan -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'blipscan';"
```

### 6.3 Backup Database

```bash
# Create backup
pg_dump blipscan > blipscan_backup_$(date +%Y%m%d).sql

# Restore from backup
psql blipscan < blipscan_backup_20240120.sql
```

### 6.4 Reset Indexer (Re-index from scratch)

```bash
# Stop indexer
pm2 stop blipscan-indexer

# Reset cursor
psql blipscan -c "UPDATE indexer_cursor SET last_processed_slot = 0, last_processed_signature = NULL;"

# Clear data (optional)
psql blipscan -c "TRUNCATE trades, trade_events, merchant_stats CASCADE;"

# Restart indexer
pm2 start blipscan-indexer
```

## Troubleshooting

### PostgreSQL Connection Failed

**Error:** `ECONNREFUSED ::1:5432`

**Solution:**
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Start if not running
sudo systemctl start postgresql

# Check if listening on correct port
sudo netstat -plnt | grep 5432
```

### Indexer Not Finding Transactions

**Error:** No transactions found

**Solution:**
1. Check program ID is correct
2. Verify RPC endpoint works: `curl https://api.devnet.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`
3. Check if program has transactions on Solana Explorer
4. Increase poll interval or check rate limits

### Web UI 500 Error

**Error:** Internal Server Error

**Solution:**
1. Check database connection in `.env`
2. Verify database has schema: `psql blipscan -c "\dt"`
3. Check Next.js logs: `npm run dev` (development mode)
4. Verify PostgreSQL is accepting connections

### RPC Rate Limits

**Error:** 429 Too Many Requests

**Solution:**
1. Increase `POLL_INTERVAL` in `indexer/src/index.ts` (default 60000ms)
2. Use paid RPC provider (Helius, QuickNode, Alchemy)
3. Implement exponential backoff

## Next Steps

- [ ] Set up monitoring (Sentry, LogRocket)
- [ ] Configure custom domain
- [ ] Enable HTTPS (Let's Encrypt)
- [ ] Set up alerts for indexer downtime
- [ ] Implement caching (Redis)
- [ ] Add analytics (Plausible, Google Analytics)

## Support

- GitHub Issues: https://github.com/yourusername/blipscan/issues
- Documentation: See README.md
- Blip Money: https://blipmoney.com

Happy exploring! 🚀
