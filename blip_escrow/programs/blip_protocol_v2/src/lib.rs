use anchor_lang::prelude::*;

pub mod state;
pub mod instructions;
pub mod events;
pub mod errors;
pub mod utils;

use instructions::*;
use state::*;

declare_id!("AzhunmkEJEBa7RBjhgwvax8WdKZGMfmF8EHbMG1a4ez8");

#[program]
pub mod blip_protocol_v2 {
    use super::*;

    /// Initialize protocol configuration (one-time setup)
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        params: InitializeConfigParams,
    ) -> Result<()> {
        instructions::initialize_config::handler(ctx, params)
    }

    /// Update protocol configuration (authority only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        params: UpdateConfigParams,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }

    /// Create a new trade
    pub fn create_trade(
        ctx: Context<CreateTrade>,
        params: CreateTradeParams,
    ) -> Result<()> {
        instructions::create_trade::handler(ctx, params)
    }

    /// Fund escrow WITHOUT counterparty (open for acceptance)
    /// Use this when you want to fund first and let someone join later
    pub fn fund_escrow(ctx: Context<FundEscrow>) -> Result<()> {
        instructions::fund_escrow::handler(ctx)
    }

    /// Accept a funded trade as the counterparty
    /// Transitions trade from Funded → Locked
    pub fn accept_trade(ctx: Context<AcceptTrade>) -> Result<()> {
        instructions::accept_trade::handler(ctx)
    }

    /// Lock escrow (deposit funds WITH counterparty in one step)
    /// Use this when you know the counterparty upfront
    pub fn lock_escrow(
        ctx: Context<LockEscrow>,
        params: LockEscrowParams,
    ) -> Result<()> {
        instructions::lock_escrow::handler(ctx, params)
    }

    /// Release escrow to counterparty (with fee)
    pub fn release_escrow(ctx: Context<ReleaseEscrow>) -> Result<()> {
        instructions::release_escrow::handler(ctx)
    }

    /// Extend escrow expiration (depositor only)
    pub fn extend_escrow(
        ctx: Context<ExtendEscrow>,
        params: ExtendEscrowParams,
    ) -> Result<()> {
        instructions::extend_escrow::handler(ctx, params)
    }

    /// Refund escrow to depositor (no fee)
    /// STATE-AWARE:
    ///   Funded pre-expiry    → seller only
    ///   Funded post-expiry   → anyone
    ///   Locked post-window   → anyone (permissionless hard timeout)
    ///   PaymentSent/Disputed → BLOCKED (dispute path only)
    pub fn refund_escrow(ctx: Context<RefundEscrow>) -> Result<()> {
        instructions::refund_escrow::handler(ctx)
    }

    /// Mutual cancellation — both parties co-sign. Allowed only in
    /// Funded/Locked. Refunds to depositor; closes escrow.
    pub fn cancel_trade_mutual(ctx: Context<CancelTradeMutual>) -> Result<()> {
        instructions::cancel_trade_mutual::handler(ctx)
    }

    // ========================================
    // V2.3: Payment Confirmation & Disputes
    // ========================================

    /// Buyer confirms fiat payment sent
    /// Transitions: Locked → PaymentSent
    /// CRITICAL: After this, auto-refund is FORBIDDEN
    pub fn confirm_payment(ctx: Context<ConfirmPayment>) -> Result<()> {
        instructions::confirm_payment::handler(ctx)
    }

    /// Open a dispute on the trade
    /// Either party can call when in Locked or PaymentSent state
    /// Transitions: Locked/PaymentSent → Disputed
    pub fn open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
        instructions::open_dispute::handler(ctx)
    }

    /// Resolve a disputed trade (arbiter only)
    /// Arbiter decides: ReleaseToBuyer or RefundToSeller
    /// Transitions: Disputed → Released/Refunded
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        params: ResolveDisputeParams,
    ) -> Result<()> {
        instructions::resolve_dispute::handler(ctx, params)
    }

    /// Permissionless fallback: refunds a Disputed trade to its depositor
    /// once more than `DISPUTE_WINDOW` (72h) has elapsed since open_dispute.
    /// Safeguards against an unresponsive arbiter.
    pub fn resolve_dispute_timeout(ctx: Context<ResolveDisputeTimeout>) -> Result<()> {
        instructions::resolve_dispute_timeout::handler(ctx)
    }

    /// Set the dispute-arbiter allowlist (authority only).
    pub fn set_arbiters(ctx: Context<SetArbiters>, params: SetArbitersParams) -> Result<()> {
        instructions::set_arbiters::handler(ctx, params)
    }

    /// Match a signed offer (v2.1 - with signature verification)
    pub fn match_offer(
        ctx: Context<MatchOffer>,
        params: MatchOfferParams,
    ) -> Result<()> {
        instructions::match_offer::handler(ctx, params)
    }

    // ========================================
    // V2.2 Lane instructions are DEFERRED for mainnet v1.0.
    //
    // create_lane, fund_lane, withdraw_lane, match_offer_and_lock_from_lane
    // remain implemented in `instructions/` but are NOT registered in the
    // program here, so they are unreachable from clients (the IDL does not
    // export them and no SDK can construct calls).
    //
    // Why: atomic-matching from prefunded lanes is the highest-complexity
    // surface in this program. v1 ships with direct escrow + V2.1 signed-
    // offer matching only — both have a per-trade merchant signature
    // checkpoint. Lanes will be re-enabled in v2 after an external audit.
    //
    // To re-enable: uncomment the four `pub fn` blocks below and rebuild.
    // The handler files, account structs, errors, and Lane state account
    // are intentionally kept in tree to minimise diff vs v2.
    // ========================================

    // pub fn create_lane(
    //     ctx: Context<CreateLane>,
    //     params: CreateLaneParams,
    // ) -> Result<()> {
    //     instructions::create_lane::handler(ctx, params)
    // }
    //
    // pub fn fund_lane(
    //     ctx: Context<FundLane>,
    //     params: FundLaneParams,
    // ) -> Result<()> {
    //     instructions::fund_lane::handler(ctx, params)
    // }
    //
    // pub fn withdraw_lane(
    //     ctx: Context<WithdrawLane>,
    //     params: WithdrawLaneParams,
    // ) -> Result<()> {
    //     instructions::withdraw_lane::handler(ctx, params)
    // }
    //
    // pub fn match_offer_and_lock_from_lane(
    //     ctx: Context<MatchOfferAndLockFromLane>,
    //     params: MatchOfferAndLockFromLaneParams,
    // ) -> Result<()> {
    //     instructions::match_offer_and_lock_from_lane::handler(ctx, params)
    // }

    // ========================================
    // Emergency: V2.2 Legacy Account Handling
    // ========================================

    /// Emergency refund for V2.2 legacy accounts
    /// Use this to refund accounts created before the V2.3 upgrade
    /// that cannot be deserialized by the current program
    pub fn emergency_refund_v2(ctx: Context<EmergencyRefundV2>) -> Result<()> {
        instructions::emergency_refund_v2::emergency_refund_v2(ctx)
    }

    /// Close a terminal Trade PDA and return its rent to the creator.
    ///
    /// Permissionless: any caller can pay the network fee, but the rent
    /// always flows back to `trade.creator` (enforced by the
    /// `rent_recipient` address constraint inside CloseTrade). Lets a
    /// reaper bot — or the user themselves — reclaim ~$0.22 of rent that
    /// would otherwise stay locked forever on every released/refunded
    /// trade.
    pub fn close_trade(ctx: Context<CloseTrade>) -> Result<()> {
        instructions::close_trade::handler(ctx)
    }
}
