# Blip Money 💸

> P2P crypto-to-cash settlement on Solana. Dead simple. No BS.

## What is this?

Blip Money is a **decentralized, pseudonymous P2P protocol** for cross-border value settlement built on Solana. Think Uber, but for money exchange. You tap, pick a seller (merchant), send crypto, they send cash (or vice versa).

**Core innovation:** All critical settlement actions—escrow, bond staking, reputation scoring, and dispute resolution—are recorded and enforced via on-chain smart contracts. No centralized custodians.

## The Vibe

- **Minimal AF** - No forms, no friction. Taps > typing
- **Mobile-first** - Designed for phones, works everywhere
- **Degen energy** - Emojis, memes, but actually functional
- **Dark mode** - Zinc/charcoal theme with subtle emerald accents
- **Fast** - Live merchant matching, instant settlement on Solana

## Two Sides

### User App (This repo)
Simple flow for users to buy/sell crypto for cash:

```
[Enter Amount] → [Live Merchants Appear] → [Pick One] → [Choose Recipient] → [Trade Active] → [Complete] → [Rate]
```

1. **Trade Screen** - Enter amount, pick currencies (USDC, SOL ↔ AED, USD)
2. **Mode Selection** - Fastest / Cheapest / Best rate
3. **Live Merchants** - Real-time list of available traders with ratings, speed, rates
4. **Recipient** - Send to yourself, recent contact, or new person
5. **Active Trade** - Progress circle, chat with seller
6. **Complete** - Confetti, rate the experience

### Merchant Console (Coming)
Live dashboard widget for merchants to:
- See incoming orders in real-time
- Match and execute trades instantly
- Earn points/reputation for fast settlement
- Manage their bond/stake
- Track earnings and performance

## Protocol Architecture

### Actors
- **User (U)** - Initiates orders, deposits crypto into escrow
- **Merchant (M)** - Bids on orders, executes off-chain fiat settlement, must stake a bond
- **Oracle (R)** - Submits cryptographic proof of off-chain payout
- **DAO** - Governance and dispute resolution

### Core On-Chain Components (PDAs)
- **Escrow PDA** - Non-custodial smart contract holding user funds
- **Reputation PDA** - Persistent, on-chain performance score per merchant
- **Staking/Bond PDA** - Merchant's cryptographic bond (slashable for non-performance)
- **DAO Vault** - Holds slashed funds and platform fees

### Settlement Flow
1. User creates Order off-chain
2. Merchants submit sealed bids (auction)
3. Winner determined by: `S = 1/fee + α·Reputation + β·BondLevel`
4. User deposits crypto into Escrow PDA
5. Merchant executes fiat transfer off-chain
6. Oracle submits proof → Escrow releases to merchant
7. Reputation updated, user rates merchant

### Key Features
- **Trust-Minimized** - Smart contract enforcement, no custodians
- **Pseudonymous** - No KYC required at protocol level (only wallet signature)
- **Competitive Fees** - Sealed-bid second-price auction drives costs down
- **Accountable Merchants** - Bond staking + slashing for non-delivery
- **Ultra-Fast** - Solana's ~400ms block times

## Tech Stack

- **Next.js 14** (App Router)
- **TypeScript**
- **Tailwind CSS** - Zinc palette, emerald accents
- **Framer Motion** - Smooth animations, AnimatePresence
- **Lucide React** - Icons
- **PWA ready** - manifest.json configured

### Backend (TBD)
- **Solana Programs** (Anchor/Rust) - Escrow, Reputation, Staking PDAs
- **Off-chain Indexer** - Bid aggregation, auction processing
- **Oracle Service** - Fiat payment verification

## Design Decisions

- No header/logo cruft - jump straight to action
- Balance widget always visible (top bar)
- Wallet address truncated (0x69...420 style)
- Merchants have emojis, ratings, trade counts
- Bottom sheet pattern for chat
- Star ratings for feedback
- Minimal color usage - mostly zinc grays with emerald for positive values

## Currencies

**Crypto:**
- USDC 💵
- SOL ◎

**Fiat:**
- AED د.إ (UAE Dirham)
- USD $

## Running Locally

```bash
cd settle
npm install
npm run dev -- -p 3002
```

Open [http://localhost:3002](http://localhost:3002)

## Project Structure

```
settle/
├── src/
│   └── app/
│       ├── page.tsx      # Main user app (all the magic)
│       ├── layout.tsx    # Root layout
│       └── globals.css   # Tailwind imports
├── public/
│   └── manifest.json     # PWA config
├── package.json
└── tailwind.config.ts
```

## State Machine

```typescript
type Step = "trade" | "recipient" | "active" | "complete"
type TradeMode = "fastest" | "cheapest" | "best"
```

Key states:
- `step` - Current flow step
- `amount` - User input amount
- `tradeMode` - Speed vs cost preference
- `selectedMerchant` - Chosen trader
- `visibleMerchants` - Filtered live results

## TODO

### User App
- [ ] Solana wallet connection (Phantom, Solflare)
- [ ] Real merchant matching via auction
- [ ] Chat functionality (currently mocked)
- [ ] Trade history persistence
- [ ] Push notifications

### Merchant Console
- [ ] Live order feed widget
- [ ] One-tap order matching
- [ ] Bond staking UI
- [ ] Earnings dashboard
- [ ] Real-time notifications

### Protocol
- [ ] Escrow PDA smart contract (Anchor)
- [ ] Reputation PDA with algorithmic scoring
- [ ] Staking/Bond PDA with slashing
- [ ] Off-chain auction indexer
- [ ] Oracle service for fiat verification
- [ ] DAO governance contracts

## Why "Blip"?

Fast. In and out. *blip* - done. Your money moved.

---

Built with 🦊 energy
