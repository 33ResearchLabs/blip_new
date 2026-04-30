/**
 * Verify the on-chain PDA bundle a client submitted for an order matches
 * the canonical derivation from `(escrow_creator_wallet, escrow_trade_id)`.
 *
 * The Anchor seeds for trade and escrow accounts are deterministic — given
 * the same creator pubkey and trade id, every honest party derives the same
 * PDAs. Any submitted `escrow_trade_pda` or `escrow_pda` that doesn't match
 * the local derivation is either a client bug or a payout-redirection
 * attack; both should be refused.
 *
 * Storage rule: callers MUST persist the *derived* PDAs from the result, not
 * the originally submitted ones. After a successful verification both
 * are equal, but using the derived value as the canonical source removes
 * any opportunity for a typo or normalization quirk to propagate.
 *
 * Pure module: synchronous, no DB / RPC. Wraps the existing Anchor seed
 * helpers in `pdas.ts` (single source of truth for seeds).
 */

import { PublicKey } from '@solana/web3.js';
import { findTradePda, findEscrowPda } from './pdas';
import { logger } from '@/lib/logger';

const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TRADE_ID_MAX = Number.MAX_SAFE_INTEGER;

/**
 * Strict default. Flip to `false` only as an emergency rollback if the
 * derivation logic itself is suspected of being wrong; mismatches then
 * downgrade from REJECT to a WARN-log and the request proceeds with the
 * client-supplied PDAs. Should never be off in steady-state production.
 */
export function isPdaVerificationStrict(): boolean {
  return process.env.PDA_VERIFICATION_STRICT !== 'false';
}

export interface PdaBindingInput {
  creatorWallet?: string | null;
  tradeId?: number | string | null;
  /** Optional client-submitted attestations to compare against derivation. */
  submittedTradePda?: string | null;
  submittedEscrowPda?: string | null;
  /** Order id only used for logging — not in derivation. */
  orderId?: string;
}

export interface PdaBindingDerived {
  tradePda: string;
  escrowPda: string;
  creatorWallet: string;
  tradeId: number;
}

export type PdaBindingResult =
  | { ok: true; derived: PdaBindingDerived; lax?: false }
  | { ok: true; derived: PdaBindingDerived; lax: true; reason: string }
  | { ok: false; reason: string; field?: 'creatorWallet' | 'tradeId' | 'tradePda' | 'escrowPda' };

function asTradeIdNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > TRADE_ID_MAX) return null;
  return n;
}

/**
 * Verify the binding. Returns derived PDAs on success; the caller MUST
 * use these (not the originally submitted values) for any downstream
 * persistence or on-chain instruction construction.
 */
