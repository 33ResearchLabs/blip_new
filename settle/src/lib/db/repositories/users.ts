import { query, queryOne } from '../index';
import { User, UserBankAccount } from '../../types/database';
import crypto from 'crypto';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';

// Simple password hashing (in production, use bcrypt)
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

// Strip password_hash from user object before returning
function sanitizeUser(user: User | null): Omit<User, 'password_hash'> | null {
  if (!user) return null;
  const { password_hash, ...safeUser } = user;
  return safeUser;
}

export async function getUserById(id: string): Promise<Omit<User, 'password_hash'> | null> {
  const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
  return sanitizeUser(user);
}

export async function getUserByWallet(walletAddress: string): Promise<Omit<User, 'password_hash'> | null> {
  const user = await queryOne<User>('SELECT * FROM users WHERE wallet_address = $1', [walletAddress]);
  return sanitizeUser(user);
}

export async function getUserByUsername(username: string): Promise<User | null> {
  // Returns full user including password_hash for auth verification
  return queryOne<User>('SELECT * FROM users WHERE username = $1', [username]);
}

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  // Check both users and merchants tables to ensure username uniqueness across platform
  const userResult = await queryOne<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM users WHERE LOWER(username) = LOWER($1)',
    [username]
  );

  const merchantResult = await queryOne<{ count: string | number }>(
    'SELECT COUNT(*) as count FROM merchants WHERE LOWER(username) = LOWER($1)',
    [username]
  );

  // PostgreSQL COUNT returns bigint which pg converts to string for safety
  const userCount = parseInt(String(userResult?.count || 0));
  const merchantCount = parseInt(String(merchantResult?.count || 0));

  return userCount === 0 && merchantCount === 0;
}

type CreateUserInput = {
  username?: string;
  password?: string;
  wallet_address?: string;
  name?: string;
};

export async function createUser(
  data: CreateUserInput
): Promise<Omit<User, 'password_hash'>> {
  // Password is optional for wallet-based authentication
  const passwordHash = data.password ? hashPassword(data.password) : null;
  // In mock mode, auto-fund new accounts with initial USDT balance
  const initialBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
  const result = await queryOne<User>(
    `
    INSERT INTO users (username, password_hash, wallet_address, name, balance)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      data.username ?? null,
      passwordHash,
      data.wallet_address ?? null,
      data.name ?? null,
      initialBalance,
    ]
  );

  return sanitizeUser(result)!;
}


export async function authenticateUser(
  username: string,
  password: string
): Promise<Omit<User, 'password_hash'> | null> {
  const user = await getUserByUsername(username);
  if (!user || !user.password_hash) return null;

  if (!verifyPassword(password, user.password_hash)) {
    return null;
  }

  return sanitizeUser(user);
}

export async function updateUsername(
  id: string,
  newUsername: string
): Promise<Omit<User, 'password_hash'> | null> {
  // Check if username is available
  const available = await checkUsernameAvailable(newUsername);
  if (!available) {
    throw new Error('Username already taken');
  }

  const result = await queryOne<User>(
    `UPDATE users SET username = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [newUsername, id]
  );
  return sanitizeUser(result);
}

export async function updatePassword(
  id: string,
  currentPassword: string,
  newPassword: string
): Promise<boolean> {
  const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
  if (!user || !user.password_hash) return false;

  if (!verifyPassword(currentPassword, user.password_hash)) {
    return false;
  }

  const newHash = hashPassword(newPassword);
  await query(
    `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
    [newHash, id]
  );
  return true;
}

export async function linkWalletToUser(
  id: string,
  walletAddress: string
): Promise<Omit<User, 'password_hash'> | null> {
  // Check if wallet is already linked to another user
  const existingUser = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE wallet_address = $1 AND id != $2',
    [walletAddress, id]
  );

  if (existingUser) {
    throw new Error('Wallet already linked to another account');
  }

  const result = await queryOne<User>(
    `UPDATE users SET wallet_address = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [walletAddress, id]
  );
  return sanitizeUser(result);
}

export async function updateUser(
  id: string,
  data: Partial<Pick<User, 'username' | 'phone' | 'avatar_url' | 'push_token'>>
): Promise<Omit<User, 'password_hash'> | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.username !== undefined) {
    // Check username availability
    const available = await checkUsernameAvailable(data.username);
    const currentUser = await queryOne<{ username: string }>('SELECT username FROM users WHERE id = $1', [id]);
    if (!available && currentUser?.username !== data.username) {
      throw new Error('Username already taken');
    }
    fields.push(`username = $${paramIndex++}`);
    values.push(data.username);
  }
  if (data.phone !== undefined) {
    fields.push(`phone = $${paramIndex++}`);
    values.push(data.phone);
  }
  if (data.avatar_url !== undefined) {
    fields.push(`avatar_url = $${paramIndex++}`);
    values.push(data.avatar_url);
  }
  if (data.push_token !== undefined) {
    fields.push(`push_token = $${paramIndex++}`);
    values.push(data.push_token);
  }

  if (fields.length === 0) return getUserById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);
  const result = await queryOne<User>(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  return sanitizeUser(result);
}

export async function incrementUserStats(
  id: string,
  volume: number
): Promise<void> {
  await query(
    `UPDATE users
     SET total_trades = total_trades + 1,
         total_volume = total_volume + $1
     WHERE id = $2`,
    [volume, id]
  );
}

// Bank Accounts
export async function getUserBankAccounts(userId: string): Promise<UserBankAccount[]> {
  return query<UserBankAccount>(
    'SELECT * FROM user_bank_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
    [userId]
  );
}

export async function addBankAccount(data: {
  user_id: string;
  bank_name: string;
  account_name: string;
  iban: string;
  is_default?: boolean;
}): Promise<UserBankAccount> {
  // If this is default, unset other defaults
  if (data.is_default) {
    await query('UPDATE user_bank_accounts SET is_default = false WHERE user_id = $1', [data.user_id]);
  }

  const result = await queryOne<UserBankAccount>(
    `INSERT INTO user_bank_accounts (user_id, bank_name, account_name, iban, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.user_id, data.bank_name, data.account_name, data.iban, data.is_default || false]
  );
  return result!;
}

export async function deleteBankAccount(id: string, userId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM user_bank_accounts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return (result as unknown[]).length > 0;
}

export async function setDefaultBankAccount(id: string, userId: string): Promise<void> {
  await query('UPDATE user_bank_accounts SET is_default = false WHERE user_id = $1', [userId]);
  await query('UPDATE user_bank_accounts SET is_default = true WHERE id = $1 AND user_id = $2', [id, userId]);
}
