use anchor_lang::prelude::*;
use crate::state::TradeSide;

#[event]
pub struct TradeCreatedEvent {
    pub trade: Pubkey,
    pub creator: Pubkey,
    pub trade_id: u64,
    pub mint: Pubkey,
    pub amount: u64,
    pub side: TradeSide,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct TradeFundedEvent {
    pub trade: Pubkey,
    pub escrow: Pubkey,
    pub vault_ata: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct TradeAcceptedEvent {
    pub trade: Pubkey,
    pub escrow: Pubkey,
    pub counterparty: Pubkey,
    pub creator: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradeLockedEvent {
    pub trade: Pubkey,
    pub counterparty: Pubkey,
    pub escrow: Pubkey,
    pub vault_ata: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradeReleasedEvent {
    pub trade: Pubkey,
    pub counterparty: Pubkey,
    pub payout: u64,
    pub fee: u64,
    pub treasury: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct TradeRefundedEvent {
    pub trade: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradeExtendedEvent {
    pub trade: Pubkey,
    pub depositor: Pubkey,
    pub old_expires_at: i64,
    pub new_expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct PaymentConfirmedEvent {
    pub trade: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct DisputeOpenedEvent {
    pub trade: Pubkey,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct DisputeResolvedEvent {
    pub trade: Pubkey,
    pub arbiter: Pubkey,
    pub resolution: u8,  // 0 = ReleaseToBuyer, 1 = RefundToSeller
    pub recipient: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct OfferMatchedEvent {
    pub trade: Pubkey,
    pub offer_hash: [u8; 32],
    pub offer_creator: Pubkey,
    pub matcher: Pubkey,
    pub counterparty: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ConfigUpdatedEvent {
    pub authority: Pubkey,
    pub new_fee_bps: Option<u16>,
    pub new_treasury: Option<Pubkey>,
    pub new_authority: Option<Pubkey>,
    pub is_frozen: Option<bool>,
    pub timestamp: i64,
}
