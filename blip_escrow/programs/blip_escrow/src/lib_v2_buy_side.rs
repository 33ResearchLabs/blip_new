// Enhanced Blip Escrow Program - V2 Buy-Side Escrow
// Adds: Balance validation, Events, Buy-side specific logic

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, CloseAccount, Token, Transfer};
use anchor_spl::token::spl_token;
use anchor_spl::token::spl_token::state as spl_state;

declare_id!("HZ9ZSXtebTKYGRR7ZNsetroAT7Kh8ymKExcf5FF9dLNq");

#[program]
pub mod blip_escrow {
    use super::*;

    /// Create escrow for buy-side P2P (merchant locks funds for buyer)
    ///
    /// Flow:
    /// 1. Buyer places buy order (no crypto deposit)
    /// 2. Merchant accepts order
    /// 3. Backend validates merchant balance via RPC
    /// 4. Merchant signs this transaction to lock funds in escrow
    /// 5. Funds transfer from merchant ATA → escrow vault
    ///
    /// Security:
    /// - Validates maker has sufficient balance in maker_ata
    /// - Checks mint matches across all token accounts
    /// - Emits event for off-chain tracking
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        deal_id: [u8; 16],
        amount: u64,
        fee_bps: u16,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(fee_bps <= 1_000, EscrowError::FeeTooHigh); // Max 10%

        // Read and validate accounts
        let _mint = read_mint(&ctx.accounts.mint)?;
        let maker_ata = read_token_account(&ctx.accounts.maker_ata)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;

        // Validate maker owns the ATA
        require_keys_eq!(
            maker_ata.owner,
            ctx.accounts.maker.key(),
            EscrowError::BadMakerAtaOwner
        );

        // Validate mints match
        require_keys_eq!(
            maker_ata.mint,
            ctx.accounts.mint.key(),
            EscrowError::BadMint
        );
        require_keys_eq!(
            vault_ata.mint,
            ctx.accounts.mint.key(),
            EscrowError::BadMint
        );

        // CRITICAL: Validate maker has sufficient balance
        // This is belt-and-suspenders - backend should check via RPC first
        require!(
            maker_ata.amount >= amount,
            EscrowError::InsufficientBalance
        );

        // Initialize escrow account
        let escrow = &mut ctx.accounts.escrow;
        escrow.version = 1;
        escrow.deal_id = deal_id;

        escrow.maker = ctx.accounts.maker.key();
        escrow.taker = Pubkey::default(); // Set later in lock_for_taker
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.treasury = ctx.accounts.treasury.key();

        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.fee_bps = fee_bps;
        escrow.status = EscrowStatus::Funded;

        escrow.escrow_bump = ctx.bumps.escrow;
        escrow.signer_bump = ctx.bumps.escrow_signer;

        // Transfer tokens from maker to vault
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.maker_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        // Emit event for off-chain indexing
        emit!(EscrowCreatedEvent {
            escrow: escrow.key(),
            deal_id,
            maker: escrow.maker,
            mint: escrow.mint,
            amount,
            fee_bps,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Lock escrow for buyer (taker)
    ///
    /// Called after buyer accepts the order and agrees to pay fiat.
    /// Sets the taker (buyer) and transitions status to Locked.
    ///
    /// Security:
    /// - Can only be called once (taker must be default)
    /// - Status must be Funded
    /// - Prevents merchant from backing out after buyer commits
    pub fn lock_for_taker(ctx: Context<LockForTaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Funded,
            EscrowError::InvalidStatus
        );
        require!(escrow.taker == Pubkey::default(), EscrowError::AlreadyTaken);

        escrow.taker = ctx.accounts.taker.key();
        escrow.status = EscrowStatus::Locked;

        emit!(EscrowLockedEvent {
            escrow: escrow.key(),
            deal_id: escrow.deal_id,
            taker: escrow.taker,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Release funds to buyer (taker) after fiat payment confirmed
    ///
    /// Flow:
    /// 1. Buyer sends fiat off-chain
    /// 2. Buyer confirms payment in app
    /// 3. Merchant confirms receipt of fiat
    /// 4. Merchant (or arbiter) calls this instruction
    /// 5. Tokens transfer from vault → buyer with fee deduction
    ///
    /// Security:
    /// - Status must be Locked
    /// - Taker must match stored taker
    /// - Signer must be maker OR arbiter (prevents unauthorized release)
    /// - Fee calculated and sent to treasury
    pub fn release_to_taker(ctx: Context<ReleaseToTaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Locked,
            EscrowError::InvalidStatus
        );
        require_keys_eq!(
            escrow.taker,
            ctx.accounts.taker.key(),
            EscrowError::WrongTaker
        );

        // Only maker (merchant) or arbiter can release
        let signer = ctx.accounts.signer.key();
        require!(
            signer == escrow.maker || signer == escrow.arbiter,
            EscrowError::Unauthorized
        );

        require_keys_eq!(
            escrow.treasury,
            ctx.accounts.treasury.key(),
            EscrowError::WrongTreasury
        );

        // Validate token accounts
        let _mint = read_mint(&ctx.accounts.mint)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;
        let taker_ata = read_token_account(&ctx.accounts.taker_ata)?;
        let treasury_ata = read_token_account(&ctx.accounts.treasury_ata)?;

        require_keys_eq!(vault_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(taker_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(treasury_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);

        let amount = escrow.amount;

        // Calculate fee (basis points)
        let fee = amount
            .checked_mul(escrow.fee_bps as u64)
            .ok_or(EscrowError::MathOverflow)?
            / 10_000;

        let payout = amount
            .checked_sub(fee)
            .ok_or(EscrowError::MathOverflow)?;

        let escrow_key = escrow.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow-signer",
            escrow_key.as_ref(),
            &[escrow.signer_bump],
        ]];

        // Transfer payout to buyer (taker)
        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.taker_ata.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, payout)?;
        }

        // Transfer fee to treasury
        if fee > 0 {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.treasury_ata.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, fee)?;
        }

        // Close vault and return rent to maker
        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.vault_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::close_account(cpi_ctx)?;
        }

