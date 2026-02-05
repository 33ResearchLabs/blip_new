/**
 * Blip Protocol V2.2 Types
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Trade status enum
export enum TradeStatus {
  Created = 'Created',
  Funded = 'Funded',  // Escrow funded, waiting for counterparty to accept
  Locked = 'Locked',
  Released = 'Released',
  Refunded = 'Refunded',
}

// Trade side enum
export enum TradeSide {
  Buy = 'Buy',
  Sell = 'Sell',
}

// On-chain Lane account structure
export interface Lane {
  merchant: PublicKey;
  laneId: BN;
  mint: PublicKey;
  vaultAuthority: PublicKey;
  vaultAta: PublicKey;
  availableBalance: BN;
  minAmount: BN;
  maxAmount: BN;
  isActive: boolean;
  bump: number;
  vaultBump: number;
  createdAt: BN;
  updatedAt: BN;
}

// On-chain Trade account structure
export interface Trade {
  creator: PublicKey;
  counterparty: PublicKey;
  tradeId: BN;
  mint: PublicKey;
  amount: BN;
  status: TradeStatus;
  feeBps: number;
  escrowBump: number;
  bump: number;
  createdAt: BN;
  lockedAt: BN;
  settledAt: BN;
  side: TradeSide;
}

// On-chain Escrow account structure
export interface Escrow {
  trade: PublicKey;
  vaultAuthority: PublicKey;
  vaultAta: PublicKey;
  depositor: PublicKey;
  amount: BN;
  bump: number;
  vaultBump: number;
}

// Lane info with PDAs
export interface LaneInfo {
  lanePda: PublicKey;
  laneVaultAuthority: PublicKey;
  laneVaultAta: PublicKey;
  lane: Lane;
}

// Create lane params
export interface CreateLaneParams {
  laneId: number;
  minAmount: BN;
  maxAmount: BN;
  mint: PublicKey;
}

// Fund lane params
export interface FundLaneParams {
  laneId: number;
  amount: BN;
}

// Withdraw lane params
export interface WithdrawLaneParams {
  laneId: number;
  amount: BN;
}

// Create trade params
export interface CreateTradeParams {
  tradeId: number;
  amount: BN;
  side: TradeSide;
}

// Fund escrow params (no counterparty needed)
export interface FundEscrowParams {
  tradePda: PublicKey;
  mint: PublicKey;
}

// Accept trade params (counterparty joins)
export interface AcceptTradeParams {
  tradePda: PublicKey;
}

// Lock escrow params
export interface LockEscrowParams {
  counterparty: PublicKey;
}

// Release escrow params
export interface ReleaseEscrowParams {
  tradePda: PublicKey;
  counterparty: PublicKey;
  mint: PublicKey;
}

// Refund escrow params
export interface RefundEscrowParams {
  tradePda: PublicKey;
  mint: PublicKey;
}
