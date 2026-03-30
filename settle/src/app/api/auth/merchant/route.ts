import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { requireTokenAuth } from '@/lib/middleware/auth';
import { updateMerchantOnlineStatus, createDefaultMerchantOffers, serializeMerchant } from '@/lib/db/repositories/merchants';
import { generateSessionToken, generateAccessToken, generateRefreshToken, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/auth/sessionToken';
import { validateUsername } from '@/lib/validation/username';
import crypto from 'crypto';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';

// Password hashing — PBKDF2 with 100k iterations (OWASP minimum for SHA-512)
const PBKDF2_ITERATIONS = 100_000;
const LEGACY_ITERATIONS = 1000; // Old hashes used this — auto-upgraded on login

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 64, 'sha512').toString('hex');
  // New format: salt:iterations:hash (3 parts)
  return `${salt}:${PBKDF2_ITERATIONS}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): { valid: boolean; needsRehash: boolean } {
  const parts = storedHash.split(':');
  let salt: string, hash: string, iterations: number;

  if (parts.length === 3) {
    // New format: salt:iterations:hash
    [salt, , hash] = parts;
    iterations = parseInt(parts[1], 10);
  } else if (parts.length === 2) {
    // Legacy format: salt:hash (1000 iterations)
    [salt, hash] = parts;
    iterations = LEGACY_ITERATIONS;
  } else {
    return { valid: false, needsRehash: false };
  }

  const verifyHash = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  const valid = crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  return { valid, needsRehash: valid && iterations < PBKDF2_ITERATIONS };
}

// GET handler - fetch merchant by wallet address or validate session
export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute
  const rateLimitResponse = await checkRateLimit(request, 'auth:merchant:get', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const wallet_address = searchParams.get('wallet_address');
    const merchant_id = searchParams.get('merchant_id');

    // Check session validity
    if (action === 'check_session' && merchant_id) {
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, avatar_url, bio, rating, total_trades, balance, has_ops_access, COALESCE(has_compliance_access, false) as has_compliance_access
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
        avatar_url: string | null;
        bio: string | null;
        rating: number;
        total_trades: number;
        balance: number;
        has_ops_access: boolean;
          has_compliance_access: boolean;
      };

      // Set merchant online when session is validated (critical for order matching!)
      await updateMerchantOnlineStatus(merchant.id, true);
      console.log('[API] Merchant session restored, set online:', merchant.id);

      const payload = { actorId: merchant.id, actorType: 'merchant' as const };
      const sessionToken = generateSessionToken(payload);
      const accessToken = generateAccessToken(payload);
      const refreshToken = generateRefreshToken(payload);

      const response = NextResponse.json({
        success: true,
        data: {
          valid: true,
          merchant: serializeMerchant(merchant),
          ...(sessionToken && { token: sessionToken }),
          ...(accessToken && { accessToken }),
        },
      });
      if (refreshToken) {
        response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
      }
      return response;
    }

    if (action === 'wallet_login' && wallet_address) {
      // Query merchant by wallet address
      const rows = await query(
        `SELECT id, username, display_name, business_name, wallet_address, avatar_url, bio, rating, total_trades, is_online, has_ops_access, COALESCE(has_compliance_access, false) as has_compliance_access
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
        data: serializeMerchant(merchant),
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
  const rateLimitResponse = await checkRateLimit(request, 'auth:merchant', AUTH_LIMIT);
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
        `SELECT id, username, display_name, business_name, wallet_address, avatar_url, bio, rating, total_trades, is_online, balance, has_ops_access, COALESCE(has_compliance_access, false) as has_compliance_access
         FROM merchants
         WHERE wallet_address = $1 AND status = 'active'`,
        [wallet_address]
      );

      let merchant;
      const isNewMerchant = false;
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
          avatar_url: string | null;
          bio: string | null;
          rating: number;
          total_trades: number;
          is_online: boolean;
          balance: number;
          has_ops_access: boolean;
          has_compliance_access: boolean;
        };

        // Check if username needs to be set
        if (!merchant.username || merchant.username.startsWith('merchant_')) {
          needsUsername = true;
        }

        // Update online status
        await updateMerchantOnlineStatus(merchant.id, true);

        // Check if merchant has any offers, if not create default ones
        const existingOffers = await query(
          `SELECT id FROM merchant_offers WHERE merchant_id = $1 LIMIT 1`,
          [merchant.id]
        );

        if (existingOffers.length === 0) {
          console.log('[API] No offers found for merchant, creating defaults:', merchant.id);
          const displayName = merchant.display_name || merchant.username || 'Merchant';
          await createDefaultMerchantOffers(merchant.id, displayName);
        }

        console.log('[API] Merchant login successful:', merchant.id, merchant.username);

        const walletPayload = { actorId: merchant.id, actorType: 'merchant' as const };
        const token = generateSessionToken(walletPayload);
        const walletAccessToken = generateAccessToken(walletPayload);
        const walletRefreshToken = generateRefreshToken(walletPayload);

        const walletResponse = NextResponse.json({
          success: true,
          data: {
            merchant: serializeMerchant(merchant),
            isNewMerchant,
            needsUsername,
            ...(token && { token }),
            ...(walletAccessToken && { accessToken: walletAccessToken }),
          },
        });
        if (walletRefreshToken) {
          walletResponse.cookies.set(REFRESH_TOKEN_COOKIE, walletRefreshToken, REFRESH_COOKIE_OPTIONS);
        }
        return walletResponse;
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
      const createUsernameError = validateUsername(username);
      if (createUsernameError) {
        return NextResponse.json(
          { success: false, error: createUsernameError },
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
      let result;
      try {
        result = await query(
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
      } catch (insertErr: any) {
        if (insertErr?.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        throw insertErr;
      }

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
      await createDefaultMerchantOffers(merchant.id, username);

      const createPayload = { actorId: merchant.id, actorType: 'merchant' as const };
      const createToken = generateSessionToken(createPayload);
      const createAccessTk = generateAccessToken(createPayload);
      const createRefreshTk = generateRefreshToken(createPayload);

      const createResponse = NextResponse.json({
        success: true,
        data: {
          merchant: { ...serializeMerchant(merchant), balance: merchantBalance },
          ...(createToken && { token: createToken }),
          ...(createAccessTk && { accessToken: createAccessTk }),
        },
      });
      if (createRefreshTk) {
        createResponse.cookies.set(REFRESH_TOKEN_COOKIE, createRefreshTk, REFRESH_COOKIE_OPTIONS);
      }
      return createResponse;
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
      const setUsernameError = validateUsername(username);
      if (setUsernameError) {
        return NextResponse.json(
          { success: false, error: setUsernameError },
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
      try {
        await query(
          `UPDATE merchants SET username = $1, display_name = $2, business_name = $3 WHERE id = $4`,
          [username, username, username, merchant.id]
        );
      } catch (updateErr: any) {
        if (updateErr?.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        throw updateErr;
      }

      console.log('[API] Merchant username set:', merchant.id, username);

      return NextResponse.json({
        success: true,
        data: { message: 'Username set successfully' },
      });
    }

    // Update username for existing merchant (wallet signature required)
    if (action === 'update_username') {
      const { merchant_id } = body;

      if (!merchant_id || !username || !wallet_address || !signature || !message) {
        return NextResponse.json(
          { success: false, error: 'merchant_id, username, wallet_address, signature, and message are required' },
          { status: 400 }
        );
      }

      // Verify the wallet signature to prove ownership
      const isValid = await verifyWalletSignature(wallet_address, signature, message);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Invalid wallet signature' },
          { status: 401 }
        );
      }

      // Verify the wallet address belongs to this merchant_id
      const ownerCheck = await query(
        `SELECT id FROM merchants WHERE id = $1 AND wallet_address = $2 AND status = 'active'`,
        [merchant_id, wallet_address]
      );
      if (ownerCheck.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Wallet does not match merchant account' },
          { status: 403 }
        );
      }

      // Validate username
      const updateUsernameError = validateUsername(username);
      if (updateUsernameError) {
        return NextResponse.json(
          { success: false, error: updateUsernameError },
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
      try {
        await query(
          `UPDATE merchants SET username = $1 WHERE id = $2`,
          [username, merchant_id]
        );
      } catch (updateErr: any) {
        if (updateErr?.code === '23505') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        throw updateErr;
      }

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
        `SELECT id, username, display_name, business_name, wallet_address, avatar_url, bio, email, password_hash, rating, total_trades, is_online, balance, has_ops_access, COALESCE(has_compliance_access, false) as has_compliance_access
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
        avatar_url: string | null;
        bio: string | null;
        email: string;
        password_hash: string | null;
        rating: number;
        total_trades: number;
        is_online: boolean;
        balance: number;
        has_ops_access: boolean;
          has_compliance_access: boolean;
      };

      // Verify password
      if (!merchant.password_hash) {
        return NextResponse.json(
          { success: false, error: 'Invalid email or password' },
          { status: 401 }
        );
      }
      const pwResult = verifyPassword(password, merchant.password_hash);
      if (!pwResult.valid) {
        return NextResponse.json(
          { success: false, error: 'Invalid email or password' },
          { status: 401 }
        );
      }

      // Auto-upgrade legacy password hash to stronger iterations
      if (pwResult.needsRehash) {
        const newHash = hashPassword(password);
        await query('UPDATE merchants SET password_hash = $1 WHERE id = $2', [newHash, merchant.id]);
      }

      // Update online status
      await updateMerchantOnlineStatus(merchant.id, true);

      console.log('[API] Merchant email login successful:', merchant.id, merchant.email);

      const emailPayload = { actorId: merchant.id, actorType: 'merchant' as const };
      const emailLoginToken = generateSessionToken(emailPayload);
      const emailAccessTk = generateAccessToken(emailPayload);
      const emailRefreshTk = generateRefreshToken(emailPayload);

      const emailResponse = NextResponse.json({
        success: true,
        data: {
          merchant: serializeMerchant(merchant),
          ...(emailLoginToken && { token: emailLoginToken }),
          ...(emailAccessTk && { accessToken: emailAccessTk }),
        },
      });
      if (emailRefreshTk) {
        emailResponse.cookies.set(REFRESH_TOKEN_COOKIE, emailRefreshTk, REFRESH_COOKIE_OPTIONS);
      }
      return emailResponse;
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
      await createDefaultMerchantOffers(merchant.id, merchant.display_name);

      return NextResponse.json({
        success: true,
        data: {
          merchant: { ...serializeMerchant(merchant), balance: regBalance },
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
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// PATCH handler - update merchant wallet address (requires token + wallet signature)
export async function PATCH(request: NextRequest) {
  // Rate limit wallet updates
  const rl = await checkRateLimit(request, 'auth:merchant:patch', AUTH_LIMIT);
  if (rl) return rl;

  try {
    // Require token auth — this is a critical identity operation
    const auth = await requireTokenAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { merchant_id, wallet_address, signature, message } = body;

    if (!merchant_id || !wallet_address || !signature || !message) {
      return NextResponse.json(
        { success: false, error: 'merchant_id, wallet_address, signature, and message are required' },
        { status: 400 }
      );
    }

    // Enforce: authenticated actor must own this merchant account
    if (auth.actorId !== merchant_id) {
      return NextResponse.json(
        { success: false, error: 'You can only update your own wallet' },
        { status: 403 }
      );
    }

    // Verify the wallet signature proves ownership of the NEW wallet
    const isValid = await verifyWalletSignature(wallet_address, signature, message);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet signature' },
        { status: 401 }
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

    console.log('[API] Merchant wallet updated:', merchant_id);

    return NextResponse.json({
      success: true,
      data: { message: 'Wallet updated successfully' },
    });
  } catch (error) {
    console.error('Merchant wallet update error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update wallet' },
      { status: 500 }
    );
  }
}
