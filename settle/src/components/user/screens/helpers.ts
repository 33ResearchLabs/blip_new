import type { OrderStatus, OrderStep, TradeType, DbOrder, Order, Merchant } from './types';

// Map DB status to UI status/step
export function mapDbStatusToUI(dbStatus: string): { status: OrderStatus; step: OrderStep } {
  switch (dbStatus) {
    case 'pending':
      return { status: 'pending', step: 1 };
    case 'escrowed':
      // Escrowed = escrow is locked, trade is active — buyer should send payment
      return { status: 'payment', step: 2 };
    case 'accepted':
    case 'escrow_pending':
    case 'payment_pending':
      return { status: 'payment', step: 2 };
    case 'payment_sent':
    case 'payment_confirmed':
    case 'releasing':
      return { status: 'waiting', step: 3 };
    case 'completed':
      return { status: 'complete', step: 4 };
    case 'cancelled':
    case 'disputed':
    case 'expired':
      return { status: 'complete', step: 4 };
    default:
      return { status: 'pending', step: 1 };
  }
}

// Map DB order to UI order
export function mapDbOrderToUI(dbOrder: DbOrder): Order | null {
  // Guard against completely missing data
  if (!dbOrder) {
    return null;
  }

  const { status, step } = mapDbStatusToUI(dbOrder.status);
  const offer = dbOrder.offer;
  // Use merchant data if available, or create a minimal fallback to prevent order disappearing
  const merchant = dbOrder.merchant || {
    id: dbOrder.merchant_id || 'unknown',
    display_name: 'Merchant',
    rating: 5.0,
    total_trades: 0,
    wallet_address: undefined,
  } as Merchant;

  return {
    id: dbOrder.id,
    type: dbOrder.type as TradeType,
    cryptoAmount: dbOrder.crypto_amount.toString(),
    cryptoCode: dbOrder.crypto_currency,
    fiatAmount: dbOrder.fiat_amount.toString(),
    fiatCode: dbOrder.fiat_currency,
    merchant: {
      id: merchant.id,
      name: merchant.display_name,
      rating: parseFloat(merchant.rating?.toString() || '5.0'),
      trades: merchant.total_trades,
      rate: parseFloat(dbOrder.rate.toString()),
      paymentMethod: dbOrder.payment_method,
      bank: offer?.bank_name || undefined,
      iban: offer?.bank_iban || undefined,
      accountName: offer?.bank_account_name || undefined,
      location: offer?.location_name || undefined,
      address: offer?.location_address || undefined,
      lat: offer?.location_lat || undefined,
      lng: offer?.location_lng || undefined,
      meetingSpot: offer?.meeting_instructions || undefined,
      walletAddress: merchant.wallet_address || undefined,
      isOnline: merchant.is_online ?? false,
      lastSeenAt: merchant.last_seen_at ? new Date(merchant.last_seen_at) : null,
    },
    status,
    step,
    createdAt: new Date(dbOrder.created_at),
    expiresAt: new Date(dbOrder.expires_at),
    dbStatus: dbOrder.status,
    unreadCount: dbOrder.unread_count || 0,
    lastMessage: dbOrder.last_message ? {
      content: dbOrder.last_message.content,
      fromMerchant: dbOrder.last_message.sender_type === 'merchant',
      createdAt: new Date(dbOrder.last_message.created_at),
    } : null,
    // Escrow on-chain references for release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    // Merchant's wallet address captured when accepting (for sell order escrow release)
    acceptorWalletAddress: dbOrder.acceptor_wallet_address,
    // Unhappy path state
    cancelRequest: dbOrder.cancel_requested_by ? {
      requestedBy: dbOrder.cancel_requested_by,
      requestedAt: new Date(dbOrder.cancel_requested_at!),
      reason: dbOrder.cancel_request_reason || 'Requested cancellation',
    } : null,
    inactivityWarned: !!dbOrder.inactivity_warned_at,
    lastActivityAt: dbOrder.last_activity_at ? new Date(dbOrder.last_activity_at) : null,
    disputedAt: dbOrder.disputed_at ? new Date(dbOrder.disputed_at) : null,
    disputeAutoResolveAt: dbOrder.dispute_auto_resolve_at ? new Date(dbOrder.dispute_auto_resolve_at) : null,
    // Locked payment method (fiat receiver's chosen method for this order)
    lockedPaymentMethod: dbOrder.locked_payment_method || null,
  };
}

// Fee structure based on trade preference
export const FEE_CONFIG = {
  fast: { totalFee: 0.03, traderCut: 0.01 },    // 3% total, 1% to trader
  best: { totalFee: 0.025, traderCut: 0.005 },  // 2.5% total, 0.5% to trader
  cheap: { totalFee: 0.015, traderCut: 0.0025 }, // 1.5% total, 0.25% to trader
} as const;

// Format merchant last seen status
export function formatLastSeen(isOnline?: boolean, lastSeenAt?: Date | null): string {
  if (isOnline) return 'Online';
  if (!lastSeenAt) return 'Offline';

  const now = new Date();
  const diffMs = now.getTime() - lastSeenAt.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Last seen just now';
  if (diffMins < 60) return `Last seen ${diffMins}m ago`;

  const isToday = lastSeenAt.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = lastSeenAt.toDateString() === yesterday.toDateString();

  if (isToday) {
    return `Last seen at ${lastSeenAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (isYesterday) return 'Last seen yesterday';
  return `Last seen ${lastSeenAt.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
