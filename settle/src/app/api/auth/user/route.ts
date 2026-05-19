import { NextRequest, NextResponse } from 'next/server';
import {
  getUserByWallet,
  createUser,
  checkUsernameAvailable,
  updateUsername,
  updatePassword,
  getUserById,
  authenticateUser,
  getUserByUsername,
  linkWalletToUser,
} from '@/lib/db/repositories/users';
import { queryOne } from '@/lib/db';
import { verifyWalletAuthRequest } from '@/lib/auth/loginNonce';
import { checkRateLimit, AUTH_LIMIT, STANDARD_LIMIT } from '@/lib/middleware/rateLimit';
import { validateUsername } from '@/lib/validation/username';
import {
  validateUserUsername,
  validateUserPassword,
} from '@/lib/validation/userAuth';
import { generateSessionToken, generateAccessToken, REFRESH_TOKEN_COOKIE, REFRESH_COOKIE_OPTIONS, ACCESS_TOKEN_COOKIE, ACCESS_COOKIE_OPTIONS } from '@/lib/auth/sessionToken';
import { createSession, getSessionIdFromRefreshCookie, revokeAllSessionsExcept } from '@/lib/auth/sessions';
import { trackRequest, checkDeviceChangeFrequency } from '@/lib/risk/tracker';
import { requireTokenAuth } from '@/lib/middleware/auth';

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
    const { action, username: rawUsername, wallet_address, signature, message, nonce, password } = body;
    const username = rawUsername?.trim();

    // Check username availability
    if (action === 'check_username') {
      if (!username) {
        return NextResponse.json(
          { success: false, error: 'Username is required' },
          { status: 400 }
        );
      }

      try {

        const available = await checkUsernameAvailable(username);

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

      // Fire-and-forget: device + IP tracking (never blocks auth)
      trackRequest(request, {
        entityId: user.id,
        entityType: 'user',
        action: isNewUser ? 'signup' : 'login',
      }).catch(() => {});
      if (!isNewUser) {
        checkDeviceChangeFrequency(user.id, 'user').catch(() => {});
      }

      // 2FA gate: if enabled and not a new user, return pendingToken.
      //
      // Pre-check the per-actor OTP rate limit BEFORE issuing a fresh
      // pendingToken. Without this, an attacker who has the primary
      // credential can keep hitting this endpoint during their lockout
      // and stockpile pendingTokens to drain as the window slides. The
      // verify-login endpoint blocks the code attempts anyway, but the
      // token stockpile thrashes the DB and obscures abuse signal.
      if (!isNewUser) {
        const { getTotpStatus: getWalletTotpStatus, createPendingLoginToken: createWalletPendingToken, isRateLimited: walletIsRateLimited } = await import('@/lib/auth/totp');
        const walletTotpStatus = await getWalletTotpStatus(user.id, 'user');
        if (walletTotpStatus.enabled) {
          if (await walletIsRateLimited(user.id, 'user')) {
            return NextResponse.json(
              { success: false, error: 'Too many attempts. Please wait 15 minutes.' },
              { status: 429 }
            );
          }
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
      // SECURITY: previously emitted a real 7-day HMAC legacy token. The
      // value escapes via JSON to the client store + any error logs and
      // could be replayed as a Bearer credential for the full 7 days.
      // Clients only use this field as a "logged-in" truthy sentinel
      // (`!!data.token` gates silent refresh in fetchWithAuth) — no code
      // path puts this value into an Authorization header. Replacing with
      // a fixed sentinel keeps the client behavior identical while
      // eliminating the long-lived stealable credential.
      const token = 'cookie-session';

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
      if (userAccessTk) {
        walletRes.cookies.set(ACCESS_TOKEN_COOKIE, userAccessTk, ACCESS_COOKIE_OPTIONS);
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

      const setUnPayload = { actorId: user.id, actorType: 'user' as const };
      const setUsernameToken = 'cookie-session'; // sentinel — see comment on first occurrence

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
      if (setUnAccessTk) {
        setUnRes.cookies.set(ACCESS_TOKEN_COOKIE, setUnAccessTk, ACCESS_COOKIE_OPTIONS);
      }
      return setUnRes;
    }

    // Login with username-or-email + password
    if (action === 'login') {
      // Accept `identifier` (preferred — email or username) or legacy `username`.
      // `username` (rawUsername.trim()) is already populated above for backward
      // compat with existing clients.
      const rawIdentifier: string | undefined =
        (typeof body.identifier === 'string' && body.identifier.trim()) || username;

      if (!rawIdentifier || !password) {
        return NextResponse.json(
          { success: false, error: 'Username and password are required' },
          { status: 400 }
        );
      }

      const user = await authenticateUser(rawIdentifier, password);
      if (!user) {
        return NextResponse.json(
          { success: false, error: 'Invalid username or password' },
          { status: 401 }
        );
      }

      // Email verification gate — mirrors the merchant flow at
      // api/auth/merchant/route.ts. We deliberately gate ONLY when the
      // account actually has an email on file: wallet-only users (who
      // signed up via signature without ever providing an email) have
      // nothing to verify and must not be blocked here.
      //
      // `email` and `email_verified` are columns on the users table but
      // are not part of the typed User interface — `SELECT *` brings
      // them through anyway, so we cast at the read site.
      const userRow = user as typeof user & { email?: string | null; email_verified?: boolean };
      if (userRow.email && userRow.email_verified === false) {
        return NextResponse.json({
          success: false,
          error: 'Please verify your email before logging in. Check your inbox for a verification link.',
          code: 'EMAIL_NOT_VERIFIED',
          userId: user.id,
        }, { status: 403 });
      }

      // Fire-and-forget: device + IP tracking
      trackRequest(request, { entityId: user.id, entityType: 'user', action: 'login' }).catch(() => {});
      checkDeviceChangeFrequency(user.id, 'user').catch(() => {});

      // 2FA gate: if enabled, return pendingToken instead of real tokens.
      // Refuse issuance when the actor is currently OTP-rate-limited so an
      // attacker with the primary password cannot stockpile tokens during
      // a lockout window. See verify-login route for the matching guard.
      const { getTotpStatus, createPendingLoginToken, isRateLimited } = await import('@/lib/auth/totp');
      const totpStatus = await getTotpStatus(user.id, 'user');
      if (totpStatus.enabled) {
        if (await isRateLimited(user.id, 'user')) {
          return NextResponse.json(
            { success: false, error: 'Too many attempts. Please wait 15 minutes.' },
            { status: 429 }
          );
        }
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
      const loginToken = 'cookie-session'; // sentinel — see comment on first occurrence

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
      if (loginAccessTk) {
        loginRes.cookies.set(ACCESS_TOKEN_COOKIE, loginAccessTk, ACCESS_COOKIE_OPTIONS);
      }
      return loginRes;
    }

    // Register with username + PIN. No email collected.
    if (action === 'register') {
      const usernameError = validateUserUsername(username || '');
      if (usernameError) {
        return NextResponse.json(
          { success: false, error: usernameError },
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

      const available = await checkUsernameAvailable(username);
      if (!available) {
        return NextResponse.json(
          { success: false, error: 'Username already taken' },
          { status: 409 }
        );
      }

      let user;
      try {
        user = await createUser({
          username,
          password,
          name: username,
          email_verified: true,
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
      const registerToken = 'cookie-session'; // sentinel — see comment on first occurrence

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
          message: 'Account created!',
          ...(registerToken && { token: registerToken }),
          ...(regAccessTk && { accessToken: regAccessTk }),
        },
      });
      if (regRefreshToken) {
        regRes.cookies.set(REFRESH_TOKEN_COOKIE, regRefreshToken, REFRESH_COOKIE_OPTIONS);
      }
      if (regAccessTk) {
        regRes.cookies.set(ACCESS_TOKEN_COOKIE, regAccessTk, ACCESS_COOKIE_OPTIONS);
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

    // Change Password (authenticated user). Verifies current password,
    // writes the new hash, then revokes every OTHER active session so a
    // stolen refresh cookie can't keep working for the 7-day TTL after
    // a password change. The current session is preserved so the device
    // that just confirmed the old password stays logged in.
    if (action === 'change_password') {
      const { user_id, current_password, new_password } = body;

      if (!user_id || !current_password || !new_password) {
        return NextResponse.json(
          { success: false, error: 'user_id, current_password and new_password are required' },
          { status: 400 }
        );
      }

      const auth = await requireTokenAuth(request);
      if (auth instanceof NextResponse) return auth;
      if (auth.actorType !== 'user' || auth.actorId !== user_id) {
        return NextResponse.json(
          { success: false, error: 'You can only change your own password' },
          { status: 403 }
        );
      }

      const trimmedNew = String(new_password).trim();
      const passwordError = validateUserPassword(trimmedNew);
      if (passwordError) {
        return NextResponse.json(
          { success: false, error: passwordError },
          { status: 400 }
        );
      }

      const ok = await updatePassword(user_id, String(current_password).trim(), trimmedNew);
      if (!ok) {
        return NextResponse.json(
          { success: false, error: 'Current password is incorrect' },
          { status: 401 }
        );
      }

      // Same rationale as the merchant flow — revocation failure doesn't
      // roll back the password update.
      try {
        await revokeAllSessionsExcept(user_id, 'user', auth.sessionId);
      } catch (revokeError) {
        console.error('[user change_password] session revocation failed (password was changed)', revokeError);
      }

      return NextResponse.json({
        success: true,
        data: { message: 'Password changed successfully' },
      });
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

      // SECURITY: identity must come from the refresh cookie, never from
      // the query param. Without a valid pre-existing session this route
      // used to mint fresh cookies for whoever the query param named —
      // full account takeover by anyone who knew a UUID.
      const refreshCookie = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
      if (!refreshCookie) {
        return NextResponse.json({ success: true, data: { valid: false } });
      }

      let checkSessionId: string | null = null;
      try {
        checkSessionId = await getSessionIdFromRefreshCookie(refreshCookie);
      } catch { /* treat as invalid */ }
      if (!checkSessionId) {
        return NextResponse.json({ success: true, data: { valid: false } });
      }

      // Cross-check: the cookie's session must belong to this user and to
      // a `user` actor type. Stops a cookie from one actor being used to
      // mint tokens for another actor on a shared device.
      const sessionRow = await queryOne<{ entity_id: string; entity_type: string }>(
        'SELECT entity_id, entity_type FROM sessions WHERE id = $1 AND is_revoked = false AND expires_at > NOW()',
        [checkSessionId]
      );
      if (!sessionRow || sessionRow.entity_type !== 'user' || sessionRow.entity_id !== userId) {
        return NextResponse.json({ success: true, data: { valid: false } });
      }

      const user = await getUserById(userId);
      if (!user) {
        return NextResponse.json({ success: true, data: { valid: false } });
      }

      const checkPayload = { actorId: user.id, actorType: 'user' as const };
      const checkToken = 'cookie-session'; // sentinel — see comment on first occurrence
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
      // Refresh ONLY the short-lived access cookie. The long-lived refresh
      // cookie is left untouched — rotation belongs to /api/auth/refresh,
      // not to a session-check probe.
      if (checkAccessTk) checkResponse.cookies.set(ACCESS_TOKEN_COOKIE, checkAccessTk, ACCESS_COOKIE_OPTIONS);
      return checkResponse;
    }

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'User ID is required' },
        { status: 400 }
      );
    }

    const user = await getUserById(userId);
    if (!user) {

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
