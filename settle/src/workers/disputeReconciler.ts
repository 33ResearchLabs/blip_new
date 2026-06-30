/**
 * Dispute Reconciler — completes DB finalization for disputes that already
 * settled ON-CHAIN but whose database finalize never committed.
 *
 * This is the recovery safety net that MUST run before the backend arbiter is
 * enabled. It closes the blockchain-success + DB-failure window (also:
 * confirmation timeout, or any crash between the on-chain settlement and
 * atomicFinalizeDispute).
 *
 * It is gated behind DISPUTE_RECONCILER_ENABLED (default off) and is
 * INDEPENDENT of the arbiter flag — it reconciles ANY disputed order whose
 * escrow reached a terminal on-chain state, whoever settled it (human
 * compliance wallet, backend arbiter, or the on-chain 72h dispute timeout).
 *
 * SAFETY
 *   - Reuses atomicFinalizeDispute, inheriting SELECT … FOR UPDATE, the
 *     status='disputed' re-check, the order_version guard, the idempotent
 *     ledger ON CONFLICT, and real-mode "no DB cache credit" (so it can never
 *     double-pay).
 *   - Reads the AUTHORITATIVE on-chain Trade.status before deciding the
 *     outcome; it never invents a settlement.
 *   - Already-finalized orders never match the candidate query (status !=
 *     'disputed'); if raced, the helper's status guard rejects the second
 *     writer. So it never changes an already-finalized order.
 *   - Per-order exponential backoff (migration 177) so a permanently
 *     unreadable order can't starve the batch.
 */

import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Connection, PublicKey } from '@solana/web3.js';
import { getConnection } from '@/lib/solana/escrow';
import { findTradePda } from '@/lib/solana/v2/pdas';
import { atomicFinalizeDispute } from '@/lib/orders/atomicFinalizeDispute';
import { runWorkerTick } from '@/lib/workerHealth';

// On-chain TradeStatus (state/trade.rs declaration order). Status byte lives at
// trade-account offset 120 (see fetchTrade in v2/program.ts).
//   0 Created · 1 Funded · 2 Locked · 3 PaymentSent · 4 Disputed
//   5 Released (funds → counterparty/buyer) · 6 Refunded (funds → depositor/seller)
const TRADE_STATUS_RELEASED = 5;
const TRADE_STATUS_REFUNDED = 6;

const POLL_INTERVAL_MS = 30_000;
const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 10;
const BASE_BACKOFF_SEC = 30;
const MAX_BACKOFF_SEC = 3_600;

const NETWORK: 'devnet' | 'mainnet-beta' =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';

// System actor for reconciler-attributed finalizations. disputes.resolved_by is
// TEXT and chat_messages.sender_id is uuid (no FK) — the nil uuid satisfies both
// and clearly marks the row as machine-reconciled in the audit trail.
const RECONCILER_MEMBER = {
  id: '00000000-0000-0000-0000-000000000000',
  name: 'Dispute Reconciler (auto)',
  role: 'system',
};

export interface ReconcileCandidate {
  id: string;
  escrow_creator_wallet: string;
  escrow_trade_id: number;
  dispute_reconcile_attempts: number;
}

export interface ReconcileOutcome {
  orderId: string;
  action: 'finalized' | 'already_finalized' | 'not_settled' | 'unreadable' | 'error';
  resolution?: 'user' | 'merchant';
  txHash?: string;
  error?: string;
}

export function isDisputeReconcilerEnabled(): boolean {
  return process.env.DISPUTE_RECONCILER_ENABLED === 'true';
}

function backoffSeconds(attempts: number): number {
  return Math.min(MAX_BACKOFF_SEC, BASE_BACKOFF_SEC * 2 ** Math.min(attempts, 7));
}

/**
 * Candidate disputes: still 'disputed' in DB, escrow was locked on-chain, no
 * settlement hash recorded yet, and not in backoff. Matches the partial index
 * from migration 177.
 */
