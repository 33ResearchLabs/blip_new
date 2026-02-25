/**
 * Wallet Feature — Public API
 *
 * Import from '@/features/wallet' for clean, feature-scoped access.
 *
 * EXISTING HOOKS NOT REPLACED:
 *  - useMerchantAuth     (hooks/useMerchantAuth.ts)     — Full merchant auth flow
 *  - useWalletAuth       (hooks/useWalletAuth.ts)       — Full user auth flow
 *  - useWalletConnection (hooks/useWalletConnection.ts) — Adapter connection state
 *
 * Those hooks tightly integrate with Solana wallet adapters and should
 * continue to be used directly from '@/hooks/'.
 */

// Services
export {
  generateLoginMessage,
  requestWalletSignature,
  authenticateWithWallet,
  setUsername,
  authenticateMerchantWithWallet,
  createMerchantAccount,
  authApi,
} from './services/auth.service';

export {
  getWalletBalance,
  getMockBalance,
  type BalanceResult,
} from './services/balance.service';

// Hooks
export { useWalletBalance } from './hooks/useWalletBalance';
