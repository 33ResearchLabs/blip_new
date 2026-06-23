-- Records the wallet address that performed the on-chain stake, so the stake
-- (and its origin wallet) persist in the user profile even if the wallet is
-- disconnected, and so unstake can require the original staking wallet.
ALTER TABLE staking_positions
  ADD COLUMN IF NOT EXISTS staking_wallet_address VARCHAR(44);
