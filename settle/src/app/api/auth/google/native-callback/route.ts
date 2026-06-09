/**
 * POST /api/auth/google/native-callback
 *
 * GIS redirect-mode callback for Capacitor (Android/iOS) WebViews.
 * Google POSTs a form with `credential` (JWT) + optional `g_csrf_token`.
 * We verify the credential, mint a session identical to the JSON endpoint,
 * then redirect back to the appropriate app page.
 *
 * Used only when the app detects window.Capacitor and switches GIS to
 * ux_mode:"redirect" pointing here.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { queryOne } from '@/lib/db';
import { checkRateLimit, AUTH_LIMIT } from '@/lib/middleware/rateLimit';
import { verifyGoogleIdToken } from '@/lib/auth/googleIdToken';
import { deriveUniqueGoogleUsername } from '@/lib/auth/googleUsername';
import {
  generateAccessToken,
  REFRESH_TOKEN_COOKIE,
  REFRESH_COOKIE_OPTIONS,
  ACCESS_TOKEN_COOKIE,
  ACCESS_COOKIE_OPTIONS,
} from '@/lib/auth/sessionToken';
import { createSession } from '@/lib/auth/sessions';
import { defaultAvatarUrl } from '@/lib/avatars';
import { MOCK_MODE, MOCK_INITIAL_BALANCE } from '@/lib/config/mockMode';
import { triggerRecompute } from '@/lib/threat/recompute';
import { bootstrapNewActor } from '@/lib/coins/onboarding';

export async function POST(request: NextRequest) {
  const rateLimitResponse = await checkRateLimit(request, 'auth:google', AUTH_LIMIT);
  if (rateLimitResponse) return rateLimitResponse;

  let credential: string | null = null;
  let role: string = 'merchant';
  let redirectTo: string = '/merchant';

  try {
    const form = await request.formData();
    credential = form.get('credential') as string | null;
    const stateRaw = form.get('state') as string | null;
    if (stateRaw) {
      try {
        const state = JSON.parse(decodeURIComponent(stateRaw));
        if (state.role) role = state.role;
        if (state.redirect) redirectTo = state.redirect;
      } catch { /* ignore malformed state */ }
    }
  } catch {
    return NextResponse.redirect(new URL(`${redirectTo}?google_error=invalid_request`, request.url));
  }

  if (!credential) {
    return NextResponse.redirect(new URL(`${redirectTo}?google_error=no_credential`, request.url));
  }

  const identity = await verifyGoogleIdToken(credential);
  if (!identity) {
    return NextResponse.redirect(new URL(`${redirectTo}?google_error=invalid_token`, request.url));
  }

  try {
    const actorType = (role === 'user' ? 'user' : 'merchant') as 'user' | 'merchant';
    let actorId: string;
    let isNew = false;

    if (actorType === 'merchant') {
      const bySub = await queryOne<{ id: string }>(
        `SELECT id FROM merchants WHERE google_sub = $1 LIMIT 1`, [identity.sub]);
      if (bySub) {
        actorId = bySub.id;
      } else {
        const byEmail = await queryOne<{ id: string }>(
          `SELECT id FROM merchants WHERE LOWER(email) = LOWER($1) LIMIT 1`, [identity.email]);
        if (byEmail) {
          await queryOne(
            `UPDATE merchants SET google_sub=$1, oauth_provider=COALESCE(oauth_provider,'google'), email_verified=true, updated_at=NOW() WHERE id=$2`,
            [identity.sub, byEmail.id]);
          actorId = byEmail.id;
        } else {
          const localPart = identity.email.split('@')[0] || 'merchant';
          const businessName = (identity.name?.trim() || localPart).slice(0, 100);
          const displayName = (identity.name?.trim() || localPart).slice(0, 50);
          const avatarUrl = identity.picture || defaultAvatarUrl(identity.email);
          const created = await queryOne<{ id: string }>(
            `INSERT INTO merchants (email, password_hash, business_name, display_name, status, is_online, balance, email_verified, avatar_url, google_sub, oauth_provider)
             VALUES ($1, NULL, $2, $3, 'active', true, $4, true, $5, $6, 'google') RETURNING id`,
            [identity.email, businessName, displayName, MOCK_MODE ? MOCK_INITIAL_BALANCE : 0, avatarUrl, identity.sub]);
          if (!created) throw new Error('Failed to create merchant');
          actorId = created.id;
          isNew = true;
        }
      }
    } else {
      const bySub = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE google_sub = $1 LIMIT 1`, [identity.sub]);
      if (bySub) {
        actorId = bySub.id;
      } else {
        const byEmail = await queryOne<{ id: string }>(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [identity.email]);
        if (byEmail) {
          await queryOne(
            `UPDATE users SET google_sub=$1, oauth_provider=COALESCE(oauth_provider,'google'), email_verified=true, updated_at=NOW() WHERE id=$2`,
            [identity.sub, byEmail.id]);
          actorId = byEmail.id;
        } else {
          const username = await deriveUniqueGoogleUsername(identity.email, async (c) => {
            const u = await queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM users WHERE LOWER(username)=LOWER($1)', [c]);
            const m = await queryOne<{ count: string }>('SELECT COUNT(*) AS count FROM merchants WHERE LOWER(username)=LOWER($1)', [c]);
            return parseInt(u?.count||'0') + parseInt(m?.count||'0') > 0;
          });
          const avatarUrl = identity.picture || defaultAvatarUrl(username);
          const created = await queryOne<{ id: string }>(
            `INSERT INTO users (username, password_hash, wallet_address, name, balance, email, email_verified, avatar_url, google_sub, oauth_provider)
             VALUES ($1, NULL, $2, $3, $4, $5, true, $6, $7, 'google') RETURNING id`,
            [username, `placeholder_${crypto.randomUUID()}`, identity.name ?? username, MOCK_MODE ? MOCK_INITIAL_BALANCE : 0, identity.email, avatarUrl, identity.sub]);
          if (!created) throw new Error('Failed to create user');
          actorId = created.id;
          isNew = true;
        }
      }
    }

    const payload = { actorId, actorType };
    let sessionId: string | null = null;
    let refreshToken: string | null = null;
    try {
      const sessionResult = await createSession(payload, request as any);
      if (sessionResult) { sessionId = sessionResult.sessionId; refreshToken = sessionResult.refreshToken; }
    } catch { /* proceed without session */ }

    const accessToken = generateAccessToken({ ...payload, ...(sessionId && { sessionId }) });

    try { await bootstrapNewActor(actorId, actorType); } catch { /* swallow */ }
    if (isNew) triggerRecompute(actorType, actorId);

    const res = NextResponse.redirect(new URL(`${redirectTo}?google_ok=1`, request.url));
    if (refreshToken) res.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, REFRESH_COOKIE_OPTIONS);
    if (accessToken) res.cookies.set(ACCESS_TOKEN_COOKIE, accessToken, ACCESS_COOKIE_OPTIONS);
    return res;
  } catch (err) {
    console.error('[google native-callback] failed:', err);
    return NextResponse.redirect(new URL(`${redirectTo}?google_error=server_error`, request.url));
  }
}
