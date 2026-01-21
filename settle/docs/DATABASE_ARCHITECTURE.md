# Database Architecture & Trade Flow

## Overview

P2P crypto settlement platform connecting **Users** (buyers/sellers of USDC) with **Merchants** (liquidity providers).

---

## Database Schema

### 1. Users Table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(20),
  avatar_url TEXT,

  -- KYC
  kyc_status ENUM('none', 'pending', 'verified', 'rejected') DEFAULT 'none',
  kyc_level INT DEFAULT 0,

  -- Stats
  total_trades INT DEFAULT 0,
  total_volume DECIMAL(20, 2) DEFAULT 0,
  rating DECIMAL(2, 1) DEFAULT 5.0,

  -- Settings
  push_token TEXT,
  notification_settings JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 2. Merchants Table
```sql
CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address VARCHAR(64) UNIQUE NOT NULL,
  business_name VARCHAR(100) NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  avatar_url TEXT,

  -- Verification
  status ENUM('pending', 'active', 'suspended', 'banned') DEFAULT 'pending',
  verification_level INT DEFAULT 1,

  -- Stats
  total_trades INT DEFAULT 0,
  total_volume DECIMAL(20, 2) DEFAULT 0,
  rating DECIMAL(2, 1) DEFAULT 5.0,
  rating_count INT DEFAULT 0,
  avg_response_time_mins INT DEFAULT 5,

  -- Availability
  is_online BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMP,
  auto_accept_enabled BOOLEAN DEFAULT false,
  auto_accept_max_amount DECIMAL(20, 2),

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 3. Merchant Offers Table
```sql
CREATE TABLE merchant_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID REFERENCES merchants(id),

  -- Offer Type
  type ENUM('buy', 'sell') NOT NULL,  -- merchant buys/sells USDC
  payment_method ENUM('bank', 'cash') NOT NULL,

  -- Pricing
  rate DECIMAL(10, 4) NOT NULL,  -- AED per USDC
  rate_type ENUM('fixed', 'market_margin') DEFAULT 'fixed',
  margin_percent DECIMAL(5, 2),  -- if market_margin, +/- from market rate

  -- Limits
  min_amount DECIMAL(20, 2) NOT NULL,
  max_amount DECIMAL(20, 2) NOT NULL,
  available_amount DECIMAL(20, 2) NOT NULL,  -- current liquidity

  -- Bank Details (if bank transfer)
  bank_name VARCHAR(100),
  bank_account_name VARCHAR(100),
  bank_iban VARCHAR(34),

  -- Cash Details (if cash)
  location_name VARCHAR(100),
  location_address TEXT,
  location_lat DECIMAL(10, 7),
  location_lng DECIMAL(10, 7),
  meeting_instructions TEXT,

  -- Settings
  is_active BOOLEAN DEFAULT true,
  requires_kyc_level INT DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_offers_active ON merchant_offers(is_active, type, payment_method);
CREATE INDEX idx_offers_merchant ON merchant_offers(merchant_id);
```

### 4. Orders Table
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(20) UNIQUE NOT NULL,  -- human readable: BM-240115-XXXX

  -- Parties
  user_id UUID REFERENCES users(id),
  merchant_id UUID REFERENCES merchants(id),
  offer_id UUID REFERENCES merchant_offers(id),

  -- Order Type
  type ENUM('buy', 'sell') NOT NULL,  -- user buys/sells USDC
  payment_method ENUM('bank', 'cash') NOT NULL,

  -- Amounts
  crypto_amount DECIMAL(20, 6) NOT NULL,
  crypto_currency VARCHAR(10) DEFAULT 'USDC',
  fiat_amount DECIMAL(20, 2) NOT NULL,
  fiat_currency VARCHAR(10) DEFAULT 'AED',
  rate DECIMAL(10, 4) NOT NULL,  -- locked rate at order creation

  -- Fees
  platform_fee DECIMAL(20, 6) DEFAULT 0,
  network_fee DECIMAL(20, 6) DEFAULT 0,

  -- Status
  status ENUM(
    'pending',          -- waiting for merchant to accept
    'accepted',         -- merchant accepted, waiting for action
    'escrow_pending',   -- waiting for escrow confirmation
    'escrowed',         -- crypto locked in escrow
    'payment_pending',  -- waiting for fiat payment
    'payment_sent',     -- user marked payment sent
    'payment_confirmed',-- merchant confirmed fiat received
    'releasing',        -- releasing from escrow
    'completed',        -- done
    'cancelled',        -- cancelled by user/merchant
    'disputed',         -- in dispute
    'expired'           -- timed out
  ) DEFAULT 'pending',

  -- Escrow
  escrow_tx_hash VARCHAR(128),
  escrow_address VARCHAR(64),
  release_tx_hash VARCHAR(128),

  -- Payment Details (snapshot at order time)
  payment_details JSONB,  -- bank/cash details

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  accepted_at TIMESTAMP,
  escrowed_at TIMESTAMP,
  payment_sent_at TIMESTAMP,
  payment_confirmed_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  expires_at TIMESTAMP,

  -- Cancellation
  cancelled_by ENUM('user', 'merchant', 'system'),
  cancellation_reason TEXT
);

CREATE INDEX idx_orders_user ON orders(user_id, status);
CREATE INDEX idx_orders_merchant ON orders(merchant_id, status);
CREATE INDEX idx_orders_status ON orders(status, created_at);
```

