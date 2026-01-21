# Settle P2P - Flow Status & Test Accounts

## Test Accounts (All pre-filled on login screens)

### Users (Login at `http://localhost:3000`)
| Email | Password | Name | Starting Balance |
|-------|----------|------|------------------|
| alice@test.com | user123 | Alice | 100,000 USDC |
| bob@test.com | user123 | Bob | 100,000 USDC |
| charlie@test.com | user123 | Charlie | 100,000 USDC |

### Merchants (Login at `http://localhost:3000/merchant`)
| Email | Password | Name | Starting Balance |
|-------|----------|------|------------------|
| quickswap@merchant.com | merchant123 | QuickSwap | 500,000 USDC |
| desertgold@merchant.com | merchant123 | DesertGold | 500,000 USDC |

### Compliance Team (Login at `http://localhost:3000/compliance`)
| Email | Password | Name | Role |
|-------|----------|------|------|
| support@settle.com | compliance123 | Support Agent | support |
| compliance@settle.com | compliance123 | Compliance Officer | compliance |

---

## Current Flow Status

### ✅ WORKING - User Flow
1. **Connect Wallet** - User connects wallet on home page
2. **Browse Offers** - View merchant offers (buy/sell)
3. **Create Order** - Select offer and amount
4. **Order Accepted** - Merchant accepts order
5. **Escrow** - Funds locked in escrow
6. **Payment** - User sends fiat payment
7. **Confirmation** - Merchant confirms payment received
8. **Release** - Crypto released to user
9. **Complete** - Order marked complete

### ✅ WORKING - Merchant Flow
1. **Login** - Email/password authentication
2. **Dashboard** - View orders in columns (New, In Escrow, Completed)
3. **Accept Orders** - Accept incoming orders
4. **Escrow Funds** - Lock crypto in escrow
5. **Confirm Payment** - Confirm fiat received
6. **Release Crypto** - Release to user
7. **Chat** - Real-time chat with users

### ✅ WORKING - Dispute Flow
1. **Open Dispute** - User or merchant can open dispute
   - Valid reasons: `payment_not_received`, `crypto_not_received`, `wrong_amount`, `fraud`, `other`
2. **Compliance Dashboard** - View all disputes
3. **Investigation** - Compliance reviews case
4. **Propose Resolution** - Compliance proposes: favor user, favor merchant, or split
5. **2-Confirmation** - BOTH user AND merchant must accept
6. **Finalize** - Resolution applied, funds released

### ✅ WORKING - Dispute Chat
- [x] Group chat (all parties see same messages)
- [x] Show dispute reason/icon in chat header
- [x] No individual messaging during dispute
- [x] System messages show dispute events (opened, proposed, accepted, rejected, finalized)

### ✅ WORKING - Money Release
- [x] After resolution, funds released to winning party
- [x] Split resolution divides funds between user and merchant
- [x] User balance updated on `users` table
- [x] Merchant balance updated on `merchants` table

### 📝 Mock/Demo Data (Not Real)
The following are placeholder data for UI demonstration only:
- Leaderboard rankings on merchant page
- Big order requests on merchant page
- Notifications dropdown (hardcoded examples)

---

## Database Tables

| Table | Status | Description |
|-------|--------|-------------|
| users | ✅ | User accounts with wallets |
| merchants | ✅ | Merchant accounts |
| merchant_offers | ✅ | Buy/sell offers |
| orders | ✅ | Trade orders |
| disputes | ✅ | Dispute records with 2-confirmation |
| chat_messages | ✅ | Order chat messages |
| compliance_team | ✅ | Compliance staff |
| order_status_history | ✅ | Audit log |

---

## API Endpoints

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/[id]` - Get order details
- `PATCH /api/orders/[id]/status` - Update status
- `GET /api/orders/[id]/messages` - Get chat messages
- `POST /api/orders/[id]/messages` - Send message

### Disputes
- `POST /api/orders/[id]/dispute` - Open dispute
- `GET /api/orders/[id]/dispute` - Get dispute info
- `POST /api/orders/[id]/dispute/confirm` - Accept/reject resolution

### Compliance
- `GET /api/compliance/disputes` - List all disputes
- `POST /api/compliance/disputes/[id]/resolve` - Propose resolution
- `PATCH /api/compliance/disputes/[id]/resolve` - Update status

### Auth
- `POST /api/auth/merchant` - Merchant login
- `POST /api/auth/compliance` - Compliance login

---

## Tech Stack
- **Frontend**: Next.js 14, React, TailwindCSS, Framer Motion
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL
- **Real-time**: Pusher
- **Wallet**: WalletConnect / Web3

---

## Quick Test Flow

1. Open 3 browser windows:
   - Window 1: `http://localhost:3000` (User - alice@test.com)
   - Window 2: `http://localhost:3000/merchant` (Merchant - quickswap@merchant.com)
   - Window 3: `http://localhost:3000/compliance` (Compliance - support@settle.com)

2. User creates order → Merchant accepts → Escrow funds
3. If issue: User opens dispute → Compliance investigates → Proposes resolution
4. Both parties confirm → Funds released
