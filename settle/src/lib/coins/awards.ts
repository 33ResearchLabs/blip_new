/**
 * Award policy — maps domain events (an order completes, a rating gets
 * left, a streak fires) into concrete awardCoins() calls. Business rules
 * live here so the economy module stays content-free.
 *
 * Idempotency is enforced by `source_ref` on the underlying log row,
 * so it is SAFE to call these awarders repeatedly with the same input
 * (e.g. a worker that scans completed orders on every tick).
 */

import { query, queryOne } from '@/lib/db';
import { awardCoins, type AwardResult } from './economy';
import type { WaitlistActorType, BlipPointEvent } from '@/lib/types/database';

// Concrete amounts — keep in sync with the user-facing earn table.
const AMOUNTS = {
  FIRST_TRADE: 200,
  TRADE_COMPLETED: 5,
  VOLUME_PER_50_USD: 1,
  FIVE_STAR: 10,
  STREAK_7: 50,
  STREAK_30: 300,
  DISPUTE_FREE_MONTH: 100,
  KYC_COMPLETED: 500,
  REFERRAL_FIRST_TRADE: 200,
} as const;

interface OrderRow {
  id: string;
  user_id: string;
  merchant_id: string | null;
  buyer_merchant_id: string | null;
  fiat_amount: number | null;
  status: string;
  completed_at: Date | null;
}

/**
 * Award coins for a single completed order. Awards both parties:
 *   - the merchant (or both merchants in M2M) gets TRADE_COMPLETED +
 *     VOLUME_BONUS
 *   - the user gets the same, capped by their daily limits
 *
 * Idempotent — re-running on the same order is a no-op.
 */
export async function awardOrderCompletion(order: OrderRow): Promise<AwardResult[]> {
  const results: AwardResult[] = [];
  if (order.status !== 'completed' || !order.completed_at) return results;

  const fiat = Number(order.fiat_amount ?? 0);
  // Round-down — every full $50 of volume earns 1 coin.
  const volumeCoins = Math.floor(fiat / 50) * AMOUNTS.VOLUME_PER_50_USD;

  // Parties that get credit. In an M2M order both merchant_id and
  // buyer_merchant_id are set; otherwise it's user + merchant.
  const parties: { actorId: string; actorType: WaitlistActorType }[] = [];
  if (order.merchant_id) parties.push({ actorId: order.merchant_id, actorType: 'merchant' });
  if (order.buyer_merchant_id) parties.push({ actorId: order.buyer_merchant_id, actorType: 'merchant' });
  // Only treat user_id as a real user if it's not a placeholder (M2M
  // orders use synthetic user_ids; the schema doc calls these out).
  if (order.user_id && order.merchant_id !== order.user_id) {
    // Heuristic: real user rows exist in users; M2M placeholders are
    // either prefixed or marked. We check via existence in users.
    const u = await queryOne<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [order.user_id]);
    if (u) parties.push({ actorId: order.user_id, actorType: 'user' });
  }

  for (const p of parties) {
    // 1. Per-trade flat reward.
    const perTrade = await awardCoins({
      ...p,
      event: 'TRADE_COMPLETED',
      points: AMOUNTS.TRADE_COMPLETED,
      sourceRef: order.id,
      metadata: { order_id: order.id, fiat },
    });
    results.push(perTrade);

    // 2. Volume bonus — only when fiat is large enough to earn ≥1 coin.
    if (volumeCoins > 0) {
      const vol = await awardCoins({
        ...p,
        event: 'VOLUME_BONUS',
        points: volumeCoins,
        sourceRef: order.id,
        metadata: { order_id: order.id, fiat },
      });
      results.push(vol);
    }

    // 3. First-trade lifetime bonus — guarded by the lifetime cap policy
    //    in economy.ts (CAP_POLICIES.FIRST_TRADE perPeriodCount = 1).
    //    The cap clamps subsequent attempts silently, so we can safely
    //    fire this for every completion without checking history.
    const first = await awardCoins({
      ...p,
      event: 'FIRST_TRADE',
      points: AMOUNTS.FIRST_TRADE,
      sourceRef: order.id,
      metadata: { order_id: order.id },
    });
    results.push(first);

    // 4. Referral credit — if this party was referred AND the referee's
    //    referral row is still in 'pending' state AND this is their
    //    first $50+ trade, credit the referrer.
    if (fiat >= 50) {
      await maybeCreditReferral(p.actorId, p.actorType, order.id);
    }
  }

  return results;
}

/**
 * If this actor was referred by someone and hasn't yet credited the
 * referrer, do so now and mark the referral row credited.
 */
