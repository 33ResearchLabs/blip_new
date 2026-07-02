import { query, queryOne } from '../index';
import { Merchant, MerchantOffer, MerchantOfferWithMerchant, PaymentMethod, OfferType } from '../../types/database';
import { getCachedMerchant, invalidateMerchantCache } from '@/lib/cache';

/**
 * Internal merchant fetch — returns the FULL row including auth secrets
 * (password_hash, totp_secret, totp_enabled, totp_verified_at), internal-only
 * config (synthetic_rate, max_sinr_exposure, auto_accept_*, telegram_chat_id),
 * and all other columns. Cached.
 *
 * ⚠️ DO NOT use this in any code path that serializes merchant data back to a
 * client. Use {@link getMerchantByIdSafe} instead. The `Internal` suffix is the
 * tripwire — every API-route reviewer must explicitly justify why they need
 * the full row before approving an import. An ESLint rule
 * (`no-restricted-imports` in `.eslintrc`) flags any file under `src/app/api/`
 * that imports this name.
 *
 * Legitimate callers are limited to:
 *   - middleware/auth.ts        (boolean access checks; never serialized)
 *   - auth/merchant/route.ts    (password + TOTP verification)
 *   - 2fa/{enable,disable}/...  (TOTP secret roundtrip)
 */
export async function getMerchantByIdInternal(id: string): Promise<Merchant | null> {
  return getCachedMerchant<Merchant>(id, (merchantId) =>
    queryOne<Merchant>('SELECT * FROM merchants WHERE id = $1', [merchantId])
  );
}

/**
 * Explicit allowlist of merchant columns safe to expose through public-facing
 * read endpoints (self-view + admin-view). MUST NOT include any auth secrets
 * (password_hash, totp_secret, totp_enabled, totp_verified_at) or internal-only
 * config (synthetic_rate, max_sinr_exposure, auto_accept_*, telegram_chat_id).
 *
 * If you add a new merchant column, decide explicitly whether it belongs here.
 * Default: keep it out.
 */
export const SAFE_MERCHANT_COLUMNS = [
  'id',
  'username',
  'display_name',
  'business_name',
  'email',
  'phone',
  'phone_verified',
  'phone_verified_at',
  'avatar_url',
  'bio',
  'wallet_address',
  'status',
  'verification_level',
  'total_trades',
  'total_volume',
  'rating',
  'rating_count',
  'avg_response_time_mins',
  'avg_completion_time_ms',
  'is_online',
  'last_seen_at',
  'balance',
  'sinr_balance',
  'has_ops_access',
  'has_compliance_access',
  'cancelled_orders',
  'dispute_count',
  'tour_completed_at',
  'buy_rate',
  'sell_rate',
  'dashboard_layout',
  'created_at',
  'updated_at',
] as const;

/**
 * Read a merchant row using an explicit column projection (no SELECT *).
 * Use this for any endpoint that returns merchant data to a client.
 *
 * NOT cached — the full-row cache (`getMerchantByIdInternal`) is reused by the auth
 * middleware which needs password_hash/totp_secret. Mixing the two through one
 * cache key would either poison auth (truncated row) or leak secrets (full row
 * served from a "safe" call site). Two functions, two paths.
 */
export async function getMerchantByIdSafe(
  id: string
): Promise<(Partial<Merchant> & { id: string }) | null> {
  return queryOne<Partial<Merchant> & { id: string }>(
    `SELECT ${SAFE_MERCHANT_COLUMNS.join(', ')} FROM merchants WHERE id = $1`,
    [id]
  );
}

export async function getMerchantByWallet(walletAddress: string): Promise<Merchant | null> {
  return queryOne<Merchant>('SELECT * FROM merchants WHERE wallet_address = $1', [walletAddress]);
}

