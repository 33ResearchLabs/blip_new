# Wallet-Based Authentication Setup Guide

## Overview

The app now uses **wallet signature authentication** instead of passwords. Users and merchants authenticate by signing messages with their Solana wallets.

## Features

✅ **Wallet Signature Login** - Sign messages to authenticate
✅ **Username System** - Unique usernames across all users and merchants
✅ **No Passwords** - Fully wallet-based authentication
✅ **First-Time Setup** - Username creation flow for new users
✅ **Username Immutable** - Once set, usernames cannot be changed
✅ **Cross-App Unique** - Usernames are unique across users and merchants

---

## Database Migration

### Step 1: Apply Migration

Run the migration to update the schema:

```bash
psql -U postgres -d blip -f database/migrations/003_wallet_auth_usernames.sql
```

This migration will:
- Make `wallet_address` required for users
- Make `password_hash` optional (for legacy support)
- Add `username` field to merchants table
- Add unique constraints and indexes
- Create triggers to enforce global username uniqueness
- **Remove all demo/test data**

### Step 2: Verify Migration

```bash
psql -U postgres -d blip
```

```sql
-- Check users table
\d users

-- Check merchants table
\d merchants

-- Verify no demo data exists
SELECT COUNT(*) FROM users;  -- Should be 0
SELECT COUNT(*) FROM merchants;  -- Should be 0
```

---

## API Changes

### User Authentication

#### 1. Check Username Availability

```typescript
POST /api/auth/user
{
  "action": "check_username",
  "username": "alice"
}

Response:
{
  "success": true,
  "data": { "available": true }
}
```

#### 2. Login with Wallet

```typescript
POST /api/auth/user
{
  "action": "wallet_login",
  "wallet_address": "5tXJK...",
  "signature": "4hJkL...",  // Base58 encoded signature
  "message": "Sign this message to authenticate with Blip Money\n\nWallet: 5tXJK...\nTimestamp: 1706...\nNonce: abc123"
}

Response (New User):
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "username": "user_5tXJK123", ... },
    "isNewUser": true,
    "needsUsername": true
  }
}

Response (Existing User with Username):
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "username": "alice", ... },
    "isNewUser": false,
    "needsUsername": false
  }
}
```

#### 3. Set Username (First Time Only)

```typescript
POST /api/auth/user
{
  "action": "set_username",
  "wallet_address": "5tXJK...",
  "signature": "4hJkL...",
  "message": "Sign this message...",
  "username": "alice"
}

Response:
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "username": "alice", ... }
  }
}
```

### Merchant Authentication

#### 1. Login with Wallet

```typescript
POST /api/auth/merchant
{
  "action": "wallet_login",
  "wallet_address": "7yBnM...",
  "signature": "9kPqR...",
  "message": "Sign this message..."
}

Response (New Merchant):
{
  "success": true,
  "data": {
    "isNewMerchant": true,
    "needsUsername": true,
    "wallet_address": "7yBnM..."
  }
}

Response (Existing Merchant):
{
  "success": true,
  "data": {
    "merchant": { "id": "uuid", "username": "quickswap", ... },
    "isNewMerchant": false,
    "needsUsername": false
  }
}
```

#### 2. Create Merchant Account

```typescript
POST /api/auth/merchant
{
  "action": "create_merchant",
  "wallet_address": "7yBnM...",
  "signature": "9kPqR...",
  "message": "Sign this message...",
  "username": "quickswap"
}

Response:
{
  "success": true,
  "data": {
    "merchant": { "id": "uuid", "username": "quickswap", ... }
  }
}
```

#### 3. Check Username Availability

```typescript
POST /api/auth/merchant
{
  "action": "check_username",
  "username": "quickswap"
}

Response:
{
  "success": true,
  "data": { "available": false }
}
```

---

## Client-Side Implementation

### 1. Generate Message to Sign

```typescript
import { generateLoginMessage } from '@/lib/solana/verifySignature';

const message = generateLoginMessage(walletAddress);
// Returns: "Sign this message to authenticate with Blip Money\n\nWallet: 5tXJK...\nTimestamp: 1706...\nNonce: abc123"
```

### 2. Request Signature from Wallet

```typescript
import { useWallet } from '@solana/wallet-adapter-react';

const { publicKey, signMessage } = useWallet();

// Encode message
const encodedMessage = new TextEncoder().encode(message);

// Request signature from wallet
const signature = await signMessage(encodedMessage);

// Convert to base58
import bs58 from 'bs58';
const signatureBase58 = bs58.encode(signature);
```

### 3. Send to API

```typescript
const response = await fetch('/api/auth/user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'wallet_login',
    wallet_address: publicKey.toBase58(),
    signature: signatureBase58,
    message: message,
  }),
});

const data = await response.json();

if (data.success && data.data.needsUsername) {
  // Show username creation modal
}
```

