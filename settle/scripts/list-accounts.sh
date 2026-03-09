#!/bin/bash

###############################################################################
# List Users and Merchants for minting sINR
###############################################################################

echo "📋 USERS (with USDT balance)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
psql -d blip_money -c "
  SELECT
    id,
    username,
    balance::numeric(10,6) as usdt_balance,
    (sinr_balance / 100.0)::numeric(10,2) as sinr_inr
  FROM users
  WHERE balance > 0
  ORDER BY balance DESC
  LIMIT 10;
" 2>/dev/null

echo ""
echo "🏪 MERCHANTS (with USDT balance)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
psql -d blip_money -c "
  SELECT
    id,
    business_name,
    balance::numeric(10,6) as usdt_balance,
    (sinr_balance / 100.0)::numeric(10,2) as sinr_inr,
    synthetic_rate,
    CASE
      WHEN max_sinr_exposure IS NULL THEN 'unlimited'
      ELSE (max_sinr_exposure / 100.0)::text
    END as max_exposure_inr
  FROM merchants
  WHERE balance > 0
  ORDER BY balance DESC
  LIMIT 10;
" 2>/dev/null

echo ""
echo "💡 To mint sINR for a user or merchant, run:"
echo "   ./mint-sinr.sh user <user-id> <amount>"
echo "   ./mint-sinr.sh merchant <merchant-id> <amount>"
