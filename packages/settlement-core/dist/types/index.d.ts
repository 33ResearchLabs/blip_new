export type KycStatus = 'none' | 'pending' | 'verified' | 'rejected';
export type MerchantStatus = 'pending' | 'active' | 'suspended' | 'banned';
export type OfferType = 'buy' | 'sell';
export type PaymentMethod = 'bank' | 'cash';
export type RateType = 'fixed' | 'market_margin';
export type OrderStatus = 'pending' | 'accepted' | 'escrow_pending' | 'escrowed' | 'payment_pending' | 'payment_sent' | 'payment_confirmed' | 'releasing' | 'completed' | 'cancelled' | 'disputed' | 'expired';
export type MinimalOrderStatus = 'open' | 'accepted' | 'escrowed' | 'payment_sent' | 'completed' | 'cancelled' | 'expired' | 'disputed';
export type ActorType = 'user' | 'merchant' | 'system' | 'compliance';
export type MessageType = 'text' | 'image' | 'system';
export type DisputeReason = 'payment_not_received' | 'crypto_not_received' | 'wrong_amount' | 'fraud' | 'other';
export type DisputeStatus = 'open' | 'investigating' | 'resolved' | 'escalated';
export interface User {
    id: string;
    username: string;
    password_hash?: string;
    wallet_address: string | null;
    phone: string | null;
    avatar_url: string | null;
    kyc_status: KycStatus;
    kyc_level: number;
    total_trades: number;
    total_volume: number;
    rating: number;
    push_token: string | null;
    notification_settings: Record<string, unknown>;
    balance: number;
    created_at: Date;
    updated_at: Date;
}
export interface Merchant {
    id: string;
    wallet_address: string;
    business_name: string;
    display_name: string;
    email: string;
    phone: string | null;
    avatar_url: string | null;
    status: MerchantStatus;
    verification_level: number;
    total_trades: number;
    total_volume: number;
    rating: number;
    rating_count: number;
    avg_response_time_mins: number;
    is_online: boolean;
    last_seen_at: Date | null;
    auto_accept_enabled: boolean;
    auto_accept_max_amount: number | null;
    balance: number;
    created_at: Date;
    updated_at: Date;
}
export interface MerchantOffer {
    id: string;
    merchant_id: string;
    type: OfferType;
    payment_method: PaymentMethod;
    rate: number;
    rate_type: RateType;
    margin_percent: number | null;
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
    is_active: boolean;
    requires_kyc_level: number;
    created_at: Date;
    updated_at: Date;
}
export interface Order {
    id: string;
    order_number: string;
    user_id: string;
    merchant_id: string;
    offer_id: string;
    buyer_merchant_id: string | null;
    type: OfferType;
    payment_method: PaymentMethod;
    crypto_amount: number;
    crypto_currency: string;
    fiat_amount: number;
    fiat_currency: string;
    rate: number;
    platform_fee: number;
    network_fee: number;
    status: OrderStatus;
    escrow_tx_hash: string | null;
    escrow_address: string | null;
    escrow_trade_id: number | null;
    escrow_trade_pda: string | null;
    escrow_pda: string | null;
    escrow_creator_wallet: string | null;
    release_tx_hash: string | null;
    refund_tx_hash: string | null;
    buyer_wallet_address: string | null;
    acceptor_wallet_address: string | null;
    payment_details: Record<string, unknown> | null;
    created_at: Date;
    accepted_at: Date | null;
    escrowed_at: Date | null;
    payment_sent_at: Date | null;
    payment_confirmed_at: Date | null;
    completed_at: Date | null;
    cancelled_at: Date | null;
    expires_at: Date | null;
    cancelled_by: ActorType | null;
    cancellation_reason: string | null;
    extension_count: number;
    max_extensions: number;
    extension_requested_by: ActorType | null;
    extension_requested_at: Date | null;
    extension_minutes: number;
    has_manual_message: boolean;
    assigned_compliance_id: string | null;
    spread_preference: string | null;
    protocol_fee_percentage: number | null;
    protocol_fee_amount: number | null;
    order_version: number;
    minimal_status?: MinimalOrderStatus;
}
export interface OrderEvent {
    id: string;
    order_id: string;
    event_type: string;
    actor_type: ActorType;
    actor_id: string | null;
    old_status: OrderStatus | null;
    new_status: OrderStatus | null;
    metadata: Record<string, unknown> | null;
    created_at: Date;
}
export interface ChatMessage {
    id: string;
    order_id: string;
    sender_type: ActorType;
    sender_id: string | null;
    message_type: MessageType;
    content: string;
    image_url: string | null;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
}
export interface UserBankAccount {
    id: string;
    user_id: string;
    bank_name: string;
    account_name: string;
    iban: string;
    is_default: boolean;
    is_verified: boolean;
    created_at: Date;
}
export interface Review {
    id: string;
    order_id: string;
    reviewer_type: ActorType;
    reviewer_id: string;
    reviewee_type: ActorType;
    reviewee_id: string;
    rating: number;
    comment: string | null;
    created_at: Date;
}
export interface Dispute {
    id: string;
    order_id: string;
    raised_by: ActorType;
    raiser_id: string;
    reason: DisputeReason;
    description: string | null;
    evidence_urls: string[] | null;
    status: DisputeStatus;
    resolution: string | null;
    resolved_in_favor_of: ActorType | null;
    created_at: Date;
    resolved_at: Date | null;
}
export interface MerchantOfferWithMerchant extends MerchantOffer {
    merchant: Merchant;
}
export interface OrderWithRelations extends Order {
    user: User;
    merchant: Merchant;
    offer: MerchantOffer;
}
export interface CreateOrderRequest {
    user_id: string;
    offer_id: string;
    crypto_amount: number;
    type: OfferType;
}
export interface UpdateOrderStatusRequest {
    status: OrderStatus;
    actor_type: ActorType;
    actor_id: string;
    metadata?: Record<string, unknown>;
}
export interface SendMessageRequest {
    sender_type: ActorType;
    sender_id: string;
    content: string;
    message_type?: MessageType;
    image_url?: string;
}
export interface CreateReviewRequest {
    order_id: string;
    reviewer_type: ActorType;
    reviewer_id: string;
    reviewee_type: ActorType;
    reviewee_id: string;
    rating: number;
    comment?: string;
}
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
export interface MerchantContact {
    id: string;
    merchant_id: string;
    user_id: string | null;
    contact_merchant_id: string | null;
    contact_type: 'user' | 'merchant';
    nickname: string | null;
    notes: string | null;
    is_favorite: boolean;
    trades_count: number;
    total_volume: number;
    last_trade_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface MerchantContactWithInfo extends MerchantContact {
    contact: {
        id: string;
        username: string;
        rating: number;
        total_trades: number;
        type: 'user' | 'merchant';
    };
}
export type MerchantContactWithUser = MerchantContactWithInfo;
export interface DirectMessage {
    id: string;
    sender_type: 'merchant' | 'user';
    sender_id: string;
    recipient_type: 'merchant' | 'user';
    recipient_id: string;
    content: string;
    message_type: 'text' | 'image';
    image_url: string | null;
    is_read: boolean;
    read_at: Date | null;
    created_at: Date;
}
export interface DirectConversation {
    contact_id: string;
    contact_type: 'user' | 'merchant';
    contact_target_id: string;
    username: string;
    nickname: string | null;
    is_favorite: boolean;
    trades_count: number;
    last_message: {
        content: string;
        sender_type: string;
        created_at: string;
        is_read: boolean;
    } | null;
    unread_count: number;
    last_activity: string | null;
}
export interface ContactSearchResult {
    id: string;
    username: string;
    type: 'user' | 'merchant';
    total_trades: number;
    rating: number;
    is_contact: boolean;
}
//# sourceMappingURL=index.d.ts.map