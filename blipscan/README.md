# BlipScan - Solana P2P Escrow Explorer

A minimal, production-ready blockchain explorer for Blip Money's P2P escrow protocol on Solana.

## What It Does

BlipScan indexes all escrow transactions from your Solana program and provides:

- **Trade Detail Pages**: See every escrow with full timeline, parties, amounts, and status
- **Merchant Profiles**: View merchant stats, reputation scores, and trade history
- **Latest Trades Feed**: Browse recent P2P trades with filters
- **Merchant Reputation**: Automatic scoring based on completion rate, speed, and volume

## Architecture

```
┌─────────────────┐
│  Solana Program │  (Your existing escrow)
│  HZ9ZSXteb...   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Indexer      │  (Reads logs, parses accounts)
│  TypeScript +   │
│    PostgreSQL   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Next.js UI    │  (Explorer web interface)
│   blipscan.app  │
└─────────────────┘
```

## Quick Start

### 1. Setup PostgreSQL

```bash
# Install PostgreSQL
brew install postgresql  # macOS
# or
sudo apt install postgresql  # Linux

# Create database
psql postgres
CREATE DATABASE blipscan;
\q

# Run schema
psql blipscan < database/schema.sql
```

### 2. Setup Indexer

```bash
cd indexer

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials and Solana RPC URL

# Build
npm run build

# Start indexer
npm start

# Or run in development mode
npm run dev
```

### 3. Setup Web UI

```bash
cd web

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Start development server
npm run dev

# Visit http://localhost:3001
```

### 4. Verify Indexer is Running

```bash
# Check PostgreSQL
psql blipscan -c "SELECT COUNT(*) FROM trades;"

# You should see trades being indexed in the console:
# 📥 Found 5 new transactions
#   📝 CREATE_ESCROW - a1b2c3d4...
#     ✅ Trade created: 100000000 tokens
```

## Database Schema

### Tables

- **trades**: Core P2P trades with full lifecycle tracking
- **trade_events**: Audit log of all state transitions
- **merchant_stats**: Automatically calculated reputation metrics
- **indexer_cursor**: Tracks indexing progress

### Merchant Reputation Formula

```
Score = (Completion Rate × 0.6)  [0-60 points]
      + MIN(20, Completed/5)      [0-20 points volume bonus]
      + Speed Bonus               [0-20 points, 1hr=20pts, 24hr=0pts]

Max Score: 100
```

## Configuration

### Environment Variables

#### Indexer

```env
# Solana RPC
SOLANA_RPC_URL=https://api.devnet.solana.com

# For production, use a paid RPC:
# SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres
DB_PASSWORD=your_secure_password
```

#### Web UI

```env
# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres
DB_PASSWORD=your_secure_password
```

### Indexer Performance

- **Poll Interval**: 60 seconds (configurable in `indexer/src/index.ts`)
- **Batch Size**: 50 transactions per poll
- **Memory Usage**: ~50MB typical

## API Endpoints (Next.js)

```
GET /api/trades                    # List all trades
GET /api/trades/:escrow            # Get trade by escrow address
GET /api/merchant/:pubkey          # Get merchant stats
GET /api/merchant/:pubkey/trades   # Get merchant trade history
GET /api/events/:escrow            # Get trade events timeline
GET /api/stats                     # Get global statistics
GET /api/lane-operations           # Get lane operations (V2)
```

## UI Pages

1. **/** - Latest trades feed with filters
2. **/trade/[escrow]** - Trade detail with full timeline
3. **/merchant/[pubkey]** - Merchant profile with stats

## UI Features

BlipScan UI matches the Blip Money design system with:

- ✅ Apple-style minimal design with subtle glassmorphism
- ✅ Green primary color theme (`#22C55E`)
- ✅ Proper number formatting (`1,000.00` format)
- ✅ Monospace fonts for addresses and technical data
- ✅ Small inline copy buttons like Etherscan
- ✅ Status badges with color coding
- ✅ Responsive grid layouts
- ✅ Timeline view for trade events
- ✅ Merchant reputation scoring with visual indicators

## Security Considerations

### Implemented