export async function getOnlineMerchants(): Promise<Merchant[]> {
  // Hide merchants whose first-time onboarding isn't complete — they
  // shouldn't appear as available trading partners until they've at
  // least connected a wallet and set up payment methods. Grandfathered
  // merchants from migration 121 have completed_at set, so they pass.
  return query<Merchant>(
    `SELECT m.* FROM merchants m
       JOIN merchant_onboarding mo ON mo.merchant_id = m.id
                                  AND mo.completed_at IS NOT NULL
      WHERE m.status = 'active' AND m.is_online = true
      ORDER BY m.rating DESC, m.total_trades DESC
      LIMIT 100`
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

// ─────────────────────────────────────────────────────────────────────
// Presence freshness
// ─────────────────────────────────────────────────────────────────────
//
// `merchants.is_online` is set to TRUE on login / heartbeat but it has
// no automatic expiry: nothing flips it back when a merchant closes
// the tab, crashes, or drops their connection. The heartbeat endpoint
// (every 30s) DOES touch `last_seen_at`, so a recent `last_seen_at`
// is the trustworthy "is this merchant really online" signal.
//
// We give downstream callers two tools:
//
//  1. ONLINE_FRESH_SQL — a SQL fragment to drop into WHERE clauses
//     anywhere you'd previously written `is_online = true`. It still
//     checks the flag (so opt-out via explicit logout still works)
//     but ALSO requires a heartbeat within the freshness window.
//
//  2. sweepStaleMerchantPresence() — a single UPDATE that flips
//     `is_online = false` for rows whose `last_seen_at` is too old.
//     Fire-and-forget from the admin stats endpoint so the column
//     becomes self-healing for downstream code we don't touch
//     (corridor matching, marketplace offers, leaderboards, etc.).
//
// Window choice: 2 minutes ≈ 4 missed heartbeats at the 30s cadence,
// so a single dropped network ping won't false-negative a real user,
// but ghost sessions are cleared within ~2m of disconnection.

export const MERCHANT_ONLINE_WINDOW = "2 minutes";

export const ONLINE_FRESH_SQL =
  `(m.is_online = true AND m.last_seen_at > NOW() - INTERVAL '${MERCHANT_ONLINE_WINDOW}')`;

// Same fragment for callers that aliased merchants as something other
// than `m` — keep them in lockstep so the freshness window lives in
// one place.
export const onlineFreshSqlForAlias = (alias: string): string =>
  `(${alias}.is_online = true AND ${alias}.last_seen_at > NOW() - INTERVAL '${MERCHANT_ONLINE_WINDOW}')`;

// In-memory cooldown so the sweeper doesn't run on every admin poll
// (the Monitor page refreshes every 8s — sweeping 7x/minute is wasteful
// when the freshness window itself is 2 minutes). Module-scoped state
// is fine here: any instance pause >SWEEP_MIN_INTERVAL_MS triggers a
// real sweep on the next call. A failed sweep doesn't update the
// timestamp, so retries happen on the next invocation.
const SWEEP_MIN_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

export async function sweepStaleMerchantPresence(): Promise<number> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_MIN_INTERVAL_MS) return 0;
  lastSweepAt = now;

  try {
    const result = await query<{ id: string }>(
      `UPDATE merchants
         SET is_online = false
       WHERE is_online = true
         AND (last_seen_at IS NULL
              OR last_seen_at < NOW() - INTERVAL '${MERCHANT_ONLINE_WINDOW}')
       RETURNING id`,
    );
    return result.length;
  } catch (err) {
    // Don't propagate — caller is fire-and-forget. Reset the cooldown
    // so the next request can retry instead of waiting 30s.
    lastSweepAt = 0;
    console.error('[sweepStaleMerchantPresence] failed', err);
    return 0;
  }
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
       SELECT COALESCE(AVG(r.rating), 0)
       FROM ratings r
       WHERE r.rated_id = m.id AND r.rated_type = 'merchant'
     ),
     rating_count = (
       SELECT COUNT(*)
       FROM ratings r
       WHERE r.rated_id = m.id AND r.rated_type = 'merchant'
     )
     WHERE m.id = $1`,
    [id]
  );
}

export async function updateMerchant(
  id: string,
  data: Partial<Pick<Merchant, 'avatar_url' | 'display_name' | 'phone' | 'business_name' | 'bio' | 'buy_rate' | 'sell_rate'>> & { dashboard_layout?: unknown | null }
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
    // Editing the number through the normal profile PATCH invalidates any prior
    // verification — a verified badge must never outlive the number it
    // vouched for. Re-verification happens via /api/merchant/phone/firebase-confirm,
    // which sets these back to true / NOW().
    fields.push(`phone_verified = false`);
    fields.push(`phone_verified_at = NULL`);
  }
  if (data.business_name !== undefined) {
    fields.push(`business_name = $${paramIndex++}`);
    values.push(data.business_name);
  }
  if (data.bio !== undefined) {
    fields.push(`bio = $${paramIndex++}`);
    values.push(data.bio);
  }
  if (data.buy_rate !== undefined) {
    fields.push(`buy_rate = $${paramIndex++}`);
    values.push(data.buy_rate);
  }
  if (data.sell_rate !== undefined) {
    fields.push(`sell_rate = $${paramIndex++}`);
    values.push(data.sell_rate);
  }
  if (data.dashboard_layout !== undefined) {
    // Explicit ::jsonb cast so `null` clears the column and an object is
    // stored as JSONB (not text). Zod has already shape-validated the value.
    fields.push(`dashboard_layout = $${paramIndex++}::jsonb`);
    values.push(
      data.dashboard_layout === null ? null : JSON.stringify(data.dashboard_layout)
    );
  }

  if (fields.length === 0) return getMerchantByIdInternal(id);

  fields.push(`updated_at = NOW()`);
  values.push(id);
  const result = await queryOne<Merchant>(
    `UPDATE merchants SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
  if (result) invalidateMerchantCache(id);
  return result;
}

