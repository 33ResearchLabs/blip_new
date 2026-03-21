# FINAL TRADE FLOW - DO NOT MODIFY

**Status**: CANONICAL - This is the single source of truth for trade flow logic.

---

## BUY Flow (User/Merchant wants to BUY crypto)

1. Buyer places order: "I want to buy $100 worth of crypto"
2. A seller (merchant) accepts the order and **locks $100 crypto into escrow** (seller ALWAYS locks)
3. Buyer receives offchain payment instructions (bank details, wire info)
4. Buyer sends fiat payment (bank transfer / wire)
5. Seller checks if money is received, confirms, and **releases crypto** to buyer
6. Done. Platform takes a small fee.

## SELL Flow (User/Merchant wants to SELL crypto)

1. Seller locks crypto into escrow **BEFORE the offer goes live** (pre-locked, seamless)
2. Order appears on marketplace with escrow already locked
3. A buyer accepts the order
4. Buyer sends fiat payment to seller's bank
5. Seller confirms fiat received, **releases crypto** to buyer
6. Done. Platform takes a small fee.

---

## Rules

- **Seller ALWAYS locks crypto.** No exceptions.
- **SELL orders lock escrow BEFORE going live.** This makes it seamless - buyer sees the order, accepts, pays, done.
- **BUY orders lock escrow AFTER acceptance.** Seller accepts first, then locks.
- **Cancel before escrow?** No problem, clean cancel.
- **Cancel/timeout after escrow?** Goes to dispute. Never silent fund loss.
- **Fiat is always offchain.** Bank transfer, wire, cash - not our problem, just confirm it.

---

## In One Sentence

Seller locks crypto in escrow, buyer sends fiat offchain, seller confirms and releases crypto.

---

**DO NOT OVERCOMPLICATE THIS. The UI must reflect exactly this flow.**
