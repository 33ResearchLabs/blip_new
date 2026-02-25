/**
 * Features — Top-level barrel export
 *
 * Prefer importing from individual features:
 *   import { useCreateOrder } from '@/features/orders';
 *   import { useEscrowDeposit } from '@/features/escrow';
 *   import { useWalletBalance } from '@/features/wallet';
 *
 * This file exists for convenience but feature-level imports are preferred
 * to avoid pulling in unused code and to prevent cross-feature coupling.
 */

export * as orders from './orders';
export * as wallet from './wallet';
export * as escrow from './escrow';
