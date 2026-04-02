# BlipScan Database Setup

## Prerequisites

- PostgreSQL 14+ installed
- Database user with CREATE DATABASE privileges

## Setup Instructions

### 1. Create Database

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE blipscan;

# Exit
\q
```

### 2. Run Schema

```bash
# Apply schema
psql blipscan < database/schema.sql

# Or run init cursor separately if needed
psql blipscan < database/init_cursor.sql
```

### 3. Verify Setup

```bash
# Connect to database
psql blipscan

# List tables
\dt

# You should see:
# - trades
# - trade_events
# - merchant_stats
# - indexer_cursor

# Check cursor
SELECT * FROM indexer_cursor;

# Exit
\q
```

## Database Schema

### Tables

- **trades**: Core P2P escrow trades with status tracking
- **trade_events**: Audit log of all state transitions
- **merchant_stats**: Automatic reputation calculation
- **indexer_cursor**: Indexer progress tracking

### Reputation Formula

```
Score = (Completion Rate × 0.6)  [0-60 points]
      + MIN(20, Completed/5)      [0-20 points volume bonus]
      + Speed Bonus               [0-20 points, 1hr=20pts, 24hr=0pts]

Max Score: 100
```

## Maintenance

### Reset Indexer

```sql
UPDATE indexer_cursor
SET last_processed_slot = 0,
    last_processed_signature = NULL
WHERE program_id = 'HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq';
```

### View Recent Trades

```sql
SELECT escrow_address, status, merchant_pubkey, amount, created_at
FROM trades
ORDER BY created_at DESC
LIMIT 10;
```

### Top Merchants

```sql
SELECT merchant_pubkey, reputation_score, total_trades, completion_rate
FROM merchant_stats
ORDER BY reputation_score DESC
LIMIT 10;
```