export async function findReconcileCandidates(limit = BATCH_SIZE): Promise<ReconcileCandidate[]> {
  const rows = await query<ReconcileCandidate>(
    `SELECT id, escrow_creator_wallet, escrow_trade_id, dispute_reconcile_attempts
       FROM orders
      WHERE status = 'disputed'
        AND escrow_tx_hash IS NOT NULL
        AND release_tx_hash IS NULL
        AND refund_tx_hash IS NULL
        AND escrow_creator_wallet IS NOT NULL
        AND escrow_trade_id IS NOT NULL
        AND dispute_reconcile_attempts < $2
        AND (dispute_reconcile_after IS NULL OR dispute_reconcile_after <= NOW())
      ORDER BY dispute_reconcile_after NULLS FIRST, id
      LIMIT $1`,
    [limit, MAX_ATTEMPTS],
  );
  // escrow_trade_id is a bigint → pg returns it as a string; coerce once.
  return rows.map((r) => ({ ...r, escrow_trade_id: Number(r.escrow_trade_id) }));
}

async function recordAttempt(orderId: string, attempts: number, errorMsg: string): Promise<void> {
  const delay = backoffSeconds(attempts);
  await query(
    `UPDATE orders
        SET dispute_reconcile_attempts = dispute_reconcile_attempts + 1,
            dispute_reconcile_after = NOW() + ($2 * INTERVAL '1 second'),
            dispute_reconcile_error = $3
      WHERE id = $1`,
    [orderId, delay, errorMsg.slice(0, 500)],
  );
}

/** Read the authoritative on-chain Trade.status byte. null = unreadable/closed. */
export async function readOnChainTradeStatus(
  connection: Connection,
  creatorWallet: string,
  tradeId: number,
): Promise<number | null> {
  const [tradePda] = findTradePda(new PublicKey(creatorWallet), tradeId);
  const info = await connection.getAccountInfo(tradePda, 'confirmed');
  if (!info || info.data.length < 121) return null;
  return info.data[120];
}

/** Best-effort: the most recent signature touching the trade PDA (the settlement tx). */
async function getSettlementTxHash(
  connection: Connection,
  creatorWallet: string,
  tradeId: number,
): Promise<string | null> {
  try {
    const [tradePda] = findTradePda(new PublicKey(creatorWallet), tradeId);
    const sigs = await connection.getSignaturesForAddress(tradePda, { limit: 1 }, 'confirmed');
    return sigs[0]?.signature ?? null;
  } catch {
    return null;
  }
}

/**
 * Reconcile a single candidate against on-chain reality. Idempotent and
 * side-effect-safe: only finalizes when the chain says Released/Refunded, and
 * defers entirely to atomicFinalizeDispute's guards for the DB mutation.
 */
