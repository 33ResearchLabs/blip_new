/**
 * Safe Solana Transaction Helper.
 *
 * Production-grade wrapper that fixes the 6 classic bugs:
 *  1. Blockhash expiry — blockhash fetched INSIDE this utility, right before
 *     signing. User's 60s popup clock starts at the popup, not before.
 *  2. Retry on expiry — retries with fresh blockhash (default 2 retries).
 *     Each retry gets a brand-new signature, so Solana naturally dedupes.
 *  3. Reconciliation — if confirmTransaction fails, we call getTransaction()
 *     to check if the tx actually landed. Eliminates "UI says failed but
 *     money moved" bugs.
 *  4. Preflight ENABLED — `skipPreflight: false` surfaces bad txs early
 *     instead of wasting gas on doomed submissions.
 *  5. User-rejection aware — never retries when user clicks "Reject" in
 *     their wallet popup.
 *  6. Structured phase logging — every phase emits a log entry so prod
 *     traces are coherent.
 *
 * Enhancements (additive, non-breaking):
 *  - Priority fees via ComputeBudgetProgram (opt-in, default off)
 *  - Dynamic confirm timeout that scales with retry attempt
 *  - Status callback with granular phases for UI feedback
 *  - Metrics collection (latency, success rate, retry count)
 */

import {
  ComputeBudgetProgram,
  Connection,
  Transaction,
  TransactionInstruction,
  PublicKey,
  SendTransactionError,
  TransactionSignature,
} from '@solana/web3.js';
import { logger } from '@/lib/logger';
import { txMetrics } from '@/lib/solana/txMetrics';

/** Priority level for the transaction. Controls priority fee (if any). */
export type TxPriority = 'none' | 'low' | 'medium' | 'high';

/** Micro-lamports per compute unit by priority level. */
const PRIORITY_FEE_MICROLAMPORTS: Record<TxPriority, number> = {
  none: 0,
  low: 1_000,       // ~0.00001 SOL per CU — cheap, lowest priority
  medium: 10_000,   // ~0.0001 SOL per CU — balanced
  high: 50_000,     // ~0.0005 SOL per CU — for release/confirm (time-critical)
};

export interface SafeTxOptions {
  /** Connection used to fetch blockhash, send, and confirm */
  connection: Connection;
  /** Fee payer / signer */
  feePayer: PublicKey;
  /** Function that signs a Transaction (wallet adapter style) */
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  /** The actual instructions to execute */
  instructions: TransactionInstruction[];
  /** Optional operation name for logs */
  name?: string;
  /** Max retry attempts on recoverable errors. Default 2. */
  maxRetries?: number;
  /**
   * Base confirmation timeout in ms. Default 60_000 (60s).
   * On retry N, timeout scales: base + (30_000 * N). So 60s → 90s → 120s.
   */
  confirmTimeoutMs?: number;
  /**
   * Priority level — controls priority fee (ComputeBudgetProgram instruction).
   * Default: 'none'. Use 'high' for time-critical ops (releaseEscrow, confirmPayment).
   */
  priority?: TxPriority;
  /**
   * Explicit priority-fee override in micro-lamports/CU. Takes precedence
   * over `priority`. Use when you have bid-style congestion signals.
   */
  priorityFeeMicroLamports?: number;
  /** Progress callback for UI updates */
  onPhase?: (phase: TxPhase, info?: TxPhaseInfo) => void;
}

export type TxPhase =
  | 'pending_signature'
  | 'awaiting_signature'
  | 'sending'
  | 'confirming'
  | 'retrying'
  | 'reconciling'
  | 'confirmed'
  | 'failed';

export interface TxPhaseInfo {
  attempt?: number;
  signature?: string;
  blockhash?: string;
  error?: string;
  /** User-friendly message the UI can show directly */
  message?: string;
}

