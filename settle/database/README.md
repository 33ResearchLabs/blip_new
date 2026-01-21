# Database Setup

## Prerequisites
- PostgreSQL 14+ installed locally
- psql command line tool

## Quick Setup

### 1. Create the database
```bash
createdb blip
```

### 2. Run the schema
```bash
psql -d blip -f database/schema.sql
```

### 3. Verify setup
```bash
psql -d blip -c "SELECT * FROM merchants;"
```

You should see 3 test merchants (QuickSwap, DesertGold, CashKing).

## Environment Variables

Copy `.env.example` to `.env.local` and update if needed:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blip
DB_USER=postgres
DB_PASSWORD=postgres
```

## Test Data

The schema includes seed data:

**Merchants:**
- QuickSwap - Bank transfer, fast
- DesertGold - Bank transfer, high volume
- CashKing - Cash trades, Dubai Mall

**Users:**
- Demo User with verified KYC

**Offers:**
- 2 bank transfer offers (3.67 and 3.68 AED/USDC)
- 1 cash offer (3.65 AED/USDC, Dubai Mall)

## Reset Database

To reset all data:
```bash
dropdb blip
createdb blip
psql -d blip -f database/schema.sql
```

## Schema Overview

| Table | Description |
|-------|-------------|
| users | App users with wallet addresses |
| merchants | Verified liquidity providers |
| merchant_offers | Buy/sell offers from merchants |
| orders | Trade orders between users and merchants |
| order_events | Audit log of all order changes |
| chat_messages | In-order chat between parties |
| user_bank_accounts | User's saved bank accounts |
| reviews | Post-trade ratings |
| disputes | Dispute handling |
