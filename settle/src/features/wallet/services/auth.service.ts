/**
 * Wallet Auth Service — API communication for wallet-based authentication
 *
 * Wraps the existing walletAuth library functions. No React state.
 * The underlying signature verification and account creation logic
 * lives in lib/auth/walletAuth.ts — this service simply re-exports
 * the async functions for use by hooks.
 *
 * SAFETY: This file MUST NOT contain:
 *  - Session management logic
 *  - Role/permission checks
 *  - Wallet private key handling (handled by wallet adapters)
 */

export {
  generateLoginMessage,
  requestWalletSignature,
  authenticateWithWallet,
  setUsername,
  authenticateMerchantWithWallet,
  createMerchantAccount,
} from '@/lib/auth/walletAuth';

export { auth as authApi } from '@/lib/api/client';
