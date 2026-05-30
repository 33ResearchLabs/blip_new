use anchor_lang::prelude::*;
use crate::state::{Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::PaymentConfirmedEvent;

/// Confirm fiat payment sent by buyer.
/// Transitions trade from Locked → PaymentSent.
///
/// CRITICAL: After this, auto-refund is FORBIDDEN.
/// The buyer's fiat is at risk, so only dispute resolution can adjudicate.
#[derive(Accounts)]
pub struct ConfirmPayment<'info> {
    /// Buyer (counterparty) confirming they sent fiat
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref()
        ],
        bump = trade.bump,
        constraint = trade.counterparty == buyer.key() @ ErrorCode::NotBuyer
    )]
    pub trade: Account<'info, Trade>,

    #[account(
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
        has_one = trade
    )]
    pub escrow: Account<'info, Escrow>,
}

pub fn handler(ctx: Context<ConfirmPayment>) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let clock = Clock::get()?;

    // Validate trade can have payment confirmed
    require!(trade.can_confirm_payment(), ErrorCode::CannotConfirmPayment);

    // Update trade state
    trade.status = TradeStatus::PaymentSent;
    trade.payment_confirmed_at = clock.unix_timestamp;
    // Clear expiry - no auto-refund allowed after payment confirmation
    // Disputes are the only resolution path now
    trade.expires_at = 0;

    // Emit event
    emit!(PaymentConfirmedEvent {
        trade: trade.key(),
        buyer: ctx.accounts.buyer.key(),
        seller: escrow.depositor,
        amount: escrow.amount,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Payment confirmed: trade={}, buyer={}, amount={}",
        trade.key(),
        ctx.accounts.buyer.key(),
        escrow.amount
    );
    msg!("Seller should verify fiat receipt and call release_escrow");
    msg!("If issues arise, either party can open a dispute");

    Ok(())
}
