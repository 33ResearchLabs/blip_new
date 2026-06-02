/**
 * Pending-Escrow Reconciler — closes the on-chain↔DB orphan window.
 *
 * BACKGROUND
 *   The legacy lock-escrow flow trusted the BROWSER to call the settle
 *   PATCH after the on-chain tx confirmed. Any failure between submit and
 *   PATCH (tab close, network drop, slow Solana indexing causing the
 *   client to declare failure prematurely) created an orphan: funds locked
 *   on-chain, no DB row, the order auto-cancelled later without refund.
 *
 *   This worker breaks the dependency on the client. It reads
 *   `pending_escrow` rows (created by POST /api/orders/:id/escrow/intent
 *   BEFORE the user signs anything) and reconciles each one against
 *   on-chain reality:
 *
 *     1. Compute the deterministic Trade PDA from (actor_wallet, trade_id)
 *     2. Look up the linked Escrow PDA's USDT balance
 *     3. If funds present → atomically set `orders.status='escrowed'` +
 *        write the same fields the client used to PATCH + mark the
 *        pending_escrow row resolved. ALL inside one Postgres transaction.
 *     4. If no funds AND `timeout_at` has passed → mark row `failed`. The
 *        order can then auto-cancel safely (no funds locked on-chain).
 *     5. Otherwise leave the row for next tick.
 *
 *   The worker NEVER trusts the client's `reported_signature` blindly —
 *   it always verifies by reading the PDA's actual state.
 *
 * IDEMPOTENCY
 *   - Multiple worker instances safe: SELECT … FOR UPDATE SKIP LOCKED
 *     ensures only one worker handles a given row per tick.
 *   - Re-reconciling an already-confirmed row is a no-op (resolved_at NOT NULL).
 *   - The orders UPDATE has a status guard so re-running won't overwrite
 *     a downstream transition (e.g. payment_sent).
 */

