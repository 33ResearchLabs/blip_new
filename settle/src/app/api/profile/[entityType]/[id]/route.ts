/**
 * GET /api/profile/[entityType]/[id]   (entityType = user | merchant)
 *
 * Aggregated PUBLIC counterparty profile for the profile page/modal — identity,
 * trust score, verifications, trading stats, recent reviews, risk overview,
 * limits & tier, and social links. Any authenticated user/merchant may view any
 * profile (you need to vet a counterparty before trading). Reuses existing
 * reputation / ratings / limits / verification helpers; adds no tables.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  successResponse,
  errorResponse,
  notFoundResponse,
  validationErrorResponse,
} from "@/lib/middleware/auth";
import { query, queryOne } from "@/lib/db";
import { getReputationWithBreakdown } from "@/lib/reputation";
import { TIER_INFO, type ReputationTier } from "@/lib/reputation/types";
import { getRatingsForEntity, type Rating } from "@/lib/db/repositories/ratings";
import { getXVerification } from "@/lib/db/repositories/xAccountVerifications";
import { getEffectiveLimits } from "@/lib/coins/limits";
import {
  toTrustScore100,
  trustBand,
  type ProfileData,
  type ProfileEntityType,
  type ProfileReview,
  type RiskLevel,
  type SecurityLevel,
} from "@/components/shared/profile/types";

interface IdentityRow {
  id: string;
  name: string | null;
  username: string | null;
  avatar_url: string | null;
  phone_verified: boolean | null;
  email_verified: boolean | null;
  face_verified: boolean | null;
  kyc: number | null;
  total_trades: number | null;
  total_volume: string | number | null;
  rating: string | number | null;
  rating_count: number | null;
  cancelled_orders: number | null;
  dispute_count: number | null;
  is_online: boolean | null;
  last_seen_at: Date | null;
  created_at: Date;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const { entityType: rawType, id } = await params;
  if (rawType !== "user" && rawType !== "merchant") {
    return validationErrorResponse(["entityType must be 'user' or 'merchant'"]);
  }
  const entityType = rawType as ProfileEntityType;

  // Identity + verification flags — explicit per-table projection (users and
  // merchants have different columns; users have no online/last-seen).
  const identity =
    entityType === "merchant"
      ? await queryOne<IdentityRow>(
          `SELECT id,
                  COALESCE(display_name, business_name, username) AS name,
                  username, avatar_url,
                  COALESCE(phone_verified, FALSE) AS phone_verified,
                  COALESCE(email_verified, FALSE) AS email_verified,
                  COALESCE(face_verified, FALSE)  AS face_verified,
                  COALESCE(verification_level, 0) AS kyc,
                  total_trades, total_volume, rating, rating_count,
                  cancelled_orders, dispute_count, is_online, last_seen_at,
                  created_at
             FROM merchants WHERE id = $1`,
          [id],
        )
      : await queryOne<IdentityRow>(
          `SELECT id,
                  COALESCE(name, username) AS name,
                  username, avatar_url,
                  COALESCE(phone_verified, FALSE) AS phone_verified,
                  COALESCE(email_verified, FALSE) AS email_verified,
                  COALESCE(face_verified, FALSE)  AS face_verified,
                  COALESCE(kyc_level, 0) AS kyc,
                  total_trades, total_volume, rating, rating_count,
                  cancelled_orders, dispute_count,
                  FALSE AS is_online, NULL::timestamp AS last_seen_at,
                  created_at
             FROM users WHERE id = $1`,
          [id],
        );

  if (!identity) return notFoundResponse("Profile");

  try {
    const [rep, limits, xVerif, ratings, disputeStats] = await Promise.all([
      getReputationWithBreakdown(id, entityType).catch(() => null),
      getEffectiveLimits(id, entityType).catch(() => null),
      getXVerification(entityType, id).catch(() => null),
      getRatingsForEntity(entityType, id, 5).catch(() => []),
      countDisputes(entityType, id).catch(() => ({ active: 0, fraud: 0 })),
    ]);

    const score = rep?.score ?? null;
    const bd = rep?.breakdown ?? null;

    // Trust score (300-900 → 0-100). New accounts with no rep row default to 500.
    const internalScore = score?.total_score ?? 500;
    const trust100 = toTrustScore100(internalScore);

    const tier = (score?.tier ?? "newcomer") as ReputationTier;
    const tierName = TIER_INFO[tier]?.name ?? "New";

    // Verifications + security level.
    const phone = !!identity.phone_verified;
    const email = !!identity.email_verified;
    const liveness = !!identity.face_verified;
    const x = !!xVerif?.verified_at;
    const verifiedCount = [phone, email, liveness, x].filter(Boolean).length;
    const securityLevel: SecurityLevel =
      verifiedCount >= 3 ? "High" : verifiedCount >= 2 ? "Medium" : "Low";

    // Trading stats — prefer the live reputation breakdown, fall back to cached row.
    const totalTrades = bd?.execution.completed_orders ?? Number(identity.total_trades ?? 0);
    const cached = Number(identity.total_trades ?? 0);
    const cancelled = Number(identity.cancelled_orders ?? 0);
    const successRate =
      bd?.execution.completion_rate ??
      (cached + cancelled > 0 ? Math.round((cached / (cached + cancelled)) * 100) : 100);
    const volumeUsd = bd?.volume.total_volume_usd ?? Number(identity.total_volume ?? 0);
    const avgTradeUsd =
      bd?.volume.avg_order_size ?? (totalTrades > 0 ? volumeUsd / totalTrades : 0);

    // Reviews — counts from breakdown/cached, recent enriched with author info.
    const reviewCount = bd?.reviews.count ?? Number(identity.rating_count ?? 0);
    const reviewAvg = bd?.reviews.average_rating ?? Number(identity.rating ?? 0);
    const recent = await enrichReviews(ratings);

    // Risk level from reputation flags.
    const flags = score?.flags ?? [];
    const riskLevel: RiskLevel = flags.includes("high_dispute_rate") || flags.includes("low_trust")
      ? "High"
      : flags.includes("low_completion_rate") || flags.includes("low_reliability")
        ? "Medium"
        : "Low";

    const accountAgeDays =
      bd?.consistency.account_age_days ??
      Math.floor((Date.now() - new Date(identity.created_at).getTime()) / 86_400_000);

    const data: ProfileData = {
      entityType,
      id: identity.id,
      name: identity.name ?? "Trader",
      username: identity.username,
      avatarUrl: identity.avatar_url,
      verified: liveness || (identity.kyc ?? 0) >= 2,
      tier,
      tierLabel: `${tierName} Trader`,
      memberSince: new Date(identity.created_at).toISOString(),
      lastActive: identity.last_seen_at ? new Date(identity.last_seen_at).toISOString() : null,
      isOnline: !!identity.is_online,
      trust: { score: trust100, band: trustBand(trust100) },
      verifications: { phone, email, liveness, x, securityLevel },
      stats: {
        totalTrades,
        successRate: Math.round(successRate),
        volumeUsd,
        avgTradeUsd,
      },
      reviews: { count: reviewCount, average: reviewAvg, recent },
      risk: {
        level: riskLevel,
        activeDisputes: disputeStats.active,
        fraudReports: disputeStats.fraud,
        successRate: Math.round(successRate),
        accountAgeDays,
      },
      limits: {
        tierLabel: `${tierName} Trader`,
        dailyUsd: Number(limits?.dailyUsd ?? 0),
        perTradeUsd: Number(limits?.perTradeUsd ?? 0),
      },
      social: {
        x: xVerif?.x_username ? { handle: xVerif.x_username, verified: !!xVerif.verified_at } : null,
        telegram: null, // not stored as a public handle yet
        discord: null, // not stored yet
      },
    };

    return successResponse(data);
  } catch (err) {
    console.error("[profile] aggregation failed", err);
    return errorResponse("Couldn't load this profile");
  }
}

/** Open disputes + fraud-flagged disputes involving this actor (by order role). */
async function countDisputes(
  entityType: ProfileEntityType,
  id: string,
): Promise<{ active: number; fraud: number }> {
  const cond =
    entityType === "merchant"
      ? "(o.merchant_id = $1 OR o.buyer_merchant_id = $1)"
      : "o.user_id = $1";
  const row = await queryOne<{ active: number; fraud: number }>(
    `SELECT
        COUNT(*) FILTER (WHERE d.status IN ('open','investigating','escalated'))::int AS active,
        COUNT(*) FILTER (WHERE d.reason = 'fraud')::int AS fraud
       FROM disputes d JOIN orders o ON o.id = d.order_id
      WHERE ${cond}`,
    [id],
  );
  return { active: Number(row?.active ?? 0), fraud: Number(row?.fraud ?? 0) };
}