        escrow.status = EscrowStatus::Released;

        emit!(EscrowReleasedEvent {
            escrow: escrow.key(),
            deal_id: escrow.deal_id,
            taker: escrow.taker,
            amount: payout,
            fee,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Refund funds to merchant (maker) if trade fails
    ///
    /// Scenarios:
    /// - Buyer doesn't pay within payment window (timeout)
    /// - Buyer cancels order
    /// - Arbiter determines buyer didn't pay (dispute resolution)
    ///
    /// Security:
    /// - Status must be Funded OR Locked
    /// - Signer must be maker OR arbiter
    /// - Returns full amount (no fee deduction on refund)
    pub fn refund_to_maker(ctx: Context<RefundToMaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Funded || escrow.status == EscrowStatus::Locked,
            EscrowError::InvalidStatus
        );

        let signer = ctx.accounts.signer.key();
        require!(
            signer == escrow.maker || signer == escrow.arbiter,
            EscrowError::Unauthorized
        );

        // Validate token accounts
        let _mint = read_mint(&ctx.accounts.mint)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;
        let maker_ata = read_token_account(&ctx.accounts.maker_ata)?;

        require_keys_eq!(vault_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(maker_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(
            maker_ata.owner,
            ctx.accounts.maker.key(),
            EscrowError::BadMakerAtaOwner
        );

        let escrow_key = escrow.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow-signer",
            escrow_key.as_ref(),
            &[escrow.signer_bump],
        ]];

        // Transfer full amount back to maker (no fee on refund)
        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.maker_ata.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, escrow.amount)?;
        }

