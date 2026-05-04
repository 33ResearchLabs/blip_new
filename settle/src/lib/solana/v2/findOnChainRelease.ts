/**
 * On-Chain Release / Refund Discovery
 *
 * Given a Trade PDA, look up its full transaction history on Solana and
 * return the actual signature of the ReleaseEscrow / RefundEscrow / CancelTrade
 * instruction if one exists.
 *
 * Used by:
 *   1. confirmPayment fallback when local releaseEscrow() fails with
 *      AccountNotInitialized — we need to know whether the escrow was
 *      already released on-chain (success path) vs never funded (failure
 *      path). The signature lets us mark DB completed with the real tx hash
 *      instead of a sentinel.
 *   2. The reconciliation worker that scans stuck orders and auto-syncs
 *      DB to on-chain truth.
 *
 * Side-effect free, read-only RPC calls.
 */
import { Connection, PublicKey } from '@solana/web3.js';

export type OnChainTradeOutcome =
  | { kind: 'released'; signature: string; blockTime: number | null }
  | { kind: 'refunded'; signature: string; blockTime: number | null }
  | { kind: 'cancelled'; signature: string; blockTime: number | null }
  | { kind: 'open'; latestSignature: string | null }
  | { kind: 'not-found' };

/** Substrings we look for in `meta.logMessages` to classify a tx. */
const RELEASE_LOG_HINTS = ['Instruction: ReleaseEscrow', 'Escrow released'];
const REFUND_LOG_HINTS = ['Instruction: RefundEscrow', 'Escrow refunded'];
const CANCEL_LOG_HINTS = ['Instruction: CancelTrade'];

type TerminalKind = 'released' | 'refunded' | 'cancelled';

function classifyLogs(logs: string[] | null | undefined): TerminalKind | null {
  if (!logs || logs.length === 0) return null;
  for (const line of logs) {
    if (RELEASE_LOG_HINTS.some((h) => line.includes(h))) return 'released';
    if (REFUND_LOG_HINTS.some((h) => line.includes(h))) return 'refunded';
    if (CANCEL_LOG_HINTS.some((h) => line.includes(h))) return 'cancelled';
  }
  return null;
}

/**
 * Inspect the most recent transactions for a Trade PDA and return the
 * terminal outcome (released / refunded / cancelled / still open).
 *
 * `limit` defaults to 8 — covers create+fund, accept, release for normal
 * trades plus a few retries. Bump if you expect deeper histories.
 *
 * Errors (RPC unreachable, malformed responses) bubble up — callers must
 * decide whether to swallow or propagate. Reconciliation worker swallows;
 * the click-fallback also swallows.
 */
export async function findOnChainTradeOutcome(
  connection: Connection,
  tradePda: PublicKey,
  limit = 8,
): Promise<OnChainTradeOutcome> {
  const sigs = await connection.getSignaturesForAddress(tradePda, { limit });
  if (sigs.length === 0) return { kind: 'not-found' };

  for (const sig of sigs) {
    if (sig.err) continue;
    const tx = await connection.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!tx) continue;
    const kind = classifyLogs(tx.meta?.logMessages);
    if (kind) {
      return { kind, signature: sig.signature, blockTime: sig.blockTime ?? null };
    }
  }

  // No terminal-state tx found — escrow is presumably still open
  return { kind: 'open', latestSignature: sigs[0]?.signature ?? null };
}