/** Attach each rater's display name + avatar to the recent reviews. */
async function enrichReviews(ratings: Rating[]): Promise<ProfileReview[]> {
  if (!ratings.length) return [];
  const userIds = ratings.filter((r) => r.rater_type === "user").map((r) => r.rater_id);
  const merchantIds = ratings.filter((r) => r.rater_type === "merchant").map((r) => r.rater_id);

  const authors = new Map<string, { name: string; avatar: string | null }>();
  if (userIds.length) {
    const rows = await query<{ id: string; name: string | null; username: string | null; avatar_url: string | null }>(
      `SELECT id, name, username, avatar_url FROM users WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    rows.forEach((u) => authors.set(`user:${u.id}`, { name: u.name || u.username || "User", avatar: u.avatar_url }));
  }
  if (merchantIds.length) {
    const rows = await query<{ id: string; display_name: string | null; business_name: string | null; username: string | null; avatar_url: string | null }>(
      `SELECT id, display_name, business_name, username, avatar_url FROM merchants WHERE id = ANY($1::uuid[])`,
      [merchantIds],
    );
    rows.forEach((m) =>
      authors.set(`merchant:${m.id}`, {
        name: m.display_name || m.business_name || m.username || "Merchant",
        avatar: m.avatar_url,
      }),
    );
  }

  return ratings.map((r) => {
    const a = authors.get(`${r.rater_type}:${r.rater_id}`);
    return {
      id: r.id,
      rating: Number(r.rating),
      text: r.review_text ?? null,
      authorName: a?.name ?? "Anonymous",
      authorAvatar: a?.avatar ?? null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}
