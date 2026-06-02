/**
 * Balance Reconciler — detect (default) + optional auto-correct (refund-balance fix).
 *
 * Why this exists:
 *   The DB `balance` column is a cached snapshot of the on-chain USDT ATA.
 *   Escrow LOCK deducts the cache, but escrow REFUND (esp. worker-driven ones:
 *   escrow-expiry, dispute auto-resolve, stuck on-chain refunds) deliberately
 *   does NOT credit the cache back — it relies on /api/merchant/sync-balance,
 *   which only the browser calls, and only for merchants. So after automatic
 *   refunds the cache silently drifts away from the real on-chain balance.
 *
 * What this does:
 *   For each entity (merchant/user) that had a recent ESCROW_REFUND, it reads
 *   the real on-chain balance and compares it to the cached DB balance. On drift
 *   it always LOGS (safeLog → error_logs → /admin/error-logs). If — and only if —
 *   BALANCE_RECON_WRITE=true it ALSO corrects the cache via syncBalanceFromChain
 *   (re-reads confident on-chain truth under a per-account lock, writes cache =
 *   chain). The correction is one-directional and can never lose/double money.
 *
 * Safety / zero-regression:
 *   - NOT on any order/escrow code path — it cannot affect the order flow. The
 *     refund/cancel/dispute code is entirely untouched.
 *   - Two independent off-switches: auto-run needs BALANCE_RECON_ENABLED=true;
 *     any write needs BALANCE_RECON_WRITE=true. Both default OFF → pure detection.
 *   - Skips uncertain on-chain reads (transient RPC errors) — never acts on bad data.
 *   - Skipped entirely in MOCK_MODE (no real chain to compare).
 *   - One-shot, detect only:      npx tsx src/workers/balance-reconciler.ts
 *   - One-shot, backfill/correct: BALANCE_RECON_WRITE=true npx tsx src/workers/balance-reconciler.ts
 */

import { query } from '@/lib/db';
import { logger } from '@/lib/logger';
import { safeLog } from '@/lib/errorTracking/logger';
import { MOCK_MODE } from 'settlement-core';
import { readOnChainUsdtBalance } from '@/lib/solana/readOnChainBalance';
import { syncBalanceFromChain } from '@/lib/balance/syncOnChainBalance';

const ENABLED = (process.env.BALANCE_RECON_ENABLED || '').toLowerCase() === 'true';
const WRITE = (process.env.BALANCE_RECON_WRITE || '').toLowerCase() === 'true'; // Step 3 auto-correct — DEFAULT OFF
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
export async function runBalanceReconcileOnce(): Promise<{ scanned: number; checked: number; drifts: number; corrected: number; skipped: number }> {
  let checked = 0;
  let drifts = 0;
  let corrected = 0;
  let skipped = 0;
  let entities: Candidate[] = [];
  try {
    entities = await findRecentRefundEntities();
  } catch (err) {
    logger.error('[BalanceRecon] failed to load candidates', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { scanned: 0, checked: 0, drifts: 0, corrected: 0, skipped: 0 };
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

        // Step 3 auto-correct: only when BALANCE_RECON_WRITE=true. The reconciler
        // never mutates a balance itself — it delegates to syncBalanceFromChain,
        // which re-reads confident on-chain truth under a per-account lock and
        // writes the cache = chain (one-directional; can never lose/double money).
        // Because it always writes CURRENT truth and self-corrects next pass, an
        // in-flight (not-yet-settled) refund needs no special handling.
        let correction: Awaited<ReturnType<typeof syncBalanceFromChain>> | null = null;
        if (WRITE) {
          correction = await syncBalanceFromChain({ type: c.account_type, id: c.account_id });
          if (correction.ok && correction.changed) corrected++;
        }
        const didCorrect = !!(correction && correction.ok && correction.changed);

        safeLog({
          type: didCorrect ? 'balance.onchain_drift_corrected' : 'balance.onchain_drift',
          severity: Math.abs(diff) > 1 ? 'ERROR' : 'WARN',
          source: 'worker',
          message: didCorrect
            ? `Balance drift CORRECTED: ${c.account_type} ${c.account_id} — DB ${db.balance} → ${onChain.balance} (was off by ${diff.toFixed(6)})`
            : `Balance drift: ${c.account_type} ${c.account_id} — DB=${db.balance} on-chain=${onChain.balance} (diff ${diff.toFixed(6)})`,
          metadata: {
            account_type: c.account_type,
            account_id: c.account_id,
            db_balance: db.balance,
            onchain_balance: onChain.balance,
            diff,
            wallet: db.wallet,
            detection_only: !WRITE,
            corrected: didCorrect,
            correction: WRITE ? correction : undefined,
          },
        });
      }
    } catch (err) {
      // Never let one entity abort the pass.
      logger.error('[BalanceRecon] entity check failed', {
        account_id: c.account_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: entities.length, checked, drifts, corrected, skipped };
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
  logger.info(`[BalanceRecon] started (${WRITE ? 'AUTO-CORRECT' : 'DETECTION ONLY'})`, {
    write: WRITE,
    intervalMs: INTERVAL_MS,
    lookbackHours: LOOKBACK_HOURS,
  });

  const poll = async () => {
    if (!isRunning) return;
    const res = await runBalanceReconcileOnce();
    if (res.drifts > 0 || res.corrected > 0 || res.skipped > 0) {
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

// One-shot manual run (ignores ENABLE flag so you can test on demand). It still
// honours BALANCE_RECON_WRITE: default = detect only; set it to also backfill.
//   Detect only:        npx tsx src/workers/balance-reconciler.ts
//   Backfill/correct:   BALANCE_RECON_WRITE=true npx tsx src/workers/balance-reconciler.ts
if (require.main === module) {
  (async () => {
    if (MOCK_MODE) {
      // eslint-disable-next-line no-console
      console.log('[BalanceRecon] MOCK_MODE is on — on-chain compare is meaningless here.');
    }
    const res = await runBalanceReconcileOnce();
    // eslint-disable-next-line no-console
    console.log(
      '[BalanceRecon] one-shot complete:',
      res,
      WRITE ? '(AUTO-CORRECT — drifts synced to on-chain truth)' : '(DETECTION ONLY — no balances changed)',
    );
    process.exit(0);
  })().catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[BalanceRecon] failed:', e);
    process.exit(1);
  });
}
