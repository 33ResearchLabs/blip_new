use anchor_lang::prelude::*;
use crate::state::{ProtocolConfig, Trade, TradeSide, TradeStatus};
use crate::errors::ErrorCode;
use crate::events::TradeCreatedEvent;

#[derive(Accounts)]
#[instruction(params: CreateTradeParams)]
pub struct CreateTrade<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [ProtocolConfig::SEED_PREFIX],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        init,
        payer = creator,
        space = Trade::LEN,
        seeds = [
            Trade::SEED_PREFIX,
            creator.key().as_ref(),
            params.trade_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub trade: Account<'info, Trade>,

    pub mint: Account<'info, anchor_spl::token::Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct CreateTradeParams {
    pub trade_id: u64,
    pub amount: u64,
    pub side: TradeSide,
    /// Fee tier in basis points (V2.3.1). Caller picks a tier within the
    /// protocol's [min_fee_bps, max_fee_bps] range. Snapshotted onto the
    /// Trade so future config changes don't affect this trade.
    pub fee_bps: u16,
}

pub fn handler(
    ctx: Context<CreateTrade>,
    params: CreateTradeParams,
) -> Result<()> {
    let config = &ctx.accounts.protocol_config;
    let trade = &mut ctx.accounts.trade;
    let clock = Clock::get()?;

    // Check protocol not frozen
    require!(!config.is_frozen, ErrorCode::ProtocolFrozen);

    // Reject zero-amount trades.
    require!(params.amount > 0, ErrorCode::InvalidAmount);

    // V2.3.1: Validate caller-chosen fee tier is within protocol bounds.
    // Reuses ProtocolConfig::validate_fee for consistency with init/update.
    config.validate_fee(params.fee_bps)?;

    // Initialize trade
    trade.creator = ctx.accounts.creator.key();
    trade.counterparty = Pubkey::default(); // Set on lock
    trade.trade_id = params.trade_id;
    trade.mint = ctx.accounts.mint.key();
    trade.amount = params.amount;
    trade.status = TradeStatus::Created;
    trade.fee_bps = params.fee_bps; // V2.3.1: caller-chosen tier (validated above)
    trade.treasury = config.treasury; // Snapshot treasury (V2.3)
    trade.escrow_bump = 0; // Set on lock
    trade.bump = ctx.bumps.trade;
    trade.created_at = clock.unix_timestamp;
    trade.locked_at = 0;
    trade.settled_at = 0;
    trade.side = params.side;

    // Emit event
    emit!(TradeCreatedEvent {
        trade: trade.key(),
        creator: trade.creator,
        trade_id: trade.trade_id,
        mint: trade.mint,
        amount: trade.amount,
        side: trade.side,
        fee_bps: trade.fee_bps,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Trade created: id={}, amount={}, side={:?}, fee_bps={}",
        trade.trade_id,
        trade.amount,
        trade.side,
        trade.fee_bps
    );

    Ok(())
}
