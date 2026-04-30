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
import { verifyWalletAuthRequest } from '@/lib/auth/loginNonce';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { validateUsername } from '@/lib/validation/username';
import {
  validateUserUsername,
  validateUserEmail,
  validateUserPassword,
} from '@/lib/validation/userAuth';
import { generateSessionToken, generateAccessToken, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS } from '@/lib/auth/sessionToken';
import { createSession, getSessionIdFromRefreshCookie } from '@/lib/auth/sessions';
import { trackRequest, checkDeviceChangeFrequency } from '@/lib/risk/tracker';
import { query } from '@/lib/db';
import crypto from 'crypto';

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
    const { action, username: rawUsername, wallet_address, signature, message, nonce, password, email: rawEmail } = body;
    const username = rawUsername?.trim();
    const email: string | undefined = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : undefined;

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

      // Strict: signature + nonce + timestamp window all required.
      const authResult = await verifyWalletAuthRequest({
        walletAddress: wallet_address,
        signature,
        message,
        nonce,
      });
      if (!authResult.ok) {
        return NextResponse.json(
          { success: false, error: authResult.error },
          { status: authResult.status }
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

      let walletSessionId: string | null = null;
      let walletRefreshToken: string | null = null;
      try {
        const sessionResult = await createSession(userPayload, request as any);
        if (sessionResult) {
          walletSessionId = sessionResult.sessionId;
          walletRefreshToken = sessionResult.refreshToken;
        }
      } catch { /* session creation failed, proceed without sessionId */ }

      const userAccessTk = generateAccessToken({ ...userPayload, ...(walletSessionId && { sessionId: walletSessionId }) });

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
      if (walletRefreshToken) {
        walletRes.cookies.set(REFRESH_TOKEN_COOKIE, walletRefreshToken, REFRESH_COOKIE_OPTIONS);
      }
      return walletRes;
    }

    // Set username for first-time users
    if (action === 'set_username') {
      if (!wallet_address || !signature || !message || !nonce || !username) {
        return NextResponse.json(
          { success: false, error: 'wallet_address, signature, message, nonce, and username are required' },
          { status: 400 }
        );
      }

      // Same strict nonce + timestamp + signature check as wallet_login —
      // a captured `set_username` signature must not be replayable.
      const setNameAuth = await verifyWalletAuthRequest({
        walletAddress: wallet_address,
        signature,
        message,
        nonce,
      });
      if (!setNameAuth.ok) {
        return NextResponse.json(
          { success: false, error: setNameAuth.error },
          { status: setNameAuth.status }
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

      let setUnSessionId: string | null = null;
      let setUnRefreshToken: string | null = null;
      try {
        const sessionResult = await createSession(setUnPayload, request as any);
        if (sessionResult) {
          setUnSessionId = sessionResult.sessionId;
          setUnRefreshToken = sessionResult.refreshToken;
        }
      } catch { /* session creation failed, proceed without sessionId */ }

      const setUnAccessTk = generateAccessToken({ ...setUnPayload, ...(setUnSessionId && { sessionId: setUnSessionId }) });

      const setUnRes = NextResponse.json({
        success: true,
        data: {
          user: updatedUser,
          ...(setUsernameToken && { token: setUsernameToken }),
          ...(setUnAccessTk && { accessToken: setUnAccessTk }),
        },
      });
      if (setUnRefreshToken) {
        setUnRes.cookies.set(REFRESH_TOKEN_COOKIE, setUnRefreshToken, REFRESH_COOKIE_OPTIONS);
      }
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

      let loginSessionId: string | null = null;
      let loginRefreshToken: string | null = null;
      try {
        const sessionResult = await createSession(loginPayload, request as any);
        if (sessionResult) {
          loginSessionId = sessionResult.sessionId;
          loginRefreshToken = sessionResult.refreshToken;
        }
      } catch { /* session creation failed, proceed without sessionId */ }

      const loginAccessTk = generateAccessToken({ ...loginPayload, ...(loginSessionId && { sessionId: loginSessionId }) });

      const loginRes = NextResponse.json({
        success: true,
        data: {
          user,
          needsWallet: !user.wallet_address,
          ...(loginToken && { token: loginToken }),
          ...(loginAccessTk && { accessToken: loginAccessTk }),
        },
      });
      if (loginRefreshToken) {
        loginRes.cookies.set(REFRESH_TOKEN_COOKIE, loginRefreshToken, REFRESH_COOKIE_OPTIONS);
      }
      return loginRes;
    }

    // Register with username/password (+ email for verification & recovery).
    if (action === 'register') {
      // Authoritative validation — same helpers the client runs at submit
      // time, so the user can't bypass anything by hitting the API directly.
      const usernameError = validateUserUsername(username || '');
      if (usernameError) {
        return NextResponse.json(
          { success: false, error: usernameError },
          { status: 400 }
        );
      }
      const emailError = validateUserEmail(email || '');
      if (emailError) {
        return NextResponse.json(
          { success: false, error: emailError },
          { status: 400 }
        );
      }
      const passwordError = validateUserPassword(password || '');
      if (passwordError) {
        return NextResponse.json(
          { success: false, error: passwordError },
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

      // Check email uniqueness up-front so we can return a friendlier error
      // than letting the DB unique index fire (the DB still enforces it).
      const existingByEmail = await query<{ id: string }>(
        `SELECT id FROM users WHERE LOWER(email) = $1`,
        [email]
      );
      if (existingByEmail.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Email already registered' },
          { status: 409 }
        );
      }

      // Create user — email_verified=false until they click the link.
      let user;
      try {
        user = await createUser({
          username,
          password,
          name: username,
          email,
          email_verified: false,
        });
      } catch (createErr: any) {
        if (createErr?.message === 'Username already taken') {
          return NextResponse.json(
            { success: false, error: 'Username already taken' },
            { status: 409 }
          );
        }
        if (createErr?.message === 'Email already registered') {
          return NextResponse.json(
            { success: false, error: 'Email already registered' },
            { status: 409 }
          );
        }
        throw createErr;
      }

      // Fire-and-forget verification email — don't fail registration if SES
      // is misconfigured, just log it. The user can request a resend later.
      try {
        const verifyToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
        await query(
          `INSERT INTO user_email_verification_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
          [user.id, tokenHash]
        );
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
        const verifyLink = `${appUrl}/api/auth/user/verify-email?token=${verifyToken}&id=${user.id}`;
        const { sendEmail, emailVerificationEmail } = await import('@/lib/email/ses');
        const emailContent = emailVerificationEmail(verifyLink, user.username || 'there');
        // `email` is asserted non-null because validateUserEmail above
        // returns early when it's missing — TS just can't track that.
        sendEmail({ to: email!, ...emailContent })
          .catch(err => console.error('[user register] verification email failed:', err));
      } catch (emailErr) {
        console.error('[user register] failed to create verification token:', emailErr);
      }

      console.log('[API] New user registered:', user.id, user.username);

      // Fire-and-forget: device + IP tracking for signup
      trackRequest(request, { entityId: user.id, entityType: 'user', action: 'signup' }).catch(() => {});

      const regPayload = { actorId: user.id, actorType: 'user' as const };
      const registerToken = generateSessionToken(regPayload);

      let regSessionId: string | null = null;
      let regRefreshToken: string | null = null;
      try {
        const sessionResult = await createSession(regPayload, request as any);
        if (sessionResult) {
          regSessionId = sessionResult.sessionId;
          regRefreshToken = sessionResult.refreshToken;
        }
      } catch { /* session creation failed, proceed without sessionId */ }

      const regAccessTk = generateAccessToken({ ...regPayload, ...(regSessionId && { sessionId: regSessionId }) });

      const regRes = NextResponse.json({
        success: true,
        data: {
          user,
          needsWallet: true,
          requiresEmailVerification: true,
          message: 'Account created! Check your email to verify your account.',
          ...(registerToken && { token: registerToken }),
          ...(regAccessTk && { accessToken: regAccessTk }),
        },
      });
      if (regRefreshToken) {
        regRes.cookies.set(REFRESH_TOKEN_COOKIE, regRefreshToken, REFRESH_COOKIE_OPTIONS);
      }
      return regRes;
    }

    // Link wallet to existing user account
    if (action === 'link_wallet') {
      const { user_id } = body;

      if (!user_id || !wallet_address || !signature || !message || !nonce) {
        return NextResponse.json(
          { success: false, error: 'user_id, wallet_address, signature, message, and nonce are required' },
          { status: 400 }
        );
      }

      // Strict signature + nonce + timestamp. Replaying a captured link_wallet
      // signature would otherwise let an attacker re-bind the same wallet to
      // a controlled account.
      const linkAuth = await verifyWalletAuthRequest({
        walletAddress: wallet_address,
        signature,
        message,
        nonce,
      });
      if (!linkAuth.ok) {
        return NextResponse.json(
          { success: false, error: linkAuth.error },
          { status: linkAuth.status }
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

      // Look up existing session from refresh cookie for v2 token
      let checkSessionId: string | undefined;
      const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
      if (refreshCookie) {
        try {
          const existingId = await getSessionIdFromRefreshCookie(refreshCookie);
          if (existingId) checkSessionId = existingId;
        } catch { /* proceed without sessionId */ }
      }
      // No valid refresh session → create one
      let checkRefreshToken: string | null = null;
      if (!checkSessionId) {
        try {
          const sess = await createSession(checkPayload, request as any);
          if (sess) { checkSessionId = sess.sessionId; checkRefreshToken = sess.refreshToken; }
        } catch { /* proceed without session tracking */ }
      }

      const checkToken = generateSessionToken(checkPayload);
      const checkAccessTk = generateAccessToken({ ...checkPayload, sessionId: checkSessionId });

      const checkResponse = NextResponse.json({
        success: true,
        data: {
          valid: true,
          user,
          ...(checkToken && { token: checkToken }),
          ...(checkAccessTk && { accessToken: checkAccessTk }),
        },
      });
      if (checkRefreshToken) checkResponse.cookies.set(REFRESH_TOKEN_COOKIE, checkRefreshToken, REFRESH_COOKIE_OPTIONS);
      return checkResponse;
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
