# Username Creation & Uniqueness Audit Report

**Date**: 2026-02-12
**Project**: Blip.money (Settle App)

## Executive Summary

✅ **Username uniqueness is properly enforced**
❌ **Database schema mismatch found**
⚠️ **Profile picture field exists but inconsistent naming**

---

## 1. Username Uniqueness System

### ✅ Current Implementation (WORKING)

#### Database-Level Enforcement
- **Schema**: Both `users.username` and `merchants.username` have `UNIQUE` constraints
- **Cross-Table Uniqueness**: Enforced via database trigger function `check_username_unique()`
  - Location: [migration 003](settle/database/migrations/003_wallet_auth_usernames.sql#L54-L90)
  - Prevents username collision between users and merchants tables

#### Application-Level Validation
- **Function**: `checkUsernameAvailable()` in [users.ts:37-54](settle/src/lib/db/repositories/users.ts#L37-L54)
- **Validation**:
  - Checks both `users` and `merchants` tables
  - Case-insensitive comparison (`LOWER(username)`)
  - Used in:
    - Username modal (real-time availability check)
    - User registration API
    - Merchant registration API

#### Format Validation
- **Frontend**: [UsernameModal.tsx:31-36](settle/src/components/UsernameModal.tsx#L31-L36)
- **Backend**: [route.ts:120-132](settle/src/app/api/auth/user/route.ts#L120-L132)
- **Rules**:
  - 3-20 characters
  - Only letters, numbers, and underscores (`^[a-zA-Z0-9_]+$`)
  - Lowercase enforced on input
  - Cannot be changed after creation

---

## 2. User ID System

### ✅ UUID-Based IDs (WORKING)

#### Primary Key Structure
```sql
-- Users table
id UUID PRIMARY KEY DEFAULT uuid_generate_v4()

-- Merchants table
id UUID PRIMARY KEY DEFAULT uuid_generate_v4()
```

**Every user/merchant gets a unique UUID as their primary identifier**

#### Usage Throughout App
- All database operations use `user_id` or `merchant_id` (UUID)
- Orders reference: `user_id`, `merchant_id`, `buyer_merchant_id`
- Messages reference: `sender_id`, `recipient_id`
- Wallet addresses are separate from IDs and can be NULL

#### Authentication Flow
1. **Wallet-based**: User connects wallet → creates user with UUID → sets username
2. **Username/Password**: User registers → creates user with UUID → username set immediately

---

## 3. ⚠️ Database Schema Issues

### ❌ Critical: Missing Columns in Users Table

**Problem**: Code attempts to use fields that don't exist in schema

#### Missing Field #1: `name`
- **Code tries to insert**: [users.ts:72](settle/src/lib/db/repositories/users.ts#L72)
  ```typescript
  INSERT INTO users (username, password_hash, wallet_address, name, balance)
  VALUES ($1, $2, $3, $4, $5)
  ```
- **Schema**: Field `name` does NOT exist in [schema.sql:46-69](settle/database/schema.sql#L46-L69)
- **Impact**: `createUser()` will FAIL when called

#### Missing Field #2: `balance`
- **Code tries to insert**: [users.ts:72](settle/src/lib/db/repositories/users.ts#L72)
- **Schema**: Field `balance` does NOT exist in users table
- **Exists in**: `merchants` table only ([schema.sql:82](settle/database/schema.sql#L82))
- **Impact**: `createUser()` will FAIL in mock mode

#### Type Definition Mismatch
- **TypeScript**: [database.ts:47](settle/src/lib/types/database.ts#L47)
  ```typescript
  export interface User {
    // ...
    balance: number;  // ❌ Does not exist in DB
    // ...
  }
  ```

---

## 4. Profile Picture / Avatar System

### ✅ Current Implementation (WORKING)

#### Field Name: `avatar_url`
- **Users table**: `avatar_url TEXT` ([schema.sql:52](settle/database/schema.sql#L52))
- **Merchants table**: `avatar_url TEXT` ([schema.sql:81](settle/database/schema.sql#L81))
- **Compliance table**: `avatar_url TEXT` ([schema.sql:341](settle/database/schema.sql#L341))

#### Update Function
- [users.ts:161-201](settle/src/lib/db/repositories/users.ts#L161-L201)
  ```typescript
  export async function updateUser(
    id: string,
    data: Partial<Pick<User, 'username' | 'phone' | 'avatar_url' | 'push_token'>>
  )
  ```

#### Merchants Update
- [merchants.ts:57-90](settle/src/lib/db/repositories/merchants.ts#L57-L90)
  ```typescript
  export async function updateMerchant(
    id: string,
    data: Partial<Pick<Merchant, 'avatar_url' | ...>>
  )
  ```

**✅ Avatar system is properly implemented and ready for use**

---

## 5. Recommendations

### 🔴 HIGH PRIORITY - Fix Database Schema Mismatch

#### Option A: Remove from Code (Recommended)
Remove `name` and `balance` from users repository:

```diff
// settle/src/lib/db/repositories/users.ts
export async function createUser(data: CreateUserInput) {
  const passwordHash = data.password ? hashPassword(data.password) : null;
-  const initialBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
  const result = await queryOne<User>(
    `
-    INSERT INTO users (username, password_hash, wallet_address, name, balance)
-    VALUES ($1, $2, $3, $4, $5)
+    INSERT INTO users (username, password_hash, wallet_address)
+    VALUES ($1, $2, $3)
     RETURNING *
    `,
    [
      data.username ?? null,
      passwordHash,
      data.wallet_address ?? null,
-      data.name ?? null,
-      initialBalance,
    ]
  );
  return sanitizeUser(result)!;
}
```

#### Option B: Add to Database Schema
If you need these fields, create migration:

```sql
-- settle/database/migrations/020_add_user_name_balance.sql
ALTER TABLE users ADD COLUMN name VARCHAR(100);
ALTER TABLE users ADD COLUMN balance DECIMAL(20, 6) DEFAULT 0;
```

### 🟡 MEDIUM PRIORITY - Type Safety

Update TypeScript types to match actual schema:

```diff
// settle/src/lib/types/database.ts
export interface User {
  id: string;
  username: string;
  password_hash?: string;
  wallet_address: string | null;
  phone: string | null;
  avatar_url: string | null;  // ✅ This exists
-  balance: number;            // ❌ Remove if not adding to DB
+  // balance: number;
  // ...
}
```

### 🟢 FUTURE ENHANCEMENTS

#### Profile Data Expansion
When adding more profile fields, create migration:

```sql
-- Future migration example
ALTER TABLE users ADD COLUMN bio TEXT;
ALTER TABLE users ADD COLUMN location VARCHAR(100);
ALTER TABLE users ADD COLUMN twitter_handle VARCHAR(50);
ALTER TABLE users ADD COLUMN telegram_handle VARCHAR(50);

-- Same for merchants
ALTER TABLE merchants ADD COLUMN bio TEXT;
-- etc.
```

Then update:
1. TypeScript interfaces in `database.ts`
2. Repository functions in `users.ts` / `merchants.ts`
3. Update functions to allow partial updates

---

## 6. Current Auth Flow Verification

### ✅ Wallet Login Flow (WORKING)

1. User connects wallet via [page.tsx](settle/src/app/page.tsx)
2. POST `/api/auth/user` with action: `wallet_login`
3. Verifies signature via [verifySignature](settle/src/lib/solana/verifySignature.ts)
4. If new user:
   - Creates user with temporary username: `user_${wallet_address.slice(0, 8)}`
   - Returns `needsUsername: true`
5. Shows [UsernameModal.tsx](settle/src/components/UsernameModal.tsx)
6. User picks username (checked for availability)
7. POST `/api/auth/user` with action: `set_username`
8. Updates username (enforces uniqueness)

**Each user gets unique UUID ID at step 4**

### ✅ Direct Messaging System (WORKING)

Uses user IDs throughout:
- [directMessages.ts](settle/src/lib/db/repositories/directMessages.ts)
- Sender/recipient identified by: `{type: 'user'|'merchant', id: UUID}`
- No username conflicts possible

---

## 7. Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Username Uniqueness | ✅ Working | Database triggers + app validation |
| User UUID IDs | ✅ Working | Every user has unique UUID |
| Avatar URL | ✅ Working | Field exists, updates implemented |
| User `name` field | ❌ Broken | Code uses it, DB doesn't have it |
| User `balance` field | ❌ Broken | Code uses it, DB doesn't have it |
| Cross-table username check | ✅ Working | Prevents user/merchant collisions |
| Case-insensitive checks | ✅ Working | LOWER() used in queries |

---

## 8. Action Items

1. **URGENT**: Fix schema mismatch - remove `name` and `balance` from createUser()
2. **IMPORTANT**: Update TypeScript types to match actual schema
3. **NICE TO HAVE**: Add comprehensive user profile fields via migration
4. **TEST**: Verify user creation works after fix
5. **DOCUMENT**: Update API docs with correct user fields

---

## Files to Review

### Critical Files
- [settle/src/lib/db/repositories/users.ts](settle/src/lib/db/repositories/users.ts)
- [settle/database/schema.sql](settle/database/schema.sql)
- [settle/src/lib/types/database.ts](settle/src/lib/types/database.ts)

### Auth System
- [settle/src/app/api/auth/user/route.ts](settle/src/app/api/auth/user/route.ts)
- [settle/src/components/UsernameModal.tsx](settle/src/components/UsernameModal.tsx)

### Migrations
- [settle/database/migrations/003_wallet_auth_usernames.sql](settle/database/migrations/003_wallet_auth_usernames.sql)
