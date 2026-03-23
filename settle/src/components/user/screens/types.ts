// Types
export type Screen = "home" | "order" | "escrow" | "orders" | "profile" | "chats" | "chat-view" | "create-offer" | "cash-confirm" | "matching" | "welcome" | "trade" | "wallet";
export type TradeType = "buy" | "sell";
export type TradePreference = "fast" | "cheap" | "best";
export type PaymentMethod = "bank" | "cash";
export type OrderStep = 1 | 2 | 3 | 4;
export type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed";

// Merchant type from DB
export interface Merchant {
  id: string;
  display_name: string;
  business_name: string;
  rating: number;
  total_trades: number;
  is_online: boolean;
  avg_response_time_mins: number;
  wallet_address?: string;
  last_seen_at?: string | null;
}

// Offer type from DB
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

// Order from DB
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
  // Escrow on-chain references
  escrow_tx_hash?: string;
  escrow_trade_id?: number;
  escrow_trade_pda?: string;
  escrow_pda?: string;
  escrow_creator_wallet?: string;
  // Merchant's wallet address captured when accepting sell orders
  acceptor_wallet_address?: string;
  // Unhappy path fields
  cancel_requested_by?: string | null;
  cancel_requested_at?: string | null;
  cancel_request_reason?: string | null;
  last_activity_at?: string | null;
  inactivity_warned_at?: string | null;
  disputed_at?: string | null;
  dispute_auto_resolve_at?: string | null;
  // Locked payment method (fiat receiver's selected method)
  payment_method_id?: string | null;
  locked_payment_method?: LockedPaymentMethod | null;
  // Merchant's payment method (where buyer sends fiat)
  merchant_payment_method?: MerchantPaymentMethod | null;
}

// UI Order type (maps DB order to UI)
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
    isOnline?: boolean;
    lastSeenAt?: Date | null;
  };
  status: OrderStatus;
  step: OrderStep;
  createdAt: Date;
  expiresAt: Date;
  dbStatus?: string; // Original DB status
  unreadCount?: number;
  lastMessage?: {
    content: string;
    fromMerchant: boolean;
    createdAt: Date;
  } | null;
  // Escrow on-chain references for release
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  // Merchant's wallet address captured when accepting (for sell order escrow release)
  acceptorWalletAddress?: string;
  // Unhappy path state
  cancelRequest?: {
    requestedBy: string;
    requestedAt: Date;
    reason: string;
  } | null;
  inactivityWarned?: boolean;
  lastActivityAt?: Date | null;
  disputedAt?: Date | null;
  disputeAutoResolveAt?: Date | null;
  // Locked payment method for this order (fiat receiver's chosen method)
  lockedPaymentMethod?: LockedPaymentMethod | null;
  // Merchant's payment method (where buyer sends fiat to merchant)
  merchantPaymentMethod?: MerchantPaymentMethod | null;
}

export interface BankAccount {
  id: string;
  bank: string;
  iban: string;
  name: string;
  isDefault: boolean;
}

// Locked payment method attached to an order (from user_payment_methods table)
export interface LockedPaymentMethod {
  id: string;
  type: "bank" | "upi" | "cash" | "other";
  label: string;
  details: Record<string, string>;
}

// Merchant's payment method locked into an order (from merchant_payment_methods table)
export interface MerchantPaymentMethod {
  id: string;
  type: "bank" | "cash" | "crypto" | "card" | "mobile";
  name: string;
  details: string;
  is_default: boolean;
}
