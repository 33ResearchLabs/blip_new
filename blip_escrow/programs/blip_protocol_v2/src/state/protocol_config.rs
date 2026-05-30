use anchor_lang::prelude::*;

/// Global protocol configuration
///
/// Single instance controls fees, treasury, and protocol state.
/// Authority can update mutable fields but cannot touch user funds.
#[account]
pub struct ProtocolConfig {
    /// Protocol authority (can update config)
    pub authority: Pubkey,

    /// Protocol treasury (receives all fees - ENFORCED)
    pub treasury: Pubkey,

    /// Current protocol fee in basis points (250 = 2.5%)
    pub fee_bps: u16,

    /// Maximum allowed fee (immutable cap set at init)
    pub max_fee_bps: u16,

    /// Minimum allowed fee (immutable floor set at init)
    pub min_fee_bps: u16,

    /// PDA bump seed
    pub bump: u8,

    /// Emergency freeze (disables new trade creation)
    pub is_frozen: bool,

    /// Config version for future upgrades
    pub version: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + // discriminator
        32 + // authority
        32 + // treasury
        2 +  // fee_bps
        2 +  // max_fee_bps
        2 +  // min_fee_bps
        1 +  // bump
        1 +  // is_frozen
        1;   // version

    /// Protocol config PDA seeds
    pub const SEED_PREFIX: &'static [u8] = b"protocol-config";

    /// Validate fee is within bounds
    pub fn validate_fee(&self, fee_bps: u16) -> Result<()> {
        require!(
            fee_bps >= self.min_fee_bps && fee_bps <= self.max_fee_bps,
            crate::errors::ErrorCode::FeeOutOfBounds
        );
        Ok(())
    }

    /// Calculate fee and payout for given amount
    pub fn calculate_fee(&self, amount: u64) -> Result<(u64, u64)> {
        let fee = (amount as u128)
            .checked_mul(self.fee_bps as u128)
            .ok_or(crate::errors::ErrorCode::Overflow)?
            .checked_div(10_000)
            .ok_or(crate::errors::ErrorCode::Overflow)?
            as u64;

        let payout = amount
            .checked_sub(fee)
            .ok_or(crate::errors::ErrorCode::InsufficientAmount)?;

        Ok((payout, fee))
    }
}
