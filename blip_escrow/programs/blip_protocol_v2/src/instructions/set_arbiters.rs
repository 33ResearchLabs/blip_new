use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, ArbiterSet};
use crate::errors::ErrorCode;

/// Set the dispute-arbiter allowlist. AUTHORITY ONLY. These wallets can each
/// resolve disputes (in addition to the protocol authority). Replaces the full
/// list each call.
#[derive(Accounts)]
pub struct SetArbiters<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump = protocol_config.bump,
        constraint = protocol_config.authority == authority.key() @ ErrorCode::NotArbiter
    )]
    pub protocol_config: Box<Account<'info, ProtocolConfig>>,

    #[account(
        init_if_needed,
        payer = authority,
        space = ArbiterSet::LEN,
        seeds = [ArbiterSet::SEED],
        bump
    )]
    pub arbiter_set: Box<Account<'info, ArbiterSet>>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SetArbitersParams {
    pub arbiters: Vec<Pubkey>,
}

pub fn handler(ctx: Context<SetArbiters>, params: SetArbitersParams) -> Result<()> {
    require!(params.arbiters.len() <= ArbiterSet::MAX, ErrorCode::TooManyArbiters);
    let set = &mut ctx.accounts.arbiter_set;
    set.authority = ctx.accounts.authority.key();
    set.bump = ctx.bumps.arbiter_set;
    set.count = params.arbiters.len() as u8;
    for i in 0..ArbiterSet::MAX {
        set.arbiters[i] = if i < params.arbiters.len() {
            params.arbiters[i]
        } else {
            Pubkey::default()
        };
    }
    msg!("arbiter set updated: {} arbiters", set.count);
    Ok(())
}
