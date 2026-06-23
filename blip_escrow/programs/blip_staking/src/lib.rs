use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("3HFY7MGj5uNteEGwVH2kPPWoYQPicncMG85dqK5P3wUX");

/// Blip Staking — merchants/users lock USDT to unlock a reputation-scaled
/// trading-limit boost (1.0x–1.5x, computed off-chain). This program is the
/// on-chain source of truth for *how much* is staked; the limit math lives in
/// the app. Funds can only ever return to the original staker.
#[program]
pub mod blip_staking {
    use super::*;

    /// One-time setup (authority only). Creates the config + shared vault ATA.
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: InitializeConfigParams,
    ) -> Result<()> {
        require!(params.min_stake > 0, StakeError::InvalidParams);
        require!(params.unstake_cooldown >= 0, StakeError::InvalidParams);
        let cfg = &mut ctx.accounts.config;
        cfg.authority = ctx.accounts.authority.key();
        cfg.mint = ctx.accounts.mint.key();
        cfg.vault = ctx.accounts.vault.key();
        cfg.vault_authority = ctx.accounts.vault_authority.key();
        cfg.min_stake = params.min_stake;
        cfg.unstake_cooldown = params.unstake_cooldown;
        cfg.total_staked = 0;
        cfg.bump = ctx.bumps.config;
        cfg.vault_authority_bump = ctx.bumps.vault_authority;
        cfg.is_frozen = false;
        msg!(
            "StakeConfig init: min_stake={}, cooldown={}s",
            cfg.min_stake,
            cfg.unstake_cooldown
        );
        Ok(())
    }

    /// Authority-only: adjust min stake, cooldown, or freeze new stakes.
    pub fn update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        if let Some(m) = params.min_stake {
            require!(m > 0, StakeError::InvalidParams);
            cfg.min_stake = m;
        }
        if let Some(c) = params.unstake_cooldown {
            require!(c >= 0, StakeError::InvalidParams);
            cfg.unstake_cooldown = c;
        }
        if let Some(f) = params.is_frozen {
            cfg.is_frozen = f;
        }
        if let Some(a) = params.new_authority {
            cfg.authority = a;
        }
        Ok(())
    }

    /// Stake USDT. The position's *total* must be >= min_stake. Each stake
    /// (re)starts the unstake cooldown on the whole position.
    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        require!(!cfg.is_frozen, StakeError::Frozen);
        require!(amount > 0, StakeError::InvalidAmount);

        let pos = &mut ctx.accounts.position;
        let now = Clock::get()?.unix_timestamp;

        let new_total = pos
            .amount
            .checked_add(amount)
            .ok_or(StakeError::Overflow)?;
        require!(new_total >= cfg.min_stake, StakeError::BelowMinimum);

        // Move USDT into the shared vault.
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.staker_ata.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.staker.to_account_info(),
                },
            ),
            amount,
        )?;

        if pos.staked_at == 0 {
            pos.staker = ctx.accounts.staker.key();
            pos.staked_at = now;
            pos.bump = ctx.bumps.position;
        }
        pos.amount = new_total;
        pos.last_stake_at = now;
        cfg.total_staked = cfg.total_staked.checked_add(amount).ok_or(StakeError::Overflow)?;

        emit!(StakedEvent { staker: pos.staker, amount, total: new_total, timestamp: now });
        msg!("staked {}, total={}", amount, new_total);
        Ok(())
    }

    /// Unstake USDT back to the staker. Blocked until the cooldown since the
    /// last stake has elapsed (anti-gaming). Remaining must be 0 or >= min.
    pub fn unstake(ctx: Context<Unstake>, amount: u64) -> Result<()> {
        let cfg = &mut ctx.accounts.config;
        let pos = &mut ctx.accounts.position;
        let now = Clock::get()?.unix_timestamp;

        require!(amount > 0 && amount <= pos.amount, StakeError::InvalidAmount);
        let unlock_at = pos
            .last_stake_at
            .checked_add(cfg.unstake_cooldown)
            .ok_or(StakeError::Overflow)?;
        require!(now >= unlock_at, StakeError::CooldownActive);

        let remaining = pos.amount - amount;
        require!(
            remaining == 0 || remaining >= cfg.min_stake,
            StakeError::WouldLeaveDust
        );

        // Transfer out of the vault, signed by the vault-authority PDA.
        let bump = [cfg.vault_authority_bump];
        let seeds: &[&[u8]] = &[VAULT_AUTHORITY_SEED, &bump];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.staker_ata.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        pos.amount = remaining;
        cfg.total_staked = cfg.total_staked.checked_sub(amount).ok_or(StakeError::Overflow)?;

        emit!(UnstakedEvent { staker: pos.staker, amount, total: remaining, timestamp: now });
        msg!("unstaked {}, remaining={}", amount, remaining);
        Ok(())
    }
}

