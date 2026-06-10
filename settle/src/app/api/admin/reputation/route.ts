import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { requireAdminAuth } from '@/lib/middleware/auth';
import { TIER_THRESHOLDS } from '@/lib/reputation/types';

/**
 * GET /api/admin/reputation — read-only Reward / Reputation / Trust report.
 *
 * Lists every user OR merchant (?type=user|merchant) with:
 *   - Reward      → Blip points  (e.blip_points + e.locked_blip_points)
 *   - Reputation  → reputation_scores.total_score (300–900 CIBIL scale)
 *   - Trust       → reputation_scores.trust_score (0–100 component)
 *
 * All data already exists — this route only joins + paginates it. It mirrors
 * the /api/admin/merchants pattern (same auth, LEFT JOIN reputation_scores,
 * { success, data, total, summary } envelope).
 *
 * NOTE: we deliberately do NOT trust the stored `rs.tier` string — legacy
 * rows can hold a stale pre-CIBIL-rebase tier. The frontend derives the tier
 * from total_score via getTierFromScore(), and the tier *filter* here maps to
 * score ranges (TIER_THRESHOLDS) for the same reason.
 */

// Whitelisted sort clauses. `e` = entity table (users|merchants), `rs` =
// reputation_scores. Never interpolate raw user input into the ORDER BY.
const SORT_COLUMNS: Record<string, string> = {
  reputation: 'rs.total_score DESC NULLS LAST',
  trust: 'rs.trust_score DESC NULLS LAST',
  reward: '(COALESCE(e.blip_points, 0) + COALESCE(e.locked_blip_points, 0)) DESC',
  rating: 'e.rating DESC NULLS LAST',
  trades: 'e.total_trades DESC',
  newest: 'e.created_at DESC',
  oldest: 'e.created_at ASC',
};

// Map a tier key to a `rs.total_score` range condition. Mirrors the bands the
// frontend renders via getTierFromScore, so filtering matches the displayed tier.
function tierScoreCondition(tier: string): string | null {
  switch (tier) {
    case 'unscored':
      return 'rs.total_score IS NULL';
    case 'risky':
      return `rs.total_score >= ${TIER_THRESHOLDS.risky} AND rs.total_score < ${TIER_THRESHOLDS.newcomer}`;
    case 'newcomer':
      return `rs.total_score >= ${TIER_THRESHOLDS.newcomer} AND rs.total_score < ${TIER_THRESHOLDS.bronze}`;
    case 'bronze':
      return `rs.total_score >= ${TIER_THRESHOLDS.bronze} AND rs.total_score < ${TIER_THRESHOLDS.silver}`;
    case 'silver':
      return `rs.total_score >= ${TIER_THRESHOLDS.silver} AND rs.total_score < ${TIER_THRESHOLDS.gold}`;
    case 'gold':
      return `rs.total_score >= ${TIER_THRESHOLDS.gold} AND rs.total_score < ${TIER_THRESHOLDS.platinum}`;
    case 'platinum':
      return `rs.total_score >= ${TIER_THRESHOLDS.platinum}`;
    default:
      return null;
  }
}

interface ReputationRow {
  id: string;
  name: string;
  handle: string;
  wallet_address: string | null;
  blip_points: string;
  locked_blip_points: string;
  rating: string;
  total_trades: string;
  total_score: string | null;
  trust_score: string | null;
  review_score: string | null;
  execution_score: string | null;
  volume_score: string | null;
  consistency_score: string | null;
  badges: unknown;
  calculated_at: string | null;
  created_at: string;
}

