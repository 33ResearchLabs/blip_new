#!/bin/bash
# ============================================================================
# 10 Transaction Test - Merchant Dashboard UI Flow
# ============================================================================
# Creates 2 merchants and runs 10 transactions:
#   Tx 1-3:  M2M BUY  (Merchant A buys from Merchant B) - 100, 250, 500 USDC
#   Tx 4-6:  M2M SELL (Merchant A sells to Merchant B) - 150, 300, 450 USDC
#   Tx 7-8:  M2M BUY  (Merchant B buys from Merchant A) - 200, 350 USDC
#   Tx 9-10: M2M SELL (Merchant B sells to Merchant A) - 275, 125 USDC
# ============================================================================

BASE="http://localhost:3000/api"
PASS=0; FAIL=0; TOTAL=0; TS=$(date +%s)

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'; BOLD='\033[1m'

log()    { echo -e "${BLUE}[INFO]${NC} $1"; }
pass()   { echo -e "${GREEN}  [PASS]${NC} $1"; PASS=$((PASS+1)); }
fail()   { echo -e "${RED}  [FAIL]${NC} $1"; FAIL=$((FAIL+1)); }
header() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"; echo -e "${BOLD}${CYAN}  $1${NC}"; echo -e "${BOLD}${CYAN}══════════════════════════════════════════════════${NC}"; }
step()   { echo -e "\n  ${YELLOW}▸ $1${NC}"; }

# JSON helper
J() {
  echo "$1" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  for k in '$2'.split('.'):
    if isinstance(d,dict): d=d.get(k)
    else: d=None
  print(d if d is not None else '')
except: print('')" 2>/dev/null
}

POST()  { curl -s -X POST  "$BASE$1" -H "Content-Type: application/json" -d "$2"; }
PATCH() { curl -s -X PATCH "$BASE$1" -H "Content-Type: application/json" -d "$2"; }
GET()   { curl -s "$BASE$1"; }

bal() { J "$(GET "/auth/merchant?action=check_session&merchant_id=$1")" "data.merchant.balance"; }

assert_bal() {
  local label=$1 actual=$2 expected=$3
  if python3 -c "exit(0 if abs(float('${actual:-0}')-float('${expected:-0}'))<0.01 else 1)" 2>/dev/null; then
    pass "$label: $actual (expected $expected)"
  else
    fail "$label: $actual (expected $expected)"
  fi
}

# ============================================================================
# run_trade: Execute a complete M2M trade
# Args: $1=tx_num $2=creator_id $3=type(buy/sell) $4=amount $5=acceptor_id
#        $6=creator_label $7=acceptor_label
# ============================================================================
run_trade() {
  local NUM=$1 CREATOR=$2 TYPE=$3 AMT=$4 ACCEPTOR=$5
  local CLABEL=$6 ALABEL=$7
  TOTAL=$((TOTAL+1))

  local UTYPE=$(echo "$TYPE" | tr '[:lower:]' '[:upper:]')
  header "TRANSACTION $NUM: $CLABEL ${UTYPE}S $AMT USDC (from $ALABEL)"

  local BAL_C_BEFORE=$(bal "$CREATOR")
  local BAL_A_BEFORE=$(bal "$ACCEPTOR")
  log "Before → $CLABEL: $BAL_C_BEFORE | $ALABEL: $BAL_A_BEFORE"

  # 1. Create order
  step "1. $CLABEL creates $UTYPE order ($AMT USDC)"
  R=$(POST "/merchant/orders" "{\"merchant_id\":\"$CREATOR\",\"type\":\"$TYPE\",\"crypto_amount\":$AMT,\"payment_method\":\"bank\",\"spread_preference\":\"fastest\"}")
  OID=$(J "$R" "data.id")
  ONUM=$(J "$R" "data.order_number")
  if [ -n "$OID" ]; then
    pass "Order $ONUM created (id: ${OID:0:8}...)"
  else
    fail "Create order failed: $R"
    return 1
  fi

  # Determine roles based on order type
  if [ "$TYPE" = "buy" ]; then
    # BUY: Creator buys, Acceptor sells (locks escrow)
    LOCKER=$ACCEPTOR
    PAYER=$CREATOR
    CONFIRMER=$ACCEPTOR
    RELEASER=$ACCEPTOR
  else
    # SELL: Creator sells (locks escrow), Acceptor buys
    LOCKER=$CREATOR
    PAYER=$ACCEPTOR
    CONFIRMER=$CREATOR
    RELEASER=$CREATOR
  fi

  # 2. Accept
  step "2. $ALABEL accepts order"
  R=$(PATCH "/orders/$OID" "{\"status\":\"accepted\",\"actor_type\":\"merchant\",\"actor_id\":\"$ACCEPTOR\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "accepted" ] && pass "Accepted" || { fail "Accept failed: status=$S resp=$(echo $R | head -c 200)"; return 1; }

  # 3. Lock escrow
  step "3. Locking escrow ($AMT USDC)"
  R=$(POST "/orders/$OID/escrow" "{\"tx_hash\":\"demo-tx-t${NUM}-lock-${TS}\",\"actor_type\":\"merchant\",\"actor_id\":\"$LOCKER\",\"escrow_trade_id\":${TS}${NUM}}")
  S=$(J "$R" "data.status")
  [ "$S" = "escrowed" ] && pass "Escrow locked" || { fail "Escrow lock failed: status=$S resp=$(echo $R | head -c 200)"; return 1; }

  # 4. Mark payment sent
  step "4. Fiat payment sent"
  R=$(PATCH "/orders/$OID" "{\"status\":\"payment_sent\",\"actor_type\":\"merchant\",\"actor_id\":\"$PAYER\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "payment_sent" ] && pass "Payment sent" || { fail "Payment sent failed: status=$S"; return 1; }

  # 5. Confirm payment
  step "5. Payment confirmed"
  R=$(PATCH "/orders/$OID" "{\"status\":\"payment_confirmed\",\"actor_type\":\"merchant\",\"actor_id\":\"$CONFIRMER\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "payment_confirmed" ] && pass "Payment confirmed" || { fail "Payment confirmed failed: status=$S"; return 1; }

  # 6. Release escrow
  step "6. Releasing escrow"
  R=$(PATCH "/orders/$OID/escrow" "{\"tx_hash\":\"demo-tx-t${NUM}-rel-${TS}\",\"actor_type\":\"merchant\",\"actor_id\":\"$RELEASER\"}")
  S=$(J "$R" "data.status")
  [ "$S" = "completed" ] && pass "COMPLETED" || { fail "Release failed: status=$S resp=$(echo $R | head -c 200)"; return 1; }

  # 7. Verify balances
  local BAL_C_AFTER=$(bal "$CREATOR")
  local BAL_A_AFTER=$(bal "$ACCEPTOR")
  log "After  → $CLABEL: $BAL_C_AFTER | $ALABEL: $BAL_A_AFTER"

  if [ "$TYPE" = "buy" ]; then
    # Creator bought: should gain AMT. Acceptor sold: should lose AMT.
    local EXP_C=$(python3 -c "print(round(float('$BAL_C_BEFORE') + $AMT, 2))")
    local EXP_A=$(python3 -c "print(round(float('$BAL_A_BEFORE') - $AMT, 2))")
    assert_bal "$CLABEL balance (bought $AMT)" "$BAL_C_AFTER" "$EXP_C"
    assert_bal "$ALABEL balance (sold $AMT)" "$BAL_A_AFTER" "$EXP_A"
  else
    # Creator sold: should lose AMT. Acceptor bought: should gain AMT.
    local EXP_C=$(python3 -c "print(round(float('$BAL_C_BEFORE') - $AMT, 2))")
    local EXP_A=$(python3 -c "print(round(float('$BAL_A_BEFORE') + $AMT, 2))")
    assert_bal "$CLABEL balance (sold $AMT)" "$BAL_C_AFTER" "$EXP_C"
    assert_bal "$ALABEL balance (bought $AMT)" "$BAL_A_AFTER" "$EXP_A"
  fi

  echo ""
}

# ============================================================================
header "SETUP: Create 2 Test Merchant Accounts"
# ============================================================================

step "Register Merchant A"
R=$(POST "/auth/merchant" "{\"action\":\"register\",\"email\":\"test10_a_${TS}@blip.com\",\"password\":\"test123\",\"business_name\":\"Test Merchant A\"}")
MA=$(J "$R" "data.merchant.id")
if [ -n "$MA" ]; then
  pass "Merchant A: ${MA:0:12}..."
else
  fail "Create Merchant A failed: $R"
  exit 1
fi

step "Register Merchant B"
R=$(POST "/auth/merchant" "{\"action\":\"register\",\"email\":\"test10_b_${TS}@blip.com\",\"password\":\"test123\",\"business_name\":\"Test Merchant B\"}")
MB=$(J "$R" "data.merchant.id")
if [ -n "$MB" ]; then
  pass "Merchant B: ${MB:0:12}..."
else
  fail "Create Merchant B failed: $R"
  exit 1
fi

START_A=$(bal "$MA")
START_B=$(bal "$MB")
log "Starting balances → A: $START_A | B: $START_B"

# ============================================================================
header "RUNNING 10 TRANSACTIONS"
# ============================================================================

# Tx 1-3: Merchant A BUYS from Merchant B
run_trade 1  "$MA" "buy"  100  "$MB"  "Merch-A" "Merch-B"
run_trade 2  "$MA" "buy"  250  "$MB"  "Merch-A" "Merch-B"
run_trade 3  "$MA" "buy"  500  "$MB"  "Merch-A" "Merch-B"

# Tx 4-6: Merchant A SELLS to Merchant B
run_trade 4  "$MA" "sell" 150  "$MB"  "Merch-A" "Merch-B"
run_trade 5  "$MA" "sell" 300  "$MB"  "Merch-A" "Merch-B"
run_trade 6  "$MA" "sell" 450  "$MB"  "Merch-A" "Merch-B"

# Tx 7-8: Merchant B BUYS from Merchant A
run_trade 7  "$MB" "buy"  200  "$MA"  "Merch-B" "Merch-A"
run_trade 8  "$MB" "buy"  350  "$MA"  "Merch-B" "Merch-A"

# Tx 9-10: Merchant B SELLS to Merchant A
run_trade 9  "$MB" "sell" 275  "$MA"  "Merch-B" "Merch-A"
run_trade 10 "$MB" "sell" 125  "$MA"  "Merch-B" "Merch-A"

# ============================================================================
header "FINAL RESULTS"
# ============================================================================

FINAL_A=$(bal "$MA")
FINAL_B=$(bal "$MB")

echo ""
log "Merchant A: $START_A → $FINAL_A"
log "Merchant B: $START_B → $FINAL_B"
echo ""

# Expected:
# A bought: 100 + 250 + 500 = 850
# A sold: 150 + 300 + 450 = 900
# B bought from A: 200 + 350 = 550 (A sold 550)
# B sold to A: 275 + 125 = 400 (A bought 400)
# Net A = +850 -900 -550 +400 = -200
# Net B = -850 +900 +550 -400 = +200
EXP_A=$(python3 -c "print(round(float('$START_A') - 200, 2))")
EXP_B=$(python3 -c "print(round(float('$START_B') + 200, 2))")

assert_bal "Merchant A final" "$FINAL_A" "$EXP_A"
assert_bal "Merchant B final" "$FINAL_B" "$EXP_B"

echo ""
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  SUMMARY: ${GREEN}$PASS passed${NC} / ${RED}$FAIL failed${NC} / $TOTAL transactions${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}"

if [ $FAIL -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}  ALL TESTS PASSED!${NC}\n"
  exit 0
else
  echo -e "\n${RED}${BOLD}  SOME TESTS FAILED!${NC}\n"
  exit 1
fi