---

## Frontend Flow

### User Flow

1. **Connect Wallet** → User clicks "Connect Wallet"
2. **Sign Message** → Wallet prompts to sign authentication message
3. **Check Status** → API returns if username is needed
4. **Username Modal** (if needed):
   - Show input for username (3-20 chars, alphanumeric + underscore)
   - Check availability in real-time
   - Submit with another signature
5. **Authenticated** → Store user data in localStorage as `blip_user`

### Merchant Flow

1. **Connect Wallet** → Merchant clicks "Connect Wallet"
2. **Sign Message** → Wallet prompts to sign
3. **Check Status** → API returns if new merchant
4. **Create Account** (if new):
   - Show username input + business info form
   - Submit with signature
5. **Authenticated** → Redirect to merchant dashboard

---

## Security Features

### Signature Verification

The `verifyWalletSignature` function:
- Decodes the wallet's public key
- Decodes the base58 signature
- Verifies the signature using `tweetnacl`
- Ensures the signature matches the wallet that claimed to sign it

### Message Format

```
Sign this message to authenticate with Blip Money

Wallet: {wallet_address}
Timestamp: {unix_timestamp}
Nonce: {random_string}
```

- **Timestamp**: Prevents replay attacks (messages expire after 5 minutes)
- **Nonce**: Adds randomness for additional security
- **Wallet**: Binds message to specific wallet

### Username Rules

- **Length**: 3-20 characters
- **Format**: Letters, numbers, and underscores only (`/^[a-zA-Z0-9_]+$/`)
- **Uniqueness**: Globally unique across users AND merchants
- **Immutability**: Cannot be changed once set (enforced at DB level)

---

## LocalStorage Keys

Updated from `settle_*` to `blip_*`:

- `blip_wallet` - Stores connected wallet address
- `blip_user` - Stores user data (JSON)

---

## Testing

### 1. Create Test User

```typescript
// In browser console or test file
const wallet = "5tXJK...your_wallet_address";
const message = generateLoginMessage(wallet);

// Get signature from wallet (copy from wallet adapter)
const signature = "...";

await fetch('/api/auth/user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'wallet_login',
    wallet_address: wallet,
    signature: signature,
    message: message,
  }),
});
```

### 2. Set Username

```typescript
await fetch('/api/auth/user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'set_username',
    wallet_address: wallet,
    signature: signature,
    message: message,
    username: 'alice',
  }),
});
```

---

## Dependencies

Installed packages:
- `tweetnacl` - For signature verification
- `bs58` - For base58 encoding/decoding (already present)

```bash
npm install tweetnacl --legacy-peer-deps
```

---

## Files Modified

1. **API Routes**:
   - [src/app/api/auth/user/route.ts](src/app/api/auth/user/route.ts) - User wallet auth
   - [src/app/api/auth/merchant/route.ts](src/app/api/auth/merchant/route.ts) - Merchant wallet auth

2. **Utilities**:
   - [src/lib/solana/verifySignature.ts](src/lib/solana/verifySignature.ts) - Signature verification

3. **Database**:
   - [database/migrations/003_wallet_auth_usernames.sql](database/migrations/003_wallet_auth_usernames.sql) - Schema updates

4. **Documentation**:
   - [CLOUDINARY_SETUP.md](CLOUDINARY_SETUP.md) - Cloudinary preset setup
   - This file - Wallet auth guide

---

## Next Steps

1. **Apply Database Migration**:
   ```bash
   psql -U postgres -d blip -f database/migrations/003_wallet_auth_usernames.sql
   ```

2. **Update Frontend**:
   - Add username creation modal for first-time users
   - Implement wallet signature flow
   - Update login components to use new API

3. **Remove Old Auth Code**:
   - Remove password-based login forms
   - Remove demo user credentials
   - Clean up unused auth endpoints

4. **Setup BlipScan** (see [BlipScan Setup](#blipscan-setup) below)

---

## BlipScan Setup

BlipScan is already configured in `/Users/zeus/Documents/Vscode/BM/blipscan/`

### Quick Start

```bash
# 1. Setup database
psql postgres -c "CREATE DATABASE blipscan;"
psql blipscan < /Users/zeus/Documents/Vscode/BM/blipscan/database/schema.sql

# 2. Setup indexer
cd /Users/zeus/Documents/Vscode/BM/blipscan/indexer
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev

# 3. Setup web UI
cd /Users/zeus/Documents/Vscode/BM/blipscan/web
npm install
cp .env.example .env
# Edit .env with your credentials
npm run dev
```

BlipScan will be available at `http://localhost:3001` and will automatically index all on-chain escrow transactions.

---

## Support

For issues or questions:
- Check the database migration logs
- Verify signature format is base58
- Ensure message format matches expected structure
- Check browser console for client-side errors