export async function reconcileOneDispute(
  connection: Connection,
  candidate: ReconcileCandidate,
): Promise<ReconcileOutcome> {
  const { id: orderId, escrow_creator_wallet, escrow_trade_id, dispute_reconcile_attempts } = candidate;

  let status: number | null;
  try {
    status = await readOnChainTradeStatus(connection, escrow_creator_wallet, escrow_trade_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordAttempt(orderId, dispute_reconcile_attempts, `rpc: ${msg}`);
    return { orderId, action: 'error', error: msg };
  }

  if (status === null) {
    // Trade account unreadable (RPC) or already closed (rent reclaimed after
    // settlement). We cannot determine the outcome here — back off and let a
    // human review once attempts are exhausted.
    await recordAttempt(orderId, dispute_reconcile_attempts, 'trade account unreadable/closed');
    return { orderId, action: 'unreadable' };
  }

  if (status !== TRADE_STATUS_RELEASED && status !== TRADE_STATUS_REFUNDED) {
    // Not settled on-chain yet (still Disputed/Locked/etc.). Nothing to do.
    await recordAttempt(orderId, dispute_reconcile_attempts, `on-chain not terminal (status=${status})`);
    return { orderId, action: 'not_settled' };
  }

  // Released → buyer won (DB 'user' → completed); Refunded → seller won
  // (DB 'merchant' → cancelled). Refunded covers resolve_dispute(RefundToSeller),
  // the 72h dispute timeout, and mutual cancel — all return funds to the
  // depositor/seller, which maps to the same DB outcome.
  const resolution: 'user' | 'merchant' = status === TRADE_STATUS_RELEASED ? 'user' : 'merchant';
  const txHash =
    (await getSettlementTxHash(connection, escrow_creator_wallet, escrow_trade_id)) ??
    `reconciled:onchain-${status}`;

  const result = await atomicFinalizeDispute({
    orderId,
    resolution,
    complianceMember: RECONCILER_MEMBER,
    notes: `Auto-reconciled from on-chain settlement (Trade.status=${status})`,
    releaseTxHash: resolution === 'user' ? txHash : undefined,
    refundTxHash: resolution === 'merchant' ? txHash : undefined,
    // We verified settlement by reading the chain — that IS the confirmation;
    // no need to re-require a caller-supplied hash.
    requireSettlementTx: false,
  });

  if (result.success) {
    logger.info('[DisputeReconciler] finalized from on-chain settlement', {
      orderId,
      resolution,
      txHash,
      onChainStatus: status,
    });
    return { orderId, action: 'finalized', resolution, txHash };
  }

  // Raced with another finalizer / already terminal — the helper's status
  // guard rejected us. That is the desired idempotent no-op, not an error.
  // Matches atomicFinalizeDispute's ORDER_NOT_DISPUTED + STATUS_CHANGED messages.
  if (result.error && /cannot finalize dispute for order in|order status changed/i.test(result.error)) {
    return { orderId, action: 'already_finalized', resolution };
  }

  await recordAttempt(orderId, dispute_reconcile_attempts, result.error ?? 'finalize failed');
  return { orderId, action: 'error', resolution, error: result.error };
}

/** One reconciliation pass over a batch of candidates. */
export async function runDisputeReconciliation(
  opts: { limit?: number } = {},
): Promise<{ scanned: number; finalized: number; outcomes: ReconcileOutcome[] }> {
  const candidates = await findReconcileCandidates(opts.limit ?? BATCH_SIZE);
  const connection = getConnection(NETWORK);
  const outcomes: ReconcileOutcome[] = [];

  for (const c of candidates) {
    try {
      outcomes.push(await reconcileOneDispute(connection, c));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordAttempt(c.id, c.dispute_reconcile_attempts, msg).catch(() => {});
      outcomes.push({ orderId: c.id, action: 'error', error: msg });
    }
  }

  const finalized = outcomes.filter(
    (o) => o.action === 'finalized' || o.action === 'already_finalized',
  ).length;
  if (candidates.length > 0) {
    logger.info('[DisputeReconciler] tick complete', { scanned: candidates.length, finalized });
  }
  return { scanned: candidates.length, finalized, outcomes };
}

async function main(): Promise<void> {
  if (!isDisputeReconcilerEnabled()) {
    logger.info('[DisputeReconciler] disabled (DISPUTE_RECONCILER_ENABLED != true) — exiting');
    return;
  }
  logger.info('[DisputeReconciler] starting', {
    network: NETWORK,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  // Startup reconciliation scan — recover anything stranded before this boot.
  try {
    const r = await runDisputeReconciliation({ limit: BATCH_SIZE });
    logger.info('[DisputeReconciler] startup scan complete', {
      scanned: r.scanned,
      finalized: r.finalized,
    });
  } catch (err) {
    logger.error('[DisputeReconciler] startup scan failed', { error: (err as Error).message });
  }

  let stopping = false;
  const stop = () => {
    stopping = true;
    logger.info('[DisputeReconciler] received shutdown signal');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!stopping) {
    const t0 = Date.now();
    try {
      await runWorkerTick(
        'dispute-reconciler',
        { intervalMs: POLL_INTERVAL_MS, criticality: 'critical', timeoutMs: 120_000 },
        async () => {
          await runDisputeReconciliation({ limit: BATCH_SIZE });
        },
      );
    } catch (err) {
      logger.error('[DisputeReconciler] tick threw', { error: (err as Error).message });
    }
    const elapsed = Date.now() - t0;
    await new Promise((r) => setTimeout(r, Math.max(POLL_INTERVAL_MS - elapsed, 1_000)));
  }

  logger.info('[DisputeReconciler] stopped');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('[DisputeReconciler] fatal', { error: (err as Error).message });
    process.exit(1);
  });
}
