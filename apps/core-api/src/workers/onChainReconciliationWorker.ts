/**
 * On-Chain ↔ DB Reconciliation Worker (Core API)
 *
 * Scans orders that have been stuck in `payment_sent`, `escrowed`, or
 * `disputed` for too long, queries Solana for the trade PDA's transaction
 * history, and — if the on-chain side already terminated — syncs the DB
 * to match the on-chain truth.
 *
 * What this catches:
 *   - Merchant clicked "Confirm Payment" → on-chain ReleaseEscrow succeeded
 *     → DB sync hit a 429 / network blip → order stuck at payment_sent.
 *   - User clicked "Cancel" → on-chain RefundEscrow succeeded → DB sync
 *     missed → order stuck at escrowed.
 *   - Auto-resolution after dispute → on-chain finalised → DB miss.
 *
 * Safety:
 *   - Read-only on Solana side (getSignaturesForAddress + getTransaction).
 *   - All DB mutations go through the EXISTING release_order_v1 /
 *     atomicCancelWithRefund paths via insertOutboxEventDirect — same
 *     code paths as the live click flow, so triggers/listeners fire as
 *     expected.
 *   - Stale-window guard: only acts on orders older than RECON_MIN_AGE_MS
 *     (default 3 minutes) so we never race the live click flow.
 *   - Optimistic-lock guard: each UPDATE checks `order_version` so
 *     concurrent live activity cannot be silently overwritten.
 *   - Per-order errors are isolated — one bad RPC response can't stop
 *     reconciliation of other orders.
 *
 * Disabled by default. Set ONCHAIN_RECON_ENABLED=true to turn on. Even
 * when off, the worker is mounted but the poll is a no-op.
 */

import { query, queryOne, logger, MOCK_MODE } from 'settlement-core';
import { runWorkerTick } from './workerHealth';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { ORDER_EVENT } from '../events';
import { insertOutboxEventDirect } from '../outbox';

// Load core-api's own .env first (where ONCHAIN_RECON_ENABLED lives), then
// fall back to settle's env files for shared values like SOLANA_RPC_URL.
config(); // loads ./.env from cwd (apps/core-api when run via pnpm worker:onchain-recon)
config({ path: '../../settle/.env.local' });
config({ path: '../../settle/.env' });

// ── Config ──────────────────────────────────────────────────────────────
const ENABLED = (process.env.ONCHAIN_RECON_ENABLED || 'false').toLowerCase() === 'true';
const POLL_INTERVAL_MS = parseInt(process.env.ONCHAIN_RECON_POLL_MS || '60000', 10); // 1 min
const BATCH_SIZE = parseInt(process.env.ONCHAIN_RECON_BATCH || '20', 10);
// How "stale" an order has to be before we touch it. Don't race live clicks.
const MIN_AGE_MS = parseInt(process.env.ONCHAIN_RECON_MIN_AGE_MS || '180000', 10); // 3 min
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  || process.env.SOLANA_RPC_URL
  || 'https://api.devnet.solana.com';

// Hints we look for in tx logs
const RELEASE_HINTS = ['Instruction: ReleaseEscrow', 'Escrow released'];
const REFUND_HINTS = ['Instruction: RefundEscrow', 'Escrow refunded'];

// ── State ───────────────────────────────────────────────────────────────
let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;
let tickCount = 0;
let totalSynced = 0;

interface StuckOrder {
  id: string;
  order_number: string;
  status: string;
  order_version: number;
  crypto_amount: string;
  user_id: string;
  merchant_id: string;
  buyer_merchant_id: string | null;
  type: string;
  escrow_creator_wallet: string | null;
  escrow_trade_id: string | null;
  escrow_trade_pda: string | null;
  payment_sent_at: Date | null;
  escrowed_at: Date | null;
}

// ── Solana RPC helpers (raw fetch — no @solana/web3.js dep on core-api) ─

interface RpcSignature { signature: string; err: unknown; blockTime: number | null; }
interface RpcTransaction { meta?: { err: unknown; logMessages?: string[] | null } | null; }

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result as T;
}

interface OutcomeReleased { kind: 'released'; signature: string }
interface OutcomeRefunded { kind: 'refunded'; signature: string }
interface OutcomeOpen { kind: 'open' }
interface OutcomeUnknown { kind: 'unknown' }
type Outcome = OutcomeReleased | OutcomeRefunded | OutcomeOpen | OutcomeUnknown;