### 5. Order Events Table (Audit Log)
```sql
CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),

  event_type VARCHAR(50) NOT NULL,
  actor_type ENUM('user', 'merchant', 'system') NOT NULL,
  actor_id UUID,

  old_status VARCHAR(30),
  new_status VARCHAR(30),

  metadata JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_events_order ON order_events(order_id, created_at);
```

### 6. Chat Messages Table
```sql
CREATE TABLE chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),

  sender_type ENUM('user', 'merchant', 'system') NOT NULL,
  sender_id UUID,

  message_type ENUM('text', 'image', 'system') DEFAULT 'text',
  content TEXT NOT NULL,
  image_url TEXT,

  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_order ON chat_messages(order_id, created_at);
```

### 7. User Bank Accounts Table
```sql
CREATE TABLE user_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),

  bank_name VARCHAR(100) NOT NULL,
  account_name VARCHAR(100) NOT NULL,
  iban VARCHAR(34) NOT NULL,

  is_default BOOLEAN DEFAULT false,
  is_verified BOOLEAN DEFAULT false,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_bank_accounts_user ON user_bank_accounts(user_id);
```

### 8. Reviews Table
```sql
CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id) UNIQUE,

  reviewer_type ENUM('user', 'merchant') NOT NULL,
  reviewer_id UUID NOT NULL,
  reviewee_type ENUM('user', 'merchant') NOT NULL,
  reviewee_id UUID NOT NULL,

  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);
```

### 9. Disputes Table
```sql
CREATE TABLE disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),

  raised_by ENUM('user', 'merchant') NOT NULL,
  raiser_id UUID NOT NULL,

  reason ENUM(
    'payment_not_received',
    'crypto_not_received',
    'wrong_amount',
    'fraud',
    'other'
  ) NOT NULL,
  description TEXT,
  evidence_urls TEXT[],

  status ENUM('open', 'investigating', 'resolved', 'escalated') DEFAULT 'open',
  resolution TEXT,
  resolved_in_favor_of ENUM('user', 'merchant'),

  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);
```

---

## Trade Flow

### BUY USDC (User pays fiat, receives crypto)

