import { PublicKey, Keypair, Transaction, TransactionInstruction, Ed25519Program } from "@solana/web3.js";
import BN from "bn.js";
import * as ed25519 from "@noble/ed25519";
import * as crypto from "crypto";
import { Offer, SignedOffer, CreateOfferParams, TradeSide } from "./types";

/**
 * Create a canonical offer for signing
 *
 * CRITICAL: This MUST produce identical bytes to on-chain Borsh serialization
 */
export function createOffer(params: CreateOfferParams): Offer {
  const {
    creator,
    mint,
    amount,
    side,
    tradeId,
    expirySeconds = 3600, // 1 hour default
    nonce,
    laneId = 0, // V2.2: Default to 0 (two-step fallback)
  } = params;

  const now = Math.floor(Date.now() / 1000);

  return {
    creator,
    mint,
    amount: amount instanceof BN ? amount : new BN(amount),
    side: side === "buy" ? TradeSide.Buy : TradeSide.Sell,
    tradeId: tradeId
      ? tradeId instanceof BN
        ? tradeId
        : new BN(tradeId)
      : new BN(Date.now()),
    expiry: new BN(now + expirySeconds),
    nonce: nonce
      ? nonce instanceof BN
        ? nonce
        : new BN(nonce)
      : new BN(Math.floor(Math.random() * 1_000_000_000)),
    laneId: laneId instanceof BN ? laneId : new BN(laneId), // V2.2
  };
}

/**
 * Serialize offer to canonical bytes for hashing/signing
 *
 * CRITICAL: This MUST match on-chain Borsh serialization exactly
 * V2.2: Updated to 105 bytes (added lane_id field)
 */
export function serializeOffer(offer: Offer): Buffer {
  // Borsh serialization matching Offer struct on-chain (V2.2):
  // - creator: Pubkey (32 bytes)
  // - mint: Pubkey (32 bytes)
  // - amount: u64 (8 bytes, little-endian)
  // - side: enum (1 byte: 0 = Buy, 1 = Sell)
  // - tradeId: u64 (8 bytes, little-endian)
  // - expiry: i64 (8 bytes, little-endian, signed)
  // - nonce: u64 (8 bytes, little-endian)
  // - laneId: u64 (8 bytes, little-endian) ← V2.2

  const buffer = Buffer.alloc(32 + 32 + 8 + 1 + 8 + 8 + 8 + 8); // 105 bytes (V2.2)
  let offset = 0;

  // creator (32 bytes)
  offer.creator.toBuffer().copy(buffer, offset);
  offset += 32;

  // mint (32 bytes)
  offer.mint.toBuffer().copy(buffer, offset);
  offset += 32;

  // amount (u64, 8 bytes LE)
  offer.amount.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // side (enum, 1 byte)
  buffer.writeUInt8(offer.side, offset);
  offset += 1;

  // tradeId (u64, 8 bytes LE)
  offer.tradeId.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // expiry (i64, 8 bytes LE)
  offer.expiry.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // nonce (u64, 8 bytes LE)
  offer.nonce.toArrayLike(Buffer, "le", 8).copy(buffer, offset);
  offset += 8;

  // laneId (u64, 8 bytes LE) - V2.2
  offer.laneId.toArrayLike(Buffer, "le", 8).copy(buffer, offset);

  return buffer;
}

/**
 * Hash canonical offer bytes (SHA256)
 */
export function hashOffer(offerBytes: Buffer): Buffer {
  return crypto.createHash("sha256").update(offerBytes).digest();
}

/**
 * Get signing message for offer (hash of canonical bytes)
 */
export function getOfferSigningMessage(offer: Offer): Buffer {
  const offerBytes = serializeOffer(offer);
  return hashOffer(offerBytes);
}

/**
 * Sign an offer using Ed25519
 *
 * @param offer - Canonical offer
 * @param signer - Keypair to sign with (must match offer.creator)
 * @returns Signed offer with signature and hash
 */
export async function signOffer(
  offer: Offer,
  signer: Keypair
): Promise<SignedOffer> {
  if (!offer.creator.equals(signer.publicKey)) {
    throw new Error("Signer does not match offer creator");
  }

  const message = getOfferSigningMessage(offer);
  const signature = await ed25519.sign(message, signer.secretKey.slice(0, 32));

  return {
    offer,
    signature,
    offerHash: message,
  };
}

/**
 * Verify offer signature (off-chain validation)
 */
export async function verifyOfferSignature(
  signedOffer: SignedOffer
): Promise<boolean> {
  const message = getOfferSigningMessage(signedOffer.offer);

  // Verify hash matches
  if (!message.equals(Buffer.from(signedOffer.offerHash))) {
    return false;
  }

  // Verify signature
  return ed25519.verify(
    signedOffer.signature,
    message,
    signedOffer.offer.creator.toBytes()
  );
}

/**
 * Build Ed25519 signature verification instruction
 *
 * CRITICAL: This instruction MUST be included BEFORE match_offer instruction
 * in the same transaction for signature verification to work.
 */
export function buildEd25519Instruction(
  signedOffer: SignedOffer
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: signedOffer.offer.creator.toBytes(),
    message: signedOffer.offerHash,
    signature: signedOffer.signature,
  });
}

/**
 * Check if offer is expired
 */
export function isOfferExpired(offer: Offer): boolean {
  const now = Math.floor(Date.now() / 1000);
  return offer.expiry.toNumber() <= now;
}

/**
 * Get offer expiry time as Date
 */
export function getOfferExpiry(offer: Offer): Date {
  return new Date(offer.expiry.toNumber() * 1000);
}

/**
 * V2.2: Check if offer uses a lane (atomic matching)
 *
 * @returns true if offer specifies a lane (lane_id > 0), false otherwise
 */
export function usesLane(offer: Offer): boolean {
  return offer.laneId.gt(new BN(0));
}

/**
 * V2.2: Get offer matching mode
 *
 * @returns "atomic" if uses lane, "two-step" if fallback
 */
export function getOfferMatchingMode(offer: Offer): "atomic" | "two-step" {
  return usesLane(offer) ? "atomic" : "two-step";
}
