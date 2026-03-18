import { query, queryOne } from '../index';

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
 * Get receipt by order ID
 */
export async function getReceiptByOrderId(orderId: string): Promise<OrderReceipt | null> {
  return queryOne<OrderReceipt>(
    'SELECT * FROM order_receipts WHERE order_id = $1',
    [orderId]
  );
}

/**
 * Get all receipts for a participant (creator or acceptor).
 * Works for both users and merchants.
 */
export async function getReceiptsByParticipant(
  participantId: string,
  options?: { limit?: number; offset?: number; status?: string }
): Promise<OrderReceipt[]> {
  return getReceiptsByParticipantIds([participantId], options);
}

/**
 * Get all receipts for multiple participant IDs (e.g. user + merchant identities).
 */
export async function getReceiptsByParticipantIds(
  participantIds: string[],
  options?: { limit?: number; offset?: number; status?: string }
): Promise<OrderReceipt[]> {
  const limit = options?.limit || 20;
  const offset = options?.offset || 0;

  if (options?.status) {
    return query<OrderReceipt>(
      `SELECT * FROM order_receipts
       WHERE (creator_id = ANY($1) OR acceptor_id = ANY($1)) AND status = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [participantIds, options.status, limit, offset]
    );
  }

  return query<OrderReceipt>(
    `SELECT * FROM order_receipts
     WHERE creator_id = ANY($1) OR acceptor_id = ANY($1)
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [participantIds, limit, offset]
  );
}
