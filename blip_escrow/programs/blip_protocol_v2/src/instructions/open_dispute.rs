use anchor_lang::prelude::*;
use crate::state::{Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::DisputeOpenedEvent;

/// Open a dispute on a trade.
/// Can be called by either party (seller or buyer) when trade is Locked or PaymentSent.
///
/// Transitions trade to Disputed state, freezing funds until arbiter resolves.
#[derive(Accounts)]
pub struct OpenDispute<'info> {
    /// Party initiating the dispute (must be seller or buyer)
    #[account(mut)]
    pub initiator: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump = trade.bump
    )]
    pub trade: Box<Account<'info, Trade>>,

    #[account(
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
        has_one = trade
    )]
    pub escrow: Box<Account<'info, Escrow>>,
}

pub fn handler(ctx: Context<OpenDispute>) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let initiator = ctx.accounts.initiator.key();

    // Validate trade can be disputed
    require!(trade.can_dispute(), ErrorCode::CannotDispute);

    // Party check — creator (seller) or counterparty (buyer).
    let is_seller = initiator == trade.creator || initiator == escrow.depositor;
    let is_buyer = initiator == trade.counterparty;
    let is_party = is_seller || is_buyer;

    // Permissionless stale-payment escalation:
    //   in PaymentSent, after `payment_confirmed_at + PAYMENT_STALE_THRESHOLD`
    //   ANY signer may open the dispute. This closes the "both parties ghost
    //   in PaymentSent" stuck-funds path; final resolution still requires the
    //   arbiter (or resolve_dispute_timeout after DISPUTE_WINDOW).
    let is_stale_payment_sent = trade.status == TradeStatus::PaymentSent
        && trade.payment_confirmed_at > 0
        && now >= trade
            .payment_confirmed_at
            .checked_add(Trade::PAYMENT_STALE_THRESHOLD)
            .ok_or(ErrorCode::Overflow)?;

    require!(is_party || is_stale_payment_sent, ErrorCode::NotParty);

    // Determine counterparty for event.
    let counterparty = if is_party {
        if is_seller { trade.counterparty } else { escrow.depositor }
    } else {
        // Stale-payment escalation by third party — default to buyer.
        trade.counterparty
    };

    // Update trade state
    trade.status = TradeStatus::Disputed;
    trade.disputed_at = now;
    trade.dispute_initiator = initiator;
    // Clear expiry - disputed trades have no timeout-based auto-resolution
    trade.expires_at = 0;

    // Emit event
    emit!(DisputeOpenedEvent {
        trade: trade.key(),
        initiator,
        counterparty,
        amount: escrow.amount,
        timestamp: now,
    });

    msg!(
        "Dispute opened: trade={}, initiator={}, amount={}",
        trade.key(),
        initiator,
        escrow.amount
    );
    msg!("Funds are frozen until arbiter resolves the dispute");

    Ok(())
}
