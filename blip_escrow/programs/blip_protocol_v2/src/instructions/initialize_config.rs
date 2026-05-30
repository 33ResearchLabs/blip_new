use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::LEN,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: Treasury can be any account
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigParams {
    pub fee_bps: u16,
    pub max_fee_bps: u16,
    pub min_fee_bps: u16,
}

pub fn handler(
    ctx: Context<InitializeConfig>,
    params: InitializeConfigParams,
) -> Result<()> {
    let config = &mut ctx.accounts.protocol_config;

    // V2.3 hard cap: max_fee_bps cannot exceed 10% (1000 bps). Prevents
    // an admin from initializing with an unreasonable ceiling.
    require!(
        params.max_fee_bps <= 1000,
        ErrorCode::MaxFeeBpsExceedsHardCap
    );

    // Validate fee bounds
    require!(
        params.fee_bps >= params.min_fee_bps && params.fee_bps <= params.max_fee_bps,
        ErrorCode::FeeOutOfBounds
    );

    // Initialize config
    config.authority = ctx.accounts.authority.key();
    config.treasury = ctx.accounts.treasury.key();
    config.fee_bps = params.fee_bps;
    config.max_fee_bps = params.max_fee_bps;
    config.min_fee_bps = params.min_fee_bps;
    config.bump = ctx.bumps.protocol_config;
    config.is_frozen = false;
    config.version = 1;

    msg!(
        "Protocol initialized: authority={}, treasury={}, fee_bps={}, max={}, min={}",
        config.authority,
        config.treasury,
        config.fee_bps,
        config.max_fee_bps,
        config.min_fee_bps
    );

    Ok(())
}
