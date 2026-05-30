use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use crate::state::{Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeRefundedEvent;

/// State-aware refund.
///
/// Authorization matrix (now satisfies "any non-final state must be
/// recoverable without coordination" for Funded + Locked):
///
///   Funded, pre-expiry        : seller/depositor only
///   Funded, post-expiry       : ANYONE (permissionless auto-refund)
///   Locked, pre-window        : BLOCKED (BuyerPayWindowActive)
///   Locked, post-window       : ANYONE (permissionless hard timeout)
///   PaymentSent               : BLOCKED (must use dispute)
///   Disputed                  : BLOCKED (use resolve_dispute or
///                               resolve_dispute_timeout after 72h)
///   Released / Refunded       : BLOCKED (terminal)
///
/// Funds always and only move to `escrow.depositor` via the
/// `depositor_ata.owner == escrow.depositor` Anchor constraint.
#[derive(Accounts)]
pub struct RefundEscrow<'info> {
    /// Signer — authorization is state-dependent (checked in handler).
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
        bump = trade.bump
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        mut,
        close = depositor,
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
        has_one = trade
    )]
    pub escrow: Account<'info, Escrow>,

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
    pub vault_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = depositor_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = depositor_ata.owner == escrow.depositor @ ErrorCode::InvalidDepositor
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    /// CHECK: Rent refund recipient — must equal escrow.depositor.
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RefundEscrow>) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let signer = ctx.accounts.signer.key();
    let is_seller = signer == trade.creator || signer == escrow.depositor;

    // Double-refund / zero-amount guard. If the Anchor account is loadable
    // but amount has been zeroed (e.g. by a pathological upgrade), reject.
    // Terminal states are also explicitly blocked below.
    require!(escrow.amount > 0, ErrorCode::CannotRefund);

    let refund_type: &str = match trade.status {
        TradeStatus::Created => {
            // Defensive: an initialized Escrow with status=Created should not
            // exist (fund_escrow transitions to Funded atomically). Treat as
            // pre-counterparty cancel: seller only.
            require!(is_seller, ErrorCode::Unauthorized);
            "created_cancel"
        }

        TradeStatus::Funded => {
            if trade.can_auto_refund(now) {
                // Permissionless — Funded has no counterparty; safe for anyone.
                "auto_refund_expired"
            } else {
                require!(is_seller, ErrorCode::Unauthorized);
                "seller_cancel"
            }
        }

        TradeStatus::Locked => {
            if trade.can_anyone_refund_locked(now) {
                // Hard, permissionless timeout. Funds can only go to
                // `escrow.depositor` by Anchor constraint.
                "auto_refund_locked_window_elapsed"
            } else {
                // Pre-window: only the seller may cancel, and only after
                // buyer_pay_window — but can_anyone_refund_locked above is
                // true iff the same condition holds, so this branch is the
                // seller-only *early* path which is now redundant. Keep as
                // the explicit block for pre-window attempts.
                require!(is_seller, ErrorCode::Unauthorized);
                require!(
                    trade.can_seller_cancel(now),
                    ErrorCode::BuyerPayWindowActive
                );
                // Unreachable in practice because can_anyone_refund_locked
                // uses the same predicate, but kept explicit for clarity.
                "seller_cancel_after_window"
            }
        }

        TradeStatus::PaymentSent => {
            // Buyer has claimed fiat sent. Refunding now would steal fiat.
            return Err(ErrorCode::MustUseDispute.into());
        }

        TradeStatus::Disputed => {
            // Use resolve_dispute (arbiter) or resolve_dispute_timeout (72h).
            return Err(ErrorCode::MustUseDispute.into());
        }

        TradeStatus::Released | TradeStatus::Refunded => {
            return Err(ErrorCode::CannotRefund.into());
        }
    };

    // PDA signer seeds
    let escrow_key = escrow.key();
    let vault_seeds = &[
        Escrow::VAULT_AUTHORITY_PREFIX,
        escrow_key.as_ref(),
        &[escrow.vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    // Transfer full amount back to depositor (no fee on refund).
    let transfer_refund = Transfer {
        from: ctx.accounts.vault_ata.to_account_info(),
        to: ctx.accounts.depositor_ata.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_refund,
        signer_seeds,
    );
    token::transfer(cpi_ctx, escrow.amount)?;

    // Close vault ATA (rent → depositor — the party who paid for it)
    let close_vault = CloseAccount {
        account: ctx.accounts.vault_ata.to_account_info(),
        destination: ctx.accounts.depositor.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        close_vault,
        signer_seeds,
    );
    token::close_account(cpi_ctx)?;

    // Finalize trade — this + the escrow close() above make a replay
    // impossible: Anchor will fail to deserialize the closed escrow on any
    // subsequent invocation.
    trade.status = TradeStatus::Refunded;
    trade.settled_at = now;

    emit!(TradeRefundedEvent {
        trade: trade.key(),
        depositor: escrow.depositor,
        amount: escrow.amount,
        timestamp: now,
    });

    msg!(
        "Escrow refunded ({}): trade={}, depositor={}, amount={}",
        refund_type,
        trade.key(),
        escrow.depositor,
        escrow.amount
    );

    Ok(())
}