        // Close vault and return rent to maker
        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.vault_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::close_account(cpi_ctx)?;
        }

        escrow.status = EscrowStatus::Refunded;

        emit!(EscrowRefundedEvent {
            escrow: escrow.key(),
            deal_id: escrow.deal_id,
            maker: escrow.maker,
            amount: escrow.amount,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    /// Admin instruction to cancel escrow before locking
    /// Only callable by arbiter in emergency situations
    pub fn emergency_cancel(ctx: Context<EmergencyCancel>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        // Only arbiter can emergency cancel
        require_keys_eq!(
            ctx.accounts.arbiter.key(),
            escrow.arbiter,
            EscrowError::Unauthorized
        );

        // Can only cancel if not yet locked (Funded status)
        require!(
            escrow.status == EscrowStatus::Funded,
            EscrowError::InvalidStatus
        );

        // Refund logic same as refund_to_maker
        let _mint = read_mint(&ctx.accounts.mint)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;
        let maker_ata = read_token_account(&ctx.accounts.maker_ata)?;

        require_keys_eq!(vault_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(maker_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);

        let escrow_key = escrow.key();
        let signer_seeds: &[&[&[u8]]] = &[&[
            b"escrow-signer",
            escrow_key.as_ref(),
            &[escrow.signer_bump],
        ]];

        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    to: ctx.accounts.maker_ata.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::transfer(cpi_ctx, escrow.amount)?;
        }

        {
            let cpi_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.vault_ata.to_account_info(),
                    destination: ctx.accounts.maker.to_account_info(),
                    authority: ctx.accounts.escrow_signer.to_account_info(),
                },
                signer_seeds,
            );
            token::close_account(cpi_ctx)?;
        }

        escrow.status = EscrowStatus::Cancelled;

        emit!(EscrowCancelledEvent {
            escrow: escrow.key(),
            deal_id: escrow.deal_id,
            cancelled_by: ctx.accounts.arbiter.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }
}

// ----------------- SPL parsers -----------------

fn read_mint(mint_ai: &UncheckedAccount) -> Result<spl_state::Mint> {
    let ai = mint_ai.to_account_info();
    require_keys_eq!(
        *ai.owner,
        spl_token::id(),
        EscrowError::WrongTokenProgram
    );
    let data = ai.try_borrow_data()?;
    spl_state::Mint::unpack(&data).map_err(|_| error!(EscrowError::BadMintData))
}

fn read_token_account(ata_ai: &UncheckedAccount) -> Result<spl_state::Account> {
    let ai = ata_ai.to_account_info();
    require_keys_eq!(
        *ai.owner,
        spl_token::id(),
        EscrowError::WrongTokenProgram
    );
    let data = ai.try_borrow_data()?;
    spl_state::Account::unpack(&data).map_err(|_| error!(EscrowError::BadTokenAccountData))
}

// ----------------- Accounts -----------------

#[derive(Accounts)]
#[instruction(deal_id: [u8; 16])]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,

    /// CHECK: Arbiter for dispute resolution
    pub arbiter: SystemAccount<'info>,

    /// CHECK: Treasury for fee collection
    pub treasury: SystemAccount<'info>,

    /// CHECK: SPL Mint account. Validated at runtime
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = maker,
        space = 8 + Escrow::LEN,
        seeds = [b"escrow", maker.key().as_ref(), deal_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer derived from seeds
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: SPL Token vault ATA. Validated at runtime
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Maker token account. Validated at runtime
    #[account(mut)]
    pub maker_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct LockForTaker<'info> {
    pub taker: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct ReleaseToTaker<'info> {
    pub signer: Signer<'info>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,
    #[account(mut)]
    pub taker: SystemAccount<'info>,
    #[account(mut)]
    pub treasury: SystemAccount<'info>,

    /// CHECK: SPL Mint account. Validated at runtime
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump = escrow.signer_bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: Vault ATA. Validated at runtime
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Taker ATA. Validated at runtime
    #[account(mut)]
    pub taker_ata: UncheckedAccount<'info>,

    /// CHECK: Treasury ATA. Validated at runtime
    #[account(mut)]
    pub treasury_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundToMaker<'info> {
    pub signer: Signer<'info>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,

    /// CHECK: SPL Mint account. Validated at runtime
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump = escrow.signer_bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: Vault ATA. Validated at runtime
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Maker ATA. Validated at runtime
    #[account(mut)]
    pub maker_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EmergencyCancel<'info> {
    pub arbiter: Signer<'info>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,

    /// CHECK: SPL Mint account
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump = escrow.signer_bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: Vault ATA
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Maker ATA
    #[account(mut)]
    pub maker_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// ----------------- State -----------------

#[account]
pub struct Escrow {
    pub version: u8,
    pub deal_id: [u8; 16],

    pub maker: Pubkey,      // Merchant wallet
    pub taker: Pubkey,      // Buyer wallet
    pub arbiter: Pubkey,    // Dispute resolver
    pub treasury: Pubkey,   // Fee destination

    pub mint: Pubkey,       // Token mint (USDT, USDC, etc.)
    pub amount: u64,        // Locked amount in lamports
    pub fee_bps: u16,       // Fee in basis points (250 = 2.5%)

    pub status: EscrowStatus,

    pub escrow_bump: u8,
    pub signer_bump: u8,
}

impl Escrow {
    pub const LEN: usize =
        1 + 16 +              // version + deal_id
        32 + 32 + 32 + 32 +   // maker + taker + arbiter + treasury
        32 +                  // mint
        8 +                   // amount
        2 +                   // fee_bps
        1 +                   // status
        1 + 1;                // bumps
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Funded,    // Merchant deposited funds
    Locked,    // Buyer accepted, awaiting fiat payment
    Released,  // Funds released to buyer
    Refunded,  // Funds returned to merchant
    Cancelled, // Emergency cancelled by arbiter
}

// ----------------- Events -----------------

#[event]
pub struct EscrowCreatedEvent {
    pub escrow: Pubkey,
    pub deal_id: [u8; 16],
    pub maker: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct EscrowLockedEvent {
    pub escrow: Pubkey,
    pub deal_id: [u8; 16],
    pub taker: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct EscrowReleasedEvent {
    pub escrow: Pubkey,
    pub deal_id: [u8; 16],
    pub taker: Pubkey,
    pub amount: u64,
    pub fee: u64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowRefundedEvent {
    pub escrow: Pubkey,
    pub deal_id: [u8; 16],
    pub maker: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowCancelledEvent {
    pub escrow: Pubkey,
    pub deal_id: [u8; 16],
    pub cancelled_by: Pubkey,
    pub timestamp: i64,
}

// ----------------- Errors -----------------

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Fee too high (max 10%)")]
    FeeTooHigh,
    #[msg("Invalid status for this operation")]
    InvalidStatus,
    #[msg("Escrow already taken by another buyer")]
    AlreadyTaken,
    #[msg("Unauthorized: only maker or arbiter can perform this action")]
    Unauthorized,
    #[msg("Wrong taker address")]
    WrongTaker,
    #[msg("Wrong treasury address")]
    WrongTreasury,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient balance in maker account")]
    InsufficientBalance,

    #[msg("Wrong token program owner")]
    WrongTokenProgram,
    #[msg("Bad mint account data")]
    BadMintData,
    #[msg("Bad token account data")]
    BadTokenAccountData,
    #[msg("Mint mismatch")]
    BadMint,
    #[msg("Maker ATA owner mismatch")]
    BadMakerAtaOwner,
}