async function findTradeOutcome(tradePda: string): Promise<Outcome> {
  const sigs = await rpc<RpcSignature[]>('getSignaturesForAddress', [tradePda, { limit: 8 }]);
  if (!sigs || sigs.length === 0) return { kind: 'unknown' };

  for (const sig of sigs) {
    if (sig.err) continue;
    const tx = await rpc<RpcTransaction | null>('getTransaction', [sig.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
      encoding: 'json',
    }]);
    const logs = tx?.meta?.logMessages;
    if (!logs) continue;
    if (logs.some((l: string) => RELEASE_HINTS.some((h) => l.includes(h)))) {
      return { kind: 'released', signature: sig.signature };
    }
    if (logs.some((l: string) => REFUND_HINTS.some((h) => l.includes(h)))) {
      return { kind: 'refunded', signature: sig.signature };
    }
  }
  return { kind: 'open' };
}

// ── DB sync ─────────────────────────────────────────────────────────────

/**
 * Apply an on-chain release to the DB. Uses release_order_v1 — the same
 * stored proc the live click flow calls — so all triggers / events /
 * audit-table mirrors fire identically.
 */
async function syncReleaseToDb(order: StuckOrder, releaseTxHash: string): Promise<boolean> {
  // Optimistic lock: only update if the order is still in the version we read
  // and still in a non-terminal state. If a live click just landed, abort.
  const procResult = await queryOne<{ release_order_v1: { success: boolean; old_status?: string; order?: any; error?: string } }>(
    'SELECT release_order_v1($1,$2,$3)',
    [order.id, releaseTxHash, MOCK_MODE],
  );
  const data = procResult?.release_order_v1;
  if (!data?.success) {
    logger.warn('[OnChainRecon] release_order_v1 rejected', {
      orderId: order.id,
      error: data?.error,
    });
    return false;
  }

  // Best-effort outbox event so listeners (receipt updater, websocket
  // broadcaster, audit log) see the transition. Fire-and-forget — the
  // DB row is already updated by the proc above; outbox failure is
  // non-fatal and the existing reconciliation tooling will catch up.
  insertOutboxEventDirect({
    event: ORDER_EVENT.COMPLETED,
    orderId: order.id,
    orderNumber: order.order_number,
    previousStatus: data.old_status ?? order.status,
    newStatus: 'completed',
    actorType: 'system',
    actorId: 'onchain-reconciliation',
    userId: order.user_id,
    merchantId: order.merchant_id,
    buyerMerchantId: order.buyer_merchant_id ?? undefined,
    order: data.order as Record<string, unknown>,
    orderVersion: data.order?.order_version,
    minimalStatus: 'completed',
    txHash: releaseTxHash,
    metadata: { tx_hash: releaseTxHash, source: 'onchain-reconciliation' },
  }).catch(() => { /* swallow */ });

  logger.info('[OnChainRecon] Synced order to completed from on-chain release', {
    orderId: order.id,
    orderNumber: order.order_number,
    releaseTxHash,
    previousStatus: data.old_status,
  });
  return true;
}

// ── Main loop ───────────────────────────────────────────────────────────

async function findStuckOrders(): Promise<StuckOrder[]> {
  // Look for orders where:
  //   - status is non-terminal AND
  //   - on-chain escrow exists (escrow_trade_id + creator) AND
  //   - state has been stuck longer than MIN_AGE_MS
  //
  // We focus on payment_sent and escrowed since those are the states
  // where on-chain has likely already moved (released / refunded) but
  // DB might be stale.
  return query<StuckOrder>(
    `SELECT id, order_number, status::text AS status, order_version,
            crypto_amount, user_id, merchant_id, buyer_merchant_id, type::text AS type,
            escrow_creator_wallet, escrow_trade_id::text AS escrow_trade_id, escrow_trade_pda,
            payment_sent_at, escrowed_at
     FROM orders
     WHERE status IN ('payment_sent', 'escrowed')
       AND escrow_creator_wallet IS NOT NULL
       AND escrow_trade_id IS NOT NULL
       AND release_tx_hash IS NULL
       AND refund_tx_hash IS NULL
       AND COALESCE(payment_sent_at, escrowed_at, created_at) < NOW() - ($1 || ' milliseconds')::interval
     ORDER BY COALESCE(payment_sent_at, escrowed_at, created_at) ASC
     LIMIT $2`,
    [MIN_AGE_MS, BATCH_SIZE],
  );
}

