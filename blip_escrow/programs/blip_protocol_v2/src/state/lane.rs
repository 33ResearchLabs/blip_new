use anchor_lang::prelude::*;

/// Liquidity Lane - Merchant's prefunded vault for instant matching
///
/// Seeds: [b"lane-v2", merchant, lane_id.to_le_bytes()]
#[account]
pub struct Lane {
    /// Lane owner (merchant)
    pub merchant: Pubkey,

    /// Lane ID (unique per merchant)
    pub lane_id: u64,

    /// Token mint
    pub mint: Pubkey,

    /// Lane vault authority PDA
    pub vault_authority: Pubkey,

    /// Lane vault token account
    pub vault_ata: Pubkey,

    /// Available balance (tracked on-chain)
    pub available_balance: u64,

    /// Minimum order amount
    pub min_amount: u64,

    /// Maximum order amount
    pub max_amount: u64,

    /// Is lane active (merchant can pause)
    pub is_active: bool,

    /// Lane PDA bump
    pub bump: u8,

    /// Vault authority bump
    pub vault_bump: u8,

    /// Created timestamp
    pub created_at: i64,

    /// Last updated timestamp
    pub updated_at: i64,
}

impl Lane {
    pub const LEN: usize = 8 + // discriminator
        32 + // merchant
        8 +  // lane_id
        32 + // mint
        32 + // vault_authority
        32 + // vault_ata
        8 +  // available_balance
        8 +  // min_amount
        8 +  // max_amount
        1 +  // is_active
        1 +  // bump
        1 +  // vault_bump
        8 +  // created_at
        8;   // updated_at

    /// Lane PDA seeds prefix
    pub const SEED_PREFIX: &'static [u8] = b"lane-v2";

    /// Lane vault authority PDA seeds prefix
    pub const VAULT_AUTHORITY_PREFIX: &'static [u8] = b"lane-vault-authority-v2";

    /// Check if lane can fulfill amount
    pub fn can_fulfill(&self, amount: u64) -> bool {
        self.is_active
            && amount >= self.min_amount
            && amount <= self.max_amount
            && self.available_balance >= amount
    }

    /// Reserve amount (decreases available balance)
    pub fn reserve(&mut self, amount: u64) -> Result<()> {
        self.available_balance = self
            .available_balance
            .checked_sub(amount)
            .ok_or(crate::errors::ErrorCode::InsufficientLaneBalance)?;
        Ok(())
    }

    /// Release reserved amount (increases available balance)
    pub fn release(&mut self, amount: u64) -> Result<()> {
        self.available_balance = self
            .available_balance
            .checked_add(amount)
            .ok_or(crate::errors::ErrorCode::Overflow)?;
        Ok(())
    }
}
