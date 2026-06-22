use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as IX_SYSVAR_ID;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use crate::state::{
    ProtocolConfig, Trade, Escrow, OfferFill, Offer, Lane,
    TradeSide, TradeStatus,
};
use crate::errors::ErrorCode;
use crate::events::{OfferMatchedEvent, TradeCreatedEvent, TradeLockedEvent};
use crate::utils::ed25519::verify_ed25519_ix;

/// V2.2: ATOMIC offer matching via prefunded lane
///
/// This is the PRIMARY PATH for instant, one-click matching.
/// No merchant signature required at match time.
///
/// Flow:
/// 1. Verify Ed25519 signature on offer
/// 2. Validate lane can fulfill
/// 3. Create Trade + OfferFill + Escrow PDAs
/// 4. Transfer funds from LaneVault → TradeVault
/// 5. Update lane available_balance
/// All in ONE transaction, atomic.
#[derive(Accounts)]
#[instruction(params: MatchOfferAndLockFromLaneParams)]
pub struct MatchOfferAndLockFromLane<'info> {
    /// Matcher (pays PDA rent, anyone can match)
    #[account(mut)]
    pub matcher: Signer<'info>,

    /// CHECK: Offer creator (signature verified via ed25519)
    /// Also the lane merchant
    pub offer_creator: UncheckedAccount<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump
    )]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        mut,
        seeds = [
            Lane::SEED_PREFIX,
            offer_creator.key().as_ref(),
            params.lane_id.to_le_bytes().as_ref()
        ],
        bump = lane.bump,
        constraint = lane.merchant == offer_creator.key() @ ErrorCode::Unauthorized
    )]
    pub lane: Box<Account<'info, Lane>>,

    /// CHECK: Lane vault authority PDA
    #[account(
        seeds = [Lane::VAULT_AUTHORITY_PREFIX, lane.key().as_ref()],
        bump
    )]
    pub lane_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = lane_vault_ata.key() == lane.vault_ata,
        constraint = lane_vault_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub lane_vault_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = matcher,
        space = Trade::LEN,
        seeds = [
            Trade::SEED_PREFIX,
            offer_creator.key().as_ref(),
            params.trade_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub trade: Box<Account<'info, Trade>>,

    #[account(
        init,
        payer = matcher,
        space = Escrow::LEN,
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump
    )]
    pub escrow: Box<Account<'info, Escrow>>,

    /// CHECK: Trade vault authority PDA
    #[account(
        seeds = [Escrow::VAULT_AUTHORITY_PREFIX, escrow.key().as_ref()],
        bump
    )]
    pub trade_vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = matcher,
        associated_token::mint = mint,
        associated_token::authority = trade_vault_authority
    )]
    pub trade_vault_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = matcher,
        space = OfferFill::LEN,
        seeds = [OfferFill::SEED_PREFIX, params.offer_hash.as_ref()],
        bump
    )]
    pub offer_fill: Box<Account<'info, OfferFill>>,

    /// Mint must match lane's mint (verified in handler)
    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: Instructions sysvar — used to read the preceding Ed25519 ix
    #[account(address = IX_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Minimal params to reduce stack usage
/// The offer hash is verified client-side; we trust it if the signature is valid
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MatchOfferAndLockFromLaneParams {
    /// Lane ID for PDA derivation
    pub lane_id: u64,
    /// Trade ID for PDA derivation
    pub trade_id: u64,
    /// Amount to trade
    pub amount: u64,
    /// Trade side (0=Buy, 1=Sell)
    pub side: u8,
    /// Offer expiry timestamp
    pub expiry: i64,
    /// Ed25519 signature over offer hash
    pub signature: [u8; 64],
    /// Counterparty for the trade
    pub counterparty: Pubkey,
    /// Nonce from the signed Offer — required to reconstruct the hash on-chain.
    pub nonce: u64,
    /// Fee tier in bps from the signed Offer (V2.3.1) — required to
    /// reconstruct the canonical offer hash.
    pub fee_bps: u16,
    /// SHA256 hash of the canonical offer
    pub offer_hash: [u8; 32],
    /// Index (in the current tx) of the Ed25519Verify instruction.
    pub ed25519_ix_index: u16,
}

