/**
 * Escrow Feature — Public API
 *
 * Import from '@/features/escrow' for clean, feature-scoped access.
 *
 * SAFETY: On-chain transaction building lives in lib/solana/.
 * These services/hooks only handle the API calls to record
 * escrow state changes AFTER the on-chain tx is confirmed.
 *
 * Escrow payer determination is server-side logic — NEVER in frontend.
 */

// Services
export {
  getEscrowStatus,
  depositEscrow,
  releaseEscrow,
  type EscrowDepositParams,
  type EscrowReleaseParams,
  type EscrowStatusResult,
} from './services/escrow.service';

// Hooks
export { useEscrowStatus } from './hooks/useEscrowStatus';
export { useEscrowDeposit } from './hooks/useEscrowDeposit';
export { useEscrowRelease } from './hooks/useEscrowRelease';
