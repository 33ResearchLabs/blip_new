use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::Lane;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct WithdrawLane<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,

    #[account(
        mut,
        seeds = [
            Lane::SEED_PREFIX,
            merchant.key().as_ref(),
            lane.lane_id.to_le_bytes().as_ref()
        ],
        bump = lane.bump,
        has_one = merchant @ ErrorCode::Unauthorized
    )]
    pub lane: Box<Account<'info, Lane>>,

    /// CHECK: Lane vault authority PDA
    #[account(
        seeds = [Lane::VAULT_AUTHORITY_PREFIX, lane.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = vault_ata.key() == lane.vault_ata,
        constraint = vault_ata.mint == mint.key() @ ErrorCode::InvalidMint
    )]
    pub vault_ata: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = merchant_ata.mint == mint.key() @ ErrorCode::InvalidMint,
        constraint = merchant_ata.owner == merchant.key()
    )]
    pub merchant_ata: Box<Account<'info, TokenAccount>>,

    #[account(constraint = mint.key() == lane.mint @ ErrorCode::InvalidMint)]
    pub mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct WithdrawLaneParams {
    pub amount: u64,
}

pub fn handler(ctx: Context<WithdrawLane>, params: WithdrawLaneParams) -> Result<()> {
    let lane = &mut ctx.accounts.lane;
    let clock = Clock::get()?;

    // Verify sufficient available balance
    require!(
        lane.available_balance >= params.amount,
        ErrorCode::InsufficientLaneBalance
    );

    // Transfer tokens from lane vault to merchant
    let lane_key = lane.key();
    let vault_seeds = &[
        Lane::VAULT_AUTHORITY_PREFIX,
        lane_key.as_ref(),
        &[lane.vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    let transfer = Transfer {
        from: ctx.accounts.vault_ata.to_account_info(),
        to: ctx.accounts.merchant_ata.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        transfer,
        signer_seeds,
    );
    token::transfer(cpi_ctx, params.amount)?;

    // Update lane available balance
    lane.available_balance = lane
        .available_balance
        .checked_sub(params.amount)
        .ok_or(ErrorCode::InsufficientLaneBalance)?;
    lane.updated_at = clock.unix_timestamp;

    msg!(
        "Lane withdrawal: id={}, amount={}, remaining_balance={}",
        lane.lane_id,
        params.amount,
        lane.available_balance
    );

    Ok(())
}
