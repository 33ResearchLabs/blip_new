import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import crypto from 'crypto';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';

// Simple password hashing using Node's crypto
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// GET handler - fetch merchant by wallet address or validate session
export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, 'auth:merchant:get', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const wallet_address = searchParams.get('wallet_address');
    const merchant_id = searchParams.get('merchant_id');

    // Check session validity
    if (action === 'check_session' && merchant_id) {
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, rating, total_trades, balance
         FROM merchants
         WHERE id = $1 AND status = 'active'`,
        [merchant_id]
      );

      if (rows.length === 0) {
        return NextResponse.json({
          success: true,
          data: { valid: false },
        });
      }

      const merchant = rows[0] as {
        id: string;
        username: string | null;
        display_name: string;
        business_name: string;
        wallet_address: string;
        rating: number;
        total_trades: number;
        balance: number;
      };

      // Set merchant online when session is validated (critical for order matching!)
      await query(
        `UPDATE merchants SET is_online = true, last_seen_at = NOW() WHERE id = $1`,
        [merchant.id]
      );
      console.log('[API] Merchant session restored, set online:', merchant.id);

      return NextResponse.json({
        success: true,
        data: {
          valid: true,
          merchant: {
            id: merchant.id,
            username: merchant.username,
            display_name: merchant.display_name,
            business_name: merchant.business_name,
            wallet_address: merchant.wallet_address,
            rating: parseFloat(String(merchant.rating)) || 5,
            total_trades: merchant.total_trades || 0,
            balance: parseFloat(String(merchant.balance)) || 0,
          },
        },
      });
    }

    if (action === 'wallet_login' && wallet_address) {
      // Query merchant by wallet address
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, rating, total_trades, is_online
         FROM merchants
         WHERE wallet_address = $1 AND status = 'active'`,
        [wallet_address]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Merchant not found' },
          { status: 404 }
        );
      }

      const merchant = rows[0] as {
        id: string;
        username: string | null;
        display_name: string;
        business_name: string;
        wallet_address: string;
        rating: number;
        total_trades: number;
        is_online: boolean;
      };

      return NextResponse.json({
        success: true,
        data: {
          id: merchant.id,
          username: merchant.username,
          display_name: merchant.display_name,
          business_name: merchant.business_name,
          wallet_address: merchant.wallet_address,
          rating: parseFloat(String(merchant.rating)) || 5,
          total_trades: merchant.total_trades || 0,
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('GET /api/auth/merchant error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch merchant' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 5 auth attempts per minute (prevents brute force)
  const rateLimitResponse = checkRateLimit(request, 'auth:merchant', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { action, wallet_address, signature, message, username } = body;

    // Wallet-based login/signup
    if (action === 'wallet_login') {
      if (!wallet_address || !signature || !message) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, and message are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Query merchant by wallet address
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, rating, total_trades, is_online, balance
         FROM merchants
         WHERE wallet_address = $1 AND status = 'active'`,
        [wallet_address]
      );

      let merchant;
      let isNewMerchant = false;
      let needsUsername = false;

      if (rows.length === 0) {
        // New merchant - needs to set username
        return NextResponse.json({
          success: true,
          data: {
            isNewMerchant: true,
            needsUsername: true,
            wallet_address,
          },
        });
      } else {
        merchant = rows[0] as {
          id: string;
          username: string | null;
          display_name: string;
          business_name: string;
          wallet_address: string;
          rating: number;
          total_trades: number;
          is_online: boolean;
          balance: number;
        };

        // Check if username needs to be set
        if (!merchant.username || merchant.username.startsWith('merchant_')) {
          needsUsername = true;
        }

        // Update online status
        await query(
          `UPDATE merchants SET is_online = true, last_seen_at = NOW() WHERE id = $1`,
          [merchant.id]
        );

        // Check if merchant has any offers, if not create default ones
        const existingOffers = await query(
          `SELECT id FROM merchant_offers WHERE merchant_id = $1 LIMIT 1`,
          [merchant.id]
        );

        if (existingOffers.length === 0) {
          console.log('[API] No offers found for merchant, creating defaults:', merchant.id);
          try {
            const displayName = merchant.display_name || merchant.username || 'Merchant';
            // Create a sell offer (bank transfer)
            await query(
              `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
               VALUES ($1, 'sell', 'bank', 3.67, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
              [merchant.id, displayName]
            );

            // Create a buy offer (bank transfer)
            await query(
              `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
               VALUES ($1, 'buy', 'bank', 3.65, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
              [merchant.id, displayName]
            );

            console.log('[API] Default offers created for existing merchant:', merchant.id);
          } catch (offerError) {
            console.error('[API] Failed to create default offers:', offerError);
          }
        }

        console.log('[API] Merchant login successful:', merchant.id, merchant.username);

        return NextResponse.json({
          success: true,
          data: {
            merchant: {
              id: merchant.id,
              username: merchant.username,
              display_name: merchant.display_name,
              business_name: merchant.business_name,
              wallet_address: merchant.wallet_address,
              rating: parseFloat(String(merchant.rating)) || 5,
              total_trades: merchant.total_trades || 0,
              balance: parseFloat(String(merchant.balance)) || 0,
            },
            isNewMerchant,
            needsUsername,
          },
        });
      }
    }

    // Create new merchant account with username
    if (action === 'create_merchant') {
      if (!wallet_address || !signature || !message || !username) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, message, and username are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Validate username
      if (username.length < 3 || username.length > 20) {
        return NextResponse.json(
          { success: false, error: 'Username must be 3-20 characters' },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return NextResponse.json(
          { success: false, error: 'Username can only contain letters, numbers, and underscores' },
          { status: 400 }
        );
      }

      // Check if username is taken (across users and merchants)
      const userCheck = await query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      const merchantCheck = await query(
        `SELECT id FROM merchants WHERE username = $1`,
        [username]
      );

      if (userCheck.length > 0 || merchantCheck.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Check if wallet already has a merchant account
      const existingMerchant = await query(
        `SELECT id FROM merchants WHERE wallet_address = $1`,
        [wallet_address]
      );

      if (existingMerchant.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Wallet already linked to a merchant account' },
          { status: 409 }
        );
      }

      // Create merchant (auto-funded in mock mode)
      const merchantBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
      const result = await query(
        `INSERT INTO merchants (
          wallet_address,
          username,
          business_name,
          display_name,
          email,
          status,
          is_online,
          balance
        ) VALUES ($1, $2, $3, $4, $5, 'active', true, $6)
        RETURNING id, username, display_name, business_name, wallet_address, rating, total_trades`,
        [wallet_address, username, username, username, `${username}@merchant.blip.money`, merchantBalance]
      );

      const merchant = result[0] as {
        id: string;
        username: string;
        display_name: string;
        business_name: string;
        wallet_address: string;
        rating: number;
        total_trades: number;
      };

      console.log('[API] New merchant created:', merchant.id, merchant.username, MOCK_MODE ? `(mock balance: ${merchantBalance})` : '');

      // Auto-create default offers for new merchant (so they can start receiving orders immediately)
      try {
        // Create a sell offer (bank transfer) - users can buy USDC from this merchant
        await query(
          `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
           VALUES ($1, 'sell', 'bank', 3.67, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
          [merchant.id, username]
        );

        // Create a buy offer (bank transfer) - users can sell USDC to this merchant
        await query(
          `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
           VALUES ($1, 'buy', 'bank', 3.65, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
          [merchant.id, username]
        );

        console.log('[API] Default offers created for merchant:', merchant.id);
      } catch (offerError) {
        console.error('[API] Failed to create default offers:', offerError);
        // Don't fail the registration if offer creation fails
      }

      return NextResponse.json({
        success: true,
        data: {
          merchant: {
            id: merchant.id,
            username: merchant.username,
            display_name: merchant.display_name,
            business_name: merchant.business_name,
            wallet_address: merchant.wallet_address,
            rating: parseFloat(String(merchant.rating)) || 5,
            total_trades: merchant.total_trades || 0,
            balance: 0,
          },
        },
      });
    }

    // Set username for existing merchant
    if (action === 'set_username') {
      if (!wallet_address || !signature || !message || !username) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, message, and username are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Validate username
      if (username.length < 3 || username.length > 20) {
        return NextResponse.json(
          { success: false, error: 'Username must be 3-20 characters' },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return NextResponse.json(
          { success: false, error: 'Username can only contain letters, numbers, and underscores' },
          { status: 400 }
        );
      }

      // Check if username is taken
      const userCheck = await query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      const merchantCheck = await query(
        `SELECT id FROM merchants WHERE username = $1`,
        [username]
      );

      if (userCheck.length > 0 || merchantCheck.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Get merchant
      const merchantRows = await query(
        `SELECT id, username FROM merchants WHERE wallet_address = $1`,
        [wallet_address]
      );

      if (merchantRows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Merchant not found' },
          { status: 404 }
        );
      }

      const merchant = merchantRows[0] as { id: string; username: string | null };

      // Check if merchant already has a non-temporary username
      if (merchant.username && !merchant.username.startsWith('merchant_')) {
        return NextResponse.json(
          { success: false, error: 'Username already set and cannot be changed' },
          { status: 400 }
        );
      }

      // Update username
      await query(
        `UPDATE merchants SET username = $1, display_name = $2, business_name = $3 WHERE id = $4`,
        [username, username, username, merchant.id]
      );

      console.log('[API] Merchant username set:', merchant.id, username);

      return NextResponse.json({
        success: true,
        data: { message: 'Username set successfully' },
      });
    }

    // Update username for existing merchant (no signature required)
    if (action === 'update_username') {
      const { merchant_id } = body;

      if (!merchant_id || !username) {
        return NextResponse.json(
          { success: false, error: 'merchant_id and username are required' },
          { status: 400 }
        );
      }

      // Validate username
      if (username.length < 3 || username.length > 20) {
        return NextResponse.json(
          { success: false, error: 'Username must be 3-20 characters' },
          { status: 400 }
        );
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return NextResponse.json(
          { success: false, error: 'Username can only contain letters, numbers, and underscores' },
          { status: 400 }
        );
      }

      // Check if username is taken
      const userCheck = await query(
        `SELECT id FROM users WHERE LOWER(username) = LOWER($1)`,
        [username]
      );

      const merchantCheck = await query(
        `SELECT id FROM merchants WHERE LOWER(username) = LOWER($1) AND id != $2`,
        [username, merchant_id]
      );

      if (userCheck.length > 0 || merchantCheck.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Update merchant username
      await query(
        `UPDATE merchants SET username = $1 WHERE id = $2`,
        [username, merchant_id]
      );

      return NextResponse.json({
        success: true,
        data: { message: 'Username updated successfully' },
      });
    }

    // Check username availability
    if (action === 'check_username') {
      if (!username) {
        return NextResponse.json(
          { success: false, error: 'username is required' },
          { status: 400 }
        );
      }

      const userCheck = await query(
        `SELECT id FROM users WHERE username = $1`,
        [username]
      );

      const merchantCheck = await query(
        `SELECT id FROM merchants WHERE username = $1`,
        [username]
      );

      const available = userCheck.length === 0 && merchantCheck.length === 0;

      return NextResponse.json({
        success: true,
        data: { available },
      });
    }

    // Email/Password Login
    if (action === 'login') {
      const { email, password } = body;

      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: 'Email and password are required' },
          { status: 400 }
        );
      }

      // Find merchant by email
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, email, password_hash, rating, total_trades, is_online, balance
         FROM merchants
         WHERE email = $1 AND status = 'active'`,
        [email.toLowerCase()]
      );

      if (rows.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      const merchant = rows[0] as {
        id: string;
        username: string | null;
        display_name: string;
        business_name: string;
        wallet_address: string | null;
        email: string;
        password_hash: string | null;
        rating: number;
        total_trades: number;
        is_online: boolean;
        balance: number;
      };

      // Verify password
      if (!merchant.password_hash || !verifyPassword(password, merchant.password_hash)) {
        return NextResponse.json(
          { success: false, error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      // Update online status
      await query(
        `UPDATE merchants SET is_online = true, last_seen_at = NOW() WHERE id = $1`,
        [merchant.id]
      );

      console.log('[API] Merchant email login successful:', merchant.id, merchant.email);

      return NextResponse.json({
        success: true,
        data: {
          merchant: {
            id: merchant.id,
            username: merchant.username,
            display_name: merchant.display_name,
            business_name: merchant.business_name,
            wallet_address: merchant.wallet_address,
            email: merchant.email,
            rating: parseFloat(String(merchant.rating)) || 5,
            total_trades: merchant.total_trades || 0,
            balance: parseFloat(String(merchant.balance)) || 0,
          },
        },
      });
    }

    // Email/Password Registration
    if (action === 'register') {
      const { email, password, business_name } = body;

      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: 'Email and password are required' },
          { status: 400 }
        );
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return NextResponse.json(
          { success: false, error: 'Invalid email format' },
          { status: 400 }
        );
      }

      // Validate password
      if (password.length < 6) {
        return NextResponse.json(
          { success: false, error: 'Password must be at least 6 characters' },
          { status: 400 }
        );
      }

      // Check if email already exists
      const existingMerchant = await query(
        `SELECT id FROM merchants WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (existingMerchant.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Email already registered' },
          { status: 409 }
        );
      }

      // Generate username from email
      const baseUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 15);
      let username = baseUsername;
      let counter = 1;

      // Ensure unique username
      while (true) {
        const check = await query(
          `SELECT id FROM merchants WHERE username = $1 UNION SELECT id FROM users WHERE username = $1`,
          [username]
        );
        if (check.length === 0) break;
        username = `${baseUsername}${counter}`;
        counter++;
      }

      // Hash password
      const passwordHash = hashPassword(password);

      // Create merchant (auto-funded in mock mode)
      const regBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
      const result = await query(
        `INSERT INTO merchants (
          email,
          password_hash,
          username,
          business_name,
          display_name,
          status,
          is_online,
          balance
        ) VALUES ($1, $2, $3, $4, $5, 'active', true, $6)
        RETURNING id, username, display_name, business_name, wallet_address, email, rating, total_trades`,
        [email.toLowerCase(), passwordHash, username, business_name || username, business_name || username, regBalance]
      );

      const merchant = result[0] as {
        id: string;
        username: string;
        display_name: string;
        business_name: string;
        wallet_address: string | null;
        email: string;
        rating: number;
        total_trades: number;
      };

      console.log('[API] New merchant registered:', merchant.id, merchant.email);

      // Auto-create default offers
      try {
        await query(
          `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
           VALUES ($1, 'sell', 'bank', 3.67, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
          [merchant.id, merchant.display_name]
        );

        await query(
          `INSERT INTO merchant_offers (merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount, bank_name, bank_account_name, bank_iban, is_active)
           VALUES ($1, 'buy', 'bank', 3.65, 100, 50000, 50000, 'Emirates NBD', $2, 'AE070331234567890123456', true)`,
          [merchant.id, merchant.display_name]
        );
        console.log('[API] Default offers created for merchant:', merchant.id);
      } catch (offerError) {
        console.error('[API] Failed to create default offers:', offerError);
      }

      return NextResponse.json({
        success: true,
        data: {
          merchant: {
            id: merchant.id,
            username: merchant.username,
            display_name: merchant.display_name,
            business_name: merchant.business_name,
            wallet_address: merchant.wallet_address,
            email: merchant.email,
            rating: parseFloat(String(merchant.rating)) || 5,
            total_trades: merchant.total_trades || 0,
            balance: 0,
          },
        },
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Merchant auth error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// PATCH handler - update merchant wallet address
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { merchant_id, wallet_address } = body;

    if (!merchant_id || !wallet_address) {
      return NextResponse.json(
        { success: false, error: 'merchant_id and wallet_address are required' },
        { status: 400 }
      );
    }

    // Check if wallet is already linked to another merchant
    const existingMerchant = await query(
      `SELECT id FROM merchants WHERE wallet_address = $1 AND id != $2`,
      [wallet_address, merchant_id]
    );

    if (existingMerchant.length > 0) {
      return NextResponse.json(
        { success: false, error: 'Wallet already linked to another merchant account' },
        { status: 409 }
      );
    }

    // Update merchant wallet
    await query(
      `UPDATE merchants SET wallet_address = $1, updated_at = NOW() WHERE id = $2`,
      [wallet_address, merchant_id]
    );

    console.log('[API] Merchant wallet updated:', merchant_id, wallet_address);

    return NextResponse.json({
      success: true,
      data: { message: 'Wallet updated successfully' },
    });
  } catch (error) {
    console.error('Merchant wallet update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update wallet', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