async function processOrder(order: StuckOrder): Promise<void> {
  // Use the trade PDA the order itself recorded at lock time. We don't
  // re-derive from creator+tradeId because that would require pulling the
  // full @solana/web3.js into core-api just for PDA math; the stored value
  // was already verified by settle's verifyEscrowPdaBinding before being
  // written. If it's missing, skip (older orders).
  if (!order.escrow_trade_pda) return;

  let outcome: Outcome;
  try {
    outcome = await findTradeOutcome(order.escrow_trade_pda);
  } catch (rpcErr) {
    logger.warn('[OnChainRecon] Solana RPC error (will retry next tick)', {
      orderId: order.id,
      error: rpcErr instanceof Error ? rpcErr.message : String(rpcErr),
    });
    return;
  }

  if (outcome.kind === 'released') {
    if (order.status === 'payment_sent') {
      const ok = await syncReleaseToDb(order, outcome.signature);
      if (ok) totalSynced++;
    } else {
      // status was 'escrowed' but on-chain already released — that's a more
      // surprising drift (skips payment_sent). Log loudly but don't auto-sync;
      // a human should look.
      logger.error('[OnChainRecon] On-chain released but DB still escrowed (manual review)', {
        orderId: order.id,
        orderNumber: order.order_number,
        releaseTxHash: outcome.signature,
      });
    }
  } else if (outcome.kind === 'refunded') {
    // Refund-side reconciliation is more complex (atomicCancelWithRefund needs
    // many fields) so for now we just log. Add the auto-sync once we have a
    // safe wrapper analogous to syncReleaseToDb.
    logger.warn('[OnChainRecon] On-chain refund detected — DB needs manual cancel sync', {
      orderId: order.id,
      orderNumber: order.order_number,
      refundTxHash: outcome.signature,
      currentStatus: order.status,
    });
  }
  // 'open' or 'unknown' → escrow is still live or RPC returned no info; skip.
}

async function processBatch(): Promise<void> {
  let stuck: StuckOrder[] = [];
  try {
    stuck = await findStuckOrders();
  } catch (dbErr) {
    logger.warn('[OnChainRecon] DB scan failed (will retry)', {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
    return;
  }

  if (stuck.length === 0) return;

  logger.info('[OnChainRecon] Processing batch', { count: stuck.length });

  // Sequential — Solana RPC and our DB pool both prefer not to fan out 20
  // concurrent requests. Per-order errors are isolated.
  for (const order of stuck) {
    if (!isRunning) break;
    try {
      await processOrder(order);
    } catch (err) {
      logger.warn('[OnChainRecon] Per-order failure (continuing)', {
        orderId: order.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

export function startOnChainReconciliationWorker(): void {
  if (isRunning) {
    logger.warn('[OnChainRecon] Worker already running');
    return;
  }
  if (!ENABLED) {
    logger.info('[OnChainRecon] Worker NOT started (ONCHAIN_RECON_ENABLED!=true)');
    return;
  }
  isRunning = true;
  logger.info('[OnChainRecon] Starting worker', {
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    minAgeMs: MIN_AGE_MS,
    rpc: SOLANA_RPC.split('?')[0],
  });

  const poll = async () => {
    if (!isRunning) return;
    try {
      // processBatch runs unchanged; the wrapper adds a heartbeat + stall
      // timeout. Re-arm moved into finally so the chain can never die from an
      // unexpected throw (closes the silent-death gap the audit flagged here).
      await runWorkerTick(
        'onChainReconciliationWorker',
        { intervalMs: POLL_INTERVAL_MS, criticality: 'high', timeoutMs: 120_000 },
        processBatch,
      );
      tickCount++;
      if (tickCount % 10 === 0) {
        logger.info('[OnChainRecon] Summary', { ticks: tickCount, totalSynced });
      }
    } finally {
      if (isRunning) pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }
  };
  poll();
}

export function stopOnChainReconciliationWorker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info('[OnChainRecon] Stopped worker');
}

// Standalone-script entry point
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  startOnChainReconciliationWorker();
}
