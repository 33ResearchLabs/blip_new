/**
 * Server-side verification-email helpers used by the login routes to
 * auto-resend a verification link when an unverified actor attempts to
 * sign in. The dedicated /resend-verification endpoints still exist for
 * the manual "Resend" button; this module is what the login flow calls
 * itself so the user doesn't have to click anything to receive a fresh
 * link.
 *
 * Each call:
 *   1. Looks up the actor + email + verification state.
 *   2. Throttles by account: if a token was issued in the last
 *      `RESEND_COOLDOWN_SECONDS`, no new email goes out. Returns the
 *      remaining cooldown so the API/UI can render a countdown.
 *   3. Otherwise: invalidates previous unused tokens, mints a fresh
 *      24h token, and sends the email (fire-and-forget — SES failures
 *      are logged, never thrown back to the caller).
 *
 * The throttle matches the 60s `UNVERIFIED_OVERWRITE_COOLDOWN_SECONDS`
 * constant in both register flows — keeps the user-visible "wait Ns"
 * cadence consistent across register, login-retry, and manual resend.
 */

import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { sendEmail, emailVerificationEmail } from '@/lib/email/ses';

export const RESEND_COOLDOWN_SECONDS = 60;

export interface ResendOutcome {
  /** `true` when a new email was queued; `false` when skipped (already
   *  verified, no email on file, or still in cooldown). */
  sent: boolean;
  /** Seconds the UI should disable the "Resend" button for. Equal to
   *  RESEND_COOLDOWN_SECONDS when a new email just went out; the
   *  remaining throttle window when an existing one was issued recently;
   *  `0` when nothing should be sent at all (verified / no email). */
  cooldownSeconds: number;
}

interface UserVerifyLookup {
  id: string;
  email: string | null;
  username: string | null;
  email_verified: boolean;
  seconds_since_last_token: number | null;
}

interface MerchantVerifyLookup {
  id: string;
  email: string | null;
  display_name: string | null;
  email_verified: boolean;
  seconds_since_last_token: number | null;
}

function buildVerifyLink(role: 'user' | 'merchant', actorId: string, token: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const path = role === 'merchant' ? '/market/verify-email' : '/user/verify-email';
  return `${appUrl}${path}?token=${token}&id=${actorId}`;
}

/**
 * Best-effort resend for a known user id. Safe to call fire-and-forget
 * from inside a login handler — never throws on email-send failures.
 */
export async function resendUserVerificationEmail(userId: string): Promise<ResendOutcome> {
  try {
    const row = await queryOne<UserVerifyLookup>(
      `SELECT u.id, u.email, u.username,
              COALESCE(u.email_verified, false) AS email_verified,
              (
                SELECT EXTRACT(EPOCH FROM (NOW() - t.created_at))::int
                  FROM user_email_verification_tokens t
                 WHERE t.user_id = u.id
              ORDER BY t.created_at DESC
                 LIMIT 1
              ) AS seconds_since_last_token
         FROM users u
        WHERE u.id = $1`,
      [userId]
    );

    if (!row || !row.email || row.email_verified) {
      return { sent: false, cooldownSeconds: 0 };
    }

    if (
      row.seconds_since_last_token !== null &&
      row.seconds_since_last_token < RESEND_COOLDOWN_SECONDS
    ) {
      return {
        sent: false,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS - row.seconds_since_last_token,
      };
    }

    await query(
      `UPDATE user_email_verification_tokens
          SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL`,
      [row.id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `INSERT INTO user_email_verification_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [row.id, tokenHash]
    );

    const content = emailVerificationEmail(
      buildVerifyLink('user', row.id, token),
      row.username || 'there'
    );
    sendEmail({ to: row.email, ...content }).catch((err) =>
      console.error('[auth/verification] user email send failed:', err)
    );

    return { sent: true, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
  } catch (err) {
    console.error('[auth/verification] resendUserVerificationEmail failed:', err);
    return { sent: false, cooldownSeconds: 0 };
  }
}

/**
 * Best-effort resend for a known merchant id. Same contract as the user
 * variant — never throws.
 */
export async function resendMerchantVerificationEmail(merchantId: string): Promise<ResendOutcome> {
  try {
    const row = await queryOne<MerchantVerifyLookup>(
      `SELECT m.id, m.email, m.display_name,
              COALESCE(m.email_verified, false) AS email_verified,
              (
                SELECT EXTRACT(EPOCH FROM (NOW() - t.created_at))::int
                  FROM email_verification_tokens t
                 WHERE t.merchant_id = m.id
              ORDER BY t.created_at DESC
                 LIMIT 1
              ) AS seconds_since_last_token
         FROM merchants m
        WHERE m.id = $1`,
      [merchantId]
    );

    if (!row || !row.email || row.email_verified) {
      return { sent: false, cooldownSeconds: 0 };
    }

    if (
      row.seconds_since_last_token !== null &&
      row.seconds_since_last_token < RESEND_COOLDOWN_SECONDS
    ) {
      return {
        sent: false,
        cooldownSeconds: RESEND_COOLDOWN_SECONDS - row.seconds_since_last_token,
      };
    }

    await query(
      `UPDATE email_verification_tokens
          SET used_at = NOW()
        WHERE merchant_id = $1 AND used_at IS NULL`,
      [row.id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await query(
      `INSERT INTO email_verification_tokens (merchant_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [row.id, tokenHash]
    );

    const content = emailVerificationEmail(
      buildVerifyLink('merchant', row.id, token),
      row.display_name || 'there'
    );
    sendEmail({ to: row.email, ...content }).catch((err) =>
      console.error('[auth/verification] merchant email send failed:', err)
    );

    return { sent: true, cooldownSeconds: RESEND_COOLDOWN_SECONDS };
  } catch (err) {
    console.error('[auth/verification] resendMerchantVerificationEmail failed:', err);
    return { sent: false, cooldownSeconds: 0 };
  }
}
