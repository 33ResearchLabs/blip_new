/**
 * Database queries for reputation data aggregation.
 * Uses settlement-core's query helper.
 */

import { query as dbQuery } from 'settlement-core';
import { TradeRecord } from './types';

// ============================================
// RESOLVE ENTITY
// ============================================

export async function resolveMerchant(id: string): Promise<{ id: string; wallet_address: string; balance: number; is_online: boolean; avg_response_time_mins: number } | null> {
  const rows = await dbQuery<any>(
    `SELECT id, wallet_address, COALESCE(balance, 0)::float as balance, is_online,
            COALESCE(avg_response_time_mins, 0) as avg_response_time_mins
     FROM merchants WHERE id::text = $1 OR wallet_address = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

export async function resolveUser(id: string): Promise<{ id: string; wallet_address: string } | null> {
  const rows = await dbQuery<any>(
    `SELECT id, wallet_address FROM users WHERE id::text = $1 OR wallet_address = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// ============================================
// MERCHANT TRADES (V1 + V2 + offchain)
// ============================================

export async function fetchMerchantTrades(merchantUuid: string, walletAddress: string): Promise<TradeRecord[]> {
  const rows = await dbQuery<any>(
    `
    SELECT * FROM (
      -- V1 on-chain
      SELECT COALESCE(NULLIF(t.amount,'')::numeric,0)/1000000 as amount_usd, LOWER(t.state) as status,
        t.created_at, t.released_at as completed_at, NULL::timestamp as payment_sent_at,
        t."user" as counterparty, 'v1' as source, NULL as cancelled_by,
        false as disputed, false as dispute_lost, false as dispute_raised_by_user,
        t.refunded_at IS NOT NULL as was_refunded, false as timed_out
      FROM trades t WHERE t.merchant = $2 AND t.protocol_version = 'v1'

      UNION ALL

      -- V2 as creator
      SELECT COALESCE(NULLIF(v.amount,'')::numeric,0)/1000000, LOWER(v.status),
        v.created_at, v.released_at, NULL, v.counterparty_pubkey, 'v2', NULL,
        false, false, false, v.refunded_at IS NOT NULL, false
      FROM v2_trades v WHERE v.creator_pubkey = $2

      UNION ALL

      -- V2 as counterparty
      SELECT COALESCE(NULLIF(v.amount,'')::numeric,0)/1000000, LOWER(v.status),
        v.created_at, v.released_at, NULL, v.creator_pubkey, 'v2', NULL,
        false, false, false, v.refunded_at IS NOT NULL, false
      FROM v2_trades v WHERE v.counterparty_pubkey = $2

      UNION ALL

      -- Offchain as merchant
      SELECT COALESCE(o.fiat_amount,0)::float, o.status::text,
        o.created_at, o.completed_at, o.payment_sent_at, o.buyer_merchant_id::text, 'offchain', o.cancelled_by::text,
        o.disputed_at IS NOT NULL,
        EXISTS(SELECT 1 FROM disputes d WHERE d.order_id=o.id AND d.resolved_in_favor_of IS NOT NULL AND d.resolved_in_favor_of::text!='merchant'),
        false, false,
        (o.status::text='expired' OR (o.status::text='cancelled' AND o.cancelled_by::text='system'))
      FROM orders o WHERE o.merchant_id = $1
    ) combined`,
    [merchantUuid, walletAddress]
  );

  return rows.map(mapTradeRow);
}

// ============================================
// USER TRADES
// ============================================

export async function fetchUserTrades(userUuid: string, walletAddress: string): Promise<TradeRecord[]> {
  const rows = await dbQuery<any>(
    `
    SELECT * FROM (
      -- V1 on-chain (user side)
      SELECT COALESCE(NULLIF(t.amount,'')::numeric,0)/1000000 as amount_usd, LOWER(t.state) as status,
        t.created_at, t.released_at as completed_at, NULL::timestamp as payment_sent_at,
        t.merchant as counterparty, 'v1' as source, NULL as cancelled_by,
        false as disputed, false as dispute_lost, false as dispute_raised_by_user,
        t.refunded_at IS NOT NULL as was_refunded, false as timed_out
      FROM trades t WHERE t."user" = $2 AND t.protocol_version = 'v1'

      UNION ALL

      -- V2 as counterparty
      SELECT COALESCE(NULLIF(v.amount,'')::numeric,0)/1000000, LOWER(v.status),
        v.created_at, v.released_at, NULL, v.creator_pubkey, 'v2', NULL,
        false, false, false, v.refunded_at IS NOT NULL, false
      FROM v2_trades v WHERE v.counterparty_pubkey = $2

      UNION ALL

      -- V2 as creator
      SELECT COALESCE(NULLIF(v.amount,'')::numeric,0)/1000000, LOWER(v.status),
        v.created_at, v.released_at, NULL, v.counterparty_pubkey, 'v2', NULL,
        false, false, false, v.refunded_at IS NOT NULL, false
      FROM v2_trades v WHERE v.creator_pubkey = $2

      UNION ALL

      -- Offchain as buyer
      SELECT COALESCE(o.fiat_amount,0)::float, o.status::text,
        o.created_at, o.completed_at, o.payment_sent_at, o.merchant_id::text, 'offchain', o.cancelled_by::text,
        o.disputed_at IS NOT NULL,
        EXISTS(SELECT 1 FROM disputes d WHERE d.order_id=o.id AND d.resolved_in_favor_of IS NOT NULL AND d.resolved_in_favor_of::text!='user'),
        EXISTS(SELECT 1 FROM disputes d WHERE d.order_id=o.id AND d.raised_by::text='user'),
        false,
        (o.status::text='expired' OR (o.status::text='cancelled' AND o.cancelled_by::text='system'))
      FROM orders o WHERE o.user_id = $1
    ) combined`,
    [userUuid, walletAddress || '']
  );

  return rows.map(mapTradeRow);
}

// ============================================
// RATINGS & EVENTS
// ============================================

export async function fetchRatings(entityId: string, entityType: 'merchant' | 'user'): Promise<{ rating: number; created_at: Date }[]> {
  const rows = await dbQuery<any>(
    `SELECT rating, created_at FROM ratings WHERE rated_id = $1 AND rated_type = $2 ORDER BY created_at DESC`,
    [entityId, entityType]
  );
  return rows.map((r: any) => ({ rating: r.rating, created_at: new Date(r.created_at) }));
}

export async function fetchPenaltyEvents(entityId: string, entityType: 'merchant' | 'user'): Promise<{ event_type: string; score_change: number; created_at: Date }[]> {
  const rows = await dbQuery<any>(
    `SELECT event_type, score_change, created_at FROM reputation_events WHERE entity_id = $1 AND entity_type = $2 ORDER BY created_at DESC`,
    [entityId, entityType]
  );
  return rows.map((r: any) => ({ event_type: r.event_type, score_change: r.score_change || 0, created_at: new Date(r.created_at) }));
}

// ============================================
// PERSISTENCE
// ============================================

export async function persistReputationScore(entityId: string, entityType: 'merchant' | 'user', result: {
  total_score: number; tier: string; badges: string[];
  breakdown: Record<string, { raw: number }>;
}): Promise<void> {
  // Core API owns ONLY the denormalised fast-access columns that the
  // matching engine + arbiter eligibility read directly (0–1000 scale,
  // zero joins). It must NOT write `reputation_scores` / `reputation_history`
  // anymore: those are the DISPLAY tables (leaderboard + in-app score) and
  // are owned EXCLUSIVELY by settle's calculator, which emits CIBIL-rebased
  // 300–900 scores. When core-api also upserted `reputation_scores` here,
  // its 5-minute sweep clobbered settle's rows with a different algorithm
  // AND a different scale — that's what made the leaderboard show ~400 /
  // 'diamond' for everyone while the app showed a different 300–900 number.
  // Settle now keeps `reputation_scores` fresh — see
  // settle/src/workers/reputation-worker.ts.
  if (entityType === 'merchant') {
    await dbQuery(`UPDATE merchants SET reputation_score = $1, reputation_tier = $2 WHERE id = $3`,
      [Math.round(result.total_score), result.tier, entityId]);
  } else {
    await dbQuery(`UPDATE users SET reputation_score = $1, reputation_tier = $2 WHERE id = $3`,
      [Math.round(result.total_score), result.tier, entityId]);
  }
}

// ============================================
// HELPERS
// ============================================

function mapTradeRow(r: any): TradeRecord {
  return {
    amount_usd: parseFloat(r.amount_usd) || 0,
    status: r.status,
    created_at: new Date(r.created_at),
    completed_at: r.completed_at ? new Date(r.completed_at) : null,
    payment_sent_at: r.payment_sent_at ? new Date(r.payment_sent_at) : null,
    counterparty: r.counterparty,
    source: r.source as 'v1' | 'v2' | 'offchain',
    cancelled_by: r.cancelled_by,
    disputed: r.disputed,
    dispute_lost: r.dispute_lost,
    dispute_raised_by_user: r.dispute_raised_by_user || false,
    was_refunded: r.was_refunded,
    timed_out: r.timed_out || false,
  };
}
