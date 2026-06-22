use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token::{Mint, Token, TokenAccount}};
use crate::state::Lane;
use crate::errors::ErrorCode;

#[derive(Accounts)]
#[instruction(params: CreateLaneParams)]
pub struct CreateLane<'info> {
    #[account(mut)]
    pub merchant: Signer<'info>,

    #[account(
        init,
        payer = merchant,
        space = Lane::LEN,
        seeds = [
            Lane::SEED_PREFIX,
            merchant.key().as_ref(),
            params.lane_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub lane: Box<Account<'info, Lane>>,

    /// CHECK: PDA signer for lane vault
    #[account(
        seeds = [Lane::VAULT_AUTHORITY_PREFIX, lane.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = merchant,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault_ata: Box<Account<'info, TokenAccount>>,

    pub mint: Box<Account<'info, Mint>>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateLaneParams {
    pub lane_id: u64,
    pub min_amount: u64,
    pub max_amount: u64,
}

pub fn handler(ctx: Context<CreateLane>, params: CreateLaneParams) -> Result<()> {
    let lane = &mut ctx.accounts.lane;
    let clock = Clock::get()?;

    // V2.3: validate lane bounds. min must be > 0 (otherwise a match with
    // amount=0 would pass the bounds check) and min must be ≤ max
    // (otherwise no match ever passes — a useless lane).
    require!(
        params.min_amount > 0 && params.min_amount <= params.max_amount,
        ErrorCode::InvalidLaneBounds
    );

    lane.merchant = ctx.accounts.merchant.key();
    lane.lane_id = params.lane_id;
    lane.mint = ctx.accounts.mint.key();
    lane.vault_authority = ctx.accounts.vault_authority.key();
    lane.vault_ata = ctx.accounts.vault_ata.key();
    lane.available_balance = 0; // Starts empty
    lane.min_amount = params.min_amount;
    lane.max_amount = params.max_amount;
    lane.is_active = true;
    lane.bump = ctx.bumps.lane;
    lane.vault_bump = ctx.bumps.vault_authority;
    lane.created_at = clock.unix_timestamp;
    lane.updated_at = clock.unix_timestamp;

    msg!(
        "Lane created: id={}, merchant={}, min={}, max={}",
        lane.lane_id,
        lane.merchant,
        lane.min_amount,
        lane.max_amount
    );

    Ok(())
}
