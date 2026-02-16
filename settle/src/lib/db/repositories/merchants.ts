import { query, queryOne } from '../index';
import { Merchant, MerchantOffer, MerchantOfferWithMerchant, PaymentMethod, OfferType } from '../../types/database';

export async function getMerchantById(id: string): Promise<Merchant | null> {
  return queryOne<Merchant>('SELECT * FROM merchants WHERE id = $1', [id]);
}

export async function getMerchantByWallet(walletAddress: string): Promise<Merchant | null> {
  return queryOne<Merchant>('SELECT * FROM merchants WHERE wallet_address = $1', [walletAddress]);
}

export async function getOnlineMerchants(): Promise<Merchant[]> {
  return query<Merchant>(
    `SELECT * FROM merchants
     WHERE status = 'active' AND is_online = true
     ORDER BY rating DESC, total_trades DESC`
  );
}

export async function updateMerchantOnlineStatus(id: string, isOnline: boolean): Promise<void> {
  await query(
    `UPDATE merchants
     SET is_online = $1, last_seen_at = NOW()
     WHERE id = $2`,
    [isOnline, id]
  );
}

export async function incrementMerchantStats(id: string, volume: number): Promise<void> {
  await query(
    `UPDATE merchants
     SET total_trades = total_trades + 1,
         total_volume = total_volume + $1
     WHERE id = $2`,
    [volume, id]
  );
}

export async function updateMerchantRating(id: string): Promise<void> {
  await query(
    `UPDATE merchants m
     SET rating = (
       SELECT COALESCE(AVG(r.rating), 5.0)
       FROM reviews r
       WHERE r.reviewee_id = m.id AND r.reviewee_type = 'merchant'
     ),
     rating_count = (
       SELECT COUNT(*)
       FROM reviews r
       WHERE r.reviewee_id = m.id AND r.reviewee_type = 'merchant'
     )
     WHERE m.id = $1`,
    [id]
  );
}

