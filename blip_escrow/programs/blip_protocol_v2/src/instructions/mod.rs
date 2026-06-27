pub mod initialize_config;
pub mod update_config;
pub mod create_trade;
pub mod fund_escrow;
pub mod accept_trade;
pub mod lock_escrow;
pub mod extend_escrow;
pub mod release_escrow;
pub mod refund_escrow;
pub mod cancel_trade_mutual;
pub mod match_offer;

// V2.3: Payment confirmation and dispute resolution
pub mod confirm_payment;
pub mod open_dispute;
pub mod resolve_dispute;
pub mod set_arbiters;
pub mod resolve_dispute_timeout;

// V2.2: Liquidity lanes for atomic matching
pub mod create_lane;
pub mod fund_lane;
pub mod withdraw_lane;
pub mod match_offer_and_lock_from_lane;

// Emergency: V2.2 legacy account handling
pub mod emergency_refund_v2;

// Permissionless reclaimer for terminal Trade PDAs (recovers rent from
// trades that completed under older binary releases before `close = depositor`
// landed in release_escrow / refund_escrow).
pub mod close_trade;

pub use initialize_config::*;
pub use update_config::*;
pub use create_trade::*;
pub use fund_escrow::*;
pub use accept_trade::*;
pub use lock_escrow::*;
pub use extend_escrow::*;
pub use release_escrow::*;
pub use refund_escrow::*;
pub use cancel_trade_mutual::*;
pub use match_offer::*;

// V2.3 dispute resolution exports
pub use confirm_payment::*;
pub use open_dispute::*;
pub use resolve_dispute::*;
pub use set_arbiters::*;
pub use resolve_dispute_timeout::*;

// V2.2 lane exports
pub use create_lane::*;
pub use fund_lane::*;
pub use withdraw_lane::*;
pub use match_offer_and_lock_from_lane::*;

// Emergency V2.2 legacy exports
pub use emergency_refund_v2::*;

// close_trade exports — Anchor's #[program] macro requires the full glob
// to pick up generated client modules (__client_accounts_close_trade etc).
// `handler` name ambiguity with other modules is just a warning.
pub use close_trade::*;
