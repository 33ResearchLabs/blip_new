// Utility functions for order mapping and status resolution
// Extracted from page.tsx for reuse across hooks and components

import type { DbOrder, Order } from "@/types/merchant";
import { mapMinimalStatusToUIStatus, normalizeLegacyStatus, computeMyRole } from "@/lib/orders/statusResolver";

// Deterministic emoji from user name
export const getUserEmoji = (name: string): string => {
  const emojis = ["🦊", "🦧", "🐋", "🦄", "🔥", "💎", "🐺", "🦁", "🐯", "🐻"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return emojis[Math.abs(hash) % emojis.length];
};

// Get the effective status for UI rendering
// CRITICAL: Always prefer minimalStatus over status field
export const getEffectiveStatus = (order: Order): Order['status'] => {
  if (order.minimalStatus === 'completed') {
    return 'completed';
  }
  return order.status;
};

// Check if an order is expired based on expiresIn countdown
export const isOrderExpired = (order: Order): boolean => {
  return order.expiresIn <= 0;
};

// Convert DB order to UI order
export const mapDbOrderToUI = (dbOrder: DbOrder, merchantId?: string | null): Order => {
  const now = new Date();
  let expiresIn: number;

  if (dbOrder.expires_at) {
    const expiresAt = new Date(dbOrder.expires_at);
    expiresIn = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
  } else {
    const createdAt = new Date(dbOrder.created_at);
    const globalTimeoutSec = 15 * 60;
    expiresIn = Math.max(0, Math.floor((createdAt.getTime() + globalTimeoutSec * 1000 - now.getTime()) / 1000));
  }
  const userName = dbOrder.user?.name || "Unknown User";

  const cryptoAmount = typeof dbOrder.crypto_amount === 'string'
    ? parseFloat(dbOrder.crypto_amount)
    : dbOrder.crypto_amount;
  const fiatAmount = typeof dbOrder.fiat_amount === 'string'
    ? parseFloat(dbOrder.fiat_amount)
    : dbOrder.fiat_amount;
  const rate = typeof dbOrder.rate === 'string'
    ? parseFloat(dbOrder.rate)
    : dbOrder.rate;

  const isM2M = !!dbOrder.buyer_merchant_id;

  const minimalStatus = dbOrder.minimal_status || normalizeLegacyStatus(dbOrder.status);
  let uiStatus = mapMinimalStatusToUIStatus(minimalStatus as any, dbOrder.is_my_order);

  // Pre-locked SELL order (escrowed but no buyer yet) should show as "pending"
  // for observers so they can accept it. Only the creator sees it in "escrow" panel.
  // NEVER downgrade if merchant_id matches me — it's definitely my order.
  const iAmAssignedMerchant = merchantId && (dbOrder.merchant_id === merchantId || dbOrder.buyer_merchant_id === merchantId);
  if (uiStatus === 'escrow' && (minimalStatus === 'escrowed' || dbOrder.status === 'escrowed')
      && !dbOrder.accepted_at && !dbOrder.is_my_order && !iAmAssignedMerchant) {
    uiStatus = 'pending';
  }

  return {
    id: dbOrder.id,
    user: isM2M ? (dbOrder.buyer_merchant?.display_name || 'Merchant') : userName,
    emoji: getUserEmoji(isM2M ? (dbOrder.buyer_merchant?.display_name || 'M') : userName),
    amount: cryptoAmount,
    fromCurrency: "USDC",
    toCurrency: "AED",
    rate: rate,
    total: fiatAmount,
    timestamp: new Date(dbOrder.created_at),
    status: uiStatus,
    minimalStatus: dbOrder.minimal_status,
    orderVersion: dbOrder.order_version,
    expiresIn,
    isNew: (dbOrder.user?.total_trades || 0) < 3,
    tradeVolume: (dbOrder.user?.total_trades || 0) * 500,
    dbOrder,
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    refundTxHash: dbOrder.refund_tx_hash,
    userWallet: isM2M
      ? (dbOrder.buyer_merchant?.wallet_address || dbOrder.acceptor_wallet_address)
      : (dbOrder.type === 'buy'
          ? (dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address)
          : (dbOrder.acceptor_wallet_address || dbOrder.buyer_wallet_address || dbOrder.user?.wallet_address)),
    orderType: dbOrder.type,
    userBankAccount: dbOrder.payment_details
      ? `${dbOrder.payment_details.user_bank_account || dbOrder.payment_details.bank_account_name || 'Unknown'} - ${dbOrder.payment_details.bank_name || 'Unknown Bank'} (${dbOrder.payment_details.bank_iban || 'No IBAN'})`
      : undefined,
    isM2M,
    buyerMerchantId: dbOrder.buyer_merchant_id,
    buyerMerchantWallet: dbOrder.buyer_merchant?.wallet_address,
    acceptorWallet: dbOrder.acceptor_wallet_address,
    isMyOrder: dbOrder.is_my_order,
    myRole: dbOrder.my_role || (merchantId ? computeMyRole(dbOrder, merchantId) : undefined),
    orderMerchantId: dbOrder.merchant_id,
    unreadCount: dbOrder.unread_count || 0,
    hasMessages: (dbOrder.message_count || 0) > 0 || dbOrder.has_manual_message || false,
    lastHumanMessage: dbOrder.last_human_message,
    lastHumanMessageSender: dbOrder.last_human_message_sender,
    spreadPreference: dbOrder.spread_preference as Order['spreadPreference'],
    protocolFeePercent: dbOrder.protocol_fee_percentage ? parseFloat(String(dbOrder.protocol_fee_percentage)) : undefined,
    protocolFeeAmount: dbOrder.protocol_fee_amount ? parseFloat(String(dbOrder.protocol_fee_amount)) : undefined,
  };
};

// Top volume threshold for Top 1% badge
export const TOP_1_PERCENT_THRESHOLD = 100000;

// Fee structure - trader earnings based on trade preference
export const TRADER_CUT_CONFIG = {
  fast: 0.01,
  best: 0.005,
  cheap: 0.0025,
  average: 0.00583,
} as const;
