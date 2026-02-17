/**
 * Corridor Bridge Repository
 * LP registration, auto-matching, and fulfillment tracking
 */

import { query, queryOne } from '../index';
import { CorridorProvider, CorridorFulfillment } from '../../types/database';

// ============================================
// PROVIDER CRUD
// ============================================

export async function getProviderByMerchantId(merchantId: string): Promise<CorridorProvider | null> {
  return queryOne<CorridorProvider>(
    'SELECT * FROM corridor_providers WHERE merchant_id = $1',
    [merchantId]
  );
}

export async function upsertProvider(
  merchantId: string,
  data: {
    is_active: boolean;
    fee_percentage: number;
    min_amount: number;
    max_amount: number;
    auto_accept?: boolean;
  }
): Promise<CorridorProvider> {
  const rows = await query<CorridorProvider>(
    `INSERT INTO corridor_providers (merchant_id, is_active, fee_percentage, min_amount, max_amount, auto_accept)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (merchant_id) DO UPDATE SET
       is_active = $2,
       fee_percentage = $3,
       min_amount = $4,
       max_amount = $5,
       auto_accept = $6,
       updated_at = NOW()
     RETURNING *`,
    [merchantId, data.is_active, data.fee_percentage, data.min_amount, data.max_amount, data.auto_accept ?? true]
  );
  return rows[0];
}

export async function getActiveProviders(): Promise<CorridorProvider[]> {
  return query<CorridorProvider>(
    `SELECT cp.* FROM corridor_providers cp
     JOIN merchants m ON cp.merchant_id = m.id
     WHERE cp.is_active = true AND m.is_online = true AND m.status = 'active'
     ORDER BY cp.fee_percentage ASC`
  );
}

// ============================================
// AUTO-MATCHING
// ============================================

/**
 * Find the cheapest active LP that can handle the given fiat amount.
 * Excludes buyer and seller merchants.
 */
export async function findBestProvider(
  fiatAmount: number,
  excludeMerchantIds: string[]
): Promise<(CorridorProvider & { merchant_rating: number }) | null> {
  const rows = await query<CorridorProvider & { merchant_rating: number }>(
    `SELECT cp.*, m.rating as merchant_rating
     FROM corridor_providers cp
     JOIN merchants m ON cp.merchant_id = m.id
     WHERE cp.is_active = true
       AND m.is_online = true
       AND m.status = 'active'
       AND cp.min_amount <= $1
       AND cp.max_amount >= $1
       AND cp.merchant_id != ALL($2::uuid[])
       AND (cp.available_hours_start IS NULL
            OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)
     ORDER BY cp.fee_percentage ASC, m.rating DESC
     LIMIT 1`,
    [fiatAmount, excludeMerchantIds]
  );
  return rows[0] || null;
}

/**
 * Check if any LP is available for a given amount (for UI button state).
 */
export async function checkCorridorAvailability(
  fiatAmount: number,
  excludeMerchantIds: string[]
): Promise<{ available: boolean; cheapest_fee: number | null; provider_count: number }> {
  const rows = await query<{ cnt: string; min_fee: string | null }>(
    `SELECT COUNT(*) as cnt, MIN(cp.fee_percentage) as min_fee
     FROM corridor_providers cp
     JOIN merchants m ON cp.merchant_id = m.id
     WHERE cp.is_active = true
       AND m.is_online = true
       AND m.status = 'active'
       AND cp.min_amount <= $1
       AND cp.max_amount >= $1
       AND cp.merchant_id != ALL($2::uuid[])
       AND (cp.available_hours_start IS NULL
            OR CURRENT_TIME BETWEEN cp.available_hours_start AND cp.available_hours_end)`,
    [fiatAmount, excludeMerchantIds]
  );
  const cnt = parseInt(rows[0]?.cnt || '0');
  return {
    available: cnt > 0,
    cheapest_fee: rows[0]?.min_fee ? parseFloat(rows[0].min_fee) : null,
    provider_count: cnt,
  };
}

// ============================================
// FULFILLMENT LIFECYCLE
// ============================================

export interface CreateFulfillmentInput {
  order_id: string;
  provider_merchant_id: string;
  provider_id: string;
  saed_amount_locked: number;
  fiat_amount: number;
  corridor_fee: number;
  bank_details: Record<string, unknown> | null;
  send_deadline_minutes?: number;
  idempotency_key?: string;
}

export async function createFulfillment(data: CreateFulfillmentInput): Promise<CorridorFulfillment> {
  const deadlineMinutes = data.send_deadline_minutes || 30;
  const rows = await query<CorridorFulfillment>(
    `INSERT INTO corridor_fulfillments
     (order_id, provider_merchant_id, provider_id, saed_amount_locked, fiat_amount,
      corridor_fee, bank_details, send_deadline, idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '${deadlineMinutes} minutes', $8)
     RETURNING *`,
    [
      data.order_id,
      data.provider_merchant_id,
      data.provider_id,
      data.saed_amount_locked,
      data.fiat_amount,
      data.corridor_fee,
      data.bank_details ? JSON.stringify(data.bank_details) : null,
      data.idempotency_key || null,
    ]
  );
  return rows[0];
}

export async function getFulfillmentByOrderId(orderId: string): Promise<CorridorFulfillment | null> {
  return queryOne<CorridorFulfillment>(
    `SELECT * FROM corridor_fulfillments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );
}

export async function getFulfillmentById(id: string): Promise<CorridorFulfillment | null> {
  return queryOne<CorridorFulfillment>(
    'SELECT * FROM corridor_fulfillments WHERE id = $1',
    [id]
  );
}

export async function getActiveFulfillmentsForProvider(merchantId: string): Promise<CorridorFulfillment[]> {
  return query<CorridorFulfillment>(
    `SELECT cf.* FROM corridor_fulfillments cf
     WHERE cf.provider_merchant_id = $1
       AND cf.provider_status IN ('pending', 'payment_sent')
     ORDER BY cf.assigned_at DESC`,
    [merchantId]
  );
}

export async function updateFulfillmentStatus(
  id: string,
  status: 'payment_sent' | 'completed' | 'failed' | 'cancelled'
): Promise<CorridorFulfillment | null> {
  const timestampCol =
    status === 'payment_sent' ? 'payment_sent_at' :
    status === 'completed' ? 'completed_at' :
    status === 'failed' ? 'failed_at' :
    'cancelled_at';

  const rows = await query<CorridorFulfillment>(
    `UPDATE corridor_fulfillments
     SET provider_status = $1, ${timestampCol} = NOW(), updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [status, id]
  );
  return rows[0] || null;
}

export async function updateProviderStats(
  providerId: string,
  fiatAmount: number,
  fulfillmentTimeSec: number | null
): Promise<void> {
  await query(
    `UPDATE corridor_providers
     SET total_fulfillments = total_fulfillments + 1,
         total_volume = total_volume + $1,
         avg_fulfillment_time_sec = CASE
           WHEN avg_fulfillment_time_sec IS NULL THEN $2
           ELSE (avg_fulfillment_time_sec + $2) / 2
         END,
         last_fulfillment_at = NOW(),
         updated_at = NOW()
     WHERE id = $3`,
    [fiatAmount, fulfillmentTimeSec, providerId]
  );
}

/**
 * Find overdue fulfillments (past deadline, still pending)
 */
export async function getOverdueFulfillments(): Promise<CorridorFulfillment[]> {
  return query<CorridorFulfillment>(
    `SELECT * FROM corridor_fulfillments
     WHERE provider_status = 'pending'
       AND send_deadline < NOW()
     ORDER BY send_deadline ASC`
  );
}