import { transaction, query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { getConnection } from '@/lib/solana/escrow';
import { findTradePda, findEscrowPda } from '@/lib/solana/v2/pdas';
import { getUsdtMint } from '@/lib/solana/v2/config';
import { runWorkerTick } from '@/lib/workerHealth';

const POLL_INTERVAL_MS = 10_000;       // 10s — frequent enough for live UX
const BATCH_SIZE = 25;
const MAX_ATTEMPTS_BEFORE_FAIL = 30;   // ~5 min of polling at 10s cadence
const NETWORK: 'devnet' | 'mainnet-beta' =
  (process.env.NEXT_PUBLIC_SOLANA_NETWORK as 'devnet' | 'mainnet-beta') || 'devnet';

type PendingRow = {
  id: string;
  order_id: string;
  merchant_id: string | null;
  user_id: string | null;
  actor_type: 'user' | 'merchant';
  actor_wallet: string;
  trade_id: string; // bigint serialised as string
  expected_amount: string;
  reported_signature: string | null;
  status: 'broadcasting' | 'awaiting_confirmation' | 'confirmed' | 'failed';
  attempts: number;
  timeout_at: string;
};

/**
 * Read the on-chain USDT balance held by the escrow PDA derived from
 * (actor_wallet, trade_id). Returns null if the escrow ATA doesn't exist
 * or holds zero.
 *
 * Uses the same PDA derivation the client uses for fund_escrow / lock_escrow,
 * so this works for BOTH the U2M (lock_escrow) and broadcast (fund_escrow)
 * flows without branching.
 */
async function readOnChainEscrowAmount(
  connection: Connection,
  actorWallet: string,
  tradeId: bigint,
): Promise<number | null> {
  try {
    const creator = new PublicKey(actorWallet);
    const [tradePda] = findTradePda(creator, Number(tradeId));
    const [escrowPda] = findEscrowPda(tradePda);
    const usdtMint = getUsdtMint(NETWORK);
    const escrowAta = await getAssociatedTokenAddress(usdtMint, escrowPda, true);

    // Cheap balance probe — returns null if ATA doesn't exist yet.
    const bal = await connection.getTokenAccountBalance(escrowAta).catch(() => null);
    if (!bal?.value) return null;
    const ui = bal.value.uiAmount ?? 0;
    return ui > 0 ? ui : null;
  } catch (err) {
    logger.debug('[EscrowReconciler] readOnChainEscrowAmount threw', {
      actorWallet,
      tradeId: tradeId.toString(),
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Apply on-chain truth to the DB. Atomic:
 *   - UPDATE orders SET status='escrowed', escrow_* = ... WHERE id=$ AND status='accepted'
 *   - UPDATE pending_escrow SET status='confirmed', resolved_at=NOW() WHERE id=$
 *
 * Returns true if the order was actually transitioned (1 row updated). A
 * 0-row update means another worker / client got there first; we still
 * resolve our pending row but mark the resolution as "already_recorded".
 */
async function applyConfirmedEscrow(
  row: PendingRow,
  onChainAmount: number,
  connection: Connection,
): Promise<{ applied: boolean; note: string }> {
  // Re-derive the PDAs so we can store them on the order. Cheap (no RPC).
  const creator = new PublicKey(row.actor_wallet);
  const [tradePda] = findTradePda(creator, Number(row.trade_id));
  const [escrowPda] = findEscrowPda(tradePda);
  const usdtMint = getUsdtMint(NETWORK);
  const escrowAta = await getAssociatedTokenAddress(usdtMint, escrowPda, true);

  return await transaction(async (client) => {
    const upd = await client.query(
      `UPDATE orders
         SET status = 'escrowed',
             escrow_tx_hash             = COALESCE(escrow_tx_hash, $2),
             escrow_address             = COALESCE(escrow_address, $3),
             escrow_trade_pda           = COALESCE(escrow_trade_pda, $4),
             escrow_debited_entity_type = $5,
             escrow_debited_entity_id   = $6,
             escrow_debited_amount      = $7,
             escrow_debited_at          = COALESCE(escrow_debited_at, NOW()),
             escrowed_at                = COALESCE(escrowed_at, NOW()),
             escrow_creator_wallet      = COALESCE(escrow_creator_wallet, $8),
             escrow_trade_id            = COALESCE(escrow_trade_id, $9),
             order_version              = order_version + 1,
             updated_at                 = NOW()
       WHERE id = $1
         AND status IN ('pending', 'accepted')
       RETURNING id, status`,
      [
        row.order_id,
        row.reported_signature || null,
        escrowAta.toBase58(),
        tradePda.toBase58(),
        row.actor_type,
        row.actor_type === 'merchant' ? row.merchant_id : row.user_id,
        onChainAmount,
        row.actor_wallet,
        row.trade_id,
      ],
    );

    const applied = upd.rowCount === 1;
    const note = applied
      ? 'reconciler: applied on-chain escrow to order'
      : 'reconciler: order already past accepted/pending — pending_escrow resolved without DB rewrite';

    await client.query(
      `UPDATE pending_escrow
          SET status = 'confirmed',
              resolved_at = NOW(),
              resolution_note = $2,
              attempts = attempts + 1,
              last_polled_at = NOW()
        WHERE id = $1`,
      [row.id, note],
    );

    return { applied, note };
  });
}

/**
 * Mark a row failed when timeout_at has passed and on-chain has nothing.
 * The order is left alone — its own auto-cancel pipeline will pick it up
 * (now that pending_escrow is resolved, the auto-cancel guard releases it).
 */
async function markFailed(rowId: string, reason: string): Promise<void> {
  await query(
    `UPDATE pending_escrow
        SET status = 'failed',
            resolved_at = NOW(),
            resolution_note = $2,
            attempts = attempts + 1,
            last_polled_at = NOW()
      WHERE id = $1
        AND resolved_at IS NULL`,
    [rowId, reason],
  );
}

/**
 * Touch a row that's still in flight — bumps attempt counter + last_polled_at.
 * Lets us cap retries and surface stuck rows to ops.
 */
async function touchPending(rowId: string, lastError?: string): Promise<void> {
  await query(
    `UPDATE pending_escrow
        SET attempts = attempts + 1,
            last_polled_at = NOW(),
            last_error = $2,
            -- promote from broadcasting → awaiting_confirmation as soon as
            -- the worker runs once; status reflects "we are looking"
            status = CASE WHEN status = 'broadcasting'
                          THEN 'awaiting_confirmation'
                          ELSE status END
      WHERE id = $1
        AND resolved_at IS NULL`,
    [rowId, lastError ?? null],
  );
}

/**
 * One reconciliation pass — claims a batch, polls on-chain, reflects truth.
 */
async function tick(connection: Connection): Promise<void> {
  // Claim a batch via SKIP LOCKED so multiple workers don't collide.
  const claimed = await transaction(async (client) => {
    const r = await client.query(
      `SELECT id, order_id, merchant_id, user_id, actor_type, actor_wallet,
              trade_id::text AS trade_id, expected_amount::text AS expected_amount,
              reported_signature, status, attempts, timeout_at
         FROM pending_escrow
        WHERE resolved_at IS NULL
        ORDER BY last_polled_at NULLS FIRST, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [BATCH_SIZE],
    );
    return r.rows as PendingRow[];
  });

  if (claimed.length === 0) return;

  for (const row of claimed) {
    try {
      const onChain = await readOnChainEscrowAmount(
        connection,
        row.actor_wallet,
        BigInt(row.trade_id),
      );

      if (onChain !== null) {
        // Tolerate small float drift; require at least the expected amount.
        const expected = parseFloat(row.expected_amount);
        if (onChain + 1e-6 < expected) {
          // Partial / unexpected — keep polling, don't apply.
          logger.warn('[EscrowReconciler] on-chain amount under expected', {
            id: row.id,
            order_id: row.order_id,
            onChain,
            expected,
          });
          await touchPending(
            row.id,
            `on-chain amount ${onChain} < expected ${expected}, retrying`,
          );
          continue;
        }
        const result = await applyConfirmedEscrow(row, onChain, connection);
        logger.info('[EscrowReconciler] confirmed', {
          id: row.id,
          order_id: row.order_id,
          actor_type: row.actor_type,
          onChain,
          applied: result.applied,
          note: result.note,
        });
        continue;
      }

      // No funds on-chain. If past timeout — declare failed. Otherwise
      // keep polling; the user may still be in their wallet popup.
      const now = Date.now();
      const timeoutAt = new Date(row.timeout_at).getTime();
      const tooManyAttempts = row.attempts >= MAX_ATTEMPTS_BEFORE_FAIL;
      if (now >= timeoutAt || tooManyAttempts) {
        await markFailed(
          row.id,
          tooManyAttempts
            ? `attempts exhausted (${row.attempts})`
            : `timeout_at elapsed without on-chain evidence`,
        );
        logger.warn('[EscrowReconciler] failed', {
          id: row.id,
          order_id: row.order_id,
          attempts: row.attempts,
          tooManyAttempts,
        });
      } else {
        await touchPending(row.id, 'no on-chain escrow yet');
      }
    } catch (err) {
      logger.error('[EscrowReconciler] row processing threw', {
        id: row.id,
        order_id: row.order_id,
        error: (err as Error).message,
      });
      // Don't fail the whole tick — touch the row and move on.
      try {
        await touchPending(row.id, (err as Error).message);
      } catch {
        // Even the touch failed — DB is in trouble, let the next tick retry.
      }
    }
  }
}

/**
 * Entry point — main loop. Distribution-safe via FOR UPDATE SKIP LOCKED.
 */
async function main(): Promise<void> {
  logger.info('[EscrowReconciler] starting', {
    network: NETWORK,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
  });

  const connection = getConnection(NETWORK);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    logger.info('[EscrowReconciler] received shutdown signal');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  while (!stopping) {
    const t0 = Date.now();
    try {
      // Heartbeat-wrapped tick — tick(connection) runs unchanged; the wrapper
      // adds a stall timeout + worker_health heartbeat. The timeout bounds the
      // wait only; it never aborts an in-flight on-chain read / DB transaction.
      await runWorkerTick(
        'escrow-reconciler',
        { intervalMs: POLL_INTERVAL_MS, criticality: 'critical', timeoutMs: 120_000 },
        () => tick(connection),
      );
    } catch (err) {
      logger.error('[EscrowReconciler] tick threw', {
        error: (err as Error).message,
      });
    }
    const elapsed = Date.now() - t0;
    const sleep = Math.max(POLL_INTERVAL_MS - elapsed, 1_000);
    await new Promise((r) => setTimeout(r, sleep));
  }

  logger.info('[EscrowReconciler] stopped');
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    logger.error('[EscrowReconciler] fatal', { error: (err as Error).message });
    process.exit(1);
  });
}

// Export the tick for tests / manual invocation from cron route.
export { tick as runEscrowReconcileTick };
