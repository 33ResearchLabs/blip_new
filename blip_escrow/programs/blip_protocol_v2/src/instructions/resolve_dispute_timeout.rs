use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};

use crate::state::{Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::DisputeResolvedEvent;

/// Permissionless fallback: if a trade has been Disputed for longer than
/// `Trade::DISPUTE_WINDOW` (72h) and no arbiter has acted, ANY caller may
/// trigger a safe refund to the original depositor. No fee is charged.
///
/// Safety: funds can ONLY go to `escrow.depositor` (depositor_ata.owner
/// constraint); rent goes to `trade.creator`. The caller chooses nothing.
#[derive(Accounts)]
pub struct ResolveDisputeTimeout<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        close = depositor,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump = trade.bump,
        constraint = trade.status == TradeStatus::Disputed @ ErrorCode::NotDisputed
    )]
    pub trade: Box<Account<'info, Trade>>,

    #[account(
        mut,
        close = depositor,
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
        has_one = trade
    )]
    pub escrow: Box<Account<'info, Escrow>>,

    /// CHECK: PDA signer for vault
    #[account(
        seeds = [Escrow::VAULT_AUTHORITY_PREFIX, escrow.key().as_ref()],
        bump = escrow.vault_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_ata.key() == escrow.vault_ata,
        constraint = vault_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub vault_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = depositor_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = depositor_ata.owner == escrow.depositor @ ErrorCode::InvalidDepositor
    )]
    pub depositor_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: rent destination, must equal escrow.depositor.
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ResolveDisputeTimeout>) -> Result<()> {
    let clock = Clock::get()?;
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;

    // disputed_at MUST be set (it is, by open_dispute).
    require!(trade.disputed_at > 0, ErrorCode::NotDisputed);
    require!(escrow.amount > 0, ErrorCode::InsufficientAmount);
    let deadline = trade
        .disputed_at
        .checked_add(Trade::DISPUTE_WINDOW)
        .ok_or(ErrorCode::Overflow)?;
    require!(clock.unix_timestamp >= deadline, ErrorCode::DisputeWindowActive);

    // Refund full amount to depositor — no fee, permissionless safety net.
    let escrow_key = escrow.key();
    let vault_seeds = &[
        Escrow::VAULT_AUTHORITY_PREFIX,
        escrow_key.as_ref(),
        &[escrow.vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.depositor_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        escrow.amount,
    )?;

    // Close vault ATA (rent → depositor — the party who paid for it)
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault_ata.to_account_info(),
            destination: ctx.accounts.depositor.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    trade.status = TradeStatus::Refunded;
    trade.settled_at = clock.unix_timestamp;

    emit!(DisputeResolvedEvent {
        trade: trade.key(),
        arbiter: ctx.accounts.signer.key(), // caller (permissionless)
        resolution: 1,                       // RefundToSeller semantics
        recipient: escrow.depositor,
        amount: escrow.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!("Dispute auto-resolved after timeout: refunded to depositor");
    Ok(())
}
