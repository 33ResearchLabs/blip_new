// Shared types for the Merchant Dashboard
// Extracted from page.tsx for reuse across hooks and components

export interface DbOrder {
  id: string;
  order_number: string;
  user_id: string;
  merchant_id: string;
  offer_id: string;
  type: "buy" | "sell";
  payment_method: "bank" | "cash";
  crypto_amount: number | string;
  fiat_amount: number | string;
  rate: number | string;
  status: string;
  minimal_status?: string;
  order_version?: number;
  created_at: string;
  expires_at: string;
  accepted_at?: string;
  escrowed_at?: string;
  payment_sent_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  refund_tx_hash?: string;
  buyer_wallet_address?: string;
  acceptor_wallet_address?: string;
  buyer_merchant_id?: string;
  buyer_merchant?: {
    id: string;
    display_name: string;
    wallet_address?: string;
  };
  is_my_order?: boolean;
  my_role?: 'buyer' | 'seller' | 'observer';
  payment_details?: {
    user_bank_account?: string;
    bank_account_name?: string;
    bank_name?: string;
    bank_iban?: string;
  };
  user?: {
    id: string;
    name: string;
    username?: string;
    rating: number;
    total_trades: number;
    wallet_address?: string;
  };
  offer?: {
    payment_method: string;
    location_name?: string;
  };
  cancellation_reason?: string;
  unread_count?: number;
  has_manual_message?: boolean;
  message_count?: number;
  last_human_message?: string;
  last_human_message_sender?: string;
  spread_preference?: string;
  protocol_fee_percentage?: number | string;
  protocol_fee_amount?: number | string;
}

export interface Order {
  id: string;
  user: string;
  emoji: string;
  amount: number;
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  total: number;
  timestamp: Date;
  status: "pending" | "active" | "escrow" | "completed" | "disputed" | "cancelled" | "expired";
  minimalStatus?: string;
  orderVersion?: number;
  expiresIn: number;
  isNew?: boolean;
  tradeVolume?: number;
  dbOrder?: DbOrder;
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  refundTxHash?: string;
  userWallet?: string;
  orderType?: "buy" | "sell";
  userBankAccount?: string;
  isM2M?: boolean;
  buyerMerchantId?: string;
  buyerMerchantWallet?: string;
  acceptorWallet?: string;
  isMyOrder?: boolean;
  myRole?: 'buyer' | 'seller' | 'observer';
  orderMerchantId?: string;
  unreadCount?: number;
  hasMessages?: boolean;
  lastHumanMessage?: string;
  lastHumanMessageSender?: string;
  spreadPreference?: 'best' | 'fastest' | 'cheap';
  protocolFeePercent?: number;
  protocolFeeAmount?: number;
}

export interface LeaderboardEntry {
  rank: number;
  id: string;
  displayName: string;
  username: string;
  totalTrades: number;
  totalVolume: number;
  rating: number;
  ratingCount: number;
  isOnline: boolean;
  avgResponseMins: number;
  completedCount: number;
}

export interface BigOrderRequest {
  id: string;
  user: string;
  emoji: string;
  amount: number;
  currency: string;
  message: string;
  timestamp: Date;
  premium: number;
}

export interface MerchantInfo {
  id: string;
  email: string;
  display_name: string;
  business_name: string;
  balance: number;
  wallet_address?: string;
  username?: string;
  rating?: number;
  total_trades?: number;
  avatar_url?: string | null;
}

export interface Notification {
  id: string;
  type: 'order' | 'escrow' | 'payment' | 'dispute' | 'complete' | 'system';
  message: string;
  timestamp: number;
  read: boolean;
  orderId?: string;
}

export interface OrderConversation {
  order_id: string;
  order_number: string;
  order_status: string;
  order_type: 'buy' | 'sell';
  crypto_amount: number;
  fiat_amount: number;
  fiat_currency: string;
  order_created_at: string;
  counterparty_name: string;
  counterparty_type: 'user' | 'merchant';
  last_message?: string;
  last_message_at?: string;
  unread_count: number;
  total_messages: number;
}

export interface OpenTradeForm {
  tradeType: "buy" | "sell";
  cryptoAmount: string;
  paymentMethod: "bank" | "cash";
  spreadPreference: "best" | "fastest" | "cheap";
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
  requestedBy: 'user' | 'merchant';
  extensionMinutes: number;
  extensionCount: number;
  maxExtensions: number;
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

export interface RatingModalData {
  orderId: string;
  counterpartyName: string;
  counterpartyType: 'user' | 'merchant';
}