export function verifyEscrowPdaBinding(input: PdaBindingInput): PdaBindingResult {
  const { creatorWallet, tradeId, submittedTradePda, submittedEscrowPda, orderId } = input;

  const hasAnySubmittedPda = !!(submittedTradePda || submittedEscrowPda);

  if (!creatorWallet || typeof creatorWallet !== 'string' || !SOLANA_BASE58_RE.test(creatorWallet)) {
    return {
      ok: false,
      field: 'creatorWallet',
      reason: 'escrow_creator_wallet missing or not a valid Solana base58 pubkey',
    };
  }

  const tradeIdNum = asTradeIdNumber(tradeId);
  if (tradeIdNum === null) {
    return {
      ok: false,
      field: 'tradeId',
      reason: 'escrow_trade_id missing or not a non-negative integer',
    };
  }

  // Derive canonical PDAs from creator + tradeId. Throws synchronously if
  // creatorWallet isn't a real pubkey on the Ed25519 curve — caught and
  // mapped to a clean 4xx envelope.
  let creatorPk: PublicKey;
  try {
    creatorPk = new PublicKey(creatorWallet);
  } catch {
    return {
      ok: false,
      field: 'creatorWallet',
      reason: 'escrow_creator_wallet is not a valid PublicKey',
    };
  }

  const [tradePda] = findTradePda(creatorPk, tradeIdNum);
  const [escrowPda] = findEscrowPda(tradePda);

  const derivedTradeStr = tradePda.toBase58();
  const derivedEscrowStr = escrowPda.toBase58();

  // Compare submitted attestations if provided.
  if (submittedTradePda && submittedTradePda !== derivedTradeStr) {
    const reason =
      `escrow_trade_pda mismatch — submitted=${submittedTradePda} ` +
      `derived=${derivedTradeStr} (creator=${creatorWallet}, trade_id=${tradeIdNum})`;
    if (isPdaVerificationStrict()) {
      logger.error('[security][escrow_pda] trade PDA mismatch — REJECTING', {
        orderId, submittedTradePda, derivedTradePda: derivedTradeStr,
        creatorWallet, tradeId: tradeIdNum,
      });
      return { ok: false, field: 'tradePda', reason };
    }
    logger.warn('[security][escrow_pda] trade PDA mismatch (lax mode — allowing)', {
      orderId, submittedTradePda, derivedTradePda: derivedTradeStr,
      creatorWallet, tradeId: tradeIdNum,
    });
    return {
      ok: true,
      lax: true,
      reason,
      derived: { tradePda: derivedTradeStr, escrowPda: derivedEscrowStr, creatorWallet, tradeId: tradeIdNum },
    };
  }

  if (submittedEscrowPda && submittedEscrowPda !== derivedEscrowStr) {
    const reason =
      `escrow_pda mismatch — submitted=${submittedEscrowPda} ` +
      `derived=${derivedEscrowStr} (trade_pda=${derivedTradeStr})`;
    if (isPdaVerificationStrict()) {
      logger.error('[security][escrow_pda] escrow PDA mismatch — REJECTING', {
        orderId, submittedEscrowPda, derivedEscrowPda: derivedEscrowStr,
        tradePda: derivedTradeStr,
      });
      return { ok: false, field: 'escrowPda', reason };
    }
    logger.warn('[security][escrow_pda] escrow PDA mismatch (lax mode — allowing)', {
      orderId, submittedEscrowPda, derivedEscrowPda: derivedEscrowStr,
      tradePda: derivedTradeStr,
    });
    return {
      ok: true,
      lax: true,
      reason,
      derived: { tradePda: derivedTradeStr, escrowPda: derivedEscrowStr, creatorWallet, tradeId: tradeIdNum },
    };
  }

  // Either no submitted PDAs (client only sent creator+tradeId — fine,
  // we derive) or all submitted values match. Audit-log the binding so
  // later forensics can correlate the on-chain accounts with the order.
  if (hasAnySubmittedPda) {
    logger.info('[escrow_pda] binding verified', {
      orderId, tradePda: derivedTradeStr, escrowPda: derivedEscrowStr,
      creatorWallet, tradeId: tradeIdNum,
    });
  }

  return {
    ok: true,
    derived: { tradePda: derivedTradeStr, escrowPda: derivedEscrowStr, creatorWallet, tradeId: tradeIdNum },
  };
}

/**
 * Refuse if the client submitted a PDA without the creator+tradeId we
 * need to verify it. Routes call this after the basic input check;
 * separated so the logic stays trivially testable.
 */
export function rejectsSubmittedPdaWithoutDerivationInputs(input: PdaBindingInput): PdaBindingResult | null {
  const hasAnySubmittedPda = !!(input.submittedTradePda || input.submittedEscrowPda);
  const hasInputsForDerivation = !!input.creatorWallet && (input.tradeId !== null && input.tradeId !== undefined && input.tradeId !== '');
  if (hasAnySubmittedPda && !hasInputsForDerivation) {
    return {
      ok: false,
      reason:
        'cannot verify PDA without escrow_creator_wallet and escrow_trade_id; ' +
        'do not submit escrow_trade_pda / escrow_pda separately',
    };
  }
  return null;
}
