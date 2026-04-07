/**
 * Matching Engine — Reputation Integration
 *
 * Reads reputation_score directly from merchants/users tables.
 * ZERO joins, ZERO external API calls, O(1) reads.
 *
 * Usage in offer ranking:
 *   const ranked = await rankOffers(offers, userId);
 */

import { query as dbQuery } from 'settlement-core';

// ============================================
// FAST READ — O(1) from indexed columns
// ============================================

export async function getMerchantReputation(merchantId: string): Promise<{ score: number; tier: string }> {
  const rows = await dbQuery<{ reputation_score: number; reputation_tier: string }>(
    `SELECT COALESCE(reputation_score, 0) as reputation_score, COALESCE(reputation_tier, 'average') as reputation_tier
     FROM merchants WHERE id = $1`,
    [merchantId]
  );
  if (rows.length === 0) return { score: 0, tier: 'average' };
  return { score: rows[0].reputation_score, tier: rows[0].reputation_tier };
}

export async function getUserReputation(userId: string): Promise<{ score: number; tier: string }> {
  const rows = await dbQuery<{ reputation_score: number; reputation_tier: string }>(
    `SELECT COALESCE(reputation_score, 0) as reputation_score, COALESCE(reputation_tier, 'average') as reputation_tier
     FROM users WHERE id = $1`,
    [userId]
  );
  if (rows.length === 0) return { score: 0, tier: 'average' };
  return { score: rows[0].reputation_score, tier: rows[0].reputation_tier };
}

/**
 * Pair score: average of user + merchant reputation.
 * Used to estimate trade reliability.
 */
export function pairScore(userScore: number, merchantScore: number): number {
  return (userScore + merchantScore) / 2;
}

// ============================================
// OFFER RANKING
// ============================================

interface Offer {
  id: string;
  merchant_id: string;
  price: number;          // offer price (fiat per crypto unit)
  market_price: number;   // current market rate
}

interface RankedOffer extends Offer {
  rank_score: number;
  merchant_reputation: number;
  pair_score: number;
}

const RANK_WEIGHTS = {
  price: 0.50,              // 50% weight on price competitiveness
  merchant_reputation: 0.30, // 30% weight on merchant reputation
  pair_compatibility: 0.20,  // 20% weight on pair score
};

/**
 * Rank offers for a user.
 * Reads merchant reputation from DB (already denormalized, O(1) per merchant).
 * No joins, no external calls.
 */
export async function rankOffers(offers: Offer[], userId: string): Promise<RankedOffer[]> {
  if (offers.length === 0) return [];

  // Get user reputation once
  const userRep = await getUserReputation(userId);

  // Get all merchant reputations in a single query
  const merchantIds = [...new Set(offers.map(o => o.merchant_id))];
  const merchantRows = await dbQuery<{ id: string; reputation_score: number }>(
    `SELECT id, COALESCE(reputation_score, 0) as reputation_score
     FROM merchants WHERE id = ANY($1)`,
    [merchantIds]
  );
  const merchantScores = new Map(merchantRows.map(r => [r.id, r.reputation_score]));

  // Score each offer
  const ranked: RankedOffer[] = offers.map(offer => {
    const merchantRep = merchantScores.get(offer.merchant_id) || 0;

    // Price competitiveness: how close to market price (0-100)
    // Lower spread = higher score
    const spread = Math.abs(offer.price - offer.market_price) / offer.market_price;
    const priceScore = Math.max(0, 100 - (spread * 1000)); // 0% spread = 100, 10% = 0

    // Normalize reputation to 0-100 (already is)
    const repScore = merchantRep;

    // Pair score
    const pair = pairScore(userRep.score, merchantRep);

    // Weighted total
    const rankScore =
      (priceScore * RANK_WEIGHTS.price) +
      (repScore * RANK_WEIGHTS.merchant_reputation) +
      (pair * RANK_WEIGHTS.pair_compatibility);

    return {
      ...offer,
      rank_score: Math.round(rankScore * 10) / 10,
      merchant_reputation: merchantRep,
      pair_score: Math.round(pair * 10) / 10,
    };
  });

  // Sort by rank_score descending (best first)
  ranked.sort((a, b) => b.rank_score - a.rank_score);

  return ranked;
}
