import { query, queryOne, transaction } from '../index';
import { ActorType } from '../../types/database';
import { logger } from '../../logger';

export type DisputeReason = 'payment_not_received' | 'crypto_not_received' | 'wrong_amount' | 'fraud' | 'other';
export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'escalated';

export interface Dispute {
  id: string;
  order_id: string;
  raised_by: ActorType;
  raiser_id: string;
  reason: DisputeReason;
  description: string | null;
  evidence_urls: string[] | null;
  status: DisputeStatus;
  resolution: string | null;
  resolved_in_favor_of: ActorType | null;
  created_at: Date;
  resolved_at: Date | null;
}

export async function getDisputeById(id: string): Promise<Dispute | null> {
  return queryOne<Dispute>('SELECT * FROM disputes WHERE id = $1', [id]);
}

export async function getDisputeByOrderId(orderId: string): Promise<Dispute | null> {
  return queryOne<Dispute>('SELECT * FROM disputes WHERE order_id = $1', [orderId]);
}

export async function getOpenDisputes(): Promise<Dispute[]> {
  return query<Dispute>(
    "SELECT * FROM disputes WHERE status IN ('open', 'investigating') ORDER BY created_at DESC"
  );
}

export async function createDispute(data: {
  order_id: string;
  raised_by: ActorType;
  raiser_id: string;
  reason: DisputeReason;
  description?: string;
  evidence_urls?: string[];
}): Promise<Dispute> {
  return transaction(async (client) => {
    // Create the dispute
    const result = await client.query(
      `INSERT INTO disputes (order_id, raised_by, raiser_id, reason, description, evidence_urls)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.order_id,
        data.raised_by,
        data.raiser_id,
        data.reason,
        data.description || null,
        data.evidence_urls || null,
      ]
    );

    const dispute = result.rows[0] as Dispute;

    // Update order status to disputed
    await client.query(
      "UPDATE orders SET status = 'disputed' WHERE id = $1",
      [data.order_id]
    );

    // Create order event
    await client.query(
      `INSERT INTO order_events (order_id, event_type, actor_type, actor_id, new_status, metadata)
       VALUES ($1, 'dispute_raised', $2, $3, 'disputed', $4)`,
      [
        data.order_id,
        data.raised_by,
        data.raiser_id,
        JSON.stringify({ dispute_id: dispute.id, reason: data.reason }),
      ]
    );

    logger.dispute.raised(data.order_id, dispute.id, data.reason);

    return dispute;
  });
}

export async function updateDispute(
  id: string,
  data: {
    status?: DisputeStatus;
    resolution?: string;
    resolved_in_favor_of?: ActorType;
  }
): Promise<Dispute | null> {
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.status) {
    updates.push(`status = $${paramIndex}`);
    values.push(data.status);
    paramIndex++;
  }

  if (data.resolution) {
    updates.push(`resolution = $${paramIndex}`);
    values.push(data.resolution);
    paramIndex++;
  }

  if (data.resolved_in_favor_of) {
    updates.push(`resolved_in_favor_of = $${paramIndex}`);
    values.push(data.resolved_in_favor_of);
    paramIndex++;
  }

  // Set resolved_at if status is 'resolved'
  if (data.status === 'resolved') {
    updates.push(`resolved_at = NOW()`);
  }

  if (updates.length === 0) {
    return getDisputeById(id);
  }

  values.push(id);

  const result = await queryOne<Dispute>(
    `UPDATE disputes SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result && data.status === 'resolved') {
    logger.dispute.resolved(id, data.resolution || '', data.resolved_in_favor_of || 'system');
  }

  return result;
}

export async function addDisputeEvidence(id: string, evidenceUrls: string[]): Promise<Dispute | null> {
  return queryOne<Dispute>(
    `UPDATE disputes
     SET evidence_urls = COALESCE(evidence_urls, ARRAY[]::TEXT[]) || $1::TEXT[]
     WHERE id = $2
     RETURNING *`,
    [evidenceUrls, id]
  );
}

// Extended dispute interface with order details
export interface DisputeWithOrder extends Dispute {
  order_number: string;
  order_type: string;
  crypto_amount: number;
  fiat_amount: number;
  crypto_currency: string;
  fiat_currency: string;
  other_party_name: string;
  other_party_id: string;
}

// Get resolved disputes for a user
export async function getUserResolvedDisputes(userId: string): Promise<DisputeWithOrder[]> {
  return query<DisputeWithOrder>(
    `SELECT d.*,
            o.order_number,
            o.type as order_type,
            o.crypto_amount,
            o.fiat_amount,
            o.crypto_currency,
            o.fiat_currency,
            m.display_name as other_party_name,
            m.id as other_party_id
     FROM disputes d
     JOIN orders o ON d.order_id = o.id
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.user_id = $1
       AND d.status = 'resolved'
     ORDER BY d.resolved_at DESC`,
    [userId]
  );
}

// Get resolved disputes for a merchant
export async function getMerchantResolvedDisputes(merchantId: string): Promise<DisputeWithOrder[]> {
  return query<DisputeWithOrder>(
    `SELECT d.*,
            o.order_number,
            o.type as order_type,
            o.crypto_amount,
            o.fiat_amount,
            o.crypto_currency,
            o.fiat_currency,
            u.username as other_party_name,
            u.id as other_party_id
     FROM disputes d
     JOIN orders o ON d.order_id = o.id
     JOIN users u ON o.user_id = u.id
     WHERE o.merchant_id = $1
       AND d.status = 'resolved'
     ORDER BY d.resolved_at DESC`,
    [merchantId]
  );
}
