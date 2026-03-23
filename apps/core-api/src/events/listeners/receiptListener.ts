/**
 * Receipt Listener
 *
 * Creates receipts on acceptance; updates them on every subsequent transition.
 */
import { orderBus, ORDER_EVENT, type OrderEventPayload } from '../orderEvents';
import { enqueueCreateReceipt, enqueueUpdateReceipt } from '../../queues/receiptQueue';
import { logger } from 'settlement-core';

export function registerReceiptListener(): void {
  // Create receipt when order is accepted
  orderBus.safeOn(ORDER_EVENT.ACCEPTED, (p: OrderEventPayload) => {
    const o = p.order;
    enqueueCreateReceipt(p.orderId, {
      id: o.id as string,
      order_number: o.order_number as string,
      type: o.type as string,
      payment_method: o.payment_method as string,
      crypto_amount: o.crypto_amount as string,
      crypto_currency: o.crypto_currency as string,
      fiat_amount: o.fiat_amount as string,
      fiat_currency: o.fiat_currency as string,
      rate: o.rate as string,
      platform_fee: o.platform_fee as string,
      protocol_fee_amount: (o.protocol_fee_amount as string) ?? null,
      status: o.status as string,
      user_id: o.user_id as string,
      merchant_id: o.merchant_id as string,
      buyer_merchant_id: (o.buyer_merchant_id as string) ?? null,
      acceptor_wallet_address: (o.acceptor_wallet_address as string) ?? null,
      buyer_wallet_address: (o.buyer_wallet_address as string) ?? null,
      escrow_tx_hash: (o.escrow_tx_hash as string) ?? null,
      payment_details: (o.payment_details as Record<string, unknown>) ?? null,
      accepted_at: o.accepted_at ? new Date(o.accepted_at as string).toISOString() : null,
      escrowed_at: o.escrowed_at ? new Date(o.escrowed_at as string).toISOString() : null,
    }, p.actorId).catch((err) => {
      logger.error('[ReceiptListener] Failed to enqueue receipt creation', { orderId: p.orderId, error: err });
    });
  });

  // Update receipt on payment_sent
  orderBus.safeOn(ORDER_EVENT.PAYMENT_SENT, (p: OrderEventPayload) => {
    enqueueUpdateReceipt(p.orderId, 'payment_sent', { payment_sent_at: true });
  });

  // Update receipt on completed (with release tx hash)
  orderBus.safeOn(ORDER_EVENT.COMPLETED, (p: OrderEventPayload) => {
    enqueueUpdateReceipt(p.orderId, 'completed', {
      release_tx_hash: p.txHash ?? null,
      completed_at: true,
    });
  });

  // Update receipt on cancelled (with optional refund tx hash)
  orderBus.safeOn(ORDER_EVENT.CANCELLED, (p: OrderEventPayload) => {
    enqueueUpdateReceipt(p.orderId, 'cancelled', {
      refund_tx_hash: p.refundTxHash ?? null,
      cancelled_at: true,
    });
  });

  // Update receipt on expired
  orderBus.safeOn(ORDER_EVENT.EXPIRED, (p: OrderEventPayload) => {
    // Only accepted+ orders have receipts; pending orders do not
    if (p.previousStatus !== 'pending') {
      enqueueUpdateReceipt(p.orderId, 'expired', { expired_at: true });
    }
  });

  // Generic handler for transitions handled by the general TX path
  // (escrowed, etc. — anything not caught by a specific listener above)
  orderBus.safeOn(ORDER_EVENT.ESCROWED, (p: OrderEventPayload) => {
    enqueueUpdateReceipt(p.orderId, 'escrowed', { escrowed_at: true });
  });

  logger.info('[ReceiptListener] Registered');
}