export async function updateMerchant(
  id: string,
  data: Partial<Pick<Merchant, 'avatar_url' | 'display_name' | 'phone' | 'business_name' | 'bio'>>
): Promise<Merchant | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (data.avatar_url !== undefined) {
    fields.push(`avatar_url = $${paramIndex++}`);
    values.push(data.avatar_url);
  }
  if (data.display_name !== undefined) {
    fields.push(`display_name = $${paramIndex++}`);
    values.push(data.display_name);
  }
  if (data.phone !== undefined) {
    fields.push(`phone = $${paramIndex++}`);
    values.push(data.phone);
  }
  if (data.business_name !== undefined) {
    fields.push(`business_name = $${paramIndex++}`);
    values.push(data.business_name);
  }
  if (data.bio !== undefined) {
    fields.push(`bio = $${paramIndex++}`);
    values.push(data.bio);
  }

  if (fields.length === 0) return getMerchantById(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);
  return queryOne<Merchant>(
    `UPDATE merchants SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

// Offers
export async function getOfferById(id: string): Promise<MerchantOffer | null> {
  return queryOne<MerchantOffer>('SELECT * FROM merchant_offers WHERE id = $1', [id]);
}

export async function getOfferWithMerchant(id: string): Promise<MerchantOfferWithMerchant | null> {
  const result = await queryOne<MerchantOfferWithMerchant>(
    `SELECT o.*, row_to_json(m.*) as merchant
     FROM merchant_offers o
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.id = $1`,
    [id]
  );
  return result;
}

export async function getActiveOffers(filters?: {
  type?: OfferType;
  payment_method?: PaymentMethod;
  min_amount?: number;
  max_amount?: number;
}): Promise<MerchantOfferWithMerchant[]> {
  let sql = `
    SELECT o.*,
           json_build_object(
             'id', m.id,
             'display_name', m.display_name,
             'business_name', m.business_name,
             'rating', m.rating,
             'rating_count', m.rating_count,
             'total_trades', m.total_trades,
             'is_online', m.is_online,
             'avg_response_time_mins', m.avg_response_time_mins,
             'wallet_address', m.wallet_address
           ) as merchant
    FROM merchant_offers o
    JOIN merchants m ON o.merchant_id = m.id
    WHERE o.is_active = true
      AND m.status = 'active'
      AND m.is_online = true
      AND o.available_amount > 0
  `;

  const params: unknown[] = [];
  let paramIndex = 1;

  if (filters?.type) {
    sql += ` AND o.type = $${paramIndex++}`;
    params.push(filters.type);
    // For "buy" offers (user is selling), merchant wallet is REQUIRED for escrow release
    if (filters.type === 'buy') {
      sql += ` AND m.wallet_address IS NOT NULL AND m.wallet_address != ''`;
    }
  }
  if (filters?.payment_method) {
    sql += ` AND o.payment_method = $${paramIndex++}`;
    params.push(filters.payment_method);
  }
  if (filters?.min_amount) {
    sql += ` AND o.available_amount >= $${paramIndex++}`;
    params.push(filters.min_amount);
  }
  if (filters?.max_amount) {
    sql += ` AND o.min_amount <= $${paramIndex++}`;
    params.push(filters.max_amount);
  }

  sql += ' ORDER BY o.rate ASC, m.rating DESC';

  return query<MerchantOfferWithMerchant>(sql, params);
}

export async function findBestOffer(
  amount: number,
  type: OfferType,
  paymentMethod: PaymentMethod,
  preference: 'fast' | 'cheap' | 'best' = 'best'
): Promise<MerchantOfferWithMerchant | null> {
  let orderBy = '';
  switch (preference) {
    case 'fast':
      orderBy = 'm.avg_response_time_mins ASC, o.rate ASC';
      break;
    case 'cheap':
      orderBy = 'o.rate ASC, m.rating DESC';
      break;
    case 'best':
    default:
      orderBy = 'm.rating DESC, o.rate ASC, m.avg_response_time_mins ASC';
      break;
  }

  console.log('[DB] findBestOffer - type:', type, 'paymentMethod:', paymentMethod, 'amount:', amount, 'preference:', preference);

  // For "buy" offers (user is selling), merchant wallet is REQUIRED for escrow release
  // Filter out merchants without wallets to avoid matching failures
  const walletFilter = type === 'buy' ? "AND m.wallet_address IS NOT NULL AND m.wallet_address != ''" : '';

  const result = await queryOne<MerchantOfferWithMerchant>(
    `SELECT o.*,
            json_build_object(
              'id', m.id,
              'display_name', m.display_name,
              'business_name', m.business_name,
              'rating', m.rating,
              'rating_count', m.rating_count,
              'total_trades', m.total_trades,
              'is_online', m.is_online,
              'avg_response_time_mins', m.avg_response_time_mins,
              'wallet_address', m.wallet_address
            ) as merchant
     FROM merchant_offers o
     JOIN merchants m ON o.merchant_id = m.id
     WHERE o.is_active = true
       AND m.status = 'active'
       AND m.is_online = true
       AND o.type = $1
       AND o.payment_method = $2
       AND o.min_amount <= $3
       AND o.max_amount >= $3
       AND o.available_amount >= $3
       ${walletFilter}
     ORDER BY ${orderBy}
     LIMIT 1`,
    [type, paymentMethod, amount]
  );

  console.log('[DB] findBestOffer result:', result ? { id: result.id, merchant_id: result.merchant_id, merchant: result.merchant } : 'null');
  return result;
}

export async function updateOfferAvailability(id: string, amount: number): Promise<void> {
  await query(
    'UPDATE merchant_offers SET available_amount = available_amount - $1 WHERE id = $2',
    [amount, id]
  );
}

export async function restoreOfferAvailability(id: string, amount: number): Promise<void> {
  await query(
    'UPDATE merchant_offers SET available_amount = available_amount + $1 WHERE id = $2',
    [amount, id]
  );
}

// Merchant offers management
export async function getMerchantOffers(merchantId: string): Promise<MerchantOffer[]> {
  return query<MerchantOffer>(
    'SELECT * FROM merchant_offers WHERE merchant_id = $1 ORDER BY created_at DESC',
    [merchantId]
  );
}

export async function createOffer(data: {
  merchant_id: string;
  type: OfferType;
  payment_method: PaymentMethod;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  bank_name?: string;
  bank_account_name?: string;
  bank_iban?: string;
  location_name?: string;
  location_address?: string;
  location_lat?: number;
  location_lng?: number;
  meeting_instructions?: string;
}): Promise<MerchantOffer> {
  const result = await queryOne<MerchantOffer>(
    `INSERT INTO merchant_offers (
       merchant_id, type, payment_method, rate, min_amount, max_amount, available_amount,
       bank_name, bank_account_name, bank_iban,
       location_name, location_address, location_lat, location_lng, meeting_instructions
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      data.merchant_id,
      data.type,
      data.payment_method,
      data.rate,
      data.min_amount,
      data.max_amount,
      data.available_amount,
      data.bank_name || null,
      data.bank_account_name || null,
      data.bank_iban || null,
      data.location_name || null,
      data.location_address || null,
      data.location_lat || null,
      data.location_lng || null,
      data.meeting_instructions || null,
    ]
  );
  return result!;
}

export async function updateOffer(
  id: string,
  merchantId: string,
  data: Partial<MerchantOffer>
): Promise<MerchantOffer | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const allowedFields = [
    'rate', 'min_amount', 'max_amount', 'available_amount', 'is_active',
    'bank_name', 'bank_account_name', 'bank_iban',
    'location_name', 'location_address', 'location_lat', 'location_lng', 'meeting_instructions'
  ];

  for (const field of allowedFields) {
    if (data[field as keyof MerchantOffer] !== undefined) {
      fields.push(`${field} = $${paramIndex++}`);
      values.push(data[field as keyof MerchantOffer]);
    }
  }

  if (fields.length === 0) return getOfferById(id);

  values.push(id, merchantId);
  return queryOne<MerchantOffer>(
    `UPDATE merchant_offers SET ${fields.join(', ')}
     WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
     RETURNING *`,
    values
  );
}

export async function deleteOffer(id: string, merchantId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM merchant_offers WHERE id = $1 AND merchant_id = $2 RETURNING id',
    [id, merchantId]
  );
  return result.length > 0;
}
