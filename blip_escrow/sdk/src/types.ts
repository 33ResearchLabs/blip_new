import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export enum TradeSide {
  Buy = 0,
  Sell = 1,
}

export interface Offer {
  creator: PublicKey;
  mint: PublicKey;
  amount: BN;
  side: TradeSide;
  tradeId: BN;
  expiry: BN; // Unix timestamp (seconds)
  nonce: BN;
  laneId: BN; // V2.2: Lane ID (0 = no lane, fallback to two-step)
}

export interface SignedOffer {
  offer: Offer;
  signature: Uint8Array; // 64 bytes Ed25519 signature
  offerHash: Uint8Array; // 32 bytes SHA256 hash
}

export interface CreateOfferParams {
  creator: PublicKey;
  mint: PublicKey;
  amount: number | BN;
  side: "buy" | "sell";
  tradeId?: number | BN; // Optional, defaults to timestamp
  expirySeconds?: number; // Optional, defaults to 1 hour
  nonce?: number | BN; // Optional, defaults to random
  laneId?: number | BN; // V2.2: Optional lane ID (0 = two-step, >0 = atomic)
}

// V2.2: Lane management types
export interface CreateLaneParams {
  merchant: PublicKey;
  laneId: number | BN;
  mint: PublicKey;
  minAmount: number | BN;
  maxAmount: number | BN;
}

export interface FundLaneParams {
  merchant: PublicKey;
  laneId: number | BN;
  mint: PublicKey;
  amount: number | BN;
}

export interface WithdrawLaneParams {
  merchant: PublicKey;
  laneId: number | BN;
  mint: PublicKey;
  amount: number | BN;
}
