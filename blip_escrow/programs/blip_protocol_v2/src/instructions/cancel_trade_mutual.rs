use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use crate::state::{Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeRefundedEvent;

/// Mutual cancellation — BOTH parties sign and funds are immediately refunded
/// to the depositor. Allowed only when the trade has NOT progressed past
/// Locked (PaymentSent/Disputed/terminal are explicitly blocked because the
/// buyer's fiat is at risk beyond those states).
///
/// - Funded state: counterparty is not yet set (trade.counterparty == default).
///   In this case the counterparty_signer constraint is satisfied if it equals
///   the creator — practically this means the creator co-signs with itself.
///   This keeps the happy-path API uniform; most callers will use
///   `refund_escrow` directly in Funded.
/// - Locked state: counterparty_signer MUST match trade.counterparty and
///   creator_signer MUST match trade.creator. Both real keys sign.
#[derive(Accounts)]
pub struct CancelTradeMutual<'info> {
    /// Trade creator (seller). Must sign.
    #[account(
        mut,
        constraint = creator_signer.key() == trade.creator @ ErrorCode::Unauthorized
    )]
    pub creator_signer: Signer<'info>,

    /// Trade counterparty (buyer). Must sign. In Funded state counterparty
    /// has not yet been set (== default); we allow creator_signer to fill
    /// this slot. In Locked state this MUST be the real counterparty.
    #[account(
        mut,
        constraint = (
            (trade.status == TradeStatus::Funded
                && counterparty_signer.key() == creator_signer.key())
            || (trade.status == TradeStatus::Locked
                && counterparty_signer.key() == trade.counterparty)
        ) @ ErrorCode::Unauthorized
    )]
    pub counterparty_signer: Signer<'info>,

    #[account(
        mut,
        close = depositor,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump = trade.bump
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

    /// CHECK: Rent refund recipient — must equal escrow.depositor.
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<CancelTradeMutual>) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Explicit allow-list — cannot mutually cancel after PaymentSent.
    match trade.status {
        TradeStatus::Funded | TradeStatus::Locked => {}
        TradeStatus::PaymentSent | TradeStatus::Disputed => {
            return Err(ErrorCode::MustUseDispute.into());
        }
        _ => return Err(ErrorCode::CannotRefund.into()),
    }

    require!(escrow.amount > 0, ErrorCode::CannotRefund);

    // PDA signer seeds
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

    emit!(TradeRefundedEvent {
        trade: trade.key(),
        depositor: escrow.depositor,
        amount: escrow.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Mutual cancel: trade={}, depositor={}, amount={}",
        trade.key(),
        escrow.depositor,
        escrow.amount
    );

    Ok(())
}
