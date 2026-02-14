#!/bin/bash

# =====================================================
# Truncate All Database Data
# =====================================================
# WARNING: This will delete ALL data from the database
# The schema structure will remain intact
# =====================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}⚠️  WARNING: DATABASE TRUNCATION${NC}"
echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "This will permanently delete ALL data from your database:"
echo "  • All users"
echo "  • All merchants"
echo "  • All orders"
echo "  • All chat messages"
echo "  • All transactions"
echo "  • All reviews and disputes"
echo "  • All bank accounts"
echo "  • Everything else"
echo ""
echo -e "${YELLOW}The database schema will remain intact.${NC}"
echo -e "${RED}This operation CANNOT be undone!${NC}"
echo ""

# Load environment variables from .env.local
if [ -f .env.local ]; then
  source .env.local
else
  echo -e "${RED}Error: .env.local not found${NC}"
  exit 1
fi

# Construct DATABASE_URL from individual variables
if [ -z "$DATABASE_URL" ]; then
  DB_PASSWORD_PART=""
  if [ -n "$DB_PASSWORD" ]; then
    DB_PASSWORD_PART=":${DB_PASSWORD}"
  fi

  export DATABASE_URL="postgresql://${DB_USER}${DB_PASSWORD_PART}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

echo "Database: ${DB_NAME} @ ${DB_HOST}:${DB_PORT}"
echo ""

# Ask for confirmation
read -p "Type 'DELETE EVERYTHING' to confirm: " confirmation

if [ "$confirmation" != "DELETE EVERYTHING" ]; then
  echo -e "${YELLOW}Aborted. No changes were made.${NC}"
  exit 0
fi

echo ""
echo -e "${YELLOW}Connecting to database...${NC}"

# Test database connection
if ! psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
  echo -e "${RED}Error: Cannot connect to database${NC}"
  echo "Please check your database configuration in .env.local"
  exit 1
fi

echo -e "${GREEN}✓ Connected${NC}"
echo ""

# Execute truncation
echo -e "${YELLOW}Truncating all tables...${NC}"

psql "$DATABASE_URL" -f database/truncate_all.sql

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Database truncated successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Your database is now empty and ready for fresh data."
echo ""
