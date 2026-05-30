use anchor_lang::prelude::*;

/// Escrow vault state
///
/// Seeds: [b"escrow-v2", trade_key]
#[account]
pub struct Escrow {
    /// Parent trade PDA
    pub trade: Pubkey,

    /// Vault authority PDA (signs token transfers)
    pub vault_authority: Pubkey,

    /// Token account holding escrowed funds
    pub vault_ata: Pubkey,

    /// Who deposited funds (for refund)
    pub depositor: Pubkey,

    /// Amount locked in vault
    pub amount: u64,

    /// Escrow PDA bump
    pub bump: u8,

    /// Vault authority bump
    pub vault_bump: u8,
}

impl Escrow {
    pub const LEN: usize = 8 + // discriminator
        32 + // trade
        32 + // vault_authority
        32 + // vault_ata
        32 + // depositor
        8 +  // amount
        1 +  // bump
        1;   // vault_bump

    /// Escrow PDA seeds prefix
    pub const SEED_PREFIX: &'static [u8] = b"escrow-v2";

    /// Vault authority PDA seeds prefix
    pub const VAULT_AUTHORITY_PREFIX: &'static [u8] = b"vault-authority-v2";
}
