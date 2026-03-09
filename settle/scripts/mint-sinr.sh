#!/bin/bash

###############################################################################
# Mint sINR - Convert USDT to Synthetic INR
#
# Usage: ./mint-sinr.sh <user|merchant> <account-id> <usdt-amount>
# Example: ./mint-sinr.sh user "abc-123" 50.5
# Example: ./mint-sinr.sh merchant "def-456" 100
###############################################################################

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CORE_API_URL="${CORE_API_URL:-http://localhost:4010}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env.local"

# Load environment
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep CORE_API_SECRET | xargs)
fi

if [ -z "$CORE_API_SECRET" ]; then
  echo -e "${RED}❌ Error: CORE_API_SECRET not found${NC}"
  echo "   Set it in .env.local or export it:"
  echo "   export CORE_API_SECRET='your-secret-here'"
  exit 1
fi

# Parse arguments
ACCOUNT_TYPE="$1"
ACCOUNT_ID="$2"
USDT_AMOUNT="$3"

# Validate arguments
if [ -z "$ACCOUNT_TYPE" ] || [ -z "$ACCOUNT_ID" ] || [ -z "$USDT_AMOUNT" ]; then
  echo -e "${YELLOW}Usage: $0 <user|merchant> <account-id> <usdt-amount>${NC}"
  echo ""
  echo "Examples:"
  echo "  $0 user \"abc-123-def\" 10.5"
  echo "  $0 merchant \"def-456-ghi\" 100"
  exit 1
fi

# Validate account type
if [ "$ACCOUNT_TYPE" != "user" ] && [ "$ACCOUNT_TYPE" != "merchant" ]; then
  echo -e "${RED}❌ Error: Account type must be 'user' or 'merchant'${NC}"
  exit 1
fi

# Convert to micro-USDT
AMOUNT_MICRO=$(echo "$USDT_AMOUNT * 1000000" | bc | cut -d'.' -f1)

echo -e "${BLUE}🔄 Minting sINR...${NC}"
echo "   Account Type: $ACCOUNT_TYPE"
echo "   Account ID:   $ACCOUNT_ID"
echo "   Amount:       $USDT_AMOUNT USDT"
echo ""

# Make API request
RESPONSE=$(curl -s -X POST "$CORE_API_URL/v1/convert/usdt-to-sinr" \
  -H "Content-Type: application/json" \
  -H "x-core-api-secret: $CORE_API_SECRET" \
  -d "{
    \"account_type\": \"$ACCOUNT_TYPE\",
    \"account_id\": \"$ACCOUNT_ID\",
    \"amount\": $AMOUNT_MICRO,
    \"idempotency_key\": \"mint-$(date +%s)-$$\"
  }")

# Check if successful
if echo "$RESPONSE" | grep -q '"success":true'; then
  echo -e "${GREEN}✅ SUCCESS!${NC}"
  echo ""
  echo "$RESPONSE" | jq '{
    conversion_id: .data.conversion_id,
    amount_in_usdt: (.data.amount_in / 1000000),
    amount_out_inr: (.data.amount_out / 100),
    rate: .data.rate,
    usdt_balance_after: .data.usdt_balance_after,
    sinr_balance_after_inr: (.data.sinr_balance_after / 100)
  }' 2>/dev/null || echo "$RESPONSE"
else
  echo -e "${RED}❌ FAILED${NC}"
  echo ""
  ERROR=$(echo "$RESPONSE" | jq -r '.error // "Unknown error"' 2>/dev/null)
  echo "   Error: $ERROR"

  if echo "$ERROR" | grep -qi "insufficient"; then
    echo -e "${YELLOW}   → Not enough USDT balance${NC}"
  elif echo "$ERROR" | grep -qi "exposure"; then
    echo -e "${YELLOW}   → Exceeds exposure limit${NC}"
  elif echo "$ERROR" | grep -qi "not found"; then
    echo -e "${YELLOW}   → Account not found${NC}"
  fi
fi
