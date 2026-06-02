/**
 * Balance Reconciler — DETECTION ONLY (Step 1 of the refund-balance fix).
 *
 * Why this exists:
 *   The DB `balance` column is a cached snapshot of the on-chain USDT ATA.
 *   Escrow LOCK deducts the cache, but escrow REFUND (esp. worker-driven ones:
 *   escrow-expiry, dispute auto-resolve, stuck on-chain refunds) deliberately
 *   does NOT credit the cache back — it relies on /api/merchant/sync-balance,
 *   which only the browser calls, and only for merchants. So after automatic
 *   refunds the cache silently drifts below the real on-chain balance.
 *
 * What this does:
 *   For each entity (merchant/user) that had a recent ESCROW_REFUND, it reads
 *   the real on-chain balance and compares it to the cached DB balance. If they
 *   differ it LOGS the drift (safeLog → error_logs → /admin/error-logs). It
 *   writes NOTHING to any balance.
 *
 * Safety:
 *   - READ-ONLY. No UPDATE of any balance/order/escrow. Cannot affect the order
 *     flow — it is not on any order's code path.
 *   - Skips uncertain on-chain reads (transient RPC errors) — never acts on bad data.
 *   - Auto-run is OFF unless BALANCE_RECON_ENABLED=true, and skipped in MOCK_MODE.
 *   - Run a one-shot by hand to validate:  npx tsx src/workers/balance-reconciler.ts
 *
 * Step 2 (LATER, behind BALANCE_RECON_WRITE=true): the same drift handler will
 * call a hardened sync to update the DB cache to on-chain truth. Not in Step 1.
 */

import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { safeLog } from '@/lib/errorTracking/logger';
import { MOCK_MODE } from 'settlement-core';
import { readOnChainUsdtBalance } from '@/lib/solana/readOnChainBalance';

const ENABLED = (process.env.BALANCE_RECON_ENABLED || '').toLowerCase() === 'true';
const WRITE = (process.env.BALANCE_RECON_WRITE || '').toLowerCase() === 'true'; // Step 2 — default off
const INTERVAL_MS = parseInt(process.env.BALANCE_RECON_POLL_MS || '300000', 10); // 5 min
const LOOKBACK_HOURS = parseInt(process.env.BALANCE_RECON_LOOKBACK_HOURS || '48', 10);
const DRIFT_THRESHOLD = parseFloat(process.env.BALANCE_RECON_DRIFT_THRESHOLD || '0.01');
const BATCH = parseInt(process.env.BALANCE_RECON_BATCH || '200', 10);

let isRunning = false;
let pollTimer: NodeJS.Timeout | null = null;

interface Candidate {
  account_type: string;
  account_id: string;
}

/** Entities with an ESCROW_REFUND ledger entry in the lookback window. */
async function findRecentRefundEntities(): Promise<Candidate[]> {
  return query<Candidate>(
    `SELECT DISTINCT account_type, account_id
       FROM ledger_entries
      WHERE entry_type = 'ESCROW_REFUND'
        AND account_id IS NOT NULL
        AND created_at > NOW() - ($1 || ' hours')::interval
      LIMIT $2`,
    [String(LOOKBACK_HOURS), BATCH],
  );
}

async function getDbBalance(c: Candidate): Promise<{ wallet: string | null; balance: number } | null> {
  const table = c.account_type.toLowerCase().startsWith('merchant') ? 'merchants' : 'users';
  const rows = await query<{ wallet_address: string | null; balance: string | number | null }>(
    `SELECT wallet_address, balance FROM ${table} WHERE id = $1`,
    [c.account_id],
  );
  if (rows.length === 0) return null;
  return { wallet: rows[0].wallet_address, balance: Number(rows[0].balance ?? 0) };
}

/** One detection pass. Returns counts. Never throws. */
export async function runBalanceReconcileOnce(): Promise<{ scanned: number; checked: number; drifts: number; skipped: number }> {
  let checked = 0;
  let drifts = 0;
  let skipped = 0;
  let entities: Candidate[] = [];
  try {
    entities = await findRecentRefundEntities();
  } catch (err) {
    logger.error('[BalanceRecon] failed to load candidates', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, checked: 0, drifts: 0, skipped: 0 };
  }

  for (const c of entities) {
    try {
      const db = await getDbBalance(c);
      if (!db || !db.wallet) {
        skipped++;
        continue; // no wallet → nothing to compare against
      }
      const onChain = await readOnChainUsdtBalance(db.wallet);
      if (!onChain.confident) {
        skipped++; // transient/unknown read — never act on bad data
        continue;
      }
      checked++;
      const diff = onChain.balance - db.balance;
      if (Math.abs(diff) > DRIFT_THRESHOLD) {
        drifts++;
        safeLog({
          type: 'balance.onchain_drift',
          severity: Math.abs(diff) > 1 ? 'ERROR' : 'WARN',
          source: 'worker',
          message: `Balance drift: ${c.account_type} ${c.account_id} — DB=${db.balance} on-chain=${onChain.balance} (diff ${diff.toFixed(6)})`,
          metadata: {
            account_type: c.account_type,
            account_id: c.account_id,
            db_balance: db.balance,
            onchain_balance: onChain.balance,
            diff,
            wallet: db.wallet,
            detection_only: !WRITE, // Step 1: always true (we did NOT write)
          },
        });
        // Step 1 = DETECTION ONLY. Step 2 (if WRITE) will hardened-sync here.
      }
    } catch (err) {
      // Never let one entity abort the pass.
      logger.error('[BalanceRecon] entity check failed', {
        account_id: c.account_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: entities.length, checked, drifts, skipped };
}

export async function startBalanceReconciler(): Promise<void> {
  if (!ENABLED) {
    logger.info('[BalanceRecon] disabled (set BALANCE_RECON_ENABLED=true to run)');
    return;
  }
  if (MOCK_MODE) {
    logger.info('[BalanceRecon] skipped in MOCK_MODE (no real chain to compare)');
    return;
  }
  if (isRunning) return;
  isRunning = true;
  logger.info('[BalanceRecon] started (DETECTION ONLY)', {
    write: WRITE,
    intervalMs: INTERVAL_MS,
    lookbackHours: LOOKBACK_HOURS,
  });

  const poll = async () => {
    if (!isRunning) return;
    const res = await runBalanceReconcileOnce();
    if (res.drifts > 0 || res.skipped > 0) {
      logger.info('[BalanceRecon] pass complete', res);
    }
    pollTimer = setTimeout(poll, INTERVAL_MS);
  };
  await poll();
}

export function stopBalanceReconciler(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

// One-shot manual validation run (ignores ENABLE flag so you can test on demand):
//   npx tsx src/workers/balance-reconciler.ts
if (require.main === module) {
  (async () => {
    if (MOCK_MODE) {
      // eslint-disable-next-line no-console
      console.log('[BalanceRecon] MOCK_MODE is on — on-chain compare is meaningless here.');
    }
    const res = await runBalanceReconcileOnce();
    // eslint-disable-next-line no-console
    console.log('[BalanceRecon] one-shot complete:', res, '(DETECTION ONLY — no balances changed)');
    process.exit(0);
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[BalanceRecon] failed:', e);
    process.exit(1);
  });
}
