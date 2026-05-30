use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

/// Calculate fee and payout for given amount and fee rate
///
/// Returns (payout, fee) where payout + fee = amount
pub fn calculate_fee(amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    // Use u128 to prevent overflow during multiplication
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_div(10_000)
        .ok_or(ErrorCode::Overflow)?
        as u64;

    let payout = amount
        .checked_sub(fee)
        .ok_or(ErrorCode::InsufficientAmount)?;

    Ok((payout, fee))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_calculation() {
        // 2.5% fee on 1,000,000
        let (payout, fee) = calculate_fee(1_000_000, 250).unwrap();
        assert_eq!(fee, 25_000);
        assert_eq!(payout, 975_000);
        assert_eq!(payout + fee, 1_000_000);

        // 0.5% fee on 1,000,000
        let (payout, fee) = calculate_fee(1_000_000, 50).unwrap();
        assert_eq!(fee, 5_000);
        assert_eq!(payout, 995_000);

        // 5% fee (max) on 1,000,000
        let (payout, fee) = calculate_fee(1_000_000, 500).unwrap();
        assert_eq!(fee, 50_000);
        assert_eq!(payout, 950_000);

        // 0% fee
        let (payout, fee) = calculate_fee(1_000_000, 0).unwrap();
        assert_eq!(fee, 0);
        assert_eq!(payout, 1_000_000);
    }

    #[test]
    fn test_fee_rounding() {
        // Test rounding down (Solana truncates)
        let (payout, fee) = calculate_fee(999, 250).unwrap();
        assert_eq!(fee, 24); // 999 * 250 / 10000 = 24.975 → 24
        assert_eq!(payout, 975);
    }
}
