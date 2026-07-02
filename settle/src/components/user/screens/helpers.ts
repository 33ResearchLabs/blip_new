import type { OrderStatus, OrderStep, TradeType, DbOrder, Order, Merchant } from './types';

// Human label for an order's payment-method code ('bank' | 'upi' | 'cash').
// Single source of truth so the METHOD tile, Order Overview, Payment Details,
// and every other screen show the SAME label for a given order. Never collapse
// an unknown/`upi` value to "Bank Transfer" — that was the source of the
// UPI-shown-as-Bank-Transfer inconsistency.
export function paymentMethodLabel(method?: string | null): string {
  switch ((method || '').toLowerCase()) {
    case 'cash': return 'Cash';
    case 'upi': return 'UPI';
    case 'bank': return 'Bank Transfer';
    // Unknown but present code → surface it verbatim (uppercased) rather than
    // silently mislabelling it. Empty/missing → the safe electronic default.
    default: return method ? method.toUpperCase() : 'Bank Transfer';
  }
}

// The payment-method code to display for an order, resolved from the concrete
// method locked into the order (merchantPaymentMethod → lockedPaymentMethod)
// and only falling back to the order's coarse `merchant.paymentMethod` when
// nothing is locked yet. A BUY order is stored coarsely as 'bank' even when the
// counterparties settle over UPI — so the coarse field alone mislabels the
// completed order as "Bank Transfer". Mirror this logic anywhere the locked
// account details are shown so the label never disagrees with them.
export function resolveOrderPaymentMethod(order: Order): string {
  const mpm = order.merchantPaymentMethod;
  const lpm = order.lockedPaymentMethod;
  if (mpm) {
    const t = (mpm.type || '').toLowerCase();
    if (t === 'upi' || (typeof mpm.details === 'string' && mpm.details.includes('@'))) return 'upi';
    if (t) return t;
  } else if (lpm) {
    const d = lpm.details || {};
    if ((lpm.type || '').toLowerCase() === 'upi' || d.upi_id) return 'upi';
    if (d.bank_name || d.iban) return 'bank';
    if (lpm.type) return lpm.type.toLowerCase();
  }
  return order.merchant?.paymentMethod ?? 'bank';
}

