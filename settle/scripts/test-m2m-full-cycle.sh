#!/bin/bash
# ============================================================================
# M2M Full Cycle Test - Buy & Sell with Balance Verification
# ============================================================================
# Phase 1: Merch A buys $500 x2 from Merch B (B locks escrow, A pays fiat)
# Phase 2: Merch A sells $500 x2 to Merch B (A locks escrow, B pays fiat)
# Final: Balances should return to starting values
# ============================================================================

BASE="http://localhost:3000/api"
PASS=0
FAIL=0
TS=$(date +%s)

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

log()    { echo -e "${BLUE}[INFO]${NC} $1"; }
pass()   { echo -e "${GREEN}[PASS]${NC} $1"; PASS=$((PASS+1)); }
fail()   { echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
header() { echo -e "\n${BOLD}${CYAN}══ $1 ══${NC}"; }
step()   { echo -e "  ${YELLOW}▸ $1${NC}"; }

# JSON helper
J() { echo "$1" | python3 -c "import sys,json
d=json.load(sys.stdin)
keys='$2'.split('.')
for k in keys:
  if isinstance(d,dict): d=d.get(k)
  else: d=None
print(d if d is not None else '')" 2>/dev/null; }

# API helper
POST()  { curl -s -X POST  "$BASE$1" -H "Content-Type: application/json" -d "$2"; }
PATCH() { curl -s -X PATCH "$BASE$1" -H "Content-Type: application/json" -d "$2"; }
GET()   { curl -s "$BASE$1"; }

# Get balance
bal() { J "$(GET "/auth/merchant?action=check_session&merchant_id=$1")" "data.merchant.balance"; }

# ============================================================================
header "SETUP: Create 2 Merchant Accounts"
# ============================================================================

step "Registering Merchant A..."
R=$(POST "/auth/merchant" "{\"action\":\"register\",\"email\":\"m2m_a_${TS}@test.com\",\"password\":\"test123\",\"business_name\":\"Merchant A\"}")
MERCH_A=$(J "$R" "data.merchant.id")
[ -n "$MERCH_A" ] && pass "Merchant A: $MERCH_A" || { fail "Create A failed: $R"; exit 1; }

step "Registering Merchant B..."
R=$(POST "/auth/merchant" "{\"action\":\"register\",\"email\":\"m2m_b_${TS}@test.com\",\"password\":\"test123\",\"business_name\":\"Merchant B\"}")
MERCH_B=$(J "$R" "data.merchant.id")
[ -n "$MERCH_B" ] && pass "Merchant B: $MERCH_B" || { fail "Create B failed: $R"; exit 1; }

START_A=$(bal "$MERCH_A")
START_B=$(bal "$MERCH_B")
log "Starting balances → A: ${START_A} | B: ${START_B}"

# ============================================================================
# Helper: Run a complete trade
# Args: $1=phase $2=order_num $3=creator_id $4=creator_type(buy/sell)
#        $5=acceptor_id $6=escrow_locker_id $7=fiat_payer_id
#        $8=payment_confirmer_id $9=escrow_releaser_id
# ============================================================================
run_trade() {
  local PHASE=$1 NUM=$2 CREATOR=$3 TYPE=$4 ACCEPTOR=$5
  local LOCKER=$6 PAYER=$7 CONFIRMER=$8 RELEASER=$9

  header "Phase $PHASE - Trade $NUM: $TYPE 500 USDC"

  # 1. Create order
  step "Creating $TYPE order (500 USDC)..."
  R=$(POST "/merchant/orders" "{\"merchant_id\":\"$CREATOR\",\"type\":\"$TYPE\",\"crypto_amount\":500,\"payment_method\":\"bank\",\"spread_preference\":\"fastest\"}")
  OID=$(J "$R" "data.id")
  ONUM=$(J "$R" "data.order_number")
  OTYPE=$(J "$R" "data.type")
  OSTATUS=$(J "$R" "data.status")
  OMERCH=$(J "$R" "data.merchant_id")
  OBUYERM=$(J "$R" "data.buyer_merchant_id")
  if [ -n "$OID" ]; then
    pass "Order $ONUM created (stored type=$OTYPE, status=$OSTATUS)"
    log "    merchant_id=${OMERCH:0:8}... buyer_merchant_id=${OBUYERM:0:8}..."
  else
    fail "Create order failed: $R"
    return 1
  fi

  # 2. Accept
  step "Acceptor accepts order..."
  R=$(PATCH "/orders/$OID" "{\"status\":\"accepted\",\"actor_type\":\"merchant\",\"actor_id\":\"$ACCEPTOR\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "accepted" ] && pass "Accepted (merchant_id=$(J "$R" "data.merchant_id" | head -c8)... buyer_merchant=$(J "$R" "data.buyer_merchant_id" | head -c8)...)" || { fail "Accept: got status=$S"; return 1; }

  # 3. Lock escrow
  step "Locking escrow (500 USDC)..."
  local BAL_BEFORE=$(bal "$LOCKER")
  R=$(POST "/orders/$OID/escrow" "{\"tx_hash\":\"demo-tx-p${PHASE}-${NUM}-lock-${TS}\",\"actor_type\":\"merchant\",\"actor_id\":\"$LOCKER\",\"escrow_trade_id\":${TS}${PHASE}${NUM}}")
  S=$(J "$R" "data.status")
  local BAL_AFTER=$(bal "$LOCKER")
  [ "$S" = "escrowed" ] && pass "Escrowed | Locker balance: $BAL_BEFORE → $BAL_AFTER" || { fail "Escrow: got status=$S resp=$R"; return 1; }

  # 4. Mark payment sent
  step "Fiat payer marks payment sent..."
  R=$(PATCH "/orders/$OID" "{\"status\":\"payment_sent\",\"actor_type\":\"merchant\",\"actor_id\":\"$PAYER\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "payment_sent" ] && pass "Payment sent" || { fail "Payment sent: got status=$S"; return 1; }

  # 5. Confirm payment
  step "Confirmer confirms payment..."
  R=$(PATCH "/orders/$OID" "{\"status\":\"payment_confirmed\",\"actor_type\":\"merchant\",\"actor_id\":\"$CONFIRMER\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "payment_confirmed" ] && pass "Payment confirmed" || { fail "Payment confirm: got status=$S"; return 1; }

  # 6. Release escrow
  step "Releasing escrow..."
  R=$(PATCH "/orders/$OID/escrow" "{\"tx_hash\":\"demo-tx-p${PHASE}-${NUM}-rel-${TS}\",\"actor_type\":\"merchant\",\"actor_id\":\"$RELEASER\"}")
  S=$(J "$R" "data.status")
  if [ "$S" = "completed" ]; then
    pass "COMPLETED"
    local CA=$(bal "$MERCH_A") CB=$(bal "$MERCH_B")
    log "    Balances → A: $CA | B: $CB"
  else
    fail "Release: got status=$S resp=$R"
    return 1
  fi
}

# ============================================================================
header "PHASE 1: A BUYS 500 x2 from B"
log "A=buyer (pays fiat), B=seller (locks escrow, releases)"
# ============================================================================
# A creates buy order → B accepts → B locks escrow → A pays → B confirms → B releases
run_trade 1 1 "$MERCH_A" "buy" "$MERCH_B" "$MERCH_B" "$MERCH_A" "$MERCH_B" "$MERCH_B"
run_trade 1 2 "$MERCH_A" "buy" "$MERCH_B" "$MERCH_B" "$MERCH_A" "$MERCH_B" "$MERCH_B"

# Mid-point check
MID_A=$(bal "$MERCH_A")
MID_B=$(bal "$MERCH_B")
header "PHASE 1 BALANCE CHECK"
log "A bought 1000 USDC from B"
log "Expected → A: $(echo "$START_A + 1000" | bc) | B: $(echo "$START_B - 1000" | bc)"
log "Actual   → A: $MID_A | B: $MID_B"

EXP_A=$(echo "$START_A + 1000" | bc)
EXP_B=$(echo "$START_B - 1000" | bc)
python3 -c "
a,ea = float('$MID_A'), float('$EXP_A')
b,eb = float('$MID_B'), float('$EXP_B')
" 2>/dev/null
if python3 -c "exit(0 if abs(float('$MID_A')-float('$EXP_A'))<0.01 else 1)" 2>/dev/null; then
  pass "A balance correct: $MID_A"
else
  fail "A balance wrong: $MID_A (expected $EXP_A)"
fi
if python3 -c "exit(0 if abs(float('$MID_B')-float('$EXP_B'))<0.01 else 1)" 2>/dev/null; then
  pass "B balance correct: $MID_B"
else
  fail "B balance wrong: $MID_B (expected $EXP_B)"
fi

# ============================================================================
header "PHASE 2: A SELLS 500 x2 to B"
log "A=seller (locks escrow, releases), B=buyer (pays fiat)"
# ============================================================================
# A creates sell order → B accepts → A locks escrow → B pays → A confirms → A releases
run_trade 2 1 "$MERCH_A" "sell" "$MERCH_B" "$MERCH_A" "$MERCH_B" "$MERCH_A" "$MERCH_A"
run_trade 2 2 "$MERCH_A" "sell" "$MERCH_B" "$MERCH_A" "$MERCH_B" "$MERCH_A" "$MERCH_A"

# ============================================================================
header "FINAL BALANCE VERIFICATION"
# ============================================================================
FINAL_A=$(bal "$MERCH_A")
FINAL_B=$(bal "$MERCH_B")

echo ""
log "╔═══════════════════════════════════════╗"
log "║       BALANCE SUMMARY                 ║"
log "╠═══════════════════════════════════════╣"
log "║ Merchant A:                           ║"
log "║   Start:   $START_A USDC              "
log "║   +Bought: +1000 (Phase 1)            "
log "║   -Sold:   -1000 (Phase 2)            "
log "║   Expected: $START_A USDC             "
log "║   Actual:   $FINAL_A USDC             "
log "║                                       ║"
log "║ Merchant B:                           ║"
log "║   Start:   $START_B USDC              "
log "║   -Sold:   -1000 (Phase 1)            "
log "║   +Bought: +1000 (Phase 2)            "
log "║   Expected: $START_B USDC             "
log "║   Actual:   $FINAL_B USDC             "
log "╚═══════════════════════════════════════╝"
echo ""

if python3 -c "exit(0 if abs(float('$FINAL_A')-float('$START_A'))<0.01 else 1)" 2>/dev/null; then
  pass "FINAL: A balance matches start ($FINAL_A == $START_A)"
else
  fail "FINAL: A balance MISMATCH ($FINAL_A != $START_A)"
fi

if python3 -c "exit(0 if abs(float('$FINAL_B')-float('$START_B'))<0.01 else 1)" 2>/dev/null; then
  pass "FINAL: B balance matches start ($FINAL_B == $START_B)"
else
  fail "FINAL: B balance MISMATCH ($FINAL_B != $START_B)"
fi

# ============================================================================
header "RESULTS"
# ============================================================================
echo ""
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""
[ $FAIL -eq 0 ] && echo -e "${GREEN}${BOLD}ALL TESTS PASSED ✓${NC}" || echo -e "${RED}${BOLD}SOME TESTS FAILED ✗${NC}"
exit $FAIL
