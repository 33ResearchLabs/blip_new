/// Trade State Module for BlipScan Integration
/// Adds minimal on-chain trade tracking to existing escrow program

use anchor_lang::prelude::*;

// ============================================
// TRADE STATE ENUM
// ============================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum TradeState {
    /// Trade created, waiting for funds
    Created = 0,
    /// Funds locked in escrow, waiting for user action
    Locked = 1,
    /// User confirmed off-chain payment sent
    UserConfirmed = 2,
    /// Funds released to buyer
    Released = 3,
    /// Trade cancelled (by timeout or merchant)
    Cancelled = 4,
    /// Trade disputed (optional, for future use)
    Disputed = 5,
}

// ============================================
// OUTCOME CODE ENUM
// ============================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum OutcomeCode {
    Pending = 0,
    Success = 1,
    CancelledByMerchant = 2,
    CancelledByUser = 3,
    Timeout = 4,
    DisputeResolvedForUser = 5,
    DisputeResolvedForMerchant = 6,
}

// ============================================
// TRADE PDA ACCOUNT
// ============================================

#[account]
pub struct Trade {
    /// Version for future upgrades
    pub version: u8,

    /// Unique trade identifier (from off-chain system or on-chain counter)
    pub trade_id: u64,

    /// Merchant pubkey
    pub merchant: Pubkey,

    /// User/buyer pubkey
    pub user: Pubkey,

    /// Token mint (USDT)
    pub mint: Pubkey,

    /// Trade amount in base units
    pub amount: u64,

    /// Current trade state
    pub state: TradeState,

    /// Outcome of the trade
    pub outcome: OutcomeCode,

    // ---- Lifecycle slots (for analytics) ----
    /// Slot when trade was created
    pub created_slot: u64,

    /// Slot when funds were locked
    pub locked_slot: u64,

    /// Slot when user confirmed payment sent
    pub user_confirmed_slot: u64,

    /// Slot when funds were released/cancelled
    pub finalized_slot: u64,

    // ---- Optional metadata (explorer-ready) ----
    /// Region code (e.g., country code as u16, 0 if not set)
    pub region_code: u16,

    /// Payment rail code (e.g., UPI=1, Bank=2, etc., 0 if not set)
    pub rail_code: u16,

    /// Arbiter pubkey (optional, Pubkey::default if none)
    pub arbiter: Pubkey,

    /// Link to escrow PDA (for cross-reference)
    pub escrow: Pubkey,

    /// PDA bump
    pub bump: u8,
}

impl Trade {
    /// Space calculation:
    /// 1 (version) + 8 (trade_id) + 32 (merchant) + 32 (user) + 32 (mint)
    /// + 8 (amount) + 1 (state) + 1 (outcome)
    /// + 8*4 (slots) + 2 (region) + 2 (rail) + 32 (arbiter) + 32 (escrow) + 1 (bump)
    /// = 224 bytes
    pub const LEN: usize = 1 + 8 + 32 + 32 + 32 + 8 + 1 + 1 + 32 + 2 + 2 + 32 + 32 + 1;

    /// Seeds pattern: ["trade", merchant, trade_id_bytes]
    pub fn seeds(merchant: &Pubkey, trade_id: u64) -> [&[u8]; 3] {
        [b"trade", merchant.as_ref(), &trade_id.to_le_bytes()]
    }
}

// ============================================
// EVENTS
// ============================================

#[event]
pub struct TradeCreatedEvent {
    pub trade_id: u64,
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub slot: u64,
    pub region_code: u16,
    pub rail_code: u16,
}

#[event]
pub struct FundsLockedEvent {
    pub trade_id: u64,
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct UserConfirmedSentEvent {
    pub trade_id: u64,
    pub user: Pubkey,
    pub slot: u64,
}

#[event]
pub struct FundsReleasedEvent {
    pub trade_id: u64,
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub slot: u64,
}

#[event]
pub struct TradeCancelledEvent {
    pub trade_id: u64,
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub cancelled_by: Pubkey,
    pub outcome: OutcomeCode,
    pub slot: u64,
}

#[event]
pub struct TradeDisputedEvent {
    pub trade_id: u64,
    pub merchant: Pubkey,
    pub user: Pubkey,
    pub disputed_by: Pubkey,
    pub slot: u64,
}
