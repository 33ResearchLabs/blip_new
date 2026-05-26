/**
 * POST /api/auth/google
 *
 * Google Identity Services (GIS) one-tap / button sign-in. The client posts
 * the GIS-issued ID token (a JWT) as `credential`. We verify it server-side
 * against Google's public keys, then either:
 *
 *   1. find an existing row with the matching google_sub  -> sign in
 *   2. find an existing row by verified email             -> link google_sub, sign in
 *   3. create a brand-new row                             -> sign in
 *
 * The response shape and cookies (blip_refresh_token + blip_access_token)
 * match the existing /api/auth/user and /api/auth/merchant login paths so
 * the client can drop straight into its current post-login flow.
 *
 * This route is additive — it does not modify the existing email/password
 * or wallet login flows. Brand-new accounts get password_hash = NULL; they
 * can later set a password via the existing "change password" flow if they
 * want both sign-in methods.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryOne } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { verifyGoogleIdToken, GoogleIdentity } from '@/lib/auth/googleIdToken';
import { deriveUniqueGoogleUsername } from '@/lib/auth/googleUsername';
import {
  generateAccessToken,
  REFRESH_TOKEN_COOKIE,
  REFRESH_COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  ACCESS_COOKIE_OPTIONS,
} from '@/lib/auth/sessionToken';
import { createSession } from '@/lib/auth/sessions';
import { setupWaitlistForActor } from '@/lib/waitlist/signup';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';
import { defaultAvatarUrl } from '@/lib/avatars';

type Role = 'user' | 'merchant';
type ActorType = 'user' | 'merchant';

interface UserRow {
  id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  wallet_address: string | null;
  balance: string | number;
  google_sub: string | null;
  email_verified: boolean | null;
}

interface MerchantRow {
  id: string;
  username: string | null;
  email: string | null;
  display_name: string;
  business_name: string;
  avatar_url: string | null;
  wallet_address: string | null;
  balance: string | number;
  google_sub: string | null;
  email_verified: boolean | null;
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

async function isUsernameTakenAcrossTables(candidate: string): Promise<boolean> {
  const u = await queryOne<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM users WHERE LOWER(username) = LOWER($1)',
    [candidate],
  );
  const m = await queryOne<{ count: string | number }>(
    'SELECT COUNT(*) AS count FROM merchants WHERE LOWER(username) = LOWER($1)',
    [candidate],
  );
  return parseInt(String(u?.count || 0)) + parseInt(String(m?.count || 0)) > 0;
}

async function findOrCreateUser(identity: GoogleIdentity): Promise<{ row: UserRow; isNew: boolean }> {
  // 1) google_sub match
  const bySub = await queryOne<UserRow>(
    `SELECT id, username, email, name, avatar_url, wallet_address, balance, google_sub, email_verified
     FROM users WHERE google_sub = $1 LIMIT 1`,
    [identity.sub],
  );
  if (bySub) return { row: bySub, isNew: false };

  // 2) email match — attach google_sub
  const byEmail = await queryOne<UserRow>(
    `SELECT id, username, email, name, avatar_url, wallet_address, balance, google_sub, email_verified
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [identity.email],
  );
  if (byEmail) {
    const updated = await queryOne<UserRow>(
      `UPDATE users
         SET google_sub = $1,
             oauth_provider = COALESCE(oauth_provider, 'google'),
             email_verified = true,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id, username, email, name, avatar_url, wallet_address, balance, google_sub, email_verified`,
      [identity.sub, byEmail.id],
    );
    return { row: updated ?? byEmail, isNew: false };
  }

  // 3) create
  const username = await deriveUniqueGoogleUsername(identity.email, isUsernameTakenAcrossTables);
  const placeholderWallet = `placeholder_${crypto.randomUUID()}`;
  const initialBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
  const avatarUrl = identity.picture || defaultAvatarUrl(username);
  const created = await queryOne<UserRow>(
    `INSERT INTO users (
       username, password_hash, wallet_address, name, balance,
       email, email_verified, avatar_url, google_sub, oauth_provider
     ) VALUES ($1, NULL, $2, $3, $4, $5, true, $6, $7, 'google')
     RETURNING id, username, email, name, avatar_url, wallet_address, balance, google_sub, email_verified`,
    [
      username,
      placeholderWallet,
      identity.name ?? username,
      initialBalance,
      identity.email,
      avatarUrl,
      identity.sub,
    ],
  );
  if (!created) throw new Error('Failed to create user');
  return { row: created, isNew: true };
}

async function findOrCreateMerchant(identity: GoogleIdentity): Promise<{ row: MerchantRow; isNew: boolean }> {
  const bySub = await queryOne<MerchantRow>(
    `SELECT id, username, email, display_name, business_name, avatar_url, wallet_address, balance, google_sub, email_verified
     FROM merchants WHERE google_sub = $1 LIMIT 1`,
    [identity.sub],
  );
  if (bySub) return { row: bySub, isNew: false };

  const byEmail = await queryOne<MerchantRow>(
    `SELECT id, username, email, display_name, business_name, avatar_url, wallet_address, balance, google_sub, email_verified
     FROM merchants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [identity.email],
  );
  if (byEmail) {
    const updated = await queryOne<MerchantRow>(
      `UPDATE merchants
         SET google_sub = $1,
             oauth_provider = COALESCE(oauth_provider, 'google'),
             email_verified = true,
             updated_at = NOW()
       WHERE id = $2
       RETURNING id, username, email, display_name, business_name, avatar_url, wallet_address, balance, google_sub, email_verified`,
      [identity.sub, byEmail.id],
    );
    return { row: updated ?? byEmail, isNew: false };
  }

  // Merchant: display/business names derived from Google name, falling back
  // to the email local part. Username is left NULL — matches the existing
  // merchant password-register flow (merchant.username is only set later
  // via the set_username action), so consumers never see two divergent
  // username-default behaviors.
  const localPart = identity.email.split('@')[0] || 'merchant';
  const businessName = (identity.name?.trim() || localPart).slice(0, 100);
  const displayName = (identity.name?.trim() || localPart).slice(0, 50);
  const initialBalance = MOCK_MODE ? MOCK_INITIAL_BALANCE : 0;
  const avatarUrl = identity.picture || defaultAvatarUrl(identity.email);

  const created = await queryOne<MerchantRow>(
    `INSERT INTO merchants (
       email, password_hash, business_name, display_name,
       status, is_online, balance, email_verified, avatar_url,
       google_sub, oauth_provider
     ) VALUES ($1, NULL, $2, $3, 'active', true, $4, true, $5, $6, 'google')
     RETURNING id, username, email, display_name, business_name, avatar_url, wallet_address, balance, google_sub, email_verified`,
    [identity.email, businessName, displayName, initialBalance, avatarUrl, identity.sub],
  );
  if (!created) throw new Error('Failed to create merchant');
  return { row: created, isNew: true };
}

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'auth:google', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const credential: unknown = body?.credential;
  const role: unknown = body?.role;
  const source: string | undefined =
    typeof body?.source === 'string' ? body.source : undefined;
  const wantsWaitlist = body?.waitlist === true;
  const referralCode: string | undefined =
    typeof body?.referral_code === 'string' ? body.referral_code.trim() : undefined;

  if (typeof credential !== 'string' || !credential) {
    return badRequest('credential is required');
  }
  if (role !== 'user' && role !== 'merchant') {
    return badRequest("role must be 'user' or 'merchant'");
  }

  const identity = await verifyGoogleIdToken(credential);
  if (!identity) {
    return NextResponse.json(
      { success: false, error: 'Invalid Google credential' },
      { status: 401 },
    );
  }

  try {
    const actorType: ActorType = role;
    let actorId: string;
    let publicRow: any;
    let isNew = false;

    if (role === 'user') {
      const { row, isNew: created } = await findOrCreateUser(identity);
      actorId = row.id;
      isNew = created;
      publicRow = row;
    } else {
      const { row, isNew: created } = await findOrCreateMerchant(identity);
      actorId = row.id;
      isNew = created;
      publicRow = row;
    }

    const payload = { actorId, actorType };

    let sessionId: string | null = null;
    let refreshToken: string | null = null;
    try {
      const sessionResult = await createSession(payload, request as any);
      if (sessionResult) {
        sessionId = sessionResult.sessionId;
        refreshToken = sessionResult.refreshToken;
      }
    } catch {
      /* session creation failed; proceed without session id */
    }

    const accessToken = generateAccessToken({
      ...payload,
      ...(sessionId && { sessionId }),
    });

    // Bootstrap onboarding rewards (idempotent — no-op on returning users).
    try {
      const { bootstrapNewActor } = await import('@/lib/coins/onboarding');
      await bootstrapNewActor(actorId, actorType);
    } catch {
      /* swallow */
    }

    if (wantsWaitlist) {
      try {
        await setupWaitlistForActor({
          actorId,
          actorType,
          source: source ?? `waitlist_${actorType}_google`,
          referralCode,
        });
      } catch (waitlistErr) {
        console.error('[google auth] waitlist setup failed:', waitlistErr);
      }
    }

    const res = NextResponse.json({
      success: true,
      data: {
        [role]: publicRow,
        ...(role === 'user' ? { needsWallet: !publicRow.wallet_address } : {}),
        isNewUser: isNew,
        token: 'cookie-session',
        ...(accessToken && { accessToken }),
      },
    });
    if (refreshToken) {
      res.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    }
    if (accessToken) {
      res.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, ACCESS_COOKIE_OPTIONS);
    }
    return res;
  } catch (err) {
    console.error('[google auth] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Google sign-in failed' },
      { status: 500 },
    );
  }
}
