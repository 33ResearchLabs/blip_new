use anchor_lang::prelude::*;
use crate::state::ProtocolConfig;
use crate::errors::ErrorCode;
use crate::events::ConfigUpdatedEvent;

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: New treasury can be any account
    pub new_treasury: Option<AccountInfo<'info>>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigParams {
    pub new_authority: Option<Pubkey>,
    pub new_treasury: Option<Pubkey>,
    pub new_fee_bps: Option<u16>,
    pub is_frozen: Option<bool>,

    /// Lower bound on per-trade fee in basis points.
    ///
    /// Set to 0 to enable promotional 0%-fee trades. The authority can
    /// raise this back later to re-enable mandatory minimum fees. Bounded
    /// by the immutable hard cap (10% / 1000 bps) and must stay
    /// `<= max_fee_bps`.
    pub new_min_fee_bps: Option<u16>,

    /// Upper bound on per-trade fee in basis points. Bounded by the
    /// immutable hard cap (10% / 1000 bps) and must stay `>= min_fee_bps`.
    pub new_max_fee_bps: Option<u16>,
}

pub fn handler(
    ctx: Context<UpdateConfig>,
    params: UpdateConfigParams,
) -> Result<()> {
    let config = &mut ctx.accounts.protocol_config;
    let clock = Clock::get()?;

    // Update authority if provided
    if let Some(new_auth) = params.new_authority {
        config.authority = new_auth;
    }

    // Update treasury if provided
    if let Some(new_treas) = params.new_treasury {
        config.treasury = new_treas;
    }

    // Apply fee-bound updates BEFORE the current fee update so that a
    // request like `{ new_min_fee_bps: 0, new_fee_bps: 0 }` succeeds in one
    // call. Without this ordering the new fee would be validated against
    // the OLD min and the call would 6004 (FeeOutOfBounds).
    //
    // Hard cap (10% / 1000 bps) is preserved as an immutable ceiling so
    // a compromised authority can't dial fees to 50% on existing users.
    // Stays consistent with the cap set in `initialize_config`.
    if let Some(new_min) = params.new_min_fee_bps {
        require!(new_min <= 1000, ErrorCode::MaxFeeBpsExceedsHardCap);
        // If the caller is also updating max in the same tx, validate the
        // pair before committing. Otherwise validate against current max.
        let target_max = params.new_max_fee_bps.unwrap_or(config.max_fee_bps);
        require!(new_min <= target_max, ErrorCode::FeeOutOfBounds);
        config.min_fee_bps = new_min;
    }
    if let Some(new_max) = params.new_max_fee_bps {
        require!(new_max <= 1000, ErrorCode::MaxFeeBpsExceedsHardCap);
        require!(new_max >= config.min_fee_bps, ErrorCode::FeeOutOfBounds);
        config.max_fee_bps = new_max;
    }
    // If we just narrowed the band such that the current fee is now out
    // of [min, max], clamp it. Otherwise the next create_trade would fail
    // the validate_fee invariant for protocol-side default fee.
    if config.fee_bps < config.min_fee_bps {
        config.fee_bps = config.min_fee_bps;
    } else if config.fee_bps > config.max_fee_bps {
        config.fee_bps = config.max_fee_bps;
    }

    // Update fee if provided (must be within bounds — re-checks against
    // the (possibly just-updated) min/max above).
    if let Some(new_fee) = params.new_fee_bps {
        config.validate_fee(new_fee)?;
        config.fee_bps = new_fee;
    }

    // Update freeze status if provided
    if let Some(frozen) = params.is_frozen {
        config.is_frozen = frozen;
    }

    // Emit event
    emit!(ConfigUpdatedEvent {
        authority: ctx.accounts.authority.key(),
        new_fee_bps: params.new_fee_bps,
        new_treasury: params.new_treasury,
        new_authority: params.new_authority,
        is_frozen: params.is_frozen,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Config updated: fee_bps={}, min={}, max={}, treasury={}, frozen={}",
        config.fee_bps,
        config.min_fee_bps,
        config.max_fee_bps,
        config.treasury,
        config.is_frozen
    );

    Ok(())
}
