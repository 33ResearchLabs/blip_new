use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use crate::state::{ProtocolConfig, Trade, Escrow, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeReleasedEvent;

#[derive(Accounts)]
pub struct ReleaseEscrow<'info> {
    /// Signer (must be creator or counterparty)
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

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
        bump
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
        constraint = counterparty_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = counterparty_ata.owner == trade.counterparty
    )]
    pub counterparty_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = treasury_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        // V2.3: enforce against the snapshot stored on the Trade so an
        // admin can't redirect this trade's fee post-creation.
        constraint = treasury_ata.owner == trade.treasury @ ErrorCode::InvalidTreasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    /// CHECK: Rent refund recipient — must equal escrow.depositor (the
    /// party who funded the trade and paid the escrow + vault rent).
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ReleaseEscrow>) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    // protocol_config is still required as an account for backward compat
    // (clients pass it) but the treasury comes from the trade snapshot.
    let clock = Clock::get()?;

    // Validate trade state + non-empty escrow
    require!(trade.can_release(), ErrorCode::CannotRelease);
    require!(escrow.amount > 0, ErrorCode::InsufficientAmount);

    // Validate signer authorization — STATE-AWARE:
    //   Locked      → only creator (seller) may release
    //   PaymentSent → either party may release
    let signer_key = ctx.accounts.signer.key();
    match trade.status {
        TradeStatus::Locked => {
            require!(signer_key == trade.creator, ErrorCode::Unauthorized);
        }
        TradeStatus::PaymentSent => {
            require!(
                signer_key == trade.creator || signer_key == trade.counterparty,
                ErrorCode::Unauthorized
            );
        }
        _ => return err!(ErrorCode::CannotRelease),
    }

    // Calculate fee split
    let (payout, fee) = crate::utils::calculate_fee(escrow.amount, trade.fee_bps)?;

    // PDA signer seeds
    let escrow_key = escrow.key();
    let vault_seeds = &[
        Escrow::VAULT_AUTHORITY_PREFIX,
        escrow_key.as_ref(),
        &[escrow.vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    // Transfer payout to counterparty
    let transfer_payout = Transfer {
        from: ctx.accounts.vault_ata.to_account_info(),
        to: ctx.accounts.counterparty_ata.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_payout,
        signer_seeds,
    );
    token::transfer(cpi_ctx, payout)?;

    // Transfer fee to treasury
    let transfer_fee = Transfer {
        from: ctx.accounts.vault_ata.to_account_info(),
        to: ctx.accounts.treasury_ata.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer_fee,
        signer_seeds,
    );
    token::transfer(cpi_ctx, fee)?;

    // Close vault ATA (rent to depositor — the party who paid for it)
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

    // Update trade state
    trade.status = TradeStatus::Released;
    trade.settled_at = clock.unix_timestamp;

    // Emit event (treasury comes from the trade snapshot, not the live config)
    emit!(TradeReleasedEvent {
        trade: trade.key(),
        counterparty: trade.counterparty,
        payout,
        fee,
        treasury: trade.treasury,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Escrow released: trade={}, payout={}, fee={}, treasury={}",
        trade.key(),
        payout,
        fee,
        trade.treasury
    );

    Ok(())
}
