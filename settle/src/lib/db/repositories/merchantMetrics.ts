import { query, queryOne } from '@/lib/db';
import type { MerchantMetrics } from '@/lib/matching/types';

interface ScoringViewRow {
  merchant_id: string;
  avg_rating: string | null;
  rating_count: number;
  balance: string;
  is_online: boolean;
  merchant_status: string;
  trust_level: MerchantMetrics['trustLevel'];
  suspended_until: Date | null;
  total_orders: number;
  completed_orders: number;
  disputed_orders: number;
  disputes_lost: number;
  avg_completion_seconds: number;
  success_rate: string;
  dispute_rate: string;
}

function hydrate(row: ScoringViewRow): MerchantMetrics {
  return {
    merchantId: row.merchant_id,
    avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
    ratingCount: row.rating_count,
    balance: Number(row.balance),
    isOnline: row.is_online,
    merchantStatus: row.merchant_status,
    trustLevel: row.trust_level,
    suspendedUntil: row.suspended_until,
    totalOrders: row.total_orders,
    completedOrders: row.completed_orders,
    disputedOrders: row.disputed_orders,
    disputesLost: row.disputes_lost,
    avgCompletionSeconds: row.avg_completion_seconds,
    successRate: Number(row.success_rate),
    disputeRate: Number(row.dispute_rate),
  };
}

export async function getMetricsForMerchants(ids: string[]): Promise<Record<string, MerchantMetrics>> {
  if (ids.length === 0) return {};
  const rows = await query<ScoringViewRow>(
    `SELECT * FROM v_merchant_scoring WHERE merchant_id = ANY($1::uuid[])`,
    [ids],
  );
  const out: Record<string, MerchantMetrics> = {};
  for (const r of rows) out[r.merchant_id] = hydrate(r);
  return out;
}

export async function getMetricsForMerchant(id: string): Promise<MerchantMetrics | null> {
  const row = await queryOne<ScoringViewRow>(
    `SELECT * FROM v_merchant_scoring WHERE merchant_id = $1`,
    [id],
  );
  return row ? hydrate(row) : null;
}

/**
 * Post-order update. Called from the order-completion / dispute-resolution
 * paths. Upserts metrics row if missing.
 *
 * Semantics:
 *   completed   → increments completed_orders, updates avg_completion_seconds
 *   failed      → increments failed_orders
 *   disputed    → increments disputed_orders
 *   dispute_lost→ increments disputes_lost (implies disputed)
 */
export async function recordOrderOutcome(params: {
  merchantId: string;
  outcome: 'completed' | 'failed' | 'disputed' | 'dispute_lost';
  orderVolumeUsdt?: number;
  completionSeconds?: number;
}): Promise<void> {
  // Insert-or-update using COALESCE on the rolling avg.
  await query(
    `INSERT INTO merchant_metrics (merchant_id)
       VALUES ($1)
     ON CONFLICT (merchant_id) DO NOTHING`,
    [params.merchantId],
  );

  const incCols: string[] = ['total_orders = total_orders + 1'];
  if (params.outcome === 'completed') {
    incCols.push('completed_orders = completed_orders + 1');
    if (params.orderVolumeUsdt && params.orderVolumeUsdt > 0) {
      incCols.push(`total_volume_usdt = total_volume_usdt + ${Number(params.orderVolumeUsdt)}`);
    }
    if (params.completionSeconds && params.completionSeconds > 0) {
      // EMA with α=0.2 so a single slow order doesn't dominate.
      incCols.push(
        `avg_completion_seconds = GREATEST(1,
           ROUND(avg_completion_seconds * 0.8 + ${Number(params.completionSeconds)} * 0.2)::int)`,
      );
    }
  } else if (params.outcome === 'failed') {
    incCols.push('failed_orders = failed_orders + 1');
  } else if (params.outcome === 'disputed') {
    incCols.push('disputed_orders = disputed_orders + 1');
  } else if (params.outcome === 'dispute_lost') {
    incCols.push('disputed_orders = disputed_orders + 1');
    incCols.push('disputes_lost = disputes_lost + 1');
  }
  incCols.push('last_order_at = now()');
  incCols.push('updated_at = now()');

  await query(
    `UPDATE merchant_metrics SET ${incCols.join(', ')} WHERE merchant_id = $1`,
    [params.merchantId],
  );
}
