use anchor_lang::prelude::*;
use crate::state::Trade;
use crate::errors::ErrorCode;

/// `close_trade` — Reclaim the rent locked in a terminal Trade PDA.
///
/// Background
/// ----------
/// Trades that completed under an older version of this program (before
/// `release_escrow` / `refund_escrow` learned to use `close = depositor`)
/// left the Trade PDA allocated and rent-paying forever. ~2.5M lamports
/// (~$0.22 at recent prices) is stranded per terminal trade.
///
/// This instruction lets *anyone* close a Trade PDA that's already in a
/// terminal state (`Released` or `Refunded`). The lamports always flow to
/// the original `trade.creator` — never the caller — so a third-party
/// reaper bot can pay the 5000-lamport fee to do users a favor without
/// being able to redirect the rent.
///
/// Why permissionless
/// -------------------
/// The trade is terminal: every token has already moved on-chain (release
/// fee went to treasury and the rest went to the counterparty, OR the
/// entire amount went back to the depositor on a refund). The Trade PDA's
/// only remaining value is its rent-exempt lamports. Allowing anyone to
/// trigger closure means stuck rent gets reclaimed even when the original
/// creator's wallet is offline.
///
/// Safety invariants
/// -----------------
///   * `trade.is_terminal()` — refuses to close an Open/Funded/Locked/
///     PaymentSent/Disputed trade. The vault may still hold tokens; closing
///     would orphan them.
///   * `rent_recipient.key() == trade.creator` — Anchor refunds the
///     lamports to the original creator address recorded on the trade.
///   * `close = rent_recipient` — Anchor handles lamport transfer +
///     discriminator zeroing atomically.
#[derive(Accounts)]
pub struct CloseTrade<'info> {
    /// Whoever pays the network fee. Can be the creator, a reaper bot, or
    /// any helpful third party — they get nothing back beyond fee burn.
    #[account(mut)]
    pub caller: Signer<'info>,

    /// Trade PDA to close. The constraint enforces a terminal state — any
    /// non-terminal status (Open/Funded/Locked/PaymentSent/Disputed) is
    /// rejected so we can never strand the vault.
    #[account(
        mut,
        seeds = [
            Trade::SEED_PREFIX,
            trade.creator.as_ref(),
            trade.trade_id.to_le_bytes().as_ref(),
        ],
        bump = trade.bump,
        close = rent_recipient,
        constraint = trade.is_terminal() @ ErrorCode::TradeNotTerminal,
    )]
    pub trade: Account<'info, Trade>,

    /// Recipient of the reclaimed rent. MUST equal `trade.creator`. Pinning
    /// it inside the account constraint (not just the handler) means even a
    /// malicious reaper signed by `caller` can't redirect lamports — they
    /// can only burn 5000 lamports of fee on the user's behalf.
    /// CHECK: address-bound to `trade.creator` below; no other validation
    /// is needed because we only credit lamports to this account.
    #[account(
        mut,
        address = trade.creator @ ErrorCode::WrongRentRecipient,
    )]
    pub rent_recipient: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CloseTrade>) -> Result<()> {
    // Anchor's `close = rent_recipient` constraint does the heavy lifting:
    //   1. Transfers all lamports from `trade` → `rent_recipient`
    //   2. Reassigns the account to the System Program
    //   3. Zeroes the data + sets the closed-account discriminator
    //
    // No manual lamport / data manipulation needed. Just log for indexer
    // visibility.
    msg!(
        "Trade closed: trade={}, trade_id={}, rent_returned_to={}",
        ctx.accounts.trade.key(),
        ctx.accounts.trade.trade_id,
        ctx.accounts.rent_recipient.key()
    );
    Ok(())
}
