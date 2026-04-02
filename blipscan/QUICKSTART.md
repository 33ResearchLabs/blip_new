# BlipScan Quick Start

Get BlipScan running in under 10 minutes.

## Step 1: Database (2 minutes)

```bash
# Create database
psql postgres -c "CREATE DATABASE blipscan;"

# Apply schema
psql blipscan < database/schema.sql

# Verify
psql blipscan -c "\dt"
# Should show: trades, trade_events, merchant_stats, indexer_cursor
```

## Step 2: Indexer (3 minutes)

```bash
cd indexer

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your database credentials and Solana RPC URL
nano .env

# Start
npm run dev
```

Expected output:
```
🚀 BlipScan Indexer Starting...
📡 RPC: https://api.devnet.solana.com
📍 V1 resuming from slot 0
```

## Step 3: Web UI (3 minutes)

```bash
cd ../web

# Install dependencies
npm install

# Configure
cp .env.example .env
# Edit .env with your database credentials
nano .env

# Start
npm run dev
```

Expected output:
```
▲ Next.js 14.2.0
- Local:        http://localhost:3001
```

## Step 4: Open Browser

Visit **http://localhost:3001**

You should see the BlipScan explorer interface!

## Quick Configuration

### Minimal `.env` for Indexer

```env
SOLANA_RPC_URL=https://api.devnet.solana.com
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres
DB_PASSWORD=your_password
```

### Minimal `.env` for Web

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blipscan
DB_USER=postgres
DB_PASSWORD=your_password
```

## Troubleshooting

### Database connection failed
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql
# or on macOS
brew services list | grep postgresql
```

### Port 3001 already in use
```bash
# Change port in web/package.json
"dev": "next dev -p 3002"
```

### No trades showing
- Wait 60 seconds for indexer to poll
- Check if program has transactions on Solana Explorer
- Verify RPC URL is correct in indexer `.env`

## Next Steps

- Read [SETUP.md](SETUP.md) for production deployment
- Read [README.md](README.md) for full documentation
- Read [FEATURES.md](FEATURES.md) for UI design details

## Production Deployment

### Quick Deploy to Vercel (Web UI)

```bash
cd web
npm install -g vercel
vercel --prod
# Follow prompts, add DATABASE_URL env var
```

### Quick Deploy Indexer (Railway)

```bash
cd indexer
# Push to GitHub
# Go to railway.app
# Import from GitHub
# Add environment variables
# Deploy!
```

## Need Help?

- **Database Issues**: See [database/README.md](database/README.md)
- **Full Setup Guide**: See [SETUP.md](SETUP.md)
- **Architecture Details**: See [README.md](README.md)
