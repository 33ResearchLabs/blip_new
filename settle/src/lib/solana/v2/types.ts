/**
 * Blip Protocol V2.3 Types
 * Includes PaymentSent, Disputed states and dispute resolution
 */

import { PublicKey } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';

// Trade status enum
export enum TradeStatus {
  Created = 'Created',
  Funded = 'Funded',       // Escrow funded, waiting for counterparty to accept
  Locked = 'Locked',       // Counterparty set, awaiting fiat payment
  PaymentSent = 'PaymentSent',  // Buyer claims fiat sent (NO auto-refund)
  Disputed = 'Disputed',   // Trade frozen for arbitration
  Released = 'Released',
  Refunded = 'Refunded',
}

// Trade side enum
export enum TradeSide {
  Buy = 'Buy',
  Sell = 'Sell',
}

// Dispute resolution outcome
export enum DisputeResolution {
  ReleaseToBuyer = 'ReleaseToBuyer',
  RefundToSeller = 'RefundToSeller',
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
  expiresAt: BN;            // Escrow expiration (0 = no expiration after payment confirmed)
  paymentConfirmedAt: BN;   // When buyer confirmed payment (0 if not confirmed)
  disputedAt: BN;           // When dispute was opened (0 if not disputed)
  disputeInitiator: PublicKey;  // Who opened the dispute
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

// Extend escrow params (depositor only)
export interface ExtendEscrowParams {
  tradePda: PublicKey;
  extensionSeconds: BN;  // Additional seconds to extend (e.g., 86400 for 24 hours)
}

// Confirm payment params (buyer only)
export interface ConfirmPaymentParams {
  tradePda: PublicKey;
}

// Open dispute params (either party)
export interface OpenDisputeParams {
  tradePda: PublicKey;
}

// Resolve dispute params (arbiter only)
export interface ResolveDisputeParams {
  tradePda: PublicKey;
  resolution: DisputeResolution;
  mint: PublicKey;
}
