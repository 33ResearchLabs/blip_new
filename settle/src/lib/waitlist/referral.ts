// Referral codes + reward crediting for the waitlist. Codes are 8-char base62
// generated from crypto.randomBytes and stored uniquely per row (partial
// unique indexes on users.referral_code and merchants.referral_code).

import crypto from 'crypto';
import { query, queryOne, transaction } from '@/lib/db';
import type { WaitlistActorType, WaitlistReferral } from '@/lib/types/database';
import { getReferralPoints } from './blipPoints';
import { creditPoints } from './credit';

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateReferralCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE62[bytes[i] % BASE62.length];
  }
  return out;
}

/**
 * Look up the (actor_type, actor_id) that owns a referral code. Searches
 * users first, then merchants. Returns null if not found.
 */
export async function findReferrerByCode(code: string): Promise<{
  id: string;
  type: WaitlistActorType;
} | null> {
  const u = await queryOne<{ id: string }>(
    `SELECT id FROM users WHERE referral_code = $1 LIMIT 1`,
    [code],
  );
  if (u) return { id: u.id, type: 'user' };

  const m = await queryOne<{ id: string }>(
    `SELECT id FROM merchants WHERE referral_code = $1 LIMIT 1`,
    [code],
  );
  if (m) return { id: m.id, type: 'merchant' };

  return null;
}

interface ApplyReferralArgs {
  referralCode: string;
  refereeId: string;
  refereeType: WaitlistActorType;
}

interface ApplyReferralResult {
  applied: boolean;
  reason?: 'not_found' | 'self_referral' | 'already_referred';
  referrer?: { id: string; type: WaitlistActorType };
}

/**
 * Apply a referral: record the link, credit both sides, mark reward_status.
 * No-op (returns reason) on self-referral, missing code, or duplicate referee.
 */
export async function applyReferral(args: ApplyReferralArgs): Promise<ApplyReferralResult> {
  const referrer = await findReferrerByCode(args.referralCode);
  if (!referrer) return { applied: false, reason: 'not_found' };

  if (referrer.id === args.refereeId && referrer.type === args.refereeType) {
    return { applied: false, reason: 'self_referral' };
  }

  // Insert with ON CONFLICT DO NOTHING — the unique (referred_type, referred_id)
  // index makes second calls for the same referee a no-op.
  const inserted = await transaction(async (client) => {
    const ins = await client.query<WaitlistReferral>(
      `INSERT INTO waitlist_referrals
         (referrer_id, referrer_type, referred_id, referred_type, referral_code, reward_status, reward_amount)
       VALUES ($1, $2, $3, $4, $5, 'pending', 0)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [referrer.id, referrer.type, args.refereeId, args.refereeType, args.referralCode],
    );
    if (ins.rows.length === 0) return null;

    // Write the referred_by pointer on the referee row for fast joins.
    const refereeTable = args.refereeType === 'merchant' ? 'merchants' : 'users';
    const refereeCol = referrer.type === 'merchant' ? 'referred_by_merchant_id' : 'referred_by_user_id';
    await client.query(
      `UPDATE ${refereeTable} SET ${refereeCol} = $1, updated_at = NOW() WHERE id = $2`,
      [referrer.id, args.refereeId],
    );

    return ins.rows[0];
  });

  if (!inserted) return { applied: false, reason: 'already_referred', referrer };

  // Credit both sides outside the insert transaction — creditPoints itself is
  // transactional and idempotent. If either fails we surface 'credited' = false
  // by leaving reward_status='pending' for the admin to retry.
  const referrerPoints = getReferralPoints(referrer.type);
  const refereePoints = getReferralPoints(args.refereeType);

  try {
    await creditPoints({
      actorId: referrer.id,
      actorType: referrer.type,
      event: 'REFERRAL_BONUS_EARNED',
      points: referrerPoints,
      metadata: { referee_id: args.refereeId, referee_type: args.refereeType },
    });
    await creditPoints({
      actorId: args.refereeId,
      actorType: args.refereeType,
      event: 'REFERRAL_BONUS_RECEIVED',
      points: refereePoints,
      metadata: { referrer_id: referrer.id, referrer_type: referrer.type },
    });

    await query(
      `UPDATE waitlist_referrals SET reward_status = 'credited', reward_amount = $1
        WHERE id = $2`,
      [referrerPoints, inserted.id],
    );
  } catch (err) {
    console.error('[waitlist/referral] credit failed', err);
    // Leave reward_status='pending'. Admin tool can retry.
  }

  return { applied: true, referrer };
}

/**
 * Referrals I've made — used on the dashboard referral card.
 */
export async function getMyReferrals(actorId: string, actorType: WaitlistActorType) {
  return query<WaitlistReferral>(
    `SELECT * FROM waitlist_referrals
      WHERE referrer_type = $1 AND referrer_id = $2
   ORDER BY created_at DESC`,
    [actorType, actorId],
  );
}
