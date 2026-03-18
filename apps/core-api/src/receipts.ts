/**
 * Order Receipt Helpers
 *
 * Creates and updates order receipts in the order_receipts table.
 * Receipts capture a snapshot of both parties at the time of acceptance
 * and are updated on every subsequent status transition.
 */
import {
  query as dbQuery,
  queryOne,
  logger,
} from 'settlement-core';

// Fire-and-forget helper — logs errors but never blocks
const bgQuery = (sql: string, params: unknown[]) =>
  dbQuery(sql, params).catch((err) => {
    logger.error('[Receipt] bgQuery failed', { error: err });
  });

interface OrderForReceipt {
  id: string;
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
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  acceptor_wallet_address: string | null;
  buyer_wallet_address: string | null;
  escrow_tx_hash: string | null;
  payment_details: Record<string, unknown> | null;
  accepted_at: Date | null;
  escrowed_at: Date | null;
}

interface PartySnapshot {
  creator_type: string;
  creator_id: string;
  creator_name: string | null;
  creator_wallet_address: string | null;
  acceptor_type: string;
  acceptor_id: string;
  acceptor_name: string | null;
  acceptor_wallet_address: string | null;
}

/**
 * Resolve creator and acceptor parties from an order.
 * Handles both User→Merchant and Merchant→Merchant (M2M) flows.
 */
async function resolveParties(order: OrderForReceipt, actorId: string): Promise<PartySnapshot> {
  // Check if the order creator is a real user or a placeholder (merchant-initiated)
  const userRow = await queryOne<{ username: string; wallet_address: string | null }>(
    'SELECT username, wallet_address FROM users WHERE id = $1',
    [order.user_id]
  );
  const username = userRow?.username || '';
  const isMerchantCreated = username.startsWith('open_order_') || username.startsWith('m2m_');

  if (isMerchantCreated) {
    // M2M or merchant-initiated order
    // The stored proc reassigns merchant_id / buyer_merchant_id differently depending on path:
    //   Non-escrowed claiming: buyer_merchant_id = original creator, merchant_id = acceptor
    //   Escrowed claiming:     buyer_merchant_id = acceptor,         merchant_id = original creator
    //   M2M (buyer preset):    buyer_merchant_id = original buyer,   merchant_id = acceptor
    // In all cases, the acceptor is actorId. So if buyer_merchant_id IS actorId, creator is merchant_id.
    const creatorMerchantId = (order.buyer_merchant_id && order.buyer_merchant_id !== actorId)
      ? order.buyer_merchant_id
      : order.merchant_id;
    const creatorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [creatorMerchantId]
    );
    const acceptorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [actorId]
    );

    return {
      creator_type: 'merchant',
      creator_id: creatorMerchantId,
      creator_name: creatorMerchant?.business_name || null,
      creator_wallet_address: creatorMerchant?.wallet_address || null,
      acceptor_type: 'merchant',
      acceptor_id: actorId,
      acceptor_name: acceptorMerchant?.business_name || null,
      acceptor_wallet_address: order.acceptor_wallet_address || acceptorMerchant?.wallet_address || null,
    };
  } else {
    // User-initiated order
    // Creator is the user, acceptor is the merchant
    const acceptorMerchant = await queryOne<{ business_name: string; wallet_address: string | null }>(
      'SELECT business_name, wallet_address FROM merchants WHERE id = $1',
      [actorId]
    );

    return {
      creator_type: 'user',
      creator_id: order.user_id,
      creator_name: username,
      creator_wallet_address: userRow?.wallet_address || order.buyer_wallet_address || null,
      acceptor_type: 'merchant',
      acceptor_id: actorId,
      acceptor_name: acceptorMerchant?.business_name || null,
      acceptor_wallet_address: order.acceptor_wallet_address || acceptorMerchant?.wallet_address || null,
    };
  }
}

/**
 * Create an order receipt when an order is accepted.
 * Called fire-and-forget after accept_order_v1 succeeds.
 */