✅ **Read-only indexer**: No write access to blockchain
✅ **SQL injection protection**: Parameterized queries
✅ **Input validation**: All public keys validated
✅ **Rate limiting**: Built into RPC providers

### Recommended for Production

- [ ] Add API rate limiting (use `express-rate-limit`)
- [ ] Add caching layer (Redis)
- [ ] Add monitoring (Sentry, DataDog)
- [ ] Deploy indexer with PM2 or systemd for auto-restart

## Deployment

### Indexer (VPS)

```bash
# On Ubuntu server
sudo npm install -g pm2

# Start indexer
cd /home/blipscan/indexer
pm2 start npm --name "blipscan-indexer" -- start

# Auto-start on boot
pm2 startup
pm2 save
```

### Database (Managed PostgreSQL)

Recommended providers:
- **Digital Ocean**: $15/mo managed PostgreSQL
- **Supabase**: Free tier available
- **Railway**: Easy setup with auto-backups

### Web UI (Vercel)

```bash
cd web
vercel --prod
```

## Monitoring

### Check Indexer Health

```bash
# View logs
pm2 logs blipscan-indexer

# Check status
pm2 status

# View metrics
pm2 monit
```

### Database Queries

```sql
-- Recent trades
SELECT * FROM trades ORDER BY created_at DESC LIMIT 10;

-- Top merchants by volume
SELECT merchant_pubkey, total_volume, reputation_score
FROM merchant_stats
ORDER BY total_volume DESC
LIMIT 10;

-- Trades in last 24 hours
SELECT COUNT(*) FROM trades
WHERE created_at > NOW() - INTERVAL '24 hours';

-- Average completion time
SELECT AVG(EXTRACT(EPOCH FROM (released_at - locked_at)) / 60) as avg_minutes
FROM trades
WHERE status = 'released';
```

## Troubleshooting

### Indexer not finding transactions

```bash
# Check if program has any transactions
solana program show HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq --url devnet

# Reset indexer cursor (will re-index all)
psql blipscan -c "UPDATE indexer_cursor SET last_processed_slot = 0, last_processed_signature = NULL;"
```

### PostgreSQL connection issues

```bash
# Test connection
psql "postgresql://user:password@localhost:5432/blipscan"

# Check PostgreSQL is running
sudo systemctl status postgresql
```

### RPC rate limits

If you hit rate limits, use a paid RPC provider:
- **Helius**: 100 req/s on free tier
- **QuickNode**: Reliable with generous free tier
- **Alchemy**: Best for mainnet

## Tech Stack

- **Indexer**: TypeScript, @solana/web3.js, @coral-xyz/anchor, PostgreSQL
- **Web**: Next.js 14 (App Router), React 18, Tailwind CSS, Lucide Icons
- **Database**: PostgreSQL 14+ with triggers and functions

## Project Structure

```
blipscan/
├── database/
│   ├── schema.sql           # PostgreSQL schema
│   ├── init_cursor.sql      # Initialize indexer cursor
│   └── README.md            # Database setup guide
├── indexer/
│   ├── src/
│   │   └── index.ts         # Main indexer service (920 lines)
│   ├── blip_escrow_idl.json # V1 Program IDL
│   ├── blip_protocol_v2_idl.json # V2 Program IDL
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── web/
│   ├── app/
│   │   ├── page.tsx         # Main dashboard
│   │   ├── layout.tsx       # Root layout
│   │   ├── globals.css      # Global styles
│   │   ├── lib/
│   │   │   └── db.ts        # Database pool singleton
│   │   ├── api/             # API routes
│   │   ├── trade/[escrow]/  # Trade detail page
│   │   └── merchant/[pubkey]/ # Merchant profile
│   ├── package.json
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   └── .env.example
└── README.md
```

## Development Roadmap

- [x] Basic indexer with trade tracking
- [x] PostgreSQL schema with reputation
- [x] Merchant stats calculation
- [x] Next.js UI with full explorer
- [x] Trade detail pages with timeline
- [x] Merchant profile pages with stats
- [x] V2 protocol support with lanes
- [ ] Real-time WebSocket updates
- [ ] CSV export functionality
- [ ] Advanced analytics dashboard
- [ ] Multi-chain support (Ethereum L2s)

## License

MIT