export interface SafeTxResult {
  success: true;
  signature: TransactionSignature;
  attempts: number;
  /** True if we fell back to getTransaction reconciliation */
  reconciled: boolean;
  /** Total wall-clock latency (ms) from build to confirmation */
  latencyMs: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('blockhash not found') ||
    msg.includes('block height exceeded') ||
    msg.includes('transaction was not confirmed') ||
    msg.includes('transaction expired') ||
    msg.includes('failed to get recent blockhash') ||
    msg.includes('failed to send transaction') ||
    msg.includes('timed out') ||
    msg.includes('network request failed') ||
    msg.includes('503') ||
    msg.includes('service unavailable')
  );
}

function isUserRejection(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? '').toLowerCase();
  return (
    msg.includes('user rejected') ||
    msg.includes('user cancelled') ||
    msg.includes('user canceled') ||
    msg.includes('request rejected') ||
    (err as { code?: number })?.code === 4001
  );
}

/** Map internal phases to human-readable messages the UI can surface. */
function phaseMessage(phase: TxPhase, attempt?: number): string {
  switch (phase) {
    case 'pending_signature':
    case 'awaiting_signature':
      return 'Waiting for wallet approval…';
    case 'sending':
      return 'Sending transaction…';
    case 'confirming':
      return attempt && attempt > 0 ? 'Confirming (retry)…' : 'Confirming on blockchain…';
    case 'retrying':
      return 'Network slow, retrying with fresh blockhash…';
    case 'reconciling':
      return 'Verifying transaction on-chain…';
    case 'confirmed':
      return 'Transaction confirmed ✓';
    case 'failed':
      return 'Transaction failed';
  }
}

/** Compute dynamic timeout for a given retry attempt. */
function computeTimeoutMs(baseMs: number, attempt: number): number {
  return baseMs + 30_000 * attempt; // 60s → 90s → 120s
}

/**
 * Reconciliation: after a confirm failure/timeout, check the chain directly
 * to see if our transaction actually landed. Prevents "UI says failed but
 * money was locked" bugs.
 */
async function reconcileTransaction(
  connection: Connection,
  signature: TransactionSignature,
): Promise<boolean> {
  try {
    const result = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    if (!result) return false;
    // Has error? Landed but failed on-chain → NOT a success
    return !result.meta?.err;
  } catch (err) {
    logger.warn('[safeTx] Reconciliation check failed', {
      signature,
      error: (err as Error)?.message,
    });
    return false;
  }
}

/**
 * Prepend ComputeBudgetProgram instructions for priority fee support.
 * Returns a new array — never mutates the caller's instructions.
 */
function withPriorityFee(
  instructions: TransactionInstruction[],
  priority: TxPriority,
  override?: number,
): TransactionInstruction[] {
  const microLamports = override ?? PRIORITY_FEE_MICROLAMPORTS[priority];
  if (!microLamports || microLamports <= 0) return instructions;
  return [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
    ...instructions,
  ];
}

// ── Main API ─────────────────────────────────────────────────────────

