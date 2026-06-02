use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};
use crate::state::{ProtocolConfig, Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeLockedEvent;

#[derive(Accounts)]
pub struct LockEscrow<'info> {
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
        bump
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

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct LockEscrowParams {
    pub counterparty: Pubkey,
    /// Listing duration in seconds (Funded→expiry). None = 24h default.
    pub escrow_duration_secs: Option<i64>,
    /// How long the buyer has to complete fiat payment after locking (seconds).
    /// None = default 4h. Min 5 min, max 24h.
    pub payment_window_secs: Option<u64>,
}

pub fn handler(
    ctx: Context<LockEscrow>,
    params: LockEscrowParams,
) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let escrow = &mut ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Protocol freeze gate (pause new lock-ins).
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Validate trade state
    require!(trade.can_lock(), ErrorCode::CannotLock);

    // Reject zero-amount trades.
    require!(trade.amount > 0, ErrorCode::InvalidAmount);

    // Validate counterparty not default
    require!(
        params.counterparty != Pubkey::default(),
        ErrorCode::InvalidCounterparty
    );

    // V2.3 — if a previous step (e.g. match_offer) has already bound a
    // counterparty to the trade, the depositor cannot silently overwrite
    // it. Either accept the bound counterparty or reject. Allows the
    // legacy direct-lock flow (counterparty == default) unchanged.
    require!(
        trade.counterparty == Pubkey::default()
            || trade.counterparty == params.counterparty,
        ErrorCode::CounterpartyMismatch
    );

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

    // Update trade state
    trade.counterparty = params.counterparty;
    trade.status = TradeStatus::Locked;
    trade.locked_at = clock.unix_timestamp;
    trade.escrow_bump = escrow.bump;
    // Set expires_at to the payment window deadline.
    // In Locked state expires_at = when buyer must complete payment by.
    let window = params.payment_window_secs
        .unwrap_or(Trade::BUYER_PAY_WINDOW as u64)
        .max(5 * 60)        // min 5 minutes
        .min(24 * 60 * 60)  // max 24 hours
        as i64;
    trade.expires_at = clock
        .unix_timestamp
        .checked_add(window)
        .ok_or(ErrorCode::Overflow)?;

    // Emit event
    emit!(TradeLockedEvent {
        trade: trade.key(),
        counterparty: trade.counterparty,
        escrow: escrow.key(),
        vault_ata: escrow.vault_ata,
        depositor: escrow.depositor,
        amount: escrow.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Escrow locked: trade={}, counterparty={}, amount={}",
        trade.key(),
        trade.counterparty,
        escrow.amount
    );

    Ok(())
}
