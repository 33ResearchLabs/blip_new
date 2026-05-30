use anchor_lang::prelude::*;
use crate::state::{Trade, Escrow};
use crate::errors::ErrorCode;
use crate::events::TradeExtendedEvent;

/// Parameters for extending escrow expiration
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ExtendEscrowParams {
    /// Additional seconds to extend (e.g., 86400 for 24 hours)
    pub extension_seconds: i64,
}

/// Extend escrow expiration time.
/// Only the depositor (who funded the escrow) can extend it.
/// Cannot extend if already expired.
#[derive(Accounts)]
pub struct ExtendEscrow<'info> {
    /// Depositor who funded the escrow (must be signer)
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump = trade.bump
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
        has_one = trade,
        constraint = escrow.depositor == depositor.key() @ ErrorCode::NotDepositor
    )]
    pub escrow: Account<'info, Escrow>,
}

pub fn handler(ctx: Context<ExtendEscrow>, params: ExtendEscrowParams) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let clock = Clock::get()?;

    // Validate trade can be extended (not expired, in Funded or Locked state)
    require!(trade.can_extend(clock.unix_timestamp), ErrorCode::CannotExtend);

    // Extension must be strictly positive. `checked_add` on a negative i64
    // would also reject, but an explicit check gives a useful error code.
    require!(params.extension_seconds > 0, ErrorCode::InvalidExtension);

    let old_expires_at = trade.expires_at;

    // Compute new expiry with checked arithmetic.
    let new_expires_at = old_expires_at
        .checked_add(params.extension_seconds)
        .ok_or(ErrorCode::Overflow)?;

    // Hard ceiling on total trade lifetime — cannot extend past
    // `created_at + MAX_TOTAL_LIFETIME`. Prevents indefinite depositor grief.
    let max_expires_at = trade
        .created_at
        .checked_add(Trade::MAX_TOTAL_LIFETIME)
        .ok_or(ErrorCode::Overflow)?;
    require!(
        new_expires_at <= max_expires_at,
        ErrorCode::ExtensionTooLong
    );

    trade.expires_at = new_expires_at;

    emit!(TradeExtendedEvent {
        trade: trade.key(),
        depositor: ctx.accounts.depositor.key(),
        old_expires_at,
        new_expires_at: trade.expires_at,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Escrow extended: trade={}, old_expires={}, new_expires={}, ceiling={}",
        trade.key(),
        old_expires_at,
        trade.expires_at,
        max_expires_at
    );

    Ok(())
}
