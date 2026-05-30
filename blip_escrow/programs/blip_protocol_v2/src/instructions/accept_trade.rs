use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeAcceptedEvent;

/// Accept a funded trade as the counterparty.
/// This transitions the trade from Funded → Locked.
///
/// Flow:
/// 1. Creator calls `create_trade` (status = Created)
/// 2. Creator calls `fund_escrow` (status = Funded, escrow funded, no counterparty)
/// 3. Counterparty calls `accept_trade` (status = Locked, counterparty set) ← THIS
/// 4. Creator calls `release_escrow` to complete the trade
#[derive(Accounts)]
pub struct AcceptTrade<'info> {
    /// The party accepting/joining the trade as counterparty
    #[account(mut)]
    pub acceptor: Signer<'info>,

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
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump,
        constraint = escrow.trade == trade.key()
    )]
    pub escrow: Account<'info, Escrow>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AcceptTrade>) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let acceptor = &ctx.accounts.acceptor;
    let clock = Clock::get()?;

    // Protocol freeze gate (pause new acceptances).
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Validate trade state - must be Funded (escrow exists, no counterparty)
    require!(trade.can_accept(), ErrorCode::CannotAccept);

    // V2.3: don't let a buyer accept an already-expired Funded offer —
    // the seller may already be calling refund_escrow against it. Pure
    // UX hardening; no fund-loss case, but avoids a race with the
    // permissionless-Funded-refund path.
    require!(
        !trade.is_expired(clock.unix_timestamp),
        ErrorCode::OfferExpired
    );

    // Cannot accept your own trade
    require!(
        acceptor.key() != trade.creator,
        ErrorCode::CannotAcceptOwnTrade
    );

    // Update trade state
    trade.counterparty = acceptor.key();
    trade.status = TradeStatus::Locked;
    trade.locked_at = clock.unix_timestamp;

    // Emit event
    emit!(TradeAcceptedEvent {
        trade: trade.key(),
        escrow: escrow.key(),
        counterparty: acceptor.key(),
        creator: trade.creator,
        amount: escrow.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Trade accepted: trade={}, counterparty={}, amount={}",
        trade.key(),
        acceptor.key(),
        escrow.amount
    );
    msg!(
        "Trade is now locked. Creator can release_escrow to counterparty."
    );

    Ok(())
}
