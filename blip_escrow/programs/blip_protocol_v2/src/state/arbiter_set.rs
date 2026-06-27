use anchor_lang::prelude::*;

/// Allowlist of wallets authorized to resolve disputes (in addition to the
/// protocol authority). Lets a set of compliance officers each resolve disputes
/// without sharing one key. Managed by the protocol authority via set_arbiters.
///
/// Seeds: [b"arbiter-set"]
#[account]
pub struct ArbiterSet {
    /// Who can update this list (the protocol authority).
    pub authority: Pubkey,
    /// Authorized arbiter wallets (fixed slots; `count` are active).
    pub arbiters: [Pubkey; ArbiterSet::MAX],
    pub count: u8,
    pub bump: u8,
}

impl ArbiterSet {
    pub const MAX: usize = 10;
    pub const LEN: usize = 8 + 32 + (32 * Self::MAX) + 1 + 1;
    pub const SEED: &'static [u8] = b"arbiter-set";

    pub fn contains(&self, key: &Pubkey) -> bool {
        self.arbiters[..self.count as usize].iter().any(|a| a == key)
    }
}
