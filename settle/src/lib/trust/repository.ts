/**
 * Blip.money Trust Score — input gathering + read entry point.
 *
 * `getTrustScore` reads an account's current state from EXISTING tables (no new
 * schema), feeds it to the pure `computeTrustScore`, and returns the result. It
 * is read-only — it writes nothing and is wired into no enforcement path yet, so
 * calling it changes no existing behaviour.
 *
 * USD volume uses orders.crypto_amount (the USD-stablecoin notional), NOT
 * fiat_amount — fiat_amount is the order's local currency (INR/AED) and summing
 * it across corridors would be wrong. This mirrors lib/coins/limits.ts.
 */

import { query, queryOne } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';
import { computeTrustScore, type TrustScoreInputs, type TrustScoreResult } from './score';

type TrustActorType = Extract<WaitlistActorType, 'user' | 'merchant'>;

interface AccountRow {
  created_at: Date;
  email_verified: boolean | null;
  phone_verified: boolean | null;
  face_verified: boolean | null;
  kyc_lvl: number | null;
  last_seen_at: Date | null;
}

interface OrderStatsRow {
  completed: number;
  total: number;
  volume: string;
  cancelled_30d: number;
  expired_30d: number;
  last_order_at: Date | null;
}

interface DisputeStatsRow {
  opened_against_90d: number;
  lost_90d: number;
  lost_180d: number;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}

/** Gather every input `computeTrustScore` needs, from existing tables. */
export async function gatherTrustInputs(
  accountType: TrustActorType,
  accountId: string,
): Promise<TrustScoreInputs> {
  const isMerchant = accountType === 'merchant';
  const table = isMerchant ? 'merchants' : 'users';
  const kycCol = isMerchant ? 'verification_level' : 'kyc_level';
  // Orders role: a user owns user_id; a merchant can be either side of a trade.
  const roleClause = isMerchant
    ? '(merchant_id = $1 OR buyer_merchant_id = $1)'
    : 'user_id = $1';
  // A "lost" dispute is one resolved in favour of the OTHER party.
  const otherParty = isMerchant ? 'user' : 'merchant';

  const [account, orderStats, disputeStats, socialRow] = await Promise.all([
    queryOne<AccountRow>(
      `SELECT created_at,
              COALESCE(email_verified, FALSE) AS email_verified,
              COALESCE(phone_verified, FALSE) AS phone_verified,
              COALESCE(face_verified, FALSE)  AS face_verified,
              COALESCE(${kycCol}, 0)          AS kyc_lvl,
              ${isMerchant ? 'last_seen_at' : 'NULL::timestamptz AS last_seen_at'}
         FROM ${table} WHERE id = $1`,
      [accountId],
    ),
    queryOne<OrderStatsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*)::int AS total,
         COALESCE(SUM(crypto_amount) FILTER (WHERE status = 'completed'), 0)::numeric AS volume,
         COUNT(*) FILTER (WHERE status = 'cancelled' AND created_at >= NOW() - INTERVAL '30 days')::int AS cancelled_30d,
         COUNT(*) FILTER (WHERE status = 'expired'   AND created_at >= NOW() - INTERVAL '30 days')::int AS expired_30d,
         MAX(created_at) AS last_order_at
       FROM orders WHERE ${roleClause}`,
      [accountId],
    ),
    queryOne<DisputeStatsRow>(
      `SELECT
         COUNT(*) FILTER (WHERE d.raiser_id <> $1 AND d.created_at >= NOW() - INTERVAL '90 days')::int AS opened_against_90d,
         COUNT(*) FILTER (WHERE d.resolved_in_favor_of = $2 AND d.resolved_at >= NOW() - INTERVAL '90 days')::int  AS lost_90d,
         COUNT(*) FILTER (WHERE d.resolved_in_favor_of = $2 AND d.resolved_at >= NOW() - INTERVAL '180 days')::int AS lost_180d
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE ${roleClause.replace(/merchant_id|buyer_merchant_id|user_id/g, (m) => 'o.' + m)}`,
      [accountId, otherParty],
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM x_account_verifications
        WHERE actor_type = $1 AND actor_id = $2 AND status = 'verified'`,
      [accountType, accountId],
    ),
  ]);

  const now = new Date();
  const createdAt = account?.created_at ? new Date(account.created_at) : now;

  // Last activity = most recent of (last order, merchant heartbeat). Null when
  // the account has never traded → no inactivity decay (nothing to decay from).
  const activityTimes: number[] = [];
  if (orderStats?.last_order_at) activityTimes.push(new Date(orderStats.last_order_at).getTime());
  if (account?.last_seen_at) activityTimes.push(new Date(account.last_seen_at).getTime());
  const daysSinceLastActivity =
    activityTimes.length > 0 ? daysBetween(new Date(Math.max(...activityTimes)), now) : 0;

  return {
    emailVerified: !!account?.email_verified,
    phoneVerified: !!account?.phone_verified,
    kycVerified: (account?.kyc_lvl ?? 0) >= 1,
    faceVerified: !!account?.face_verified,
    socialVerifiedCount: Number(socialRow?.n ?? 0),

    completedTrades: Number(orderStats?.completed ?? 0),
    totalOrders: Number(orderStats?.total ?? 0),
    lifetimeVolumeUsd: Number(orderStats?.volume ?? 0),
    accountAgeDays: daysBetween(createdAt, now),

    cancelledInWindow: Number(orderStats?.cancelled_30d ?? 0),
    expiredInWindow: Number(orderStats?.expired_30d ?? 0),
    disputesOpenedAgainstInWindow: Number(disputeStats?.opened_against_90d ?? 0),
    disputesLostIn90d: Number(disputeStats?.lost_90d ?? 0),
    disputesLostIn180d: Number(disputeStats?.lost_180d ?? 0),

    daysSinceLastActivity,

    // Persisted severe/manual adjustments — events ledger lands in a later phase.
    manualAdjustments: 0,
  };
}

/**
 * Compute an account's current Trust Score (read-only). Returns the score, tier,
 * and breakdown. Returns the inputs too so callers/admin can show the detail.
 */
export async function getTrustScore(
  accountType: TrustActorType,
  accountId: string,
): Promise<TrustScoreResult & { inputs: TrustScoreInputs }> {
  const inputs = await gatherTrustInputs(accountType, accountId);
  const result = computeTrustScore(inputs);
  return { ...result, inputs };
}
