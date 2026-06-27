use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Fee is outside allowed bounds [min, max]")]
    FeeOutOfBounds,

    #[msg("Treasury account does not match protocol config")]
    InvalidTreasury,

    #[msg("Trade is in invalid state for this operation")]
    InvalidTradeState,

    #[msg("Unauthorized signer for this operation")]
    Unauthorized,

    #[msg("Offer signature verification failed")]
    InvalidSignature,

    #[msg("Offer has expired")]
    OfferExpired,

    #[msg("Offer already filled (replay protection)")]
    OfferAlreadyFilled,

    #[msg("Protocol is frozen - new trades disabled")]
    ProtocolFrozen,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Insufficient amount to cover fee")]
    InsufficientAmount,

    #[msg("Invalid mint for token account")]
    InvalidMint,

    #[msg("Invalid counterparty")]
    InvalidCounterparty,

    #[msg("Trade cannot be funded in current state")]
    CannotFund,

    #[msg("Trade cannot be accepted in current state")]
    CannotAccept,

    #[msg("Cannot accept your own trade")]
    CannotAcceptOwnTrade,

    #[msg("Trade cannot be locked in current state")]
    CannotLock,

    #[msg("Trade cannot be released in current state")]
    CannotRelease,

    #[msg("Trade cannot be refunded in current state")]
    CannotRefund,

    // V2.2 Lane errors
    #[msg("Lane is not active")]
    LaneNotActive,

    #[msg("Insufficient balance in lane vault")]
    InsufficientLaneBalance,

    #[msg("Amount outside lane min/max bounds")]
    AmountOutsideLaneBounds,

    #[msg("Lane does not match offer")]
    InvalidLane,

    #[msg("Offer does not specify a lane")]
    NoLaneSpecified,

    // Expiration errors
    #[msg("Escrow has expired - auto-refund available")]
    EscrowExpired,

    #[msg("Escrow has not expired yet")]
    NotExpired,

    #[msg("Only the depositor can extend escrow")]
    NotDepositor,

    #[msg("Cannot extend - escrow already expired")]
    CannotExtend,

    // Payment confirmation errors
    #[msg("Cannot confirm payment in current state")]
    CannotConfirmPayment,

    #[msg("Only the buyer can confirm payment")]
    NotBuyer,

    // Dispute errors
    #[msg("Cannot dispute in current state")]
    CannotDispute,

    #[msg("Only trade parties can open dispute")]
    NotParty,

    #[msg("Trade is not in disputed state")]
    NotDisputed,

    #[msg("Only authorized arbiters can resolve disputes")]
    NotArbiter,
    #[msg("Too many arbiters")]
    TooManyArbiters,

    #[msg("Must use dispute resolution - payment already confirmed")]
    MustUseDispute,

    #[msg("Buyer payment window still active - cannot cancel yet")]
    BuyerPayWindowActive,

    // Emergency & timeout-resolution errors
    #[msg("Invalid vault account")]
    InvalidVault,

    #[msg("Invalid depositor account")]
    InvalidDepositor,

    #[msg("Trade account is not the expected V2.2 size (150 bytes)")]
    InvalidV2AccountSize,

    #[msg("Trade account owner mismatch")]
    InvalidTradeOwner,

    #[msg("Trade is already settled (Released or Refunded)")]
    TradeAlreadySettled,

    #[msg("Creator account mismatch")]
    CreatorMismatch,

    #[msg("Dispute window has not yet elapsed")]
    DisputeWindowActive,

    #[msg("Extension seconds must be positive")]
    InvalidExtension,

    #[msg("Extension would exceed maximum trade lifetime")]
    ExtensionTooLong,

    #[msg("PaymentSent stale threshold has not elapsed")]
    PaymentNotStale,

    // V2.3 hardening errors
    #[msg("Amount must be greater than zero")]
    InvalidAmount,

    #[msg("Lane bounds invalid: min must be > 0 and ≤ max")]
    InvalidLaneBounds,

    #[msg("max_fee_bps exceeds protocol-wide hard cap (10%)")]
    MaxFeeBpsExceedsHardCap,

    #[msg("Counterparty does not match the value bound to the signed offer")]
    CounterpartyMismatch,

    // close_trade
    #[msg("Trade must be in a terminal state (Released or Refunded) before it can be closed")]
    TradeNotTerminal,

    #[msg("Rent recipient must be the original trade creator")]
    WrongRentRecipient,
}
