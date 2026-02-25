/**
 * Chat Message Templates for System Messages
 *
 * When an order status changes, a system message is auto-injected into the
 * order chat thread. These templates produce the message content.
 *
 * Returns null for transient statuses that don't need a chat message.
 */

import type { OrderLifecycleEvent } from './types';

export interface ChatTemplateResult {
  /** Primary system message content */
  content: string;
  /** Additional rich messages (JSON stringified cards for bank info, escrow info) */
  extraMessages?: string[];
}

type TemplateFn = (event: OrderLifecycleEvent) => ChatTemplateResult | null;

const TEMPLATES: Record<string, TemplateFn> = {
  'order.created': (e) => ({
    content: `Order created for ${e.payload.cryptoAmount} ${e.payload.cryptoCurrency || 'USDC'}`,
  }),

  'order.accepted': (e) => {
    const p = e.payload;
    return {
      content: p.isM2M
        ? 'Order accepted (merchant-to-merchant trade)'
        : `✓ Order accepted by ${e.actor.type === 'merchant' ? 'merchant' : 'counterparty'}`,
    };
  },

  'order.escrowed': (e) => {
    const p = e.payload;
    const amount = p.amount || p.cryptoAmount;
    const currency = p.currency || p.cryptoCurrency || 'USDC';
    const result: ChatTemplateResult = {
      content: `🔒 ${amount} ${currency} locked in escrow`,
    };
    if (p.txHash) {
      result.extraMessages = [
        JSON.stringify({
          type: 'escrow_locked',
          text: `🔒 ${amount} ${currency} locked in escrow`,
          data: {
            amount,
            currency,
            txHash: p.txHash,
            escrowPda: p.escrowPda || p.escrowTradePda,
          },
        }),
      ];
    }
    return result;
  },

  'order.payment_sent': (e) => ({
    content: `💸 Payment of ${Number(e.payload.fiatAmount).toLocaleString()} ${e.payload.fiatCurrency || 'AED'} marked as sent`,
  }),

  'order.payment_confirmed': (e) => ({
    content: `✓ Payment confirmed`,
  }),

  'order.completed': (e) => {
    const p = e.payload;
    const amount = p.cryptoAmount || p.amount;
    const currency = p.cryptoCurrency || p.currency || 'USDC';
    const result: ChatTemplateResult = {
      content: `✅ Trade completed successfully! ${amount} ${currency} released`,
    };
    if (p.releaseTxHash) {
      result.extraMessages = [
        JSON.stringify({
          type: 'escrow_released',
          text: `✅ ${amount} ${currency} released`,
          data: {
            amount,
            currency,
            txHash: p.releaseTxHash,
          },
        }),
      ];
    }
    return result;
  },

  'order.cancelled': (e) => {
    const reason = e.payload.reason ? `: ${e.payload.reason}` : '';
    const result: ChatTemplateResult = {
      content: `❌ Order cancelled${reason}`,
    };
    if (e.payload.escrowRefunded && e.payload.refundedAmount) {
      result.extraMessages = [
        `Escrow of ${e.payload.refundedAmount} USDC refunded`,
      ];
    }
    return result;
  },

  'order.expired': (e) => ({
    content: e.payload.autoDisputed
      ? '⏰ Order expired and has been escalated to dispute'
      : '⏰ Order expired (15 minute timeout)',
  }),

  'order.disputed': (e) => ({
    content: `⚠️ Order is now under dispute${e.payload.reason ? ': ' + e.payload.reason : ''}`,
  }),

  'order.dispute_resolved': (e) => ({
    content: `Dispute resolved: ${e.payload.resolution || 'See details'}`,
  }),

  'order.extension_requested': (e) => ({
    content: `Extension requested (+${e.payload.extensionMinutes || 15} min) by ${e.payload.requestedBy || e.actor.type}`,
  }),

  'order.extension_responded': (e) => ({
    content: e.payload.accepted
      ? 'Extension approved. New deadline set.'
      : 'Extension declined.',
  }),

  // Transient statuses — no chat message needed
  'order.escrow_pending': () => null,
  'order.payment_pending': () => null,
  'order.releasing': () => null,
};

/**
 * Get system chat message for an order lifecycle event.
 * Returns null if no message should be generated (transient statuses).
 */
export function getSystemChatMessage(
  event: OrderLifecycleEvent
): ChatTemplateResult | null {
  const templateFn = TEMPLATES[event.eventType];
  if (!templateFn) return null;
  return templateFn(event);
}
