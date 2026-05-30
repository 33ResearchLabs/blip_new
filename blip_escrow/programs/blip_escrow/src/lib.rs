use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_pack::Pack;
use anchor_spl::token::{self, CloseAccount, Token, Transfer};
use anchor_spl::token::spl_token;
use anchor_spl::token::spl_token::state as spl_state;

declare_id!("5ggyzySMndginf1msqRXNz9ZmKP8pNLtAQVnVo8PiAX");

#[program]
pub mod blip_escrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        deal_id: [u8; 16],
        amount: u64,
        fee_bps: u16,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(fee_bps <= 1_000, EscrowError::FeeTooHigh);

        let _mint = read_mint(&ctx.accounts.mint)?;
        let maker_ata = read_token_account(&ctx.accounts.maker_ata)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;

        require_keys_eq!(
            maker_ata.owner,
            ctx.accounts.maker.key(),
            EscrowError::BadMakerAtaOwner
        );
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

        let escrow = &mut ctx.accounts.escrow;
        escrow.version = 1;
        escrow.deal_id = deal_id;

        escrow.maker = ctx.accounts.maker.key();
        escrow.taker = Pubkey::default();
        escrow.arbiter = ctx.accounts.arbiter.key();
        escrow.treasury = ctx.accounts.treasury.key();

        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.fee_bps = fee_bps;
        escrow.status = EscrowStatus::Funded;

        escrow.escrow_bump = ctx.bumps.escrow;
        escrow.signer_bump = ctx.bumps.escrow_signer;

        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.maker_ata.to_account_info(),
                to: ctx.accounts.vault_ata.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)?;

        Ok(())
    }

    pub fn lock_for_taker(ctx: Context<LockForTaker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        require!(
            escrow.status == EscrowStatus::Funded,
            EscrowError::InvalidStatus
        );
        require!(escrow.taker == Pubkey::default(), EscrowError::AlreadyTaken);

        escrow.taker = ctx.accounts.taker.key();
        escrow.status = EscrowStatus::Locked;

        Ok(())
    }

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

        let _mint = read_mint(&ctx.accounts.mint)?;
        let vault_ata = read_token_account(&ctx.accounts.vault_ata)?;
        let taker_ata = read_token_account(&ctx.accounts.taker_ata)?;
        let treasury_ata = read_token_account(&ctx.accounts.treasury_ata)?;

        require_keys_eq!(vault_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(taker_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);
        require_keys_eq!(treasury_ata.mint, ctx.accounts.mint.key(), EscrowError::BadMint);

        let amount = escrow.amount;

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

        // payout to taker
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

        // fee to treasury
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

        // close vault -> maker
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
        Ok(())
    }

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

        // vault -> maker
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

        // close vault -> maker
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
        Ok(())
    }
}

// ----------------- SPL parsers (FIXED) -----------------

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

    pub arbiter: SystemAccount<'info>,
    pub treasury: SystemAccount<'info>,

    /// CHECK: SPL Mint account. Validated at runtime:
    /// - owned by SPL Token program (Tokenkeg...)
    /// - data unpacked as Mint
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = maker,
        space = 8 + Escrow::LEN,
        seeds = [b"escrow", maker.key().as_ref(), deal_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer derived from seeds. Used only as token authority signer.
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: SPL Token vault ATA. Validated at runtime:
    /// - owned by SPL Token program
    /// - mint matches provided mint
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Maker token account. Validated at runtime:
    /// - owned by SPL Token program
    /// - mint matches provided mint
    /// - owner == maker
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

    /// CHECK: SPL Mint account. Validated at runtime via read_mint().
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer derived from seeds. Used only as token authority signer.
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump = escrow.signer_bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: Vault ATA. Validated at runtime via read_token_account().
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Taker ATA. Validated at runtime via read_token_account().
    #[account(mut)]
    pub taker_ata: UncheckedAccount<'info>,

    /// CHECK: Treasury ATA. Validated at runtime via read_token_account().
    #[account(mut)]
    pub treasury_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundToMaker<'info> {
    pub signer: Signer<'info>,

    #[account(mut)]
    pub maker: SystemAccount<'info>,

    /// CHECK: SPL Mint account. Validated at runtime via read_mint().
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow.maker.as_ref(), escrow.deal_id.as_ref()],
        bump = escrow.escrow_bump
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: PDA signer derived from seeds. Used only as token authority signer.
    #[account(
        seeds = [b"escrow-signer", escrow.key().as_ref()],
        bump = escrow.signer_bump
    )]
    pub escrow_signer: UncheckedAccount<'info>,

    /// CHECK: Vault ATA. Validated at runtime via read_token_account().
    #[account(mut)]
    pub vault_ata: UncheckedAccount<'info>,

    /// CHECK: Maker ATA. Validated at runtime via read_token_account().
    #[account(mut)]
    pub maker_ata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

// ----------------- State -----------------

#[account]
pub struct Escrow {
    pub version: u8,
    pub deal_id: [u8; 16],

    pub maker: Pubkey,
    pub taker: Pubkey,
    pub arbiter: Pubkey,
    pub treasury: Pubkey,

    pub mint: Pubkey,
    pub amount: u64,
    pub fee_bps: u16,

    pub status: EscrowStatus,

    pub escrow_bump: u8,
    pub signer_bump: u8,
}

impl Escrow {
    pub const LEN: usize =
        1 + 16 +
        32 + 32 + 32 + 32 +
        32 +
        8 +
        2 +
        1 +
        1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum EscrowStatus {
    Funded,
    Locked,
    Released,
    Refunded,
}

// ----------------- Errors -----------------

#[error_code]
pub enum EscrowError {
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Invalid status")]
    InvalidStatus,
    #[msg("Already taken")]
    AlreadyTaken,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Wrong taker")]
    WrongTaker,
    #[msg("Wrong treasury")]
    WrongTreasury,
    #[msg("Math overflow")]
    MathOverflow,

    #[msg("Wrong token program owner")]
    WrongTokenProgram,
    #[msg("Bad mint account data")]
    BadMintData,
    #[msg("Bad token account data")]
    BadTokenAccountData,
    #[msg("Bad mint")]
    BadMint,
    #[msg("Maker ATA owner mismatch")]
    BadMakerAtaOwner,
    #[msg("Bad decimals")]
    BadDecimals,
}