async function maybeCreditReferral(
  refereeId: string,
  refereeType: WaitlistActorType,
  orderId: string,
): Promise<void> {
  const referral = await queryOne<{
    id: string;
    referrer_id: string;
    referrer_type: WaitlistActorType;
    reward_status: string;
  }>(
    `SELECT id, referrer_id, referrer_type, reward_status
       FROM waitlist_referrals
      WHERE referred_id = $1 AND referred_type = $2
      LIMIT 1`,
    [refereeId, refereeType],
  );
  if (!referral || referral.reward_status === 'credited') return;

  const res = await awardCoins({
    actorId: referral.referrer_id,
    actorType: referral.referrer_type,
    event: 'REFERRAL_TRADE_CREDITED',
    points: AMOUNTS.REFERRAL_FIRST_TRADE,
    sourceRef: refereeId, // one referral credit per referee — lifetime cap also enforces
    metadata: { referee_id: refereeId, order_id: orderId },
  });

  if (res.credited > 0 || res.reason === 'ALREADY_CREDITED') {
    await query(
      `UPDATE waitlist_referrals
          SET reward_status = 'credited',
              reward_amount = $1
        WHERE id = $2 AND reward_status <> 'credited'`,
      [res.credited, referral.id],
    );
  }
}

/**
 * Award coins for a 5-star rating received. Idempotent on (rated, event,
 * rating_id) via source_ref.
 */
export async function awardFiveStar(args: {
  ratedId: string;
  ratedType: WaitlistActorType;
  ratingId: string;
}): Promise<AwardResult> {
  return awardCoins({
    actorId: args.ratedId,
    actorType: args.ratedType,
    event: 'FIVE_STAR_RECEIVED',
    points: AMOUNTS.FIVE_STAR,
    sourceRef: args.ratingId,
    metadata: { rating_id: args.ratingId },
  });
}

/**
 * Award the KYC-completion bonus. Lifetime-capped at 1 by policy.
 */
export async function awardKycCompleted(args: {
  actorId: string;
  actorType: WaitlistActorType;
}): Promise<AwardResult> {
  return awardCoins({
    actorId: args.actorId,
    actorType: args.actorType,
    event: 'KYC_COMPLETED',
    points: AMOUNTS.KYC_COMPLETED,
    sourceRef: 'kyc',
    metadata: {},
  });
}

/**
 * Award the dispute-free-month bonus. Called by the monthly worker
 * once per (actor, year-month). The sourceRef key encodes the period
 * so retries within the same month are no-ops.
 */
export async function awardDisputeFreeMonth(args: {
  actorId: string;
  actorType: WaitlistActorType;
  yearMonth: string; // 'YYYY-MM'
}): Promise<AwardResult> {
  return awardCoins({
    actorId: args.actorId,
    actorType: args.actorType,
    event: 'DISPUTE_FREE_MONTH',
    points: AMOUNTS.DISPUTE_FREE_MONTH,
    sourceRef: `dfm:${args.yearMonth}`,
    metadata: { period: args.yearMonth },
  });
}

/**
 * Award a streak bonus. Idempotent on (actor, event, streak-week-key).
 * The week key encodes the ISO-week so a 7-day streak earned on different
 * weeks each gets credit.
 */
export async function awardStreak(args: {
  actorId: string;
  actorType: WaitlistActorType;
  kind: 7 | 30;
  weekKey: string; // 'YYYY-Www' for 7-day; 'YYYY-MM' for 30-day
}): Promise<AwardResult> {
  return awardCoins({
    actorId: args.actorId,
    actorType: args.actorType,
    event: args.kind === 7 ? 'STREAK_7' : 'STREAK_30',
    points: args.kind === 7 ? AMOUNTS.STREAK_7 : AMOUNTS.STREAK_30,
    sourceRef: `streak:${args.kind}:${args.weekKey}`,
    metadata: { period: args.weekKey },
  });
}

/**
 * Sweep: scan recently completed orders and award coins for any that
 * haven't been credited yet. The economy module's idempotency guards
 * make this safe to call as often as we like.
 *
 * Default lookback: 48 hours — wider than the daily worker's tick to
 * catch any orders that completed during a worker outage.
 */
export async function sweepCompletedOrders(
  lookbackHours = 48,
): Promise<{ processed: number; credited: number }> {
  const rows = await query<OrderRow>(
    `SELECT id, user_id, merchant_id, buyer_merchant_id, fiat_amount, status, completed_at
       FROM orders
      WHERE status = 'completed'
        AND completed_at >= NOW() - ($1 || ' hours')::interval`,
    [String(lookbackHours)],
  );

  let credited = 0;
  for (const order of rows) {
    const results = await awardOrderCompletion(order);
    credited += results.reduce((acc, r) => acc + r.credited, 0);
  }
  return { processed: rows.length, credited };
}

/**
 * Used by the trade-limit guard in /api/coins/spend/limit-bump and by
 * the order-create guard to know what tier the actor currently has.
 */
export { AMOUNTS };
