use anchor_lang::prelude::*;

/// Offer fill record (replay protection for v2.1)
///
/// Seeds: [b"offer-fill", offer_hash]
#[account]
pub struct OfferFill {
    /// Hash of the canonical offer
    pub offer_hash: [u8; 32],

    /// Trade that consumed this offer
    pub trade: Pubkey,

    /// Timestamp when filled
    pub filled_at: i64,

    /// Who matched the offer
    pub filler: Pubkey,

    /// PDA bump
    pub bump: u8,
}

impl OfferFill {
    pub const LEN: usize = 8 + // discriminator
        32 + // offer_hash
        32 + // trade
        8 +  // filled_at
        32 + // filler
        1;   // bump

    /// OfferFill PDA seeds prefix
    pub const SEED_PREFIX: &'static [u8] = b"offer-fill";
}

/// Canonical offer structure for signing
///
/// This MUST be serialized identically across all clients
/// to ensure signature verification works.
///
/// V2.3: Added `counterparty` so offers are bound to the intended buyer at
/// signature time. Without this binding, an attacker who observes a signed
/// offer can race to match it with `params.counterparty = attacker`,
/// consuming the OfferFill PDA and locking out the intended buyer.
///
/// V2.3.1: Added `fee_bps` so the merchant's signed offer commits to a
/// specific fee tier within the protocol's [min_fee_bps, max_fee_bps] range.
/// Without this, a matcher could submit the offer with a different (lower)
/// fee than the merchant intended. Domain separator bumped to \x02 because
/// the Offer layout changed — old SDK signatures will not validate.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Offer {
    /// Offer creator (signer)
    pub creator: Pubkey,

    /// Counterparty the offer is bound to (the intended buyer).
    /// Must equal `params.counterparty` at match time.
    pub counterparty: Pubkey,

    /// Token mint
    pub mint: Pubkey,

    /// Token amount
    pub amount: u64,

    /// Trade side (buy/sell)
    pub side: crate::state::TradeSide,

    /// Trade ID (unique per creator)
    pub trade_id: u64,

    /// Expiry timestamp (unix seconds)
    pub expiry: i64,

    /// Nonce for uniqueness
    pub nonce: u64,

    /// Lane ID (v2.2) - 0 means no lane (fallback to two-step)
    pub lane_id: u64,

    /// Fee tier in basis points (V2.3.1). The merchant commits to a tier at
    /// signing time; the program validates it falls within the protocol's
    /// [min_fee_bps, max_fee_bps] range and snapshots it onto the Trade so
    /// future config changes don't affect this trade. Typical tiers:
    /// 150 = 1.5% (cheap), 200 = 2% (standard), 250 = 2.5% (priority).
    pub fee_bps: u16,
}

impl Offer {
    /// Domain separator for offer hashing. Prevents cross-program /
    /// cross-version / cross-chain replay of signed offers. Bumped if the
    /// canonical Offer layout ever changes (e.g. fields added).
    /// \x01 = V2.3 (counterparty added)
    /// \x02 = V2.3.1 (fee_bps added)
    pub const DOMAIN_SEPARATOR: &'static [u8] = b"BLIP-V2-OFFER\x02";

    /// Serialize offer to canonical bytes for hashing/signing
    ///
    /// CRITICAL: This must produce identical bytes across all clients.
    /// Use Borsh serialization for determinism.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.try_to_vec().unwrap()
    }

    /// Hash the canonical offer with domain separation. The signed digest
    /// is `H(DOMAIN_SEPARATOR || borsh(offer))`.
    pub fn hash(&self) -> [u8; 32] {
        use solana_program::hash::hashv;
        hashv(&[Self::DOMAIN_SEPARATOR, &self.to_bytes()]).to_bytes()
    }

    /// Verify offer hasn't expired
    pub fn is_valid(&self, current_timestamp: i64) -> bool {
        self.expiry > current_timestamp
    }

    /// Check if offer uses lane (v2.2 atomic matching)
    pub fn uses_lane(&self) -> bool {
        self.lane_id > 0
    }
}
