// ============================================================================
// MOCK MODE CONFIGURATION
// ============================================================================
// Set NEXT_PUBLIC_MOCK_MODE=true in .env.local to enable mock mode.
// This disables real Solana wallet connections and uses DB-backed fake USDT.
// Set to false or remove the variable to restore real Solana functionality.
// ============================================================================
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE === 'true';
// Starting balance for new accounts in mock mode
export const MOCK_INITIAL_BALANCE = 10000;
