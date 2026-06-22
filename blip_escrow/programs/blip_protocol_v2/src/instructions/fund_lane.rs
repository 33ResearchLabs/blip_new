use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use crate::state::Lane;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct FundLane<'info> {
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
pub struct FundLaneParams {
    pub amount: u64,
}

pub fn handler(ctx: Context<FundLane>, params: FundLaneParams) -> Result<()> {
    let lane = &mut ctx.accounts.lane;
    let clock = Clock::get()?;

    // Transfer tokens from merchant to lane vault
    let transfer = Transfer {
        from: ctx.accounts.merchant_ata.to_account_info(),
        to: ctx.accounts.vault_ata.to_account_info(),
        authority: ctx.accounts.merchant.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer);
    token::transfer(cpi_ctx, params.amount)?;

    // Update lane available balance
    lane.available_balance = lane
        .available_balance
        .checked_add(params.amount)
        .ok_or(ErrorCode::Overflow)?;
    lane.updated_at = clock.unix_timestamp;

    msg!(
        "Lane funded: id={}, amount={}, new_balance={}",
        lane.lane_id,
        params.amount,
        lane.available_balance
    );

    Ok(())
}
