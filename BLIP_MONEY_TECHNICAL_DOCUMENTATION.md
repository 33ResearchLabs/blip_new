# Blip Money - Technical Documentation

> **Version:** 0.1.0
> **Last Updated:** February 2026
> **Platform:** Solana Blockchain

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Core Features](#5-core-features)
6. [User Flows](#6-user-flows)
7. [Database Schema](#7-database-schema)
8. [API Reference](#8-api-reference)
9. [Blockchain Integration](#9-blockchain-integration)
10. [Real-Time Communication](#10-real-time-communication)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [State Management](#12-state-management)
13. [BlipScan Explorer](#13-blipscan-explorer)
14. [Configuration & Environment](#14-configuration--environment)
15. [Security Considerations](#15-security-considerations)
16. [Deployment Guide](#16-deployment-guide)

---

## 1. Executive Summary

### What is Blip Money?

**Blip Money** is a decentralized peer-to-peer (P2P) crypto-to-fiat settlement protocol built on the Solana blockchain. It enables users to buy and sell cryptocurrency (USDC/SOL) directly with fiat currency (USD/AED) through verified merchants, using smart contract escrow for trustless transactions.

### Key Value Propositions

| Feature | Description |
|---------|-------------|
| **Decentralized** | No central custodian - funds secured by smart contracts |
| **Pseudonymous** | Only wallet signature required, no mandatory KYC at protocol level |
| **Trust-Minimized** | Escrow smart contracts enforce all critical actions |
| **Low Fees** | Direct P2P settlement reduces intermediary costs |
| **Cross-Border** | Support for multiple fiat currencies (USD, AED) |
| **Mobile-First** | PWA design optimized for mobile users |

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        BLIP MONEY ECOSYSTEM                     │
├─────────────────────┬─────────────────────┬─────────────────────┤
│                     │                     │                     │
│   SETTLE (Main)     │   BLIPSCAN         │   SOLANA PROGRAMS   │
│   ─────────────     │   ────────         │   ───────────────   │
│   • User App        │   • Indexer        │   • V1 Escrow       │
│   • Merchant App    │   • Explorer Web   │   • V2 Protocol     │
│   • Compliance      │   • Stats API      │                     │
│   • Admin           │                    │                     │
│                     │                     │                     │
└─────────────────────┴─────────────────────┴─────────────────────┘
```

---

## 2. System Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND LAYER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  User App   │  │  Merchant   │  │ Compliance  │  │   Admin     │     │
│  │   (PWA)     │  │  Dashboard  │  │   Portal    │  │  Dashboard  │     │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
└─────────┼────────────────┼────────────────┼────────────────┼────────────┘
          │                │                │                │
          └────────────────┴────────────────┴────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                              API LAYER (Next.js)                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  44 API Routes: /api/auth, /api/orders, /api/offers, /api/chat   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│   PostgreSQL    │   │     Pusher      │   │   Cloudinary    │
│   (Database)    │   │   (Real-time)   │   │   (Storage)     │
└─────────────────┘   └─────────────────┘   └─────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          SOLANA BLOCKCHAIN                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Escrow Programs (V1 & V2) - Smart Contract Settlement           │   │
│  │  Program V1: HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq        │   │
│  │  Program V2: 6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User Request → Next.js API → PostgreSQL (order data)
                         ↓
                    Pusher (real-time updates)
                         ↓
                    Solana (escrow operations)
                         ↓
                    BlipScan Indexer (blockchain data)
```

---

## 3. Tech Stack

### Frontend Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 16.1.2 | React framework with App Router |
| React | 19.2.3 | UI library |
| TypeScript | 5.x | Type safety |
| Tailwind CSS | 4.x | Styling |
| Framer Motion | 12.26.2 | Animations |
| Lucide React | 0.562.0 | Icons |
| Recharts | 2.15.4 | Charts & analytics |

### Backend Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js API Routes | 16.1.2 | Server-side API |
| PostgreSQL | - | Primary database |
| pg (node-postgres) | 8.17.1 | Database client |
| Zod | 3.23.8 | Runtime validation |

### Blockchain Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| @solana/web3.js | 1.98.4 | Solana SDK |
| @coral-xyz/anchor | 0.29.0 | Smart contract interaction |
| @solana/spl-token | 0.4.14 | Token operations |
| @solana/wallet-adapter | 0.15.20+ | Wallet connections |
| TweetNaCl | 1.0.3 | Cryptographic signatures |
| bs58 | 6.0.0 | Base58 encoding |

### Infrastructure

| Technology | Purpose |
|------------|---------|
| Pusher | Real-time WebSocket communication |
| Cloudinary | Image/file storage |
| Helius RPC | Solana RPC provider |

---

## 4. Project Structure

```
BM/
├── settle/                          # Main Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx            # User trading interface
│   │   │   ├── merchant/           # Merchant dashboard
│   │   │   │   └── page.tsx
│   │   │   ├── compliance/         # Dispute resolution portal
│   │   │   │   └── page.tsx
│   │   │   ├── arbiter/            # Arbitrator interface
│   │   │   │   └── page.tsx
│   │   │   ├── admin/              # Admin dashboard
│   │   │   │   └── page.tsx
│   │   │   ├── api/                # 44 API endpoints
│   │   │   │   ├── auth/           # Authentication routes
│   │   │   │   ├── orders/         # Order management
│   │   │   │   ├── offers/         # Merchant offers
│   │   │   │   ├── merchant/       # Merchant-specific APIs
│   │   │   │   ├── disputes/       # Dispute handling
│   │   │   │   ├── compliance/     # Compliance tools
│   │   │   │   ├── arbiters/       # Arbitration
│   │   │   │   ├── admin/          # Admin endpoints
│   │   │   │   ├── pusher/         # Real-time auth
│   │   │   │   └── setup/          # Database seeding
│   │   │   └── layout.tsx
│   │   │
│   │   ├── components/             # UI Components
│   │   │   ├── WalletModal.tsx
│   │   │   ├── UsernameModal.tsx
│   │   │   ├── PWAInstallBanner.tsx
│   │   │   ├── BottomNav.tsx
│   │   │   ├── chat/               # Chat components
│   │   │   └── merchant/           # Merchant components
│   │   │
│   │   ├── context/                # State Management (5 contexts)
│   │   │   ├── AppContext.tsx      # User state & orders
│   │   │   ├── SolanaWalletContext.tsx  # Wallet state
│   │   │   ├── ThemeContext.tsx    # Dark/light mode
│   │   │   ├── PusherContext.tsx   # Real-time events
│   │   │   └── WebSocketChatContext.tsx # Chat state
│   │   │
│   │   ├── hooks/                  # Custom Hooks (12 hooks)
│   │   │   ├── useChat.ts
│   │   │   ├── useRealtimeOrder.ts
│   │   │   ├── useWalletAuth.ts
│   │   │   ├── useMerchantAuth.ts
│   │   │   └── ...
│   │   │
│   │   └── lib/                    # Core Libraries
│   │       ├── db/                 # Database layer
│   │       │   ├── index.ts        # Connection pool
│   │       │   └── repositories/   # Data access
│   │       ├── auth/               # Authentication
│   │       │   └── walletAuth.ts
│   │       ├── solana/             # Blockchain
│   │       │   ├── escrow.ts       # Escrow operations
│   │       │   ├── rpc.ts          # RPC configuration
│   │       │   └── v2/             # V2 protocol
│   │       ├── pusher/             # Real-time
│   │       ├── reputation/         # Scoring system
│   │       ├── arbiters/           # Arbitration logic
│   │       ├── validation/         # Zod schemas
│   │       ├── types/              # TypeScript types
│   │       └── orders/             # Order state machine
│   │
│   ├── database/
│   │   └── schema.sql              # PostgreSQL schema
│   │
│   └── package.json
│
└── blipscan/                       # Blockchain Explorer
    ├── indexer/
    │   ├── src/
    │   │   └── index.ts            # Main indexer (920+ lines)
    │   ├── blip_escrow_idl.json    # V1 program IDL
    │   ├── blip_protocol_v2_idl.json # V2 program IDL
    │   └── package.json
    │
    ├── web/
    │   ├── app/
    │   │   ├── page.tsx            # Explorer dashboard
    │   │   ├── trade/[escrow]/     # Trade detail view
    │   │   └── merchant/[pubkey]/  # Merchant profile
    │   └── package.json
    │
    └── database/
        └── schema.sql              # BlipScan schema
```

---

## 5. Core Features

### 5.1 User Features

| Feature | Description |
|---------|-------------|
| **Wallet Connection** | Connect Phantom, Solflare, Coinbase, Backpack, or WalletConnect |
| **Buy Crypto** | Purchase USDC/SOL with fiat (bank transfer or cash) |
| **Sell Crypto** | Sell USDC/SOL for fiat currency |
| **Order Tracking** | Real-time order status updates |
| **In-App Chat** | Communicate with merchants during trades |
| **Payment Proof** | Upload screenshots as payment evidence |
| **Order History** | View past transactions and reviews |
| **Dispute System** | Raise disputes for problematic orders |

### 5.2 Merchant Features

| Feature | Description |
|---------|-------------|
| **Offer Management** | Create buy/sell offers with custom rates |
| **Order Dashboard** | Manage incoming orders with tabs (Pending/Active/Chat) |
| **Auto-Accept** | Automatically accept orders under threshold |
| **Big Order Handling** | Special workflow for large transactions |
| **Analytics** | View trading volume, completion rates, ratings |
| **Bank Details** | Configure payment methods (bank/cash) |
| **Online Status** | Toggle availability for new orders |

### 5.3 Compliance Features

| Feature | Description |
|---------|-------------|
| **Dispute Queue** | View and claim open disputes |
| **Investigation Tools** | Access chat history, order details, evidence |
| **Resolution Actions** | Resolve in favor of user/merchant, request refund |
| **Escalation** | Escalate to arbitration panel |

### 5.4 Arbitration Features

| Feature | Description |
|---------|-------------|
| **Voting System** | Multi-arbiter voting on escalated disputes |
| **Evidence Review** | Access all dispute evidence and history |
| **Reputation Impact** | Votes affect merchant/user reputation |

### 5.5 Admin Features

| Feature | Description |
|---------|-------------|
| **Platform Stats** | Total volume, orders, active merchants |
| **User Management** | View/modify user accounts |
| **Merchant Management** | Approve, suspend, ban merchants |
| **Activity Logs** | Audit trail of all platform actions |

---

## 6. User Flows

### 6.1 User Registration & Authentication

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER AUTHENTICATION FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
    │  Open    │     │ Connect  │     │  Sign    │     │  Create  │
    │   App    │────▶│  Wallet  │────▶│ Message  │────▶│ Username │
    └──────────┘     └──────────┘     └──────────┘     └──────────┘
                           │               │                │
                           ▼               ▼                ▼
                    ┌──────────────────────────────────────────────┐
                    │            AUTHENTICATION COMPLETE           │
                    │                                              │
                    │  • Wallet verified via signature             │
                    │  • User created/loaded from database         │
                    │  • Session stored in localStorage            │
                    │  • Ready to trade                            │
                    └──────────────────────────────────────────────┘
```

### 6.2 Buy Order Flow (User Perspective)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BUY ORDER FLOW                               │
└─────────────────────────────────────────────────────────────────────┘

Step 1: Create Order
    User enters amount → System matches merchant → Order created (PENDING)

Step 2: Wait for Acceptance
    Order status: PENDING → Merchant accepts → ACCEPTED

Step 3: Escrow Deposit
    Merchant deposits crypto → On-chain escrow → ESCROWED

Step 4: Fiat Payment
    User sends fiat payment → Uploads proof → PAYMENT_SENT

Step 5: Payment Verification
    Merchant confirms receipt → PAYMENT_CONFIRMED

Step 6: Escrow Release
    Merchant releases escrow → Crypto to user wallet → COMPLETED

        ┌────────┐   ┌──────────┐   ┌──────────┐   ┌─────────────┐
        │PENDING │──▶│ ACCEPTED │──▶│ ESCROWED │──▶│PAYMENT_SENT │
        └────────┘   └──────────┘   └──────────┘   └─────────────┘
                                                          │
        ┌───────────┐   ┌──────────────────┐              │
        │ COMPLETED │◀──│ PAYMENT_CONFIRMED │◀─────────────┘
        └───────────┘   └──────────────────┘
```

### 6.3 Sell Order Flow (User Perspective)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SELL ORDER FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

Step 1: Create Order
    User enters amount → System matches merchant → Order created (PENDING)

Step 2: Wait for Acceptance
    Merchant accepts → ACCEPTED

Step 3: User Deposits Escrow
    User deposits crypto to escrow → On-chain confirmation → ESCROWED

Step 4: Merchant Sends Fiat
    Merchant sends fiat → Confirms in app → PAYMENT_SENT

Step 5: User Confirms Receipt
    User confirms fiat received → PAYMENT_CONFIRMED

Step 6: Escrow Release
    System releases escrow to merchant → COMPLETED

        ┌────────┐   ┌──────────┐   ┌──────────────┐
        │PENDING │──▶│ ACCEPTED │──▶│ESCROW_PENDING│
        └────────┘   └──────────┘   └──────────────┘
                                           │
        ┌───────────┐   ┌─────────────┐    │
        │ COMPLETED │◀──│PAYMENT_CONF │◀───┘
        └───────────┘   └─────────────┘
```

### 6.4 Dispute Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DISPUTE RESOLUTION FLOW                        │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │ Order Issue  │
    │   Raised     │
    └──────┬───────┘
           │
           ▼
    ┌──────────────┐     ┌──────────────┐
    │   DISPUTE    │────▶│ Compliance   │
    │    OPEN      │     │ Assigned     │
    └──────────────┘     └──────┬───────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
              ▼                 ▼                 ▼
       ┌────────────┐   ┌────────────┐   ┌────────────┐
       │  Resolved  │   │ Escalated  │   │  Refunded  │
       │  (Favor)   │   │(Arbitration│   │            │
       └────────────┘   └─────┬──────┘   └────────────┘
                              │
                              ▼
                       ┌────────────┐
                       │ Multi-Vote │
                       │  Panel     │
                       └─────┬──────┘
                              │
                              ▼
                       ┌────────────┐
                       │  RESOLVED  │
                       └────────────┘
```

---

## 7. Database Schema

### 7.1 Main Application (settle)

#### Core Tables

```sql
-- Users: End users trading on the platform
users (
  id UUID PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  wallet_address VARCHAR(64) UNIQUE,
  kyc_status ENUM('none', 'pending', 'verified', 'rejected'),
  total_trades INT,
  total_volume DECIMAL(20,2),
  rating DECIMAL(2,1)
)

-- Merchants: Verified traders providing liquidity
merchants (
  id UUID PRIMARY KEY,
  wallet_address VARCHAR(64) UNIQUE,
  username VARCHAR(50) UNIQUE,
  business_name VARCHAR(100),
  status ENUM('pending', 'active', 'suspended', 'banned'),
  total_trades INT,
  rating DECIMAL(2,1),
  is_online BOOLEAN,
  auto_accept_enabled BOOLEAN
)

-- Merchant Offers: Buy/sell offers from merchants
merchant_offers (
  id UUID PRIMARY KEY,
  merchant_id UUID REFERENCES merchants,
  type ENUM('buy', 'sell'),
  payment_method ENUM('bank', 'cash'),
  rate DECIMAL(10,4),
  min_amount DECIMAL(20,2),
  max_amount DECIMAL(20,2),
  is_active BOOLEAN
)

-- Orders: P2P trade transactions
orders (
  id UUID PRIMARY KEY,
  order_number VARCHAR(20) UNIQUE,  -- Format: BM-YYMMDD-XXXX
  user_id UUID REFERENCES users,
  merchant_id UUID REFERENCES merchants,
  offer_id UUID REFERENCES merchant_offers,
  type ENUM('buy', 'sell'),
  crypto_amount DECIMAL(20,6),
  crypto_currency VARCHAR(10),      -- USDC, SOL
  fiat_amount DECIMAL(20,2),
  fiat_currency VARCHAR(10),        -- USD, AED
  status order_status,
  escrow_tx_hash VARCHAR(128),      -- On-chain reference
  escrow_trade_pda VARCHAR(64)      -- Escrow PDA address
)
```

#### Status Enums

```sql
-- Order Status Lifecycle
order_status ENUM (
  'pending',           -- Order created, waiting merchant
  'accepted',          -- Merchant accepted
  'escrow_pending',    -- Waiting for escrow deposit
  'escrowed',          -- Crypto locked in escrow
  'payment_pending',   -- Waiting for fiat payment
  'payment_sent',      -- Fiat payment sent
  'payment_confirmed', -- Fiat payment confirmed
  'releasing',         -- Escrow release in progress
  'completed',         -- Trade completed successfully
  'cancelled',         -- Trade cancelled
  'disputed',          -- Under dispute
  'expired'            -- Order timed out
)

-- Dispute Status
dispute_status ENUM ('open', 'investigating', 'resolved', 'escalated')

-- Dispute Reasons
dispute_reason ENUM (
  'payment_not_received',
  'crypto_not_received',
  'wrong_amount',
  'fraud',
  'other'
)
```

#### Supporting Tables

```sql
-- Chat messages between users and merchants
chat_messages (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders,
  sender_type ENUM('user', 'merchant', 'system'),
  message_type ENUM('text', 'image', 'system'),
  content TEXT,
  image_url TEXT,
  is_read BOOLEAN
)

-- Order event audit log
order_events (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders,
  event_type VARCHAR(50),
  actor_type ENUM('user', 'merchant', 'system'),
  old_status order_status,
  new_status order_status,
  metadata JSONB
)

-- Disputes
disputes (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders,
  raised_by ENUM('user', 'merchant'),
  reason dispute_reason,
  status dispute_status,
  resolution TEXT,
  resolved_in_favor_of ENUM('user', 'merchant')
)

-- Reviews
reviews (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders UNIQUE,
  rating INT CHECK (1-5),
  comment TEXT
)
```

### 7.2 BlipScan Explorer

```sql
-- On-chain trades indexed from Solana
trades (
  id UUID PRIMARY KEY,
  escrow_address TEXT UNIQUE,       -- PDA address
  deal_id TEXT,
  signature TEXT,                   -- Creation tx signature
  merchant_pubkey TEXT,
  buyer_pubkey TEXT,
  arbiter_pubkey TEXT,
  mint_address TEXT,                -- Token mint
  amount BIGINT,
  fee_bps INTEGER,
  status TEXT                       -- funded, locked, released, refunded
)

-- Trade events (state transitions)
trade_events (
  id UUID PRIMARY KEY,
  trade_id UUID REFERENCES trades,
  event_type TEXT,                  -- created, locked, released, refunded
  signature TEXT,
  slot BIGINT,
  instruction_data JSONB
)

-- Merchant reputation metrics
merchant_stats (
  id UUID PRIMARY KEY,
  merchant_pubkey TEXT UNIQUE,
  total_trades INTEGER,
  total_volume BIGINT,
  completion_rate DECIMAL(5,2),
  reputation_score DECIMAL(5,2)     -- 0-100 score
)
```

---

## 8. API Reference

### 8.1 Authentication APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/wallet` | POST | Connect wallet (auto-create user) |
| `/api/auth/user` | POST | User wallet authentication |
| `/api/auth/merchant` | POST | Merchant wallet authentication |
| `/api/auth/compliance` | POST | Compliance officer login |

**POST /api/auth/wallet**
```typescript
// Request
{
  walletAddress: string;
  type: 'user' | 'merchant';
}

// Response
{
  type: 'user' | 'merchant';
  user?: User;
  merchant?: Merchant;
  needsUsername?: boolean;
}
```

### 8.2 Order APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orders` | GET | List user orders |
| `/api/orders` | POST | Create new order |
| `/api/orders/[id]` | GET | Get order details |
| `/api/orders/[id]` | PUT | Update order status |
| `/api/orders/[id]/messages` | GET/POST | Chat messages |
| `/api/orders/[id]/dispute` | POST | Raise dispute |
| `/api/orders/[id]/review` | POST | Submit review |
| `/api/orders/[id]/escrow` | PUT | Update escrow status |
| `/api/orders/[id]/extension` | POST | Request time extension |
| `/api/orders/expire` | POST | Expire stale orders (cron) |

**POST /api/orders**
```typescript
// Request
{
  user_id: string;
  crypto_amount: number;
  type: 'buy' | 'sell';
  payment_method: 'bank' | 'cash';
  preference?: 'fast' | 'cheap' | 'best';
}

// Response
{
  id: string;
  order_number: string;
  status: 'pending';
  merchant: Merchant;
  offer: MerchantOffer;
  // ...
}
```

### 8.3 Merchant APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/offers` | GET | List all active offers |
| `/api/merchant/offers` | GET/POST | Merchant's own offers |
| `/api/merchant/orders` | GET | Merchant's orders |
| `/api/merchant/analytics` | GET | Trading analytics |
| `/api/merchant/big-orders` | GET | Large order queue |
| `/api/merchant/messages` | GET | Unread message counts |

### 8.4 Dispute APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/disputes` | GET | List disputes |
| `/api/disputes/[id]/arbitration` | POST | Submit to arbitration |
| `/api/disputes/resolved` | GET | Resolved disputes |
| `/api/compliance/disputes` | GET | Compliance queue |
| `/api/compliance/disputes/[id]/resolve` | POST | Resolve dispute |
| `/api/compliance/disputes/[id]/finalize` | POST | Finalize resolution |

### 8.5 Admin APIs

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/stats` | GET | Platform statistics |
| `/api/admin/orders` | GET | All orders |
| `/api/admin/merchants` | GET | All merchants |
| `/api/admin/activity` | GET | Activity logs |

---

## 9. Blockchain Integration

### 9.1 Smart Contract Programs

| Program | Address | Purpose |
|---------|---------|---------|
| V1 Escrow | `HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq` | Original escrow program |
| V2 Protocol | `6AG4ccUtM1YPcVmkMrMTuhjEtY8E7p5qwT4nud6mea87` | Enhanced protocol |

### 9.2 Supported Tokens

| Token | Mint Address (Devnet) | Use Case |
|-------|----------------------|----------|
| USDC | Circle's USDC mint | Primary stablecoin |
| SOL | Native token | Alternative payment |

### 9.3 Escrow Operations

```typescript
// src/lib/solana/escrow.ts

// Create escrow PDA (Program Derived Address)
async createEscrowPDA(
  merchantPubkey: PublicKey,
  buyerPubkey: PublicKey,
  dealId: string
): Promise<[PublicKey, number]>

// Deposit crypto into escrow
async depositToEscrow(
  wallet: WalletContextState,
  escrowPDA: PublicKey,
  amount: number,
  mint: PublicKey
): Promise<string>  // Returns tx signature

// Release escrow to recipient
async releaseEscrow(
  wallet: WalletContextState,
  escrowPDA: PublicKey,
  recipientPubkey: PublicKey
): Promise<string>

// Refund escrow (dispute resolution)
async refundEscrow(
  wallet: WalletContextState,
  escrowPDA: PublicKey,
  creatorPubkey: PublicKey
): Promise<string>
```

### 9.4 Wallet Adapters

```typescript
// Supported wallets
const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new CoinbaseWalletAdapter(),
  new BackpackWalletAdapter(),
  new WalletConnectWalletAdapter({
    network: WalletAdapterNetwork.Devnet,
    options: { projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID }
  })
];
```

### 9.5 Transaction Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ESCROW TRANSACTION FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

1. ORDER ACCEPTED
   │
   ▼
2. CREATE ESCROW PDA
   └── Deterministic address from merchant + buyer + deal_id
   │
   ▼
3. DEPOSIT TO ESCROW
   └── Seller transfers tokens to escrow vault
   └── Transaction signed by seller wallet
   │
   ▼
4. VERIFY ESCROW
   └── Backend confirms on-chain balance
   └── Order status → ESCROWED
   │
   ▼
5. FIAT PAYMENT (OFF-CHAIN)
   └── Buyer sends fiat to seller
   └── Proof uploaded to chat
   │
   ▼
6. RELEASE ESCROW
   └── Seller releases tokens to buyer
   └── Transaction signed by escrow authority
   │
   ▼
7. ORDER COMPLETE
   └── Tokens in buyer wallet
   └── Order status → COMPLETED
```

---

## 10. Real-Time Communication

### 10.1 Pusher Channels

| Channel | Events | Purpose |
|---------|--------|---------|
| `private-user-{userId}` | order_update, message | User-specific updates |
| `private-order-{orderId}` | status_change, message | Order-specific updates |
| `private-chat-{orderId}` | new_message, typing | Chat messages |
| `presence-merchants` | member_added, member_removed | Merchant online status |

### 10.2 Event Types

```typescript
// Order Events
interface OrderEvent {
  type: 'order_accepted' | 'order_escrowed' | 'payment_sent' |
        'payment_confirmed' | 'order_completed' | 'order_cancelled' |
        'dispute_created' | 'dispute_resolved';
  orderId: string;
  data: Record<string, unknown>;
}

// Chat Events
interface ChatEvent {
  type: 'message_received' | 'typing_start' | 'typing_stop';
  orderId: string;
  senderId: string;
  senderType: 'user' | 'merchant';
  content?: string;
}

// Merchant Events
interface MerchantEvent {
  type: 'merchant_online' | 'merchant_offline';
  merchantId: string;
}
```

### 10.3 WebSocket Fallback

For environments where Pusher is unavailable, a direct WebSocket connection is used:

```typescript
// src/context/WebSocketChatContext.tsx
const ws = new WebSocket(`wss://api.blip.money/ws/chat/${orderId}`);

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  handleNewMessage(message);
};
```

---

## 11. Authentication & Authorization

### 11.1 Wallet-Based Authentication

```typescript
// Authentication Flow
1. User connects wallet (Phantom, Solflare, etc.)
2. App generates login message with nonce:
   "Sign this message to authenticate with Blip Money\n\nWallet: {address}\nTimestamp: {timestamp}\nNonce: {random}"
3. User signs message (no gas fees)
4. Signature sent to server
5. Server verifies signature using TweetNaCl
6. User created/loaded from database
7. Session stored in localStorage
```

### 11.2 Role-Based Access

| Role | Access Level |
|------|--------------|
| `user` | Create orders, chat, disputes |
| `merchant` | All user + create offers, manage orders |
| `compliance` | View disputes, resolve, escalate |
| `arbiter` | Vote on escalated disputes |
| `admin` | Full platform access |

### 11.3 Username Requirements

- 3-20 characters
- Alphanumeric + underscore only
- Globally unique (across users AND merchants)
- **Immutable** - cannot be changed after creation

---

## 12. State Management

### 12.1 React Contexts

| Context | Purpose | Key State |
|---------|---------|-----------|
| `AppContext` | User & orders | user, orders, activeOrder, bankAccounts |
| `SolanaWalletContext` | Wallet connection | connected, publicKey, balances |
| `ThemeContext` | UI theme | isDark, toggle |
| `PusherContext` | Real-time | channels, subscriptions |
| `WebSocketChatContext` | Chat | messages, typing status |

### 12.2 Custom Hooks

```typescript
// Authentication
useWalletAuth()     // User wallet authentication
useMerchantAuth()   // Merchant authentication

// Orders
useRealtimeOrder(orderId)    // Single order updates
useRealtimeOrders()          // All user orders

// Chat
useChat(orderId)             // Chat messages & actions
useRealtimeChat(orderId)     // Real-time chat updates

// Utilities
usePolling(fn, interval)     // Polling mechanism
useSounds()                  // Audio notifications
usePWA()                     // PWA install prompt
useMobileDetect()            // Mobile detection
```

### 12.3 Local Storage

| Key | Purpose |
|-----|---------|
| `walletAddress` | Persisted wallet connection |
| `theme` | Light/dark preference |
| `merchantData` | Cached merchant info |

---

## 13. BlipScan Explorer

### 13.1 Overview

BlipScan is a blockchain explorer specifically for Blip Money trades. It consists of:

1. **Indexer** - Polls Solana blockchain and indexes trades
2. **Web UI** - Displays trade history and merchant stats

### 13.2 Indexer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       BLIPSCAN INDEXER                              │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
    │   Solana     │  Poll   │   Indexer    │  Store  │  PostgreSQL  │
    │   RPC        │◀───────▶│   Process    │────────▶│   Database   │
    │              │  (60s)  │              │         │              │
    └──────────────┘         └──────────────┘         └──────────────┘
                                    │
                                    │ Parse IDL
                                    ▼
                             ┌──────────────┐
                             │  V1 & V2     │
                             │  Programs    │
                             └──────────────┘
```

### 13.3 Indexer Process

```typescript
// blipscan/indexer/src/index.ts

async function indexTransactions() {
  // 1. Get last processed signature from cursor
  const cursor = await getCursor();

  // 2. Fetch new transactions from Solana
  const signatures = await connection.getSignaturesForAddress(
    PROGRAM_ID,
    { until: cursor.lastSignature }
  );

  // 3. Parse each transaction
  for (const sig of signatures) {
    const tx = await connection.getTransaction(sig.signature);
    const parsed = parseInstruction(tx);

    // 4. Insert into database
    if (parsed.type === 'create_escrow') {
      await insertTrade(parsed);
    } else if (parsed.type === 'release') {
      await updateTradeStatus(parsed.escrow, 'released');
    }
  }

  // 5. Update cursor
  await updateCursor(signatures[0].signature);
}

// Run every 60 seconds
setInterval(indexTransactions, 60000);
```

### 13.4 Explorer Features

| Feature | Description |
|---------|-------------|
| Trade List | All indexed trades with filters |
| Trade Detail | Full transaction history for an escrow |
| Merchant Profile | Stats, completion rate, trade history |
| Global Stats | Total volume, trades, active merchants |

---

## 14. Configuration & Environment

### 14.1 Environment Variables

```bash
# .env.example

# ===========================================
# DATABASE
# ===========================================
DB_HOST=localhost
DB_PORT=5432
DB_NAME=blip
DB_USER=postgres
DB_PASSWORD=postgres

# Production (use connection string)
# DATABASE_URL=postgresql://user:pass@host:5432/db

# ===========================================
# APP CONFIGURATION
# ===========================================
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ===========================================
# SOLANA CONFIGURATION
# ===========================================
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id

# ===========================================
# PUSHER (Real-time)
# ===========================================
PUSHER_APP_ID=your_app_id
PUSHER_SECRET=your_secret
NEXT_PUBLIC_PUSHER_KEY=your_key
NEXT_PUBLIC_PUSHER_CLUSTER=your_cluster

# ===========================================
# CLOUDINARY (Image Storage)
# ===========================================
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=your_cloud_name

# ===========================================
# COMPLIANCE
# ===========================================
NEXT_PUBLIC_COMPLIANCE_WALLETS=wallet1,wallet2
```

### 14.2 Development Scripts

```bash
# Main App (settle/)
npm run dev          # Start development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Run ESLint
npm run test         # Run Jest tests
npm run typecheck    # TypeScript check
npm run db:reset     # Reset database

# BlipScan Indexer
npm run dev          # Start indexer (watch mode)
npm run build        # Compile TypeScript
npm run start        # Run compiled indexer

# BlipScan Web
npm run dev          # Start on port 3001
```

---

## 15. Security Considerations

### 15.1 Authentication Security

| Measure | Implementation |
|---------|----------------|
| Wallet Signatures | Ed25519 signatures verified with TweetNaCl |
| No Password Storage | Wallet-based auth eliminates password risks |
| Session Expiry | Signatures valid for 5 minutes only |
| Nonce | Random nonce prevents replay attacks |

### 15.2 API Security

| Measure | Implementation |
|---------|----------------|
| Input Validation | Zod schemas for all API inputs |
| SQL Injection | Parameterized queries only |
| Rate Limiting | Middleware for API throttling |
| CORS | Configured for allowed origins |

### 15.3 Escrow Security

| Measure | Implementation |
|---------|----------------|
| Smart Contract | Funds held in audited Solana program |
| PDA Derivation | Deterministic, tamper-proof addresses |
| Multi-Signature | Disputes require arbiter signatures |
| Time Locks | Orders expire automatically |

### 15.4 Data Protection

| Measure | Implementation |
|---------|----------------|
| No Private Keys | Wallets never share private keys |
| Encrypted Channels | Pusher uses TLS encryption |
| Sensitive Data | Bank details never logged |

---

## 16. Deployment Guide

### 16.1 Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Pusher account
- Cloudinary account
- Helius RPC API key (recommended)

### 16.2 Database Setup

```bash
# Create database
createdb blip

# Run schema
psql -U postgres -d blip -f database/schema.sql

# For BlipScan
createdb blipscan
psql -U postgres -d blipscan -f blipscan/database/schema.sql
```

### 16.3 Application Deployment

```bash
# 1. Clone and install
git clone <repo>
cd settle
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values

# 3. Build and start
npm run build
npm run start
```

### 16.4 BlipScan Deployment

```bash
# Indexer (run as background service)
cd blipscan/indexer
npm install
npm run build
pm2 start dist/index.js --name blipscan-indexer

# Web UI
cd blipscan/web
npm install
npm run build
npm run start
```

### 16.5 Production Checklist

- [ ] Set `NEXT_PUBLIC_SOLANA_NETWORK=mainnet-beta`
- [ ] Configure production RPC endpoint
- [ ] Set up database backups
- [ ] Configure monitoring/alerting
- [ ] Enable rate limiting
- [ ] Set up SSL/TLS
- [ ] Configure CDN for static assets
- [ ] Set up log aggregation

---

## Appendix A: Order Status Reference

| Status | Description | Next States |
|--------|-------------|-------------|
| `pending` | Order created, awaiting merchant | accepted, expired, cancelled |
| `accepted` | Merchant accepted order | escrow_pending, cancelled |
| `escrow_pending` | Waiting for escrow deposit | escrowed, cancelled |
| `escrowed` | Crypto locked in escrow | payment_pending, disputed |
| `payment_pending` | Waiting for fiat payment | payment_sent, disputed |
| `payment_sent` | Fiat payment sent | payment_confirmed, disputed |
| `payment_confirmed` | Fiat confirmed received | releasing |
| `releasing` | Escrow release in progress | completed |
| `completed` | Trade finished successfully | (terminal) |
| `cancelled` | Trade cancelled | (terminal) |
| `disputed` | Under dispute investigation | resolved |
| `expired` | Order timed out | (terminal) |

---

## Appendix B: API Error Codes

| Code | Message | Resolution |
|------|---------|------------|
| 400 | Invalid request | Check request body/params |
| 401 | Unauthorized | Reconnect wallet |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not found | Resource doesn't exist |
| 409 | Conflict | Duplicate or state conflict |
| 429 | Rate limited | Wait and retry |
| 500 | Server error | Contact support |

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| **PDA** | Program Derived Address - deterministic Solana address |
| **Escrow** | Smart contract holding funds during trade |
| **Arbiter** | Neutral party resolving disputes |
| **Mint** | Token contract address (e.g., USDC mint) |
| **Slot** | Solana block number |
| **IDL** | Interface Description Language for Anchor programs |

---

---

## 17. Order State Machine

The order lifecycle is managed by a comprehensive state machine that enforces valid transitions.

### 17.1 State Machine Configuration

**Location:** `src/lib/orders/stateMachine.ts`

```typescript
// Global timeout: ALL orders must complete within 15 minutes
const GLOBAL_ORDER_TIMEOUT_MINUTES = 15;

// Maximum extensions allowed per order
const MAX_EXTENSIONS = 3;
```

### 17.2 Complete State Transition Diagram

```
                                    ┌─────────────┐
                                    │   PENDING   │
                                    └──────┬──────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
              ▼                            ▼                            ▼
       ┌────────────┐              ┌────────────┐              ┌────────────┐
       │  ACCEPTED  │              │  ESCROWED  │              │ CANCELLED  │
       └──────┬─────┘              └──────┬─────┘              └────────────┘
              │                           │
              │                           │
              ▼                           ▼
       ┌─────────────────┐         ┌─────────────────┐
       │ ESCROW_PENDING  │         │ PAYMENT_PENDING │
       └───────┬─────────┘         └────────┬────────┘
               │                            │
               ▼                            ▼
        ┌────────────┐              ┌──────────────┐
        │  ESCROWED  │              │ PAYMENT_SENT │
        └────────────┘              └──────┬───────┘
                                           │
                                           ▼
                                   ┌────────────────────┐
                                   │ PAYMENT_CONFIRMED  │
                                   └─────────┬──────────┘
                                             │
                                             ▼
                                      ┌────────────┐
                                      │  RELEASING │
                                      └──────┬─────┘
                                             │
                                             ▼
                                      ┌────────────┐
                                      │ COMPLETED  │
                                      └────────────┘

    ┌────────────────────────────────────────────────────────────────────┐
    │  DISPUTE PATH: Any active state can transition to DISPUTED         │
    │  DISPUTED → COMPLETED (resolved for user) or CANCELLED (refund)    │
    └────────────────────────────────────────────────────────────────────┘

    ┌────────────────────────────────────────────────────────────────────┐
    │  TIMEOUT PATH: Any non-terminal state can transition to EXPIRED    │
    └────────────────────────────────────────────────────────────────────┘
```

### 17.3 Transition Rules

| From Status | To Status | Allowed Actors |
|-------------|-----------|----------------|
| pending | accepted | merchant |
| pending | escrowed | user, merchant, system |
| pending | cancelled | user, merchant, system |
| pending | expired | system |
| accepted | escrow_pending | merchant, system |
| accepted | escrowed | user, merchant, system |
| accepted | payment_sent | merchant |
| accepted | cancelled | user, merchant, system |
| escrowed | payment_pending | user, merchant, system |
| escrowed | payment_sent | user, merchant |
| escrowed | completed | user, merchant, system |
| escrowed | disputed | user, merchant |
| payment_sent | payment_confirmed | user, merchant |
| payment_sent | completed | user, merchant, system |
| payment_sent | disputed | user, merchant |
| payment_confirmed | releasing | system |
| payment_confirmed | completed | user, merchant, system |
| releasing | completed | system |
| disputed | completed | system (resolved for user) |
| disputed | cancelled | system (resolved for merchant) |

### 17.4 Terminal States

```typescript
const TERMINAL_STATUSES = ['completed', 'cancelled', 'expired'];
```

- **completed** - Trade finished successfully
- **cancelled** - Trade cancelled before completion
- **expired** - Order timed out (15 minutes)

### 17.5 Extension System

Orders can be extended up to 3 times when running out of time:

| Status | Extension Duration |
|--------|-------------------|
| pending | +15 minutes |
| accepted | +30 minutes |
| escrowed | +1 hour |
| payment_sent | +2 hours |

```typescript
// Check if order can be extended
function canExtendOrder(status, currentExtensionCount) {
  const EXTENDABLE_STATUSES = ['pending', 'accepted', 'escrowed', 'payment_sent'];
  return EXTENDABLE_STATUSES.includes(status) && currentExtensionCount < 3;
}
```

### 17.6 Expiry Outcomes

| Scenario | Outcome |
|----------|---------|
| Max extensions reached + escrowed | → disputed (protects both parties) |
| Before escrow | → cancelled |
| Extension declined | → cancelled |
| No response | → cancelled |

---

## 18. Reputation System

A comprehensive reputation scoring system that tracks user and merchant trustworthiness.

### 18.1 Score Components

The reputation score (0-1000) is calculated from 5 weighted components:

| Component | Weight | Description |
|-----------|--------|-------------|
| Review Score | 30% | Ratings and review trends |
| Execution Score | 25% | Completion rate and speed |
| Volume Score | 20% | Trading volume tiers |
| Consistency Score | 15% | Account age and activity |
| Trust Score | 10% | KYC level, dispute history |

### 18.2 Score Calculation

```typescript
// Component scores (0-100 each)
const totalScore = (
  reviewScore * 0.30 +
  executionScore * 0.25 +
  volumeScore * 0.20 +
  consistencyScore * 0.15 +
  trustScore * 0.10
) * 10; // Scale to 0-1000
```

### 18.3 Reputation Tiers

| Tier | Score Range | Benefits |
|------|-------------|----------|
| Bronze | 0-199 | Basic access |
| Silver | 200-399 | Priority matching |
| Gold | 400-599 | Lower fees |
| Platinum | 600-799 | Higher limits |
| Diamond | 800-1000 | VIP features |

### 18.4 Badges

Users can earn badges for achievements:

| Badge | Requirements |
|-------|--------------|
| `fast_trader` | Avg completion < 15 mins, 10+ trades |
| `high_volume` | Top 10% by volume |
| `trusted` | 50+ completed trades, 0 lost disputes |
| `veteran` | Account age > 180 days |
| `perfect_rating` | 5.0 rating, 10+ reviews |
| `dispute_free` | 25+ orders, 0 lost disputes |
| `consistent` | 95%+ completion, active last 30 days |
| `whale` | $100,000+ lifetime volume |
| `early_adopter` | First 1000 users |
| `arbiter_approved` | Eligible for arbitration |

### 18.5 Score Impact Events

| Event | Score Change |
|-------|-------------|
| Order completed | +5 |
| Order cancelled | -2 |
| Order timeout | -5 |
| Order disputed | -5 |
| Dispute won | +10 |
| Dispute lost | -20 |
| 5-star review | +6 |
| 1-star review | -6 |

---

## 19. UI Components

### 19.1 Component Architecture

```
src/components/
├── WalletModal.tsx           # Wallet selection and connection
├── WalletConnectModal.tsx    # WalletConnect protocol handler
├── UsernameModal.tsx         # Username creation/validation
├── MerchantWalletModal.tsx   # Merchant-specific wallet UI
├── PWAInstallBanner.tsx      # Progressive Web App install prompt
├── BottomNav.tsx             # Mobile bottom navigation bar
├── ClientWalletProvider.tsx  # Wallet adapter wrapper
│
├── chat/                     # Chat system components
│   ├── ImageMessage.tsx      # Image display in chat
│   ├── ImageUpload.tsx       # Image upload handler
│   ├── FileUpload.tsx        # File attachment handler
│   └── cards/                # Rich message cards
│       ├── BankInfoCard.tsx  # Bank details display
│       ├── EscrowCard.tsx    # Escrow status display
│       └── StatusEventCard.tsx # Order event display
│
└── merchant/                 # Merchant dashboard components
    ├── AnalyticsDashboard.tsx  # Trading analytics
    ├── MerchantChatTabs.tsx    # Chat categorization
    ├── MessageHistory.tsx      # Message timeline
    ├── OrderDetailsPanel.tsx   # Order info panel
    └── TradeChat.tsx           # Trade conversation UI
```

### 19.2 Key Component Details

#### WalletModal
- Displays supported wallets (Phantom, Solflare, Coinbase, Backpack)
- Handles WalletConnect for mobile wallets
- Manages connection state and errors

#### UsernameModal
- Validates username format (3-20 chars, alphanumeric + underscore)
- Checks global uniqueness via API
- Prevents changes after creation (immutable)

#### PWAInstallBanner
- Detects iOS/Android install capability
- Shows native install prompt
- Persists dismissal in localStorage

#### Chat Components
- Real-time message updates via Pusher/WebSocket
- Image upload to Cloudinary
- Rich cards for bank info, escrow status, events
- Typing indicators

#### Merchant Dashboard
- Order tabs: Pending / Active / Chat
- Analytics: volume, completion rate, ratings over time
- Quick actions: accept, reject, release escrow

### 19.3 Design System

| Element | Specification |
|---------|---------------|
| Primary Color | Zinc grays (`zinc-900`, `zinc-800`) |
| Accent Color | Emerald green (`emerald-500`) for positive |
| Error Color | Red (`red-500`) for errors/negative |
| Font | Inter (Google Fonts) |
| Border Radius | `rounded-xl` (12px) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Dark Mode | Default theme |

---

## 20. Error Handling

### 20.1 API Error Response Format

```typescript
interface APIError {
  error: string;          // Human-readable message
  code?: string;          // Machine-readable code
  details?: unknown;      // Additional context
}

// Example
{
  error: "Order not found",
  code: "ORDER_NOT_FOUND",
  details: { orderId: "abc123" }
}
```

### 20.2 Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_INPUT` | 400 | Request validation failed |
| `INVALID_TRANSITION` | 400 | Invalid order state transition |
| `UNAUTHORIZED` | 401 | Missing/invalid authentication |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `DUPLICATE` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `ESCROW_FAILED` | 500 | Blockchain transaction failed |
| `DATABASE_ERROR` | 500 | Database operation failed |

### 20.3 Client-Side Error Handling

```typescript
// API client with error handling
async function apiCall<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json();
    throw new APIError(error.error, error.code, response.status);
  }

  return response.json();
}
```

### 20.4 Blockchain Error Handling

```typescript
// Escrow operation with retries
async function executeEscrowOperation(operation: () => Promise<string>) {
  const MAX_RETRIES = 3;
  let lastError: Error;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const signature = await operation();
      await confirmTransaction(signature);
      return signature;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * attempt); // Exponential backoff
      }
    }
  }

  throw lastError;
}
```

---

## 21. Testing

### 21.1 Test Configuration

**Framework:** Jest with ts-jest

```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};
```

### 21.2 Test Scripts

```bash
npm run test              # Run all tests
npm run test:watch        # Watch mode
npm run test:integration  # Integration tests
```

### 21.3 Test Categories

| Category | Location | Description |
|----------|----------|-------------|
| Unit | `src/**/*.test.ts` | Pure function tests |
| Integration | `src/**/*.integration.ts` | Database/API tests |
| State Machine | `src/lib/orders/*.test.ts` | Transition validation |
| Reputation | `src/lib/reputation/*.test.ts` | Score calculation |

### 21.4 Example Test

```typescript
// src/lib/orders/stateMachine.test.ts
import { validateTransition } from './stateMachine';

describe('Order State Machine', () => {
  describe('validateTransition', () => {
    it('allows merchant to accept pending order', () => {
      const result = validateTransition('pending', 'accepted', 'merchant');
      expect(result.valid).toBe(true);
    });

    it('prevents user from accepting pending order', () => {
      const result = validateTransition('pending', 'accepted', 'user');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not allowed');
    });

    it('prevents transition from terminal state', () => {
      const result = validateTransition('completed', 'disputed', 'user');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('terminal');
    });
  });
});
```

---

## 22. Monitoring & Logging

### 22.1 Logging System

**Location:** `src/lib/logger.ts`

```typescript
import { logger } from '@/lib/logger';

// Usage
logger.info('Order created', { orderId, userId, amount });
logger.error('Escrow failed', { error, transactionId });
logger.warn('Rate limit approaching', { userId, requestCount });
```

### 22.2 Log Levels

| Level | Usage |
|-------|-------|
| `error` | Failures requiring attention |
| `warn` | Potential issues, degraded state |
| `info` | Normal operations, audit trail |
| `debug` | Detailed debugging (dev only) |

### 22.3 Key Metrics to Monitor

| Metric | Description |
|--------|-------------|
| Order completion rate | % of orders reaching 'completed' |
| Average completion time | Time from created to completed |
| Dispute rate | % of orders entering dispute |
| API response time | P50, P95, P99 latencies |
| Escrow success rate | % of successful blockchain txs |
| Active users (DAU/MAU) | Daily/monthly active users |
| Trading volume | Daily/weekly/monthly USD volume |

### 22.4 Health Check Endpoint

```typescript
// GET /api/health
{
  status: 'healthy',
  timestamp: '2026-02-06T12:00:00Z',
  components: {
    database: 'healthy',
    pusher: 'healthy',
    solanaRpc: 'healthy'
  },
  version: '0.1.0'
}
```

---

## 23. Performance Optimization

### 23.1 Frontend Optimizations

| Technique | Implementation |
|-----------|----------------|
| Code Splitting | Next.js App Router automatic |
| Dynamic Imports | Wallet components, heavy charts |
| Image Optimization | Next.js Image component |
| Memoization | React.memo for expensive renders |
| Virtual Lists | For long order/message lists |

### 23.2 Backend Optimizations

| Technique | Implementation |
|-----------|----------------|
| Connection Pooling | pg Pool (max 20 connections) |
| Database Indexes | On user_id, merchant_id, status |
| Query Optimization | Selective column fetching |
| Caching | In-memory for hot data |
| Rate Limiting | Per-user request throttling |

### 23.3 Blockchain Optimizations

| Technique | Implementation |
|-----------|----------------|
| RPC Selection | Helius (fast) over public RPC |
| Transaction Batching | Combine related operations |
| Confirmation Strategy | Confirmed (not finalized) for speed |
| Retry Logic | Exponential backoff on failures |

---

## 24. Mobile & PWA Features

### 24.1 PWA Configuration

**Manifest:** `public/manifest.json`

```json
{
  "name": "Blip Money",
  "short_name": "Blip",
  "description": "P2P Crypto Settlement",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#18181b",
  "theme_color": "#18181b",
  "icons": [...]
}
```

### 24.2 Mobile-First Design

| Feature | Implementation |
|---------|----------------|
| Touch Targets | Min 44px tap areas |
| Bottom Navigation | Fixed nav bar for thumb access |
| Pull to Refresh | On order lists |
| Haptic Feedback | On key actions (where supported) |
| Safe Areas | iOS notch handling |

### 24.3 Offline Support

| Feature | Behavior |
|---------|----------|
| Cached Pages | Shell loads offline |
| Order Data | Last viewed orders cached |
| Chat Messages | Queue messages when offline |
| Sync | Auto-sync when back online |

### 24.4 Push Notifications

```typescript
// Notification events
- Order accepted by merchant
- Payment received
- Escrow released
- New chat message
- Dispute status change
```

---

## 25. Fee Structure

### 25.1 Platform Fees

| Fee Type | Amount | Paid By |
|----------|--------|---------|
| Trading Fee | 0.5% | Split buyer/seller |
| Network Fee | Variable | Transaction initiator |
| Dispute Fee | 1% | Losing party |

### 25.2 Fee Calculation

```typescript
function calculateFees(amount: number, type: 'buy' | 'sell') {
  const platformFee = amount * 0.005; // 0.5%
  const networkFee = estimateNetworkFee(); // ~0.001 SOL

  return {
    platformFee,
    networkFee,
    total: platformFee + networkFee
  };
}
```

---

## Appendix D: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + K` | Quick search |
| `Cmd/Ctrl + Enter` | Send message |
| `Escape` | Close modal |
| `Tab` | Navigate form fields |

---

## Appendix E: Supported Currencies

### Crypto Currencies

| Currency | Symbol | Decimals | Network |
|----------|--------|----------|---------|
| USD Coin | USDC | 6 | Solana SPL |
| Solana | SOL | 9 | Native |

### Fiat Currencies

| Currency | Code | Symbol | Regions |
|----------|------|--------|---------|
| US Dollar | USD | $ | Global |
| UAE Dirham | AED | د.إ | UAE |

---

## Appendix F: Rate Limits

| Endpoint Category | Rate Limit |
|-------------------|------------|
| Authentication | 10/minute |
| Order Creation | 5/minute |
| Order Updates | 30/minute |
| Chat Messages | 60/minute |
| General API | 100/minute |

---

## Appendix G: Webhook Events

For external integrations, the following webhook events are available:

| Event | Payload |
|-------|---------|
| `order.created` | Full order object |
| `order.completed` | Order + completion details |
| `order.disputed` | Order + dispute details |
| `merchant.verified` | Merchant object |
| `escrow.deposited` | Escrow + transaction hash |
| `escrow.released` | Escrow + recipient details |

---

**Document Version:** 1.0
**Generated:** February 2026
**Maintained by:** Blip Money Engineering Team
