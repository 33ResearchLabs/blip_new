use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as IX_SYSVAR_ID;
use crate::state::{
    ProtocolConfig, Trade, OfferFill, Offer,
    TradeSide, TradeStatus,
};
use crate::errors::ErrorCode;
use crate::events::{OfferMatchedEvent, TradeCreatedEvent};
use crate::utils::ed25519::verify_ed25519_ix;

/// Match a signed offer (creates Trade + OfferFill PDAs)
///
/// NOTE: This is a TWO-STEP flow:
/// 1. match_offer (this instruction) - verifies signature, creates PDAs
/// 2. lock_escrow (separate call by offer_creator) - funds the escrow
///
/// This design avoids the authority problem: matcher cannot transfer
/// FROM offer_creator's token account without their signature.
#[derive(Accounts)]
#[instruction(params: MatchOfferParams)]
pub struct MatchOffer<'info> {
    /// Matcher (pays PDA rent, anyone can match valid offers)
    #[account(mut)]
    pub matcher: Signer<'info>,

    /// CHECK: Offer creator (signature verified via ed25519)
    pub offer_creator: UncheckedAccount<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = matcher,
        space = Trade::LEN,
        seeds = [
            Trade::SEED_PREFIX,
            offer_creator.key().as_ref(),
            params.offer.trade_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        init,
        payer = matcher,
        space = OfferFill::LEN,
        seeds = [OfferFill::SEED_PREFIX, params.offer_hash.as_ref()],
        bump
    )]
    pub offer_fill: Account<'info, OfferFill>,

    /// CHECK: Instructions sysvar — used to read the preceding Ed25519 ix
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MatchOfferParams {
    pub offer: Offer,
    pub signature: [u8; 64],
    pub counterparty: Pubkey,
    pub offer_hash: [u8; 32],
    /// Index (in the current tx) of the Ed25519Verify instruction that
    /// binds offer_creator/pubkey, offer_hash, signature.
    pub ed25519_ix_index: u16,
}

pub fn handler(ctx: Context<MatchOffer>, params: MatchOfferParams) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let offer_fill = &mut ctx.accounts.offer_fill;
    let clock = Clock::get()?;

    // Check protocol not frozen
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Verify offer hash matches
    let computed_hash = params.offer.hash();
    require!(
        computed_hash == params.offer_hash,
        ErrorCode::InvalidSignature
    );

    // Verify offer not expired
    require!(
        params.offer.is_valid(clock.unix_timestamp),
        ErrorCode::OfferExpired
    );

    // Verify offer creator matches
    require!(
        params.offer.creator == ctx.accounts.offer_creator.key(),
        ErrorCode::InvalidSignature
    );

    // V2.3 — counterparty must match the value bound to the signed offer.
    // Without this, an attacker who observes the signed offer can race to
    // match it with their own address, locking out the intended buyer.
    require!(
        params.counterparty == params.offer.counterparty,
        ErrorCode::CounterpartyMismatch
    );

    // Reject zero-amount offers.
    require!(params.offer.amount > 0, ErrorCode::InvalidAmount);

    // V2.3.1 — validate the signed fee tier is within protocol bounds.
    // The merchant chose this tier at signing time; we verify it's allowed
    // by current protocol config. Snapshotted onto the Trade below.
    config.validate_fee(params.offer.fee_bps)?;

    // Verify Ed25519 inner ix is present and cryptographically binds the
    // expected (pubkey, message, signature).
    verify_ed25519_ix(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        params.ed25519_ix_index,
        &ctx.accounts.offer_creator.key().to_bytes(),
        &params.offer_hash,
        &params.signature,
    )?;

    // Validate counterparty
    require!(
        params.counterparty != Pubkey::default(),
        ErrorCode::InvalidCounterparty
    );

    // Initialize OfferFill PDA (replay protection)
    offer_fill.offer_hash = params.offer_hash;
    offer_fill.trade = trade.key();
    offer_fill.filled_at = clock.unix_timestamp;
    offer_fill.filler = ctx.accounts.matcher.key();
    offer_fill.bump = ctx.bumps.offer_fill;

    // Initialize Trade PDA (status = Created, must call lock_escrow next)
    trade.creator = ctx.accounts.offer_creator.key();
    trade.counterparty = params.counterparty;
    trade.trade_id = params.offer.trade_id;
    trade.mint = params.offer.mint;
    trade.amount = params.offer.amount;
    trade.status = TradeStatus::Created; // NOT Locked until lock_escrow called
    trade.fee_bps = params.offer.fee_bps; // V2.3.1: signed tier (validated above)
    trade.treasury = config.treasury; // Snapshot treasury at match time (V2.3)
    trade.escrow_bump = 0; // Set by lock_escrow
    trade.bump = ctx.bumps.trade;
    trade.created_at = clock.unix_timestamp;
    trade.locked_at = 0;
    trade.settled_at = 0;
    trade.side = params.offer.side;

    // Emit events
    emit!(TradeCreatedEvent {
        trade: trade.key(),
        creator: trade.creator,
        trade_id: trade.trade_id,
        mint: trade.mint,
        amount: trade.amount,
        side: trade.side,
        fee_bps: trade.fee_bps,
        timestamp: clock.unix_timestamp,
    });

    emit!(OfferMatchedEvent {
        trade: trade.key(),
        offer_hash: params.offer_hash,
        offer_creator: ctx.accounts.offer_creator.key(),
        matcher: ctx.accounts.matcher.key(),
        counterparty: params.counterparty,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "✅ Offer matched: trade={}, offer_creator={}, counterparty={}",
        trade.key(),
        ctx.accounts.offer_creator.key(),
        params.counterparty
    );
    msg!(
        "⚠️  NEXT STEP: Offer creator must call lock_escrow to fund the trade"
    );

    Ok(())
}