function parseBadges(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') === 'merchant' ? 'merchant' : 'user';
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10) || 0;
    const sortBy = searchParams.get('sort') || 'reputation';
    const searchQuery = searchParams.get('search');
    const tierFilter = searchParams.get('tier');

    const isUser = type === 'user';
    const entityTable = isUser ? 'users' : 'merchants';
    // Display name + secondary handle differ by entity type.
    const nameExpr = isUser
      ? "COALESCE(NULLIF(e.name, ''), e.username, '')"
      : "COALESCE(NULLIF(e.display_name, ''), e.business_name, '')";
    const handleExpr = isUser ? "COALESCE(e.username, '')" : "COALESCE(e.business_name, '')";

    const orderClause =
      sortBy === 'name'
        ? `ORDER BY ${nameExpr} ASC`
        : `ORDER BY ${SORT_COLUMNS[sortBy] || SORT_COLUMNS.reputation}`;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 0;

    // Exclude synthetic placeholder accounts from the Users view (same rule as
    // /api/admin/users): open_order_* and m2m_* are not real signups.
    if (isUser) {
      conditions.push("e.username IS NOT NULL");
      conditions.push("e.username NOT LIKE 'open_order_%'");
      conditions.push("e.username NOT LIKE 'm2m_%'");
    }

    if (searchQuery) {
      paramIdx++;
      if (isUser) {
        conditions.push(
          `(e.username ILIKE $${paramIdx} OR e.name ILIKE $${paramIdx} OR e.email ILIKE $${paramIdx} OR e.id::text ILIKE $${paramIdx} OR e.wallet_address ILIKE $${paramIdx})`
        );
      } else {
        conditions.push(
          `(e.business_name ILIKE $${paramIdx} OR e.display_name ILIKE $${paramIdx} OR e.email ILIKE $${paramIdx} OR e.id::text ILIKE $${paramIdx})`
        );
      }
      params.push(`%${searchQuery}%`);
    }

    if (tierFilter) {
      const tierCond = tierScoreCondition(tierFilter);
      if (tierCond) conditions.push(tierCond);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    paramIdx++;
    const limitParam = paramIdx;
    params.push(limit);
    paramIdx++;
    const offsetParam = paramIdx;
    params.push(offset);

    const rows = await query<ReputationRow>(
      `SELECT
        e.id,
        ${nameExpr} AS name,
        ${handleExpr} AS handle,
        e.wallet_address,
        COALESCE(e.blip_points, 0)::text AS blip_points,
        COALESCE(e.locked_blip_points, 0)::text AS locked_blip_points,
        COALESCE(e.rating, 0)::text AS rating,
        COALESCE(e.total_trades, 0)::text AS total_trades,
        rs.total_score::text AS total_score,
        rs.trust_score::text AS trust_score,
        rs.review_score::text AS review_score,
        rs.execution_score::text AS execution_score,
        rs.volume_score::text AS volume_score,
        rs.consistency_score::text AS consistency_score,
        rs.badges AS badges,
        to_char(rs.calculated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS calculated_at,
        to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
      FROM ${entityTable} e
      LEFT JOIN reputation_scores rs ON rs.entity_id = e.id AND rs.entity_type = '${type}'
      ${whereClause}
      ${orderClause}
      LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params
    );

    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM ${entityTable} e
       LEFT JOIN reputation_scores rs ON rs.entity_id = e.id AND rs.entity_type = '${type}'
       ${whereClause}`,
      params.slice(0, params.length - 2) // exclude limit/offset
    );

    // Platform summary for this entity type (unfiltered).
    const placeholderFilter = isUser
      ? "WHERE username IS NOT NULL AND username NOT LIKE 'open_order_%' AND username NOT LIKE 'm2m_%'"
      : '';
    // `scored` / `avg_reputation` JOIN the entity table so they only count
    // reputation rows whose entity still exists (orphaned reputation_scores
    // rows from deleted entities would otherwise push scored above total).
    const summary = await queryOne<{
      total: string;
      scored: string;
      avg_reputation: string | null;
      total_reward: string;
    }>(
      `SELECT
        (SELECT COUNT(*) FROM ${entityTable} ${placeholderFilter})::text AS total,
        (SELECT COUNT(*)
           FROM ${entityTable} e
           JOIN reputation_scores rs ON rs.entity_id = e.id AND rs.entity_type = '${type}'
           ${placeholderFilter})::text AS scored,
        (SELECT AVG(rs.total_score)
           FROM ${entityTable} e
           JOIN reputation_scores rs ON rs.entity_id = e.id AND rs.entity_type = '${type}'
           ${placeholderFilter})::text AS avg_reputation,
        (SELECT COALESCE(SUM(COALESCE(blip_points, 0) + COALESCE(locked_blip_points, 0)), 0)
           FROM ${entityTable} ${placeholderFilter})::text AS total_reward`
    );

    const data = rows.map((r) => {
      const blip = parseInt(r.blip_points || '0', 10);
      const locked = parseInt(r.locked_blip_points || '0', 10);
      return {
        id: r.id,
        type,
        name: r.name || r.handle || r.id.slice(0, 8),
        handle: r.handle,
        walletAddress: r.wallet_address,
        blipPoints: blip,
        lockedBlipPoints: locked,
        rewardTotal: blip + locked,
        // null total_score => never scored. Frontend renders an "Unscored" state.
        scored: r.total_score !== null,
        reputationScore: r.total_score === null ? null : parseInt(r.total_score, 10),
        trustScore: r.trust_score === null ? null : parseInt(r.trust_score, 10),
        reviewScore: r.review_score === null ? null : parseInt(r.review_score, 10),
        executionScore: r.execution_score === null ? null : parseInt(r.execution_score, 10),
        volumeScore: r.volume_score === null ? null : parseInt(r.volume_score, 10),
        consistencyScore: r.consistency_score === null ? null : parseInt(r.consistency_score, 10),
        badges: parseBadges(r.badges),
        rating: parseFloat(r.rating || '0'),
        trades: parseInt(r.total_trades || '0', 10),
        calculatedAt: r.calculated_at,
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({
      success: true,
      data,
      total: parseInt(countResult?.count || '0', 10),
      limit,
      offset,
      summary: {
        total: parseInt(summary?.total || '0', 10),
        scored: parseInt(summary?.scored || '0', 10),
        avgReputation: summary?.avg_reputation ? Math.round(parseFloat(summary.avg_reputation)) : 0,
        totalReward: parseInt(summary?.total_reward || '0', 10),
      },
    });
  } catch (error) {
    console.error('Error fetching admin reputation:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch reputation data' },
      { status: 500 }
    );
  }
}