pub const CONFIG_SEED: &[u8] = b"stake-config";
pub const POSITION_SEED: &[u8] = b"stake";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"stake-vault-authority";

#[account]
pub struct StakeConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub min_stake: u64,
    pub unstake_cooldown: i64,
    pub total_staked: u64,
    pub bump: u8,
    pub vault_authority_bump: u8,
    pub is_frozen: bool,
}
impl StakeConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 32 + 8 + 8 + 8 + 1 + 1 + 1;
}

#[account]
pub struct StakePosition {
    pub staker: Pubkey,
    pub amount: u64,
    pub staked_at: i64,
    pub last_stake_at: i64,
    pub bump: u8,
}
impl StakePosition {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeConfigParams {
    pub min_stake: u64,
    pub unstake_cooldown: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateConfigParams {
    pub min_stake: Option<u64>,
    pub unstake_cooldown: Option<i64>,
    pub is_frozen: Option<bool>,
    pub new_authority: Option<Pubkey>,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = StakeConfig::LEN, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, StakeConfig>>,
    pub mint: Box<Account<'info, Mint>>,
    /// CHECK: PDA that owns the vault
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = vault_authority
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(constraint = authority.key() == config.authority @ StakeError::Unauthorized)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, StakeConfig>>,
}

#[derive(Accounts)]
pub struct Stake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, StakeConfig>>,
    #[account(
        init_if_needed,
        payer = staker,
        space = StakePosition::LEN,
        seeds = [POSITION_SEED, staker.key().as_ref()],
        bump
    )]
    pub position: Box<Account<'info, StakePosition>>,
    #[account(mut, constraint = vault.key() == config.vault @ StakeError::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = staker_ata.owner == staker.key() @ StakeError::InvalidOwner,
        constraint = staker_ata.mint == config.mint @ StakeError::InvalidMint
    )]
    pub staker_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub staker: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, StakeConfig>>,
    #[account(
        mut,
        seeds = [POSITION_SEED, staker.key().as_ref()],
        bump = position.bump,
        constraint = position.staker == staker.key() @ StakeError::Unauthorized
    )]
    pub position: Box<Account<'info, StakePosition>>,
    /// CHECK: PDA that owns the vault
    #[account(seeds = [VAULT_AUTHORITY_SEED], bump = config.vault_authority_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = vault.key() == config.vault @ StakeError::InvalidVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = staker_ata.owner == staker.key() @ StakeError::InvalidOwner,
        constraint = staker_ata.mint == config.mint @ StakeError::InvalidMint
    )]
    pub staker_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[event]
pub struct StakedEvent {
    pub staker: Pubkey,
    pub amount: u64,
    pub total: u64,
    pub timestamp: i64,
}
#[event]
pub struct UnstakedEvent {
    pub staker: Pubkey,
    pub amount: u64,
    pub total: u64,
    pub timestamp: i64,
}

#[error_code]
pub enum StakeError {
    #[msg("Invalid params")]
    InvalidParams,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Stake total is below the minimum")]
    BelowMinimum,
    #[msg("Unstake cooldown has not elapsed")]
    CooldownActive,
    #[msg("Unstake would leave a position below the minimum")]
    WouldLeaveDust,
    #[msg("Staking is frozen")]
    Frozen,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid vault")]
    InvalidVault,
    #[msg("Invalid token owner")]
    InvalidOwner,
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Arithmetic overflow")]
    Overflow,
}