export async function sendAndConfirmSafe(
  opts: SafeTxOptions,
): Promise<SafeTxResult> {
  const {
    connection,
    feePayer,
    signTransaction,
    instructions,
    name = 'tx',
    maxRetries = 2,
    confirmTimeoutMs = 60_000,
    priority = 'none',
    priorityFeeMicroLamports,
    onPhase,
  } = opts;

  const startTs = Date.now();
  let lastSignature: TransactionSignature | null = null;
  let lastError: unknown = null;

  const emit = (phase: TxPhase, extra?: Partial<TxPhaseInfo>) => {
    const info: TxPhaseInfo = {
      attempt: extra?.attempt,
      signature: lastSignature || extra?.signature,
      blockhash: extra?.blockhash,
      error: extra?.error,
      message: phaseMessage(phase, extra?.attempt),
    };
    onPhase?.(phase, info);
  };

  // Precompute priority-adjusted instructions (cheap — array copy)
  const finalInstructions = withPriorityFee(instructions, priority, priorityFeeMicroLamports);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStart = Date.now();
    try {
      // ── Build transaction (no blockhash yet) ──────────────────────
      const tx = new Transaction();
      for (const ix of finalInstructions) tx.add(ix);
      tx.feePayer = feePayer;

      // ── Fetch FRESH blockhash RIGHT before signing ───────────────
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      logger.debug(`[safeTx:${name}] blockhash attached`, {
        attempt,
        blockhash,
        lastValidBlockHeight,
      });

      // ── Request wallet signature ─────────────────────────────────
      emit('pending_signature', { attempt, blockhash });
      emit('awaiting_signature', { attempt, blockhash });
      const signedTx = await signTransaction(tx);

      // ── Send ─────────────────────────────────────────────────────
      emit('sending', { attempt });
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment: 'confirmed',
      });
      lastSignature = signature;
      logger.info(`[safeTx:${name}] sent`, { attempt, signature, priority });

      // ── Confirm (dynamic timeout) ────────────────────────────────
      emit('confirming', { attempt, signature });
      const thisTimeout = computeTimeoutMs(confirmTimeoutMs, attempt);

      try {
        const confirmPromise = connection.confirmTransaction(
          { signature, blockhash, lastValidBlockHeight },
          'confirmed',
        );
        const result = await Promise.race([
          confirmPromise,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`confirmation timed out after ${thisTimeout}ms`)),
              thisTimeout,
            ),
          ),
        ]);

        if (result.value?.err) {
          throw new Error(`on-chain error: ${JSON.stringify(result.value.err)}`);
        }

        emit('confirmed', { attempt, signature });
        const latencyMs = Date.now() - startTs;
        logger.info(`[safeTx:${name}] confirmed`, {
          attempt,
          signature,
          latencyMs,
        });
        txMetrics.recordSuccess({ latencyMs, attempts: attempt + 1, reconciled: false });
        return {
          success: true,
          signature,
          attempts: attempt + 1,
          reconciled: false,
          latencyMs,
        };
      } catch (confirmErr) {
        // ── Reconcile: tx may have landed even if confirm failed ──
        emit('reconciling', { attempt, signature });
        const landed = await reconcileTransaction(connection, signature);
        if (landed) {
          const latencyMs = Date.now() - startTs;
          logger.info(`[safeTx:${name}] reconciled success`, {
            attempt,
            signature,
            latencyMs,
            reason: 'confirm failed but getTransaction found the tx on-chain',
          });
          emit('confirmed', { attempt, signature });
          txMetrics.recordSuccess({ latencyMs, attempts: attempt + 1, reconciled: true });
          return {
            success: true,
            signature,
            attempts: attempt + 1,
            reconciled: true,
            latencyMs,
          };
        }
        throw confirmErr;
      }
    } catch (err) {
      lastError = err;
      const attemptElapsedMs = Date.now() - attemptStart;

      if (isUserRejection(err)) {
        logger.warn(`[safeTx:${name}] user rejected`, { attempt, attemptElapsedMs });
        emit('failed', { attempt, error: 'user_rejected' });
        txMetrics.recordFailure({
          latencyMs: Date.now() - startTs,
          attempts: attempt + 1,
          error: err,
        });
        throw err; // NEVER retry user rejection
      }

      const isLast = attempt >= maxRetries;
      const retryable = isRetryableError(err);

      logger.warn(`[safeTx:${name}] attempt failed`, {
        attempt,
        retryable,
        isLast,
        attemptElapsedMs,
        error: (err as Error)?.message,
      });

      if (isLast || !retryable) {
        emit('failed', { attempt, error: (err as Error)?.message });
        txMetrics.recordFailure({
          latencyMs: Date.now() - startTs,
          attempts: attempt + 1,
          error: err,
        });
        throw err;
      }

      // Small backoff before retry
      emit('retrying', { attempt, error: (err as Error)?.message });
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }

  // Unreachable — the loop either returns or throws
  txMetrics.recordFailure({
    latencyMs: Date.now() - startTs,
    attempts: maxRetries + 1,
    error: lastError,
  });
  throw lastError ?? new Error(`[safeTx:${name}] exhausted retries`);
}

/**
 * Helper to catch a SendTransactionError and extract its log messages.
 */
export function extractSendErrorLogs(err: unknown): string[] | undefined {
  if (err instanceof SendTransactionError) {
    try {
      return (err as SendTransactionError & { logs?: string[] }).logs;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
