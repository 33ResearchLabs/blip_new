use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use crate::state::{ProtocolConfig, Trade, Escrow, TradeSide, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::{TradeCreatedEvent, TradeFundedEvent};

/// `create_and_fund` — Create a trade and fund its escrow in a single transaction.
///
/// Saves one transaction fee (~$0.00080) and one round-trip vs the
/// separate `create_trade` + `fund_escrow` flow. Semantically identical:
/// after this instruction the trade is in `Funded` state with no counterparty,
/// open for anyone to `accept_trade`.
#[derive(Accounts)]
#[instruction(params: CreateAndFundParams)]
pub struct CreateAndFund<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = creator,
        space = Trade::LEN,
        seeds = [
            Trade::SEED_PREFIX,
            creator.key().as_ref(),
            params.trade_id.to_le_bytes().as_ref(),
        ],
        bump
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        init,
        payer = creator,
        space = Escrow::LEN,
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer for vault
    #[account(
        seeds = [Escrow::VAULT_AUTHORITY_PREFIX, escrow.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = creator_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = creator_ata.owner == creator.key()
    )]
    pub creator_ata: Account<'info, TokenAccount>,

    #[account(constraint = mint.key() == params.mint @ ErrorCode::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateAndFundParams {
    pub trade_id: u64,
    pub amount: u64,
    pub side: TradeSide,
    /// Fee tier in basis points — validated against protocol [min, max].
    pub fee_bps: u16,
    /// Mint of the token being escrowed.
    pub mint: Pubkey,
    /// How long the listing stays open for acceptance (seconds).
    /// None = 24h default. Min 60s, max 7 days.
    pub escrow_duration_secs: Option<i64>,
}

pub fn handler(ctx: Context<CreateAndFund>, params: CreateAndFundParams) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);
    require!(params.amount > 0, ErrorCode::InvalidAmount);
    config.validate_fee(params.fee_bps)?;

    // --- Init Trade ---
    trade.creator = ctx.accounts.creator.key();
    trade.counterparty = Pubkey::default();
    trade.trade_id = params.trade_id;
    trade.mint = params.mint;
    trade.amount = params.amount;
    trade.status = TradeStatus::Funded;
    trade.fee_bps = params.fee_bps;
    trade.treasury = config.treasury;
    trade.bump = ctx.bumps.trade;
    trade.created_at = clock.unix_timestamp;
    trade.locked_at = 0;
    trade.settled_at = 0;
    trade.side = params.side;
    trade.expires_at = 0;
    trade.payment_confirmed_at = 0;
    trade.disputed_at = 0;
    trade.dispute_initiator = Pubkey::default();

    // --- Init Escrow ---
    escrow.trade = trade.key();
    escrow.vault_authority = ctx.accounts.vault_authority.key();
    escrow.vault_ata = ctx.accounts.vault_ata.key();
    escrow.depositor = ctx.accounts.creator.key();
    escrow.amount = params.amount;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault_authority;
    trade.escrow_bump = escrow.bump;

    // --- Token transfer to vault ---
    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.creator_ata.to_account_info(),
            to: ctx.accounts.vault_ata.to_account_info(),
            authority: ctx.accounts.creator.to_account_info(),
        },
    );
    token::transfer(cpi_ctx, params.amount)?;

    // --- Set listing expiry ---
    let duration = params.escrow_duration_secs
        .unwrap_or(Trade::DEFAULT_ESCROW_DURATION)
        .max(60)
        .min(Trade::MAX_TOTAL_LIFETIME);
    trade.expires_at = clock.unix_timestamp.checked_add(duration).ok_or(ErrorCode::Overflow)?;

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
    emit!(TradeFundedEvent {
        trade: trade.key(),
        escrow: escrow.key(),
        vault_ata: escrow.vault_ata,
        depositor: escrow.depositor,
        amount: escrow.amount,
        expires_at: trade.expires_at,
        timestamp: clock.unix_timestamp,
    });

    msg!("Trade created+funded: id={}, amount={}, expires_at={}", trade.trade_id, params.amount, trade.expires_at);
    Ok(())
}
