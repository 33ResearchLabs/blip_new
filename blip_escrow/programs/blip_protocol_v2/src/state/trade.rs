use anchor_lang::prelude::*;

/// Trade lifecycle states
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum TradeStatus {
    /// Trade initialized, no funds locked yet
    Created,
    /// Funds escrowed, counterparty NOT yet set (open for acceptance)
    Funded,
    /// Funds escrowed, counterparty set (trade is locked, awaiting fiat payment)
    Locked,
    /// Buyer claims fiat payment sent (NO auto-refund allowed, must dispute)
    PaymentSent,
    /// Trade is disputed, frozen for arbitration
    Disputed,
    /// Funds transferred to counterparty (terminal)
    Released,
    /// Funds returned to depositor (terminal)
    Refunded,
}

/// Trade side from creator's perspective
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TradeSide {
    /// Creator is buying (will receive tokens)
    Buy,
    /// Creator is selling (will send tokens)
    Sell,
}

/// Dispute resolution outcome
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DisputeResolution {
    /// Release funds to buyer (counterparty)
    ReleaseToBuyer,
    /// Refund funds to seller (depositor)
    RefundToSeller,
}

/// Trade PDA - tracks lifecycle and metadata
///
/// Seeds: [b"trade-v2", creator, trade_id.to_le_bytes()]
#[account]
pub struct Trade {
    /// Trade creator (initiator)
    pub creator: Pubkey,

    /// Counterparty (set when locked)
    pub counterparty: Pubkey,

    /// Unique trade ID (per creator)
    pub trade_id: u64,

    /// SPL token mint
    pub mint: Pubkey,

    /// Token amount
    pub amount: u64,

    /// Current trade status
    pub status: TradeStatus,

    /// Snapshot of protocol fee at creation (immutable)
    pub fee_bps: u16,

    /// Snapshot of protocol treasury at creation (immutable for the life
    /// of this trade). The release path uses `trade.treasury` instead of
    /// `protocol_config.treasury` so an admin who rotates the treasury
    /// after a trade is created cannot redirect that trade's fees.
    pub treasury: Pubkey,

    /// Escrow PDA bump
    pub escrow_bump: u8,

    /// Trade PDA bump
    pub bump: u8,

    /// Creation timestamp
    pub created_at: i64,

    /// Lock timestamp (0 if not locked)
    pub locked_at: i64,

    /// Settlement timestamp (0 if not settled)
    pub settled_at: i64,

    /// Trade side (buy/sell from creator perspective)
    pub side: TradeSide,

    /// Escrow expiration timestamp (0 = no expiration, set when funded)
    /// In Funded state: anyone can auto-refund after expiry
    /// In Locked state: seller can cancel after buyer_pay_window
    /// In PaymentSent/Disputed: NO auto-refund allowed
    pub expires_at: i64,

    /// Timestamp when buyer confirmed payment (0 if not confirmed)
    pub payment_confirmed_at: i64,

    /// Timestamp when dispute was opened (0 if not disputed)
    pub disputed_at: i64,

    /// Who initiated the dispute (default = no dispute)
    pub dispute_initiator: Pubkey,
}

impl Trade {
    pub const LEN: usize = 8 + // discriminator
        32 + // creator
        32 + // counterparty
        8 +  // trade_id
        32 + // mint
        8 +  // amount
        1 +  // status (enum)
        2 +  // fee_bps
        32 + // treasury (V2.3)
        1 +  // escrow_bump
        1 +  // bump
        8 +  // created_at
        8 +  // locked_at
        8 +  // settled_at
        1 +  // side (enum)
        8 +  // expires_at
        8 +  // payment_confirmed_at
        8 +  // disputed_at
        32;  // dispute_initiator

    /// Default escrow duration in seconds (24 hours)
    pub const DEFAULT_ESCROW_DURATION: i64 = 24 * 60 * 60;

    /// Buyer payment window in seconds (4 hours)
    /// After this time in Locked state, seller can cancel
    pub const BUYER_PAY_WINDOW: i64 = 4 * 60 * 60;

    /// Dispute resolution window in seconds (72 hours)
    pub const DISPUTE_WINDOW: i64 = 72 * 60 * 60;