export async function createOrderReceipt(orderId: string, order: OrderForReceipt, actorId: string): Promise<void> {
  try {
    // Check if receipt already exists (idempotency)
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM order_receipts WHERE order_id = $1',
      [orderId]
    );
    if (existing) {
      logger.info('[Receipt] Receipt already exists, skipping creation', { orderId });
      return;
    }

    const parties = await resolveParties(order, actorId);

    await dbQuery(
      `INSERT INTO order_receipts (
        order_id, order_number, type, payment_method,
        crypto_amount, crypto_currency, fiat_amount, fiat_currency, rate,
        platform_fee, protocol_fee_amount, status,
        creator_type, creator_id, creator_name, creator_wallet_address,
        acceptor_type, acceptor_id, acceptor_name, acceptor_wallet_address,
        payment_details, escrow_tx_hash,
        accepted_at, escrowed_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9,
        $10, $11, $12,
        $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22,
        $23, $24
      )`,
      [
        orderId, order.order_number, order.type, order.payment_method,
        order.crypto_amount, order.crypto_currency, order.fiat_amount, order.fiat_currency, order.rate,
        order.platform_fee, order.protocol_fee_amount, order.status,
        parties.creator_type, parties.creator_id, parties.creator_name, parties.creator_wallet_address,
        parties.acceptor_type, parties.acceptor_id, parties.acceptor_name, parties.acceptor_wallet_address,
        order.payment_details ? JSON.stringify(order.payment_details) : null, order.escrow_tx_hash,
        order.accepted_at || new Date(), order.escrowed_at,
      ]
    );

    // Insert receipt message into chat for both parties to see
    // Uses sender_type='merchant' (acceptor) and message_type='text' so it passes
    // through the getOrderMessages filter (which excludes sender_type/message_type = 'system')
    const receiptMessage = JSON.stringify({
      type: 'order_receipt',
      text: `Order Receipt #${order.order_number}`,
      data: {
        order_number: order.order_number,
        order_type: order.type,
        payment_method: order.payment_method,
        crypto_amount: order.crypto_amount,
        crypto_currency: order.crypto_currency,
        fiat_amount: order.fiat_amount,
        fiat_currency: order.fiat_currency,
        rate: order.rate,
        platform_fee: order.platform_fee,
        creator_type: parties.creator_type,
        creator_name: parties.creator_name,
        acceptor_type: parties.acceptor_type,
        acceptor_name: parties.acceptor_name,
        status: order.status,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
    // Insert into order chat (chat_messages) — visible to user in ChatViewScreen
    await dbQuery(
      `INSERT INTO chat_messages (order_id, sender_type, sender_id, content, message_type)
       VALUES ($1, $2, $3, $4, 'text')`,
      [orderId, parties.acceptor_type, parties.acceptor_id, receiptMessage]
    );

    // Insert into direct_messages — visible to merchant in DirectChatView
    // Send receipt from acceptor → creator
    await dbQuery(
      `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type)
       VALUES ($1, $2, $3, $4, $5, 'text')`,
      [parties.acceptor_type, parties.acceptor_id, parties.creator_type, parties.creator_id, receiptMessage]
    );
    // Send receipt from creator → acceptor (so acceptor also sees it)
    await dbQuery(
      `INSERT INTO direct_messages (sender_type, sender_id, recipient_type, recipient_id, content, message_type)
       VALUES ($1, $2, $3, $4, $5, 'text')`,
      [parties.creator_type, parties.creator_id, parties.acceptor_type, parties.acceptor_id, receiptMessage]
    );

    logger.info('[Receipt] Created order receipt', { orderId, orderNumber: order.order_number });
  } catch (err) {
    logger.error('[Receipt] Failed to create order receipt', { orderId, error: err });
  }
}

/**
 * Update an order receipt when the order status changes.
 * Fire-and-forget — never blocks the status transition.
 */
export function updateOrderReceipt(
  orderId: string,
  newStatus: string,
  fields?: {
    escrow_tx_hash?: string | null;
    release_tx_hash?: string | null;
    refund_tx_hash?: string | null;
    payment_sent_at?: boolean;
    escrowed_at?: boolean;
    completed_at?: boolean;
    cancelled_at?: boolean;
  }
): void {
  const setClauses: string[] = ['status = $1', 'updated_at = NOW()'];
  const params: unknown[] = [newStatus];
  let idx = 1;

  const addField = (clause: string, value: unknown) => {
    idx++;
    setClauses.push(`${clause} = $${idx}`);
    params.push(value);
  };

  if (fields?.escrow_tx_hash) addField('escrow_tx_hash', fields.escrow_tx_hash);
  if (fields?.release_tx_hash) addField('release_tx_hash', fields.release_tx_hash);
  if (fields?.refund_tx_hash) addField('refund_tx_hash', fields.refund_tx_hash);

  // Timestamp fields — set to NOW() when flagged true
  if (fields?.escrowed_at) { setClauses.push('escrowed_at = NOW()'); }
  if (fields?.payment_sent_at) { setClauses.push('payment_sent_at = NOW()'); }
  if (fields?.completed_at) { setClauses.push('completed_at = NOW()'); }
  if (fields?.cancelled_at) { setClauses.push('cancelled_at = NOW()'); }

  idx++;
  params.push(orderId);

  bgQuery(
    `UPDATE order_receipts SET ${setClauses.join(', ')} WHERE order_id = $${idx}`,
    params
  );
}
