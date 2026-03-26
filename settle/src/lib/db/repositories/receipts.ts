import { query, queryOne } from '../index';
import { getCachedReceipt } from '@/lib/cache';

export interface OrderReceipt {
  id: string;
  order_id: string;
  order_number: string;
  type: string;
  payment_method: string;
  crypto_amount: string;
  crypto_currency: string;
  fiat_amount: string;
  fiat_currency: string;
  rate: string;
  platform_fee: string;
  protocol_fee_amount: string | null;
  status: string;
  creator_type: string;
  creator_id: string;
  creator_name: string | null;
  creator_wallet_address: string | null;
  acceptor_type: string;
  acceptor_id: string;
  acceptor_name: string | null;
  acceptor_wallet_address: string | null;
  payment_details: Record<string, unknown> | null;
  escrow_tx_hash: string | null;
  release_tx_hash: string | null;
  refund_tx_hash: string | null;
  accepted_at: string | null;
  escrowed_at: string | null;
  payment_sent_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get receipt by order ID.
 * Uses Redis cache with DB fallback. UNIQUE index on order_id — O(1) lookup.
 */
export async function getReceiptByOrderId(orderId: string): Promise<OrderReceipt | null> {
  return getCachedReceipt<OrderReceipt>(orderId, (id) =>
    queryOne<OrderReceipt>('SELECT * FROM order_receipts WHERE order_id = $1', [id])
  );
}

/**
 * Get all receipts for a participant (creator or acceptor).
 * Works for both users and merchants.
 */
export async function getReceiptsByParticipant(
  participantId: string,
  options?: ReceiptQueryOptions
): Promise<OrderReceipt[]> {
  return getReceiptsByParticipantIds([participantId], options);
}

// ── Query options ───────────────────────────────────────────────
export interface ReceiptQueryOptions {
  limit?: number;
  /** @deprecated Use cursor for keyset pagination. Kept for backward compat. */
  offset?: number;
  status?: string;
  /**
   * Cursor for keyset pagination: { created_at, id } of the last item
   * from the previous page.  When provided, offset is ignored.
   */
  cursor?: { created_at: string; id: string };
}

/**
 * Get receipts for multiple participant IDs with optional status filter.
 *
 * Query strategy:
 *   Instead of a single query with `creator_id = ANY(...) OR acceptor_id = ANY(...)`,
 *   we UNION two sub-selects — one per composite index — so each branch can
 *   do an Index Scan on its own (creator_id, created_at DESC, status) or
 *   (acceptor_id, created_at DESC, status) index.  The outer query dedupes
 *   (a participant can be both creator AND acceptor is impossible by design,
 *   but UNION handles it anyway) and applies the final sort + limit.
 *
 * Pagination:
 *   Keyset (cursor) pagination when a cursor is provided.
 *   Falls back to OFFSET for backward compatibility.
 */
export async function getReceiptsByParticipantIds(
  participantIds: string[],
  options?: ReceiptQueryOptions
): Promise<OrderReceipt[]> {
  const limit = Math.min(options?.limit || 20, 100);

  // ── Keyset pagination ──────────────────────────────────────────
  if (options?.cursor) {
    const { created_at, id } = options.cursor;

    if (options?.status) {
      return query<OrderReceipt>(
        `SELECT * FROM (
           SELECT r.* FROM order_receipts r
            WHERE r.creator_id = ANY($1)
              AND r.status = $2
              AND (r.created_at, r.id) < ($3::timestamptz, $4::uuid)
           UNION
           SELECT r.* FROM order_receipts r
            WHERE r.acceptor_id = ANY($1)
              AND r.status = $2
              AND (r.created_at, r.id) < ($3::timestamptz, $4::uuid)
         ) sub
         ORDER BY created_at DESC, id DESC
         LIMIT $5`,
        [participantIds, options.status, created_at, id, limit]
      );
    }

    return query<OrderReceipt>(
      `SELECT * FROM (
         SELECT r.* FROM order_receipts r
          WHERE r.creator_id = ANY($1)
            AND (r.created_at, r.id) < ($2::timestamptz, $3::uuid)
         UNION
         SELECT r.* FROM order_receipts r
          WHERE r.acceptor_id = ANY($1)
            AND (r.created_at, r.id) < ($2::timestamptz, $3::uuid)
       ) sub
       ORDER BY created_at DESC, id DESC
       LIMIT $4`,
      [participantIds, created_at, id, limit]
    );
  }

  // ── OFFSET pagination (first page or legacy callers) ───────────
  const offset = options?.offset || 0;

  if (options?.status) {
    return query<OrderReceipt>(
      `SELECT * FROM (
         SELECT r.* FROM order_receipts r
          WHERE r.creator_id = ANY($1) AND r.status = $2
         UNION
         SELECT r.* FROM order_receipts r
          WHERE r.acceptor_id = ANY($1) AND r.status = $2
       ) sub
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [participantIds, options.status, limit, offset]
    );
  }

  return query<OrderReceipt>(
    `SELECT * FROM (
       SELECT r.* FROM order_receipts r
        WHERE r.creator_id = ANY($1)
       UNION
       SELECT r.* FROM order_receipts r
        WHERE r.acceptor_id = ANY($1)
     ) sub
     ORDER BY created_at DESC, id DESC
     LIMIT $2 OFFSET $3`,
    [participantIds, limit, offset]
  );
}

/**
 * Count receipts for a participant (for total-page-count in UI).
 * Uses the same UNION strategy so both composite indexes are leveraged.
 */
export async function countReceiptsByParticipantIds(
  participantIds: string[],
  status?: string
): Promise<number> {
  const sql = status
    ? `SELECT COUNT(*) as count FROM (
         SELECT r.id FROM order_receipts r WHERE r.creator_id = ANY($1) AND r.status = $2
         UNION
         SELECT r.id FROM order_receipts r WHERE r.acceptor_id = ANY($1) AND r.status = $2
       ) sub`
    : `SELECT COUNT(*) as count FROM (
         SELECT r.id FROM order_receipts r WHERE r.creator_id = ANY($1)
         UNION
         SELECT r.id FROM order_receipts r WHERE r.acceptor_id = ANY($1)
       ) sub`;

  const params = status ? [participantIds, status] : [participantIds];
  const row = await queryOne<{ count: string }>(sql, params);
  return parseInt(row?.count || '0', 10);
}