    /// After this many seconds in PaymentSent with no dispute action,
    /// ANY caller may open a dispute on the stale trade.
    pub const PAYMENT_STALE_THRESHOLD: i64 = 24 * 60 * 60;

    /// Hard ceiling on total trade lifetime (from `created_at`) that
    /// `extend_escrow` may not cross. Caps depositor griefing.
    pub const MAX_TOTAL_LIFETIME: i64 = 7 * 24 * 60 * 60;

    /// Trade PDA seeds prefix
    pub const SEED_PREFIX: &'static [u8] = b"trade-v2";

    /// Check if trade can be funded (escrow without counterparty)
    pub fn can_fund(&self) -> bool {
        self.status == TradeStatus::Created
    }

    /// Check if trade can be accepted (counterparty joins funded escrow)
    pub fn can_accept(&self) -> bool {
        self.status == TradeStatus::Funded
    }

    /// Check if trade can be locked (fund + set counterparty in one step)
    pub fn can_lock(&self) -> bool {
        self.status == TradeStatus::Created
    }

    /// Check if buyer can confirm payment
    pub fn can_confirm_payment(&self) -> bool {
        self.status == TradeStatus::Locked
    }

    /// Check if trade can be released
    /// Release is allowed from Locked (direct release) or PaymentSent (after buyer confirmed)
    pub fn can_release(&self) -> bool {
        matches!(self.status, TradeStatus::Locked | TradeStatus::PaymentSent)
    }

    /// Check if trade can be disputed
    pub fn can_dispute(&self) -> bool {
        matches!(self.status, TradeStatus::Locked | TradeStatus::PaymentSent)
    }

    /// Check if trade can be refunded (state-aware)
    /// - Created/Funded: always refundable by seller
    /// - Locked: refundable by seller after buyer_pay_window
    /// - PaymentSent/Disputed: NOT refundable (must use dispute resolution)
    pub fn can_refund(&self) -> bool {
        matches!(self.status, TradeStatus::Created | TradeStatus::Funded | TradeStatus::Locked)
    }

    /// Check if auto-refund (anyone callable) is allowed
    /// ONLY allowed in Funded state after expiry
    pub fn can_auto_refund(&self, current_time: i64) -> bool {
        self.status == TradeStatus::Funded && self.is_expired(current_time)
    }

    /// Check if seller can manually cancel/refund in Locked state.
    /// Uses expires_at (set to payment window deadline on lock/accept).
    /// Falls back to locked_at + BUYER_PAY_WINDOW for legacy trades.
    pub fn can_seller_cancel(&self, current_time: i64) -> bool {
        if self.status != TradeStatus::Locked { return false; }
        let deadline = if self.expires_at > 0 {
            self.expires_at
        } else {
            self.locked_at + Self::BUYER_PAY_WINDOW
        };
        current_time > deadline
    }

    /// Hard, permissionless timeout in Locked state.
    /// Uses expires_at (payment window deadline). Falls back to constant for legacy trades.
    pub fn can_anyone_refund_locked(&self, current_time: i64) -> bool {
        if self.status != TradeStatus::Locked || self.locked_at == 0 { return false; }
        let deadline = if self.expires_at > 0 {
            self.expires_at
        } else {
            self.locked_at + Self::BUYER_PAY_WINDOW
        };
        current_time > deadline
    }

    /// Check if trade is terminal (settled)
    pub fn is_terminal(&self) -> bool {
        matches!(self.status, TradeStatus::Released | TradeStatus::Refunded)
    }

    /// Check if escrow has expired
    pub fn is_expired(&self, current_time: i64) -> bool {
        self.expires_at > 0 && current_time >= self.expires_at
    }

    /// Check if escrow can be extended (only when funded or locked, not expired)
    /// Cannot extend after payment confirmed or in dispute
    pub fn can_extend(&self, current_time: i64) -> bool {
        matches!(self.status, TradeStatus::Funded | TradeStatus::Locked) &&
        !self.is_expired(current_time)
    }

    /// Check if this address is a party to the trade
    pub fn is_party(&self, address: &Pubkey) -> bool {
        *address == self.creator || *address == self.counterparty
    }
}
