import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByWallet,
  createUser,
  checkUsernameAvailable,
  updateUsername,
  getUserById,
  authenticateUser,
  getUserByUsername,
  linkWalletToUser,
} from '@/lib/db/repositories/users';
import { verifyWalletSignature } from '@/lib/solana/verifySignature';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { validateUsername } from '@/lib/validation/username';
import { generateSessionToken, generateAccessToken, setSessionOnResponse } from '@/lib/auth/sessionToken';
import { trackRequest, checkDeviceChangeFrequency } from '@/lib/risk/tracker';

/**
 * POST /api/auth/user
 * Actions: wallet_login, set_username, check_username, login, register
 */
export async function POST(request: NextRequest) {
  // Rate limit: 5 auth attempts per minute (prevents brute force)
  const rateLimitResponse = await checkRateLimit(request, 'auth:user', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;
  try {
    const body = await request.json();
    const { action, username, wallet_address, signature, message, password } = body;

    // Check username availability
    if (action === 'check_username') {
      if (!username) {
        return NextResponse.json(
          { success: false, error: 'Username is required' },
          { status: 400 }
        );
      }

      try {
        console.log('[API] Checking username availability:', username);
        const available = await checkUsernameAvailable(username);
        console.log('[API] Username availability result:', { username, available });
        return NextResponse.json({
          success: true,
          data: { available },
        });
      } catch (checkError) {
        console.error('[API] Error checking username availability:', checkError);
        return NextResponse.json(
          { success: false, error: 'Failed to check username availability', details: checkError instanceof Error ? checkError.message : String(checkError) },
          { status: 500 }
        );
      }
    }

    // Login/Signup with wallet signature
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

      // Check if user exists
      let user = await getUserByWallet(wallet_address);
      let isNewUser = false;
      let needsUsername = false;

      if (!user) {
        // Create new user without username (will be set later)
        user = await createUser({
          wallet_address,
          username: `user_${wallet_address.slice(0, 8)}`, // Temporary username
        });
        isNewUser = true;
        needsUsername = true;
      } else if (!user.username || user.username.startsWith('user_')) {
        // Existing user without a proper username
        needsUsername = true;
      }

      console.log('[API] User authenticated via wallet:', user.id, user.username, { isNewUser, needsUsername });

      // Fire-and-forget: device + IP tracking (never blocks auth)
      trackRequest(request, {
        entityId: user.id,
        entityType: 'user',
        action: isNewUser ? 'signup' : 'login',
      }).catch(() => {});
      if (!isNewUser) {
        checkDeviceChangeFrequency(user.id, 'user').catch(() => {});
      }

      // 2FA gate: if enabled and not a new user, return pendingToken
      if (!isNewUser) {
        const { getTotpStatus: getWalletTotpStatus, createPendingLoginToken: createWalletPendingToken } = await import('@/lib/auth/totp');
        const walletTotpStatus = await getWalletTotpStatus(user.id, 'user');
        if (walletTotpStatus.enabled) {
          const pendingToken = await createWalletPendingToken(user.id, 'user');
          return NextResponse.json({
            success: true,
            data: {
              requires2FA: true,
              pendingToken,
              user: { id: user.id, username: user.username },
              isNewUser,
              needsUsername,
            },
          });
        }
      }

      const userPayload = { actorId: user.id, actorType: 'user' as const };
      const token = generateSessionToken(userPayload);
      const userAccessTk = generateAccessToken(userPayload);

      const walletRes = NextResponse.json({
        success: true,
        data: {
          user,
          isNewUser,
          needsUsername,
          ...(token && { token }),
          ...(userAccessTk && { accessToken: userAccessTk }),
        },
      });
      await setSessionOnResponse(walletRes, userPayload, request);
      return walletRes;
    }

    // Set username for first-time users
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
      const usernameError = validateUsername(username);
      if (usernameError) {
        return NextResponse.json(
          { success: false, error: usernameError },
          { status: 400 }
        );
      }

      // Check username availability
      const available = await checkUsernameAvailable(username);
      if (!available) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Get user by wallet
      const user = await getUserByWallet(wallet_address);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'User not found' },
          { status: 404 }
        );
      }

      // Check if user already has a non-temporary username
      if (user.username && !user.username.startsWith('user_')) {
        return NextResponse.json(
          { success: false, error: 'Username already set and cannot be changed' },
          { status: 400 }
        );
      }

      // Update username
      let updatedUser;
      try {
        updatedUser = await updateUsername(user.id, username);
      } catch (updateErr: any) {
        if (updateErr?.message === 'Username already taken') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        throw updateErr;
      }
      if (!updatedUser) {
        return NextResponse.json(
          { success: false, error: 'Failed to update username' },
          { status: 500 }
        );
      }

      console.log('[API] Username set for user:', user.id, username);

      const setUnPayload = { actorId: user.id, actorType: 'user' as const };
      const setUsernameToken = generateSessionToken(setUnPayload);
      const setUnAccessTk = generateAccessToken(setUnPayload);

      const setUnRes = NextResponse.json({
        success: true,
        data: {
          user: updatedUser,
          ...(setUsernameToken && { token: setUsernameToken }),
          ...(setUnAccessTk && { accessToken: setUnAccessTk }),
        },
      });
      await setSessionOnResponse(setUnRes, setUnPayload, request);
      return setUnRes;
    }

    // Login with username/password
    if (action === 'login') {
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required' },
          { status: 400 }
        );
      }

      const user = await authenticateUser(username, password);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Invalid username or password' },
          { status: 401 }
        );
      }

      console.log('[API] User login successful:', user.id, user.username);

      // Fire-and-forget: device + IP tracking
      trackRequest(request, { entityId: user.id, entityType: 'user', action: 'login' }).catch(() => {});
      checkDeviceChangeFrequency(user.id, 'user').catch(() => {});

      // 2FA gate: if enabled, return pendingToken instead of real tokens
      const { getTotpStatus, createPendingLoginToken } = await import('@/lib/auth/totp');
      const totpStatus = await getTotpStatus(user.id, 'user');
      if (totpStatus.enabled) {
        const pendingToken = await createPendingLoginToken(user.id, 'user');
        return NextResponse.json({
          success: true,
          data: {
            requires2FA: true,
            pendingToken,
            user: { id: user.id, username: user.username },
          },
        });
      }

      const loginPayload = { actorId: user.id, actorType: 'user' as const };
      const loginToken = generateSessionToken(loginPayload);
      const loginAccessTk = generateAccessToken(loginPayload);

      const loginRes = NextResponse.json({
        success: true,
        data: {
          user,
          needsWallet: !user.wallet_address,
          ...(loginToken && { token: loginToken }),
          ...(loginAccessTk && { accessToken: loginAccessTk }),
        },
      });
      await setSessionOnResponse(loginRes, loginPayload, request);
      return loginRes;
    }

    // Register with username/password
    if (action === 'register') {
      if (!username || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required' },
          { status: 400 }
        );
      }

      // Validate username
      const regUsernameError = validateUsername(username);
      if (regUsernameError) {
        return NextResponse.json(
          { success: false, error: regUsernameError },
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

      // Check username availability
      const available = await checkUsernameAvailable(username);
      if (!available) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      // Create user
      let user;
      try {
        user = await createUser({
          username,
          password,
          name: username,
        });
      } catch (createErr: any) {
        if (createErr?.message === 'Username already taken') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        throw createErr;
      }

      console.log('[API] New user registered:', user.id, user.username);

      // Fire-and-forget: device + IP tracking for signup
      trackRequest(request, { entityId: user.id, entityType: 'user', action: 'signup' }).catch(() => {});

      const regPayload = { actorId: user.id, actorType: 'user' as const };
      const registerToken = generateSessionToken(regPayload);
      const regAccessTk = generateAccessToken(regPayload);

      const regRes = NextResponse.json({
        success: true,
        data: {
          user,
          needsWallet: true,
          ...(registerToken && { token: registerToken }),
          ...(regAccessTk && { accessToken: regAccessTk }),
        },
      });
      await setSessionOnResponse(regRes, regPayload, request);
      return regRes;
    }

    // Link wallet to existing user account
    if (action === 'link_wallet') {
      const { user_id } = body;

      if (!user_id || !wallet_address || !signature || !message) {
        return NextResponse.json(
          { success: false, error: 'user_id, wallet_address, signature, and message are required' },
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

      // Check if wallet is already linked to another user
      const existingUser = await getUserByWallet(wallet_address);
      if (existingUser && existingUser.id !== user_id) {
        return NextResponse.json(
          { success: false, error: 'Wallet already linked to another account' },
          { status: 409 }
        );
      }

      // Link wallet to user
      try {
        const updatedUser = await linkWalletToUser(user_id, wallet_address);
        if (!updatedUser) {
          return NextResponse.json(
            { success: false, error: 'User not found' },
            { status: 404 }
          );
        }

        console.log('[API] Wallet linked to user:', user_id, wallet_address);

        return NextResponse.json({
          success: true,
          data: { user: updatedUser },
        });
      } catch (linkError) {
        console.error('[API] Link wallet error:', linkError);
        return NextResponse.json(
          { success: false, error: linkError instanceof Error ? linkError.message : 'Failed to link wallet' },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[API] POST /api/auth/user error:', error);
    return NextResponse.json(
      { success: false, error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/auth/user?id=xxx or ?action=check_session&user_id=xxx
 * Get user by ID or validate session
 */
export async function GET(request: NextRequest) {
  // Rate limit: 100 requests per minute
  const rateLimitResponse = await checkRateLimit(request, 'auth:user:get', STANDARD_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const userId = searchParams.get('id') || searchParams.get('user_id');

    // Check session validity
    if (action === 'check_session') {
      if (!userId) {
        return NextResponse.json(
          { success: false, error: 'User ID is required' },
          { status: 400 }
        );
      }

      const user = await getUserById(userId);
      if (!user) {
        return NextResponse.json({
          success: true,
          data: { valid: false },
        });
      }

      const checkPayload = { actorId: user.id, actorType: 'user' as const };
      const checkToken = generateSessionToken(checkPayload);
      const checkAccessTk = generateAccessToken(checkPayload);

      // check_session: issue new access tokens but do NOT create a new DB session.
      return NextResponse.json({
        success: true,
        data: {
          valid: true,
          user,
          ...(checkToken && { token: checkToken }),
          ...(checkAccessTk && { accessToken: checkAccessTk }),
        },
      });
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    console.log('[API] GET /api/auth/user - fetching user:', userId);
    const user = await getUserById(userId);
    if (!user) {
      console.log('[API] GET /api/auth/user - user not found:', userId);
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { user },
    });
  } catch (error) {
    console.error('[API] GET /api/auth/user error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get user' },
      { status: 500 }
    );
  }
}