pub fn handler(
    ctx: Context<MatchOfferAndLockFromLane>,
    params: MatchOfferAndLockFromLaneParams,
) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let lane = &mut ctx.accounts.lane;
    let trade = &mut ctx.accounts.trade;
    let escrow = &mut ctx.accounts.escrow;
    let offer_fill = &mut ctx.accounts.offer_fill;
    let clock = Clock::get()?;
    let mint = &ctx.accounts.mint;

    // Check protocol not frozen
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Verify lane_id specifies a lane (> 0)
    require!(params.lane_id > 0, ErrorCode::NoLaneSpecified);

    // Verify lane matches params
    require!(params.lane_id == lane.lane_id, ErrorCode::InvalidLane);

    // Verify mint matches lane
    require!(mint.key() == lane.mint, ErrorCode::InvalidMint);

    // Verify offer not expired
    require!(params.expiry > clock.unix_timestamp, ErrorCode::OfferExpired);

    // Convert side from u8 to TradeSide (needed for hash reconstruction)
    let trade_side = if params.side == 0 {
        TradeSide::Buy
    } else {
        TradeSide::Sell
    };

    // Reject zero-amount matches up front.
    require!(params.amount > 0, ErrorCode::InvalidAmount);

    // CRITICAL: Rebuild the Offer exactly as the merchant signed it
    // (including the counterparty so the offer is bound to a specific
    // buyer), then require the hash to match. Without this, a matcher can
    // present any params alongside a signature for a DIFFERENT offer and
    // the program would execute with the matcher's params — a
    // bait-and-switch that could drain the lane.
    let reconstructed = Offer {
        creator: ctx.accounts.offer_creator.key(),
        counterparty: params.counterparty,
        mint: mint.key(),
        amount: params.amount,
        side: trade_side,
        trade_id: params.trade_id,
        expiry: params.expiry,
        nonce: params.nonce,
        lane_id: params.lane_id,
        fee_bps: params.fee_bps,
    };
    require!(
        reconstructed.hash() == params.offer_hash,
        ErrorCode::InvalidSignature
    );

    // V2.3.1 — validate signed fee tier within protocol bounds.
    config.validate_fee(params.fee_bps)?;

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

    // Validate lane can fulfill
    require!(lane.is_active, ErrorCode::LaneNotActive);
    require!(
        params.amount >= lane.min_amount && params.amount <= lane.max_amount,
        ErrorCode::AmountOutsideLaneBounds
    );
    require!(
        lane.available_balance >= params.amount,
        ErrorCode::InsufficientLaneBalance
    );

    // Initialize OfferFill PDA (replay protection)
    offer_fill.offer_hash = params.offer_hash;
    offer_fill.trade = trade.key();
    offer_fill.filled_at = clock.unix_timestamp;
    offer_fill.filler = ctx.accounts.matcher.key();
    offer_fill.bump = ctx.bumps.offer_fill;

    // Initialize Trade PDA
    trade.creator = ctx.accounts.offer_creator.key();
    trade.counterparty = params.counterparty;
    trade.trade_id = params.trade_id;
    trade.mint = mint.key();
    trade.amount = params.amount;
    trade.status = TradeStatus::Created; // Will update to Locked below
    trade.fee_bps = params.fee_bps; // V2.3.1: signed tier (validated above)
    trade.treasury = config.treasury; // Snapshot treasury at lock time
    trade.escrow_bump = ctx.bumps.escrow;
    trade.bump = ctx.bumps.trade;
    trade.created_at = clock.unix_timestamp;
    trade.locked_at = 0; // Will update below
    trade.settled_at = 0;
    trade.side = trade_side;

    // Emit TradeCreatedEvent
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

    // Initialize Escrow
    escrow.trade = trade.key();
    escrow.vault_authority = ctx.accounts.trade_vault_authority.key();
    escrow.vault_ata = ctx.accounts.trade_vault_ata.key();
    escrow.depositor = ctx.accounts.offer_creator.key(); // Lane merchant
    escrow.amount = params.amount;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.trade_vault_authority;

    // CRITICAL: Transfer funds from LaneVault → TradeVault (ATOMIC)
    let lane_key = lane.key();
    let lane_vault_seeds = &[
        Lane::VAULT_AUTHORITY_PREFIX,
        lane_key.as_ref(),
        &[lane.vault_bump],
    ];
    let lane_signer_seeds = &[&lane_vault_seeds[..]];

    let transfer_from_lane = Transfer {
        from: ctx.accounts.lane_vault_ata.to_account_info(),
        to: ctx.accounts.trade_vault_ata.to_account_info(),
        authority: ctx.accounts.lane_vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_from_lane,
        lane_signer_seeds,
    );
    token::transfer(cpi_ctx, params.amount)?;

    // Update lane available balance
    lane.reserve(params.amount)?;
    lane.updated_at = clock.unix_timestamp;

    // Update trade status to Locked + set expires_at consistently with
    // the two-step lock_escrow path (24h from lock).
    trade.status = TradeStatus::Locked;
    trade.locked_at = clock.unix_timestamp;
    trade.expires_at = clock
        .unix_timestamp
        .checked_add(Trade::DEFAULT_ESCROW_DURATION)
        .ok_or(ErrorCode::Overflow)?;

    // Emit events
    emit!(TradeLockedEvent {
        trade: trade.key(),
        counterparty: trade.counterparty,
        escrow: escrow.key(),
        vault_ata: escrow.vault_ata,
        depositor: escrow.depositor,
        amount: escrow.amount,
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
        "✅ Atomic match complete: trade={}, lane={}, amount={}, counterparty={}",
        trade.key(),
        lane.key(),
        params.amount,
        trade.counterparty
    );

    Ok(())
}

