# Blip Money — QA Test Cases (Happy Paths)

**Currency:** AED | **Crypto:** USDT | **Payment:** Bank or Cash

---

## TEST 1: BUY Order (Buyer wants to buy crypto)

| Step | Who | Action | Expected |
|------|-----|--------|----------|
| 1 | Buyer | Create BUY order (e.g. 100 USDT, bank) | Order created, status = **pending**, 15-min timer starts |
| 2 | Seller | Accept the order | Status → **accepted** |
| 3 | Seller | Lock crypto into escrow | Status → **escrowed**, seller balance reduced by 100 USDT |
| 4 | Buyer | Send fiat via bank (offchain), click "I've Sent Payment" | Status → **payment_sent** |
| 5 | Seller | Verify fiat received, click "Confirm Payment" | Status → **completed**, crypto released to buyer |

**Check after completion:**
- [ ] Buyer crypto balance increased
- [ ] Seller crypto balance decreased (escrowed amount)
- [ ] Order shows in completed list for both
- [ ] Both can leave a rating (1-5 stars)

---

## TEST 2: SELL Order (Seller wants to sell crypto)

| Step | Who | Action | Expected |
|------|-----|--------|----------|
| 1 | Seller | Create SELL order (e.g. 50 USDT, cash) | Escrow locked immediately, status = **escrowed**, offer live on marketplace |
| 2 | Buyer | Accept the order from marketplace | Status stays **escrowed** (escrow already locked) |
| 3 | Buyer | Send fiat to seller (offchain), click "I've Sent Payment" | Status → **payment_sent** |
| 4 | Seller | Verify fiat received, click "Confirm Payment" | Status → **completed**, crypto released to buyer |

**Check after completion:**
- [ ] Seller balance deducted at step 1 (pre-lock)
- [ ] Buyer crypto balance increased after completion
- [ ] Order shows in completed list for both
- [ ] Both can leave a rating (1-5 stars)

---

## TEST 3: M2M BUY (Merchant buys from Merchant)

| Step | Who | Action | Expected |
|------|-----|--------|----------|
| 1 | Merchant A | Create BUY order (e.g. 200 USDT, bank) | Order created, status = **pending** |
| 2 | Merchant B | Accept as seller, lock escrow | Status → **escrowed**, B's balance reduced |
| 3 | Merchant A | Send fiat, click "I've Sent Payment" | Status → **payment_sent** |
| 4 | Merchant B | Confirm fiat, click "Confirm Payment" | Status → **completed** |

**Check after completion:**
- [ ] Merchant A = buyer, Merchant B = seller (roles shown correctly)
- [ ] Both merchants can rate each other

---

## TEST 4: M2M SELL (Merchant sells to Merchant)

| Step | Who | Action | Expected |
|------|-----|--------|----------|
| 1 | Merchant A | Create SELL order (e.g. 75 USDT, bank) | Escrow locked, status = **escrowed**, A's balance reduced |
| 2 | Merchant B | Accept as buyer | Status stays **escrowed** |
| 3 | Merchant B | Send fiat, click "I've Sent Payment" | Status → **payment_sent** |
| 4 | Merchant A | Confirm fiat, click "Confirm Payment" | Status → **completed** |

**Check after completion:**
- [ ] Merchant A = seller, Merchant B = buyer (roles shown correctly)
- [ ] Both merchants can rate each other

---

## Before Testing

- [ ] Server running (settle :3000, core-api :4010)
- [ ] DB seeded with test merchants/users
- [ ] Test wallets funded on localnet