```
USER APP                          BACKEND                         MERCHANT APP
────────                          ───────                         ────────────
1. Enter amount
   Select payment method
   Click "Continue"
        │
        ▼
        ├──────► 2. Find best offer
                    Match with merchant
                    Create order (status: pending)
                    Notify merchant
                         │
                         ├─────────────────────────────────────► 3. Receive notification
                                                                    "New order request"
                                                                         │
                                                                         ▼
                                                                 4. Review order
                                                                    Accept/Decline
                                                                         │
        ◄────────────────────────────────────────────────────────────────┤
        │                                                                │
5. If DECLINED:                                                   (status: cancelled)
   "Order declined"
   Back to home
        │
5. If ACCEPTED:                                                   (status: accepted)
   Show "Order Accepted!"
   Merchant escrows USDC ◄────────────────────────────────────── 6. Lock USDC to escrow
        │                                                             (on-chain tx)
        ▼                                                                │
6. Escrow confirmed                                               (status: escrowed)
   Show bank/cash details                                                │
   "Send payment"                                                        ▼
        │                                                         7. Waiting for payment
        ▼                                                            See "Payment pending"
7. User sends fiat                                                       │
   (bank transfer / cash)                                                │
        │                                                                │
        ▼                                                                │
8. Click "I've paid"           ──────────────────────────────────► 8. Receive notification
   (status: payment_sent)                                             "User marked paid"
        │                                                                │
        ▼                                                                ▼
9. Waiting for                                                    9. Verify payment
   confirmation...                                                   Check bank/meet user
        │                                                                │
        │                                                                ▼
        │                                                         10. Click "Confirm received"
        │                                                             (status: payment_confirmed)
        │                                                                │
        ◄────────────────────────────────────────────────────────────────┤
        │                                                                │
10. USDC released               ◄──── Backend releases escrow ────►  USDC released
    to user wallet                    (on-chain tx)                  from escrow
    (status: completed)                                              (status: completed)
        │                                                                │
        ▼                                                                ▼
11. Rate merchant                                                 11. Rate user
    Order complete                                                    Order complete
```

### SELL USDC (User sells crypto, receives fiat)

```
USER APP                          BACKEND                         MERCHANT APP
────────                          ───────                         ────────────
1. Enter amount
   Select "Sell"
   Click "Continue"
        │
        ▼
2. Escrow confirmation
   "Lock X USDC"
   Click "Confirm"
        │
        ▼
3. Sign transaction            ──────► 4. Verify escrow on-chain
   USDC locked                         Create order (status: escrowed)
        │                              Notify merchants
        ▼                                    │
4. "Looking for buyer"                       ├─────────────────────────► 5. See new sell order
   (status: pending)                                                        available
        │                                                                        │
        │                                                                        ▼
        │                                                                 6. Click "Accept"
        │                                                                    (status: accepted)
        ◄────────────────────────────────────────────────────────────────────────┤
        │                                                                        │
5. "Buyer found!"                                                                │
   Show buyer details                                                            ▼
   Waiting for payment...                                                 7. Send fiat to user
        │                                                                    (bank/cash)
        │                                                                        │
        │                                                                        ▼
        │                                                                 8. Click "I've paid"
        │                                                                    (status: payment_sent)
        ◄────────────────────────────────────────────────────────────────────────┤
        │
6. "Payment sent"
   Check bank/meet buyer
        │
        ▼
7. Click "Confirm received"    ──────────────────────────────────────────────────►
   (status: payment_confirmed)                                                   │
        │                                                                        │
        ▼                                                                        ▼
8. USDC released               ◄──── Backend releases escrow ────►        USDC received
   to merchant                       (on-chain tx)                        in wallet
   (status: completed)                                                    (status: completed)
```

---

## API Endpoints

### User App APIs

```
Authentication
POST   /auth/wallet              - Connect wallet & sign message
POST   /auth/refresh             - Refresh token

User Profile
GET    /user/profile             - Get user profile
PATCH  /user/profile             - Update profile
GET    /user/bank-accounts       - List bank accounts
POST   /user/bank-accounts       - Add bank account
DELETE /user/bank-accounts/:id   - Remove bank account

Trading
GET    /offers                   - List available offers (with filters)
GET    /offers/:id               - Get offer details
POST   /orders                   - Create new order
GET    /orders                   - List user's orders
GET    /orders/:id               - Get order details
POST   /orders/:id/cancel        - Cancel order
POST   /orders/:id/payment-sent  - Mark payment as sent
POST   /orders/:id/confirm       - Confirm fiat received (for sell)
POST   /orders/:id/review        - Submit review

Chat
GET    /orders/:id/messages      - Get chat messages
POST   /orders/:id/messages      - Send message
POST   /orders/:id/messages/read - Mark messages as read

Disputes
POST   /orders/:id/dispute       - Raise dispute
GET    /disputes/:id             - Get dispute details
POST   /disputes/:id/evidence    - Add evidence
```

### Merchant App APIs

