use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use crate::state::{ProtocolConfig, Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeFundedEvent;

/// Fund escrow WITHOUT specifying counterparty.
/// The counterparty will be set later via `accept_trade`.
///
/// Flow:
/// 1. Creator calls `create_trade` (status = Created)
/// 2. Creator calls `fund_escrow` (status = Funded, escrow funded, no counterparty)
/// 3. Any party calls `accept_trade` to join (status = Locked, counterparty set)
#[derive(Accounts)]
pub struct FundEscrow<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump,
        constraint = trade.creator == depositor.key() @ ErrorCode::Unauthorized
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        init,
        payer = depositor,
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
        payer = depositor,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = depositor_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = depositor_ata.owner == depositor.key()
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundEscrow>) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Protocol freeze gate (pause new fundings).
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Validate trade state - must be Created
    require!(trade.can_fund(), ErrorCode::CannotFund);

    // Reject zero-amount trades.
    require!(trade.amount > 0, ErrorCode::InvalidAmount);

    // Initialize escrow
    escrow.trade = trade.key();
    escrow.vault_authority = ctx.accounts.vault_authority.key();
    escrow.vault_ata = ctx.accounts.vault_ata.key();
    escrow.depositor = ctx.accounts.depositor.key();
    escrow.amount = trade.amount;
    escrow.bump = ctx.bumps.escrow;
    escrow.vault_bump = ctx.bumps.vault_authority;

    // Transfer tokens to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.depositor_ata.to_account_info(),
        to: ctx.accounts.vault_ata.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer(cpi_ctx, trade.amount)?;

    // Update trade state - Funded (counterparty still default)
    trade.status = TradeStatus::Funded;
    trade.escrow_bump = escrow.bump;
    // Set expiration (default 24 hours from funding)
    trade.expires_at = clock
        .unix_timestamp
        .checked_add(Trade::DEFAULT_ESCROW_DURATION)
        .ok_or(ErrorCode::Overflow)?;
    // Note: counterparty remains Pubkey::default() until accept_trade

    // Emit event
    emit!(TradeFundedEvent {
        trade: trade.key(),
        escrow: escrow.key(),
        vault_ata: escrow.vault_ata,
        depositor: escrow.depositor,
        amount: escrow.amount,
        expires_at: trade.expires_at,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Escrow funded (open for acceptance): trade={}, amount={}",
        trade.key(),
        escrow.amount
    );
    msg!(
        "Next: Any party can call accept_trade to join as counterparty"
    );

    Ok(())
}
