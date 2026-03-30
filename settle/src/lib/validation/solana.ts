/**
 * Solana address validation — base58 encoded, 32-44 characters.
 * Single source of truth for all Solana wallet address checks.
 */
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidSolanaAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return SOLANA_ADDRESS_REGEX.test(address);
}