// Map DB status to UI status/step
// For SELL orders, pass the order type and merchant_id to determine the correct step:
//   - SELL + escrowed + no merchant_id → step 1 (waiting for merchant to claim)
//   - SELL + escrowed + merchant_id    → step 2 (claimed, waiting for fiat payment)
export function mapDbStatusToUI(
  dbStatus: string,
  orderType?: string,
  merchantId?: string | null,
): { status: OrderStatus; step: OrderStep } {
  switch (dbStatus) {
    case 'pending':
      return { status: 'pending', step: 1 };
    case 'escrowed':
      // SELL orders: escrowed + unclaimed = step 1 (waiting for merchant to mine)
      // SELL orders: escrowed + claimed   = step 2 (merchant claimed, waiting for fiat)
      // BUY orders: escrowed = step 2 (escrow locked, buyer sends payment)
      if (orderType === 'sell' && !merchantId) {
        return { status: 'pending', step: 1 };
      }
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
      return { status: 'cancelled', step: 1 };
    case 'expired':
      return { status: 'expired', step: 1 };
    case 'disputed':
      return { status: 'disputed', step: 3 };
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

  const { status, step } = mapDbStatusToUI(dbOrder.status, dbOrder.type, dbOrder.merchant_id);
  const offer = dbOrder.offer;
  // Use merchant data if available, or create a minimal fallback to prevent order disappearing
  const merchant = dbOrder.merchant || {
    id: dbOrder.merchant_id || 'unknown',
    display_name: 'Merchant',
    rating: 5.0,
    total_trades: 0,
    wallet_address: undefined,
  } as Merchant;

  // If merchant has a payment method locked into the order, use its details
  // instead of the offer's hardcoded bank fields
  const mpm = dbOrder.merchant_payment_method;

  return {
    id: dbOrder.id,
    // Canonical, DB-persisted order reference. Surfaced so getDisplayOrderId()
    // shows the real BM-… id (matches lists, chat, ledger, support) instead of
    // the derived fallback.
    order_number: dbOrder.order_number,
    type: dbOrder.type as TradeType,
    cryptoAmount: (dbOrder.crypto_amount ?? 0).toString(),
    cryptoCode: dbOrder.crypto_currency || 'USDT',
    fiatAmount: (dbOrder.fiat_amount ?? 0).toString(),
    fiatCode: dbOrder.fiat_currency || 'AED',
    merchant: {
      id: merchant.id,
      name: merchant.display_name || merchant.business_name || 'Merchant',
      username: merchant.username || undefined,
      rating: parseFloat(merchant.rating?.toString() || '5.0'),
      trades: merchant.total_trades || 0,
      rate: parseFloat((dbOrder.rate ?? 0).toString()),
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
      avatarUrl: merchant.avatar_url || null,
    },
    status,
    step,
    createdAt: dbOrder.created_at ? new Date(dbOrder.created_at) : new Date(),
    acceptedAt: dbOrder.accepted_at ? new Date(dbOrder.accepted_at) : null,
    paymentSentAt: dbOrder.payment_sent_at ? new Date(dbOrder.payment_sent_at) : null,
    completedAt: dbOrder.completed_at ? new Date(dbOrder.completed_at) : null,
    expiresAt: dbOrder.expires_at ? new Date(dbOrder.expires_at) : new Date(),
    dbStatus: dbOrder.status,
    unreadCount: dbOrder.unread_count || 0,
    lastMessage: dbOrder.last_message ? {
      content: dbOrder.last_message.content,
      fromMerchant: dbOrder.last_message.sender_type === 'merchant',
      senderType: dbOrder.last_message.sender_type,
      createdAt: new Date(dbOrder.last_message.created_at),
    } : null,
    // Escrow on-chain references for release
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    releaseTxHash: dbOrder.release_tx_hash ?? null,
    escrowDebitedEntityType: dbOrder.escrow_debited_entity_type ?? null,
    escrowDebitedEntityId: dbOrder.escrow_debited_entity_id ?? null,
    // Merchant's wallet address captured when accepting (for sell order escrow release)
    acceptorWalletAddress: dbOrder.acceptor_wallet_address,
    // Unhappy path state
    cancelRequest: dbOrder.cancel_requested_by ? {
      requestedBy: dbOrder.cancel_requested_by,
      requestedAt: new Date(dbOrder.cancel_requested_at!),
      reason: dbOrder.cancel_request_reason || 'Requested cancellation',
    } : null,
    inactivityWarned: !!dbOrder.inactivity_warned_at,
    lastExtendedAt: dbOrder.last_extended_at ? new Date(dbOrder.last_extended_at) : null,
    lastActivityAt: dbOrder.last_activity_at ? new Date(dbOrder.last_activity_at) : null,
    disputedAt: dbOrder.disputed_at ? new Date(dbOrder.disputed_at) : null,
    disputeAutoResolveAt: dbOrder.dispute_auto_resolve_at ? new Date(dbOrder.dispute_auto_resolve_at) : null,
    // Locked payment method (fiat receiver's chosen method for this order)
    lockedPaymentMethod: dbOrder.locked_payment_method || null,
    // Merchant's payment method (where buyer sends fiat to merchant)
    merchantPaymentMethod: mpm || null,
    // BUY (Way-1): merchant's accounts matching the buyer's chosen rails — the
    // buyer picks one to pay into. Empty array until a merchant accepts.
    merchantMatchingPaymentMethods: dbOrder.merchant_matching_payment_methods || [],
    // BUY (Way-1): the payment-method types the buyer chose to pay with.
    buyerPaymentTypes: dbOrder.buyer_payment_types || [],
    // Per-order rating
    userRating: dbOrder.user_rating || null,
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
