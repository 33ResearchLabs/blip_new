use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, Transfer};
use crate::state::{Trade, Escrow, ProtocolConfig, TradeStatus, DisputeResolution};
use crate::errors::ErrorCode;
use crate::events::DisputeResolvedEvent;

/// Resolve a disputed trade.
/// Can only be called by the protocol authority (arbiter).
///
/// Arbiter decides:
/// - ReleaseToBuyer: Funds go to counterparty (buyer won dispute)
/// - RefundToSeller: Funds go back to depositor (seller won dispute)
#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    /// Arbiter (must be protocol authority)
    #[account(mut)]
    pub arbiter: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == arbiter.key() @ ErrorCode::NotArbiter
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
        bump = trade.bump,
        constraint = trade.status == TradeStatus::Disputed @ ErrorCode::NotDisputed
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

    /// Recipient ATA - will be either buyer or seller depending on resolution
    #[account(
        mut,
        constraint = recipient_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub recipient_ata: Account<'info, TokenAccount>,

    /// Treasury ATA for fees (only used if releasing to buyer).
    /// V2.3: validate against `trade.treasury` snapshot so a post-creation
    /// authority rotation cannot redirect this trade's fee.
    #[account(
        mut,
        constraint = treasury_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = treasury_ata.owner == trade.treasury @ ErrorCode::InvalidTreasury
    )]
    pub treasury_ata: Account<'info, TokenAccount>,

    /// CHECK: Rent refund recipient — must equal escrow.depositor.
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    #[account(constraint = mint.key() == trade.mint @ ErrorCode::InvalidMint)]
    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ResolveDisputeParams {
    pub resolution: DisputeResolution,
}

pub fn handler(ctx: Context<ResolveDispute>, params: ResolveDisputeParams) -> Result<()> {
    let trade = &mut ctx.accounts.trade;
    let escrow = &ctx.accounts.escrow;
    let protocol_config = &ctx.accounts.protocol_config;
    let clock = Clock::get()?;

    require!(escrow.amount > 0, ErrorCode::InsufficientAmount);

    // PDA signer seeds
    let escrow_key = escrow.key();
    let vault_seeds = &[
        Escrow::VAULT_AUTHORITY_PREFIX,
        escrow_key.as_ref(),
        &[escrow.vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    let (final_status, recipient, amount_transferred, resolution_code): (TradeStatus, Pubkey, u64, u8);

    match params.resolution {
        DisputeResolution::ReleaseToBuyer => {
            // Buyer won - release funds to counterparty with fee
            let (payout, fee) = protocol_config.calculate_fee(escrow.amount)?;

            // Validate recipient is the buyer
            require!(
                ctx.accounts.recipient_ata.owner == trade.counterparty,
                ErrorCode::InvalidCounterparty
            );

            // Transfer payout to buyer
            let transfer_payout = Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.recipient_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_payout,
                signer_seeds,
            );
            token::transfer(cpi_ctx, payout)?;

            // Transfer fee to treasury
            if fee > 0 {
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
            }

            final_status = TradeStatus::Released;
            recipient = trade.counterparty;
            amount_transferred = payout;
            resolution_code = 0;

            msg!(
                "Dispute resolved: ReleaseToBuyer, payout={}, fee={}",
                payout,
                fee
            );
        }

        DisputeResolution::RefundToSeller => {
            // Seller won - refund funds to depositor (no fee)
            require!(
                ctx.accounts.recipient_ata.owner == escrow.depositor,
                ErrorCode::InvalidDepositor
            );

            let transfer_refund = Transfer {
                from: ctx.accounts.vault_ata.to_account_info(),
                to: ctx.accounts.recipient_ata.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_refund,
                signer_seeds,
            );
            token::transfer(cpi_ctx, escrow.amount)?;

            final_status = TradeStatus::Refunded;
            recipient = escrow.depositor;
            amount_transferred = escrow.amount;
            resolution_code = 1;

            msg!(
                "Dispute resolved: RefundToSeller, amount={}",
                escrow.amount
            );
        }
    }

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
    trade.status = final_status;
    trade.settled_at = clock.unix_timestamp;

    // Emit event
    emit!(DisputeResolvedEvent {
        trade: trade.key(),
        arbiter: ctx.accounts.arbiter.key(),
        resolution: resolution_code,
        recipient,
        amount: amount_transferred,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Trade {} dispute resolved by arbiter {}",
        trade.key(),
        ctx.accounts.arbiter.key()
    );

    Ok(())
}