```
Authentication
POST   /merchant/auth/wallet     - Connect wallet & sign message
POST   /merchant/auth/refresh    - Refresh token

Profile
GET    /merchant/profile         - Get merchant profile
PATCH  /merchant/profile         - Update profile
PATCH  /merchant/availability    - Set online/offline

Offers
GET    /merchant/offers          - List my offers
POST   /merchant/offers          - Create offer
PATCH  /merchant/offers/:id      - Update offer
DELETE /merchant/offers/:id      - Delete offer

Orders
GET    /merchant/orders          - List orders
GET    /merchant/orders/:id      - Get order details
POST   /merchant/orders/:id/accept  - Accept order
POST   /merchant/orders/:id/decline - Decline order
POST   /merchant/orders/:id/escrow  - Confirm escrow sent
POST   /merchant/orders/:id/payment-sent    - Mark payment sent (for sell orders)
POST   /merchant/orders/:id/confirm         - Confirm payment received
POST   /merchant/orders/:id/review          - Submit review

Chat
GET    /merchant/orders/:id/messages  - Get chat messages
POST   /merchant/orders/:id/messages  - Send message

Stats
GET    /merchant/stats           - Get trading stats
GET    /merchant/earnings        - Get earnings breakdown
```

---

## Real-time Events (WebSocket/SSE)

### User Events
```
order:accepted        - Merchant accepted your order
order:escrowed        - Escrow confirmed
order:payment_sent    - (Sell) Buyer sent payment
order:completed       - Order completed
order:cancelled       - Order cancelled
order:disputed        - Dispute raised
message:new           - New chat message
```

### Merchant Events
```
order:new             - New order request
order:payment_sent    - User marked payment sent
order:confirmed       - User confirmed payment (sell)
order:cancelled       - Order cancelled
order:disputed        - Dispute raised
message:new           - New chat message
```

---

## Escrow Contract Interface

```solidity
interface IEscrow {
    // Lock USDC for an order
    function lockFunds(
        bytes32 orderId,
        address seller,
        address buyer,
        uint256 amount
    ) external;

    // Release funds to buyer (called by backend after confirmation)
    function releaseFunds(bytes32 orderId) external;

    // Refund to seller (cancelled/expired/dispute)
    function refundFunds(bytes32 orderId) external;

    // Events
    event FundsLocked(bytes32 indexed orderId, address seller, address buyer, uint256 amount);
    event FundsReleased(bytes32 indexed orderId, address buyer, uint256 amount);
    event FundsRefunded(bytes32 indexed orderId, address seller, uint256 amount);
}
```

---

## State Machine

```
                    ┌──────────────┐
                    │   pending    │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            │            ▼
        ┌─────────┐        │      ┌──────────┐
        │cancelled│        │      │ expired  │
        └─────────┘        │      └──────────┘
                           ▼
                    ┌──────────────┐
                    │   accepted   │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │escrow_pending│
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   escrowed   │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │payment_pending│
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
                    │ payment_sent │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            │            ▼
        ┌─────────┐        │      ┌──────────┐
        │disputed │        │      │  (wait)  │
        └────┬────┘        │      └──────────┘
             │             ▼
             │      ┌──────────────┐
             │      │payment_confirmed│
             │      └──────┬───────┘
             │             │
             │             ▼
             │      ┌──────────────┐
             │      │  releasing   │
             │      └──────┬───────┘
             │             │
             ▼             ▼
        ┌─────────────────────────┐
        │       completed         │
        └─────────────────────────┘
```

---

## Timeouts

| State | Timeout | Action |
|-------|---------|--------|
| pending | 15 min | Auto-cancel, return escrow |
| accepted | 30 min | Merchant must escrow |
| escrowed | 2 hours | User must pay |
| payment_sent | 4 hours | Merchant must confirm |
| disputed | 72 hours | Admin resolution |

---

## Tech Stack Recommendation

- **Database**: PostgreSQL (Supabase)
- **Backend**: Node.js / Next.js API routes
- **Real-time**: Supabase Realtime / WebSocket
- **Auth**: Wallet signature + JWT
- **Blockchain**: Solana (USDC)
- **Push Notifications**: Firebase Cloud Messaging
- **File Storage**: Supabase Storage (chat images, KYC docs)