/**
 * Serialize a merchant DB row to the API response DTO.
 * Single source of truth — replaces 6+ inline object spreads in auth/merchant/route.ts.
 */
export function serializeMerchant(merchant: {
  id: string;
  username?: string | null;
  display_name?: string;
  business_name?: string;
  wallet_address?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  email?: string;
  phone?: string | null;
  phone_verified?: boolean;
  phone_verified_at?: string | Date | null;
  rating?: number;
  total_trades?: number;
  balance?: number;
  has_ops_access?: boolean;
  has_compliance_access?: boolean;
  tour_completed_at?: string | Date | null;
  buy_rate?: number | null;
  sell_rate?: number | null;
  dashboard_layout?: unknown | null;
  created_at?: string | Date | null;
}): Record<string, unknown> {
  const dto: Record<string, unknown> = {
    id: merchant.id,
    username: merchant.username ?? null,
    display_name: merchant.display_name,
    business_name: merchant.business_name,
    wallet_address: merchant.wallet_address ?? null,
    rating: parseFloat(String(merchant.rating ?? 5)) || 5,
    total_trades: merchant.total_trades || 0,
  };
  // Only include optional fields if they exist on the source row
  if (merchant.avatar_url !== undefined) dto.avatar_url = merchant.avatar_url;
  if (merchant.bio !== undefined) dto.bio = merchant.bio;
  if (merchant.email !== undefined) dto.email = merchant.email;
  // Phone + its SMS-verification status. Only present on self/admin reads
  // (getMerchantByIdSafe projects them; the auth/me + login SELECTs don't,
  // so they stay omitted there). Counterparty-facing merchant payloads use a
  // separate json_build_object and never touch this serializer, so the phone
  // number is not leaked to other traders.
  if (merchant.phone !== undefined) dto.phone = merchant.phone;
  if (merchant.phone_verified !== undefined) dto.phone_verified = Boolean(merchant.phone_verified);
  if (merchant.phone_verified_at !== undefined) {
    const v = merchant.phone_verified_at;
    dto.phone_verified_at = v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  }
  if (merchant.balance !== undefined) dto.balance = parseFloat(String(merchant.balance)) || 0;
  if (merchant.has_ops_access !== undefined) dto.has_ops_access = merchant.has_ops_access || false;
  if (merchant.has_compliance_access !== undefined) dto.has_compliance_access = merchant.has_compliance_access || false;
  // Tour completion — null means "never completed" so the frontend shows the tour.
  // Present in every response so the client can invalidate its localStorage flag
  // if it goes out of sync with the DB (e.g. admin reset, account migration).
  if (merchant.buy_rate !== undefined) dto.buy_rate = merchant.buy_rate != null ? parseFloat(String(merchant.buy_rate)) : null;
  if (merchant.sell_rate !== undefined) dto.sell_rate = merchant.sell_rate != null ? parseFloat(String(merchant.sell_rate)) : null;
  if (merchant.tour_completed_at !== undefined) {
    const v = merchant.tour_completed_at;
    dto.tour_completed_at = v == null ? null : (v instanceof Date ? v.toISOString() : String(v));
  }
  // Dashboard layout — null means "use default". Pass through as-is; the
  // hook on the client re-parses with Zod and falls back to default on any
  // shape mismatch (forward-compat when new widgets ship).
  if (merchant.dashboard_layout !== undefined) {
    dto.dashboard_layout = merchant.dashboard_layout;
  }
  // Account "Joined" date. getMerchantByIdSafe projects created_at but the
  // serializer previously dropped it, so the Settings > Account "Joined" field
  // rendered "—". Emit it as an ISO string (matches the other date fields).
  if (merchant.created_at !== undefined) {
    const v = merchant.created_at;
    dto.created_at = v == null ? null : v instanceof Date ? v.toISOString() : String(v);
  }
  return dto;
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

  return result;
}

export async function updateOfferAvailability(id: string, amount: number): Promise<MerchantOffer> {
  const result = await queryOne<MerchantOffer>(
    `UPDATE merchant_offers
     SET available_amount = available_amount - $1
     WHERE id = $2
       AND available_amount >= $1
     RETURNING *`,
    [amount, id]
  );
  if (!result) {
    throw new Error('INSUFFICIENT_LIQUIDITY');
  }
  return result;
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
