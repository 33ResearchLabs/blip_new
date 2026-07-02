// Types
export type Screen = "home" | "order" | "escrow" | "orders" | "profile" | "chats" | "chat-view" | "create-offer" | "cash-confirm" | "matching" | "welcome" | "trade" | "wallet" | "notifications" | "support" | "rewards" | "raise-ticket" | "send" | "reputation" | "limits" | "stake" | "points" | "disputes";
export type TradeType = "buy" | "sell";
export type TradePreference = "fast" | "cheap" | "best";
export type PaymentMethod = "bank" | "cash";
// An order's persisted payment-method code. Superset of the coarse form-level
// PaymentMethod: a sell order created via the UPI scan-to-pay flow is stored as
// 'upi' (see useUserTradeCreation). Order-level fields use this wider type so
// 'upi' is never silently narrowed to 'bank' for display.
export type OrderPaymentMethod = PaymentMethod | "upi";
export type OrderStep = 1 | 2 | 3 | 4;
export type OrderStatus = "pending" | "payment" | "waiting" | "complete" | "disputed" | "cancelled" | "expired";

// Merchant type from DB
export interface Merchant {
  id: string;
  display_name: string;
  business_name: string;
  username?: string;
  rating: number;
  total_trades: number;
  is_online: boolean;
  avg_response_time_mins: number;
  wallet_address?: string;
  avatar_url?: string | null;
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
  payment_method: OrderPaymentMethod;
  crypto_amount: number;
  crypto_currency: string;
  fiat_amount: number;
  fiat_currency: string;
  rate: number;
  status: string;
  payment_details: Record<string, unknown> | null;
  created_at: string;
  accepted_at?: string | null;
  payment_sent_at?: string | null;
  completed_at?: string | null;
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
  // On-chain refund state — release_tx_hash is set once escrow is either
  // released to the buyer (happy path) OR refunded to the seller (cancel
  // path). When the order is in a terminal state AND release_tx_hash is
  // null, the on-chain escrow is still holding funds.
  release_tx_hash?: string | null;
  escrow_debited_entity_type?: 'user' | 'merchant' | null;
  escrow_debited_entity_id?: string | null;
  // Merchant's wallet address captured when accepting sell orders
  acceptor_wallet_address?: string;
  // Unhappy path fields
  cancel_requested_by?: string | null;
  cancel_requested_at?: string | null;
  cancel_request_reason?: string | null;
  last_activity_at?: string | null;
  last_extended_at?: string | null;
  inactivity_warned_at?: string | null;
  disputed_at?: string | null;
  dispute_auto_resolve_at?: string | null;
  // Locked payment method (fiat receiver's selected method)
  payment_method_id?: string | null;
  locked_payment_method?: LockedPaymentMethod | null;
  // Merchant's payment method (where buyer sends fiat)
  merchant_payment_method?: MerchantPaymentMethod | null;
  // BUY (Way-1): merchant's accounts matching the buyer's chosen rails
  merchant_matching_payment_methods?: MerchantPaymentMethod[] | null;
  // BUY (Way-1): the payment-method types the buyer is willing to pay with
  // (one or more of 'bank' | 'upi' | 'cash'). Used to filter the merchant feed.
  buyer_payment_types?: string[] | null;
  // Per-order rating fields
  user_rating?: number | null;
  user_rated_at?: string | null;
}

// UI Order type (maps DB order to UI)
export interface Order {
  id: string;
  /** Canonical DB order reference (BM-YYMMDD-XXXX) — shown across all surfaces. */
  order_number?: string;
  type: TradeType;
  cryptoAmount: string;
  cryptoCode: string;
  fiatAmount: string;
  fiatCode: string;
  merchant: {
    id: string;
    name: string;
    username?: string;
    rating: number;
    trades: number;
    rate: number;
    paymentMethod: OrderPaymentMethod;
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
    avatarUrl?: string | null;
  };
  status: OrderStatus;
  step: OrderStep;
  createdAt: Date;
  /** When a merchant accepted — best-available proxy for escrow-lock time. */
  acceptedAt?: Date | null;
  /** When the buyer marked payment sent. */
  paymentSentAt?: Date | null;
  /** When the order completed (seller confirmed + crypto released). */
  completedAt?: Date | null;
  expiresAt: Date;
  dbStatus?: string; // Original DB status
  unreadCount?: number;
  lastMessage?: {
    content: string;
    fromMerchant: boolean;
    senderType?: 'user' | 'merchant' | 'compliance' | 'system';
    createdAt: Date;
  } | null;
  // Escrow on-chain references for release
  escrowTradeId?: number;
  escrowTradePda?: string;
  escrowCreatorWallet?: string;
  escrowTxHash?: string;
  // On-chain release/refund tx. When order is in a terminal state and
  // this is null, an on-chain refund is still pending.
  releaseTxHash?: string | null;
  escrowDebitedEntityType?: 'user' | 'merchant' | null;
  escrowDebitedEntityId?: string | null;
  // Merchant's wallet address captured when accepting (for sell order escrow release)
  acceptorWalletAddress?: string;
  // Unhappy path state
  cancelRequest?: {
    requestedBy: string;
    requestedAt: Date;
    reason: string;
  } | null;
  inactivityWarned?: boolean;
  lastExtendedAt?: Date | null;
  lastActivityAt?: Date | null;
  disputedAt?: Date | null;
  disputeAutoResolveAt?: Date | null;
  // Per-order rating (already submitted by this user)
  userRating?: number | null;
  // Locked payment method for this order (fiat receiver's chosen method)
  lockedPaymentMethod?: LockedPaymentMethod | null;
  // Merchant's payment method (where buyer sends fiat to merchant)
  merchantPaymentMethod?: MerchantPaymentMethod | null;
  // BUY (Way-1): the assigned merchant's payment accounts whose type matches
  // the buyer's chosen rails. The buyer picks one to pay into. Empty until a
  // merchant accepts; once the buyer picks, merchantPaymentMethod is set.
  merchantMatchingPaymentMethods?: MerchantPaymentMethod[];
  // BUY (Way-1): the payment-method types the buyer chose to pay with
  // ('bank' | 'upi' | 'cash'). Shown on the overview/matching screen.
  buyerPaymentTypes?: string[];
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
  type: "bank" | "cash" | "crypto" | "card" | "mobile" | "upi";
  name: string;
  details: string;
  is_default: boolean;
}
