# Blip Money — Services

All commands run from project root: `/Users/zeus/Documents/Vscode/BM`

## Quick Start (all 6 services)

```bash
# 1. PostgreSQL (if not already running)
brew services start postgresql@14

# 2. Settle (Next.js frontend + API routes)
cd settle && pnpm dev

# 3. Core-API (Fastify backend)
cd apps/core-api && pnpm dev

# 4. Telegram Bot
cd telegram-bot && node bot.js

# 5. Blipscan Web
cd blipscan/web && pnpm dev

# 6. Blipscan Indexer
cd blipscan/indexer && pnpm dev
```

Each service needs its own terminal tab.

## Services

| # | Service | Port | Directory | Start Command |
|---|---------|------|-----------|---------------|
| 1 | PostgreSQL | 5432 | — | `brew services start postgresql@14` |
| 2 | Settle (Next.js) | 3000 | `settle/` | `pnpm dev` |
| 3 | Core-API (Fastify) | 4010 | `apps/core-api/` | `pnpm dev` |
| 4 | Telegram Bot | — | `telegram-bot/` | `node bot.js` |
| 5 | Blipscan Web | 3001 | `blipscan/web/` | `pnpm dev` |
| 6 | Blipscan Indexer | — | `blipscan/indexer/` | `pnpm dev` |

## Check Status

```bash
# Check which services are listening
lsof -i :3000   # Settle
lsof -i :4010   # Core-API
lsof -i :5432   # PostgreSQL
lsof -i :3001   # Blipscan Web
ps aux | grep "bot.js" | grep -v grep           # Telegram Bot
ps aux | grep "blipscan/indexer" | grep -v grep  # Blipscan Indexer
```

## Stop Services

```bash
brew services stop postgresql@14   # PostgreSQL
# Everything else: Ctrl+C in its terminal, or:
kill $(lsof -ti :3000)   # Settle
kill $(lsof -ti :4010)   # Core-API
kill $(lsof -ti :3001)   # Blipscan Web
```

## DB Connection

```
Host: localhost
Port: 5432
Database: settle
User: zeus
Password: (none)
```
