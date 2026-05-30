use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

use crate::state::{Escrow, ProtocolConfig};
use crate::errors::ErrorCode;

/// Emergency refund for V2.2 legacy accounts that can't be deserialized by V2.3.
///
/// AUTHORITY-GATED: callable ONLY by `protocol_config.authority`.
///
/// V2.2 Trade account layout (150 bytes total):
/// - [0..8]:     discriminator
/// - [8..40]:    creator (Pubkey)
/// - [40..72]:   counterparty (Pubkey)
/// - [72..80]:   trade_id (u64)
/// - [80..112]:  mint (Pubkey)
/// - [112..120]: amount (u64)
/// - [120]:      status (u8) - Created=0, Locked=1, Released=2, Refunded=3
/// - [121..123]: fee_bps (u16)
/// - [123]:      escrow_bump (u8)
/// - [124]:      bump (u8)
/// - [125..133]: created_at (i64)
/// - [133..141]: locked_at (i64)
/// - [141..149]: settled_at (i64)
/// - [149]:      side (u8)

/// V2.2 TradeStatus enum values
const V2_STATUS_CREATED: u8 = 0;
const V2_STATUS_LOCKED: u8 = 1;
const V2_STATUS_REFUNDED: u8 = 3;

#[derive(Accounts)]
pub struct EmergencyRefundV2<'info> {
    /// Signer — MUST equal `protocol_config.authority`.
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == signer.key() @ ErrorCode::Unauthorized
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// V2.2 Trade account - NOT deserialized, read raw bytes
    /// CHECK: We manually parse this account's data
    #[account(mut)]
    pub trade: UncheckedAccount<'info>,

    /// Escrow account - same structure in V2.2 and V2.3
    /// Closed on success so it cannot be reused by any future instruction.
    /// Rent goes to the depositor (the party who funded the escrow).
    #[account(
        mut,
        close = depositor,
        seeds = [Escrow::SEED_PREFIX, trade.key().as_ref()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// Vault authority PDA
    /// CHECK: Verified by seeds
    #[account(
        seeds = [b"vault-authority-v2", escrow.key().as_ref()],
        bump = escrow.vault_bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    /// Escrow vault token account
    #[account(
        mut,
        constraint = vault_ata.key() == escrow.vault_ata @ ErrorCode::InvalidVault
    )]
    pub vault_ata: Account<'info, TokenAccount>,

    /// Depositor's token account to receive refund
    #[account(
        mut,
        constraint = depositor_ata.owner == escrow.depositor @ ErrorCode::InvalidDepositor
    )]
    pub depositor_ata: Account<'info, TokenAccount>,

    /// Trade creator account
    /// CHECK: Verified against parsed trade data — used only for cross-
    /// checking the V2.2 layout, NOT for rent. Rent goes to depositor.
    #[account(mut)]
    pub creator: UncheckedAccount<'info>,

    /// CHECK: Rent destination — must equal escrow.depositor.
    #[account(mut, constraint = depositor.key() == escrow.depositor @ ErrorCode::InvalidDepositor)]
    pub depositor: UncheckedAccount<'info>,

    /// Token mint
    /// CHECK: Verified against escrow
    pub mint: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn emergency_refund_v2(ctx: Context<EmergencyRefundV2>) -> Result<()> {
    // Authority gate is enforced by the Anchor constraint on protocol_config above.

    let trade_info = ctx.accounts.trade.to_account_info();
    let trade_data = trade_info.try_borrow_data()?;

    // Verify this is a V2.2 account (150 bytes)
    require!(trade_data.len() == 150, ErrorCode::InvalidV2AccountSize);

    // Verify the trade account is owned by this program
    require!(
        *trade_info.owner == crate::ID,
        ErrorCode::InvalidTradeOwner
    );

    // Parse V2.2 fields manually
    let creator_bytes: [u8; 32] = trade_data[8..40].try_into().unwrap();
    let creator_pubkey = Pubkey::new_from_array(creator_bytes);

    let status = trade_data[120];

    // Verify creator matches
    require!(
        ctx.accounts.creator.key() == creator_pubkey,
        ErrorCode::CreatorMismatch
    );

    // Can only refund Created (0) or Locked (1) — never PaymentSent/Disputed/terminal
    require!(
        status == V2_STATUS_CREATED || status == V2_STATUS_LOCKED,
        ErrorCode::TradeAlreadySettled
    );

    // Get escrow amount
    let escrow_amount = ctx.accounts.escrow.amount;

    msg!("Emergency V2 refund: {} tokens to depositor", escrow_amount);
    msg!("Trade creator: {}", creator_pubkey);
    msg!("Depositor: {}", ctx.accounts.escrow.depositor);
    msg!("V2 status byte: {}", status);

    // Transfer tokens from vault to depositor
    let escrow_key = ctx.accounts.escrow.key();
    let seeds = &[
        b"vault-authority-v2".as_ref(),
        escrow_key.as_ref(),
        &[ctx.accounts.escrow.vault_bump],
    ];
    let signer_seeds = &[&seeds[..]];

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
        escrow_amount,
    )?;

    // Close the vault ATA — rent goes to the depositor. Prevents the
    // empty vault from being reused or from leaking rent on stuck trades.
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault_ata.to_account_info(),
            destination: ctx.accounts.depositor.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        },
        signer_seeds,
    ))?;

    // Flip the V2.2 status byte AND wipe the discriminator. Wiping the
    // discriminator makes the stale Trade PDA permanently undeserializable
    // by any instruction (Anchor checks the 8-byte discriminator on load),
    // which is the on-chain equivalent of "closed" for an UncheckedAccount
    // we cannot touch via the Anchor close attribute.
    drop(trade_data);
    let mut trade_data_mut = trade_info.try_borrow_mut_data()?;
    trade_data_mut[120] = V2_STATUS_REFUNDED;
    trade_data_mut[0..8].fill(0);

    // Zero the escrow amount before the account is closed by Anchor.
    let escrow = &mut ctx.accounts.escrow;
    escrow.amount = 0;

    msg!("Emergency V2 refund completed successfully");

    Ok(())
}
