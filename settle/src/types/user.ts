// ─── User Page Types ─────────────────────────────────────────────────────────
// Extracted from page.tsx monolith

export type Screen = "home" | "order" | "escrow" | "orders" | "profile" | "chats" | "chat-view" | "create-offer" | "cash-confirm" | "matching" | "welcome" | "send" | "success";
export type TradeType = "buy" | "sell";
export type TradePreference = "fast" | "cheap" | "best";
export type PaymentMethod = "bank" | "cash";
export type OrderStep = 1 | 2 | 3 | 4;
export type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";
export type EscrowTxStatus = 'idle' | 'connecting' | 'signing' | 'confirming' | 'recording' | 'success' | 'error';

export interface Merchant {
  id: string;
  display_name: string;
  business_name: string;
  rating: number;
  total_trades: number;
  is_online: boolean;
  avg_response_time_mins: number;
  wallet_address?: string;
}

export interface Offer {
  id: string;
  merchant_id: string;
  type: "buy" | "sell";
  payment_method: PaymentMethod;
  rate: number;
  min_amount: number;
  max_amount: number;
  available_amount: number;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_iban: string | null;
  location_name: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  meeting_instructions: string | null;
  merchant: Merchant;
}

export interface DbOrder {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: "buy" | "sell";
  payment_method: PaymentMethod;
  crypto_amount: number;
  crypto_currency: string;
  fiat_amount: number;
  fiat_currency: string;
  rate: number;
  status: string;
  payment_details: Record<string, unknown> | null;
  created_at: string;
  expires_at: string;
  merchant: Merchant;
  offer: Offer;
  unread_count?: number;
  last_message?: {
    content: string;
    sender_type: "user" | "merchant" | "system";
    created_at: string;
  } | null;
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  acceptor_wallet_address?: string;
}

export interface Order {
  id: string;
  type: TradeType;
  cryptoAmount: string;
  cryptoCode: string;
  fiatAmount: string;
  fiatCode: string;
  merchant: {
    id: string;
    name: string;
    rating: number;
    trades: number;
    rate: number;
    paymentMethod: PaymentMethod;
    bank?: string;
    iban?: string;
    accountName?: string;
    location?: string;
    address?: string;
    lat?: number;
    lng?: number;
    meetingSpot?: string;
    walletAddress?: string;
  };
  status: OrderStatus;
  step: OrderStep;
  createdAt: Date;
  expiresAt: Date;
  dbStatus?: string;
  unreadCount?: number;
  lastMessage?: {
    content: string;
    fromMerchant: boolean;
    createdAt: Date;
  } | null;
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  acceptorWalletAddress?: string;
}

export interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  name: string;
  isDefault: boolean;
}

export interface ResolvedDispute {
  id: string;
  orderId: string;
  orderNumber: string;
  cryptoAmount: number;
  fiatAmount: number;
  otherPartyName: string;
  reason: string;
  resolution: string;
  resolvedInFavorOf: string;
  resolvedAt: string;
}

export interface DisputeInfo {
  id: string;
  status: string;
  reason: string;
  proposed_resolution?: string;
  resolution_notes?: string;
  user_confirmed?: boolean;
  merchant_confirmed?: boolean;
}

export interface ExtensionRequest {
  orderId: string;
  requestedBy: 'user' | 'merchant';
  extensionMinutes: number;
  extensionCount: number;
  maxExtensions: number;
}

export interface AcceptedOrderInfo {
  merchantName: string;
  cryptoAmount: number;
  fiatAmount: number;
  orderType: 'buy' | 'sell';
}

// ─── Utility Functions ───────────────────────────────────────────────────────

export function mapDbStatusToUI(dbStatus: string): { status: OrderStatus; step: OrderStep } {
  switch (dbStatus) {
    case 'pending':
      return { status: 'pending', step: 1 };
    case 'accepted':
    case 'escrow_pending':
    case 'escrowed':
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

export function mapDbOrderToUI(dbOrder: DbOrder): Order | null {
  if (!dbOrder) return null;

  const { status, step } = mapDbStatusToUI(dbOrder.status);
  const offer = dbOrder.offer;
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
    escrowTradeId: dbOrder.escrow_trade_id,
    escrowTradePda: dbOrder.escrow_trade_pda,
    escrowCreatorWallet: dbOrder.escrow_creator_wallet,
    escrowTxHash: dbOrder.escrow_tx_hash,
    acceptorWalletAddress: dbOrder.acceptor_wallet_address,
  };
}

export const FEE_CONFIG = {
  fast: { totalFee: 0.03, traderCut: 0.01 },
  best: { totalFee: 0.025, traderCut: 0.005 },
  cheap: { totalFee: 0.015, traderCut: 0.0025 },
} as const;
