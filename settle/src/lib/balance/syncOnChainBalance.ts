/**
 * Safe on-chain → DB balance refresh (Step 2 of the refund-balance fix).
 *
 * The ONE reliable way to make the DB `balance` cache match the on-chain USDT
 * truth, for BOTH merchants and users. It is deliberately ONE-DIRECTIONAL:
 * it copies on-chain → DB. It can never lose or invent money — at worst it
 * makes the cache exactly equal the chain, or (on an uncertain read) does
 * nothing at all.
 *
 * Why this is safe (zero-regression):
 *   - CONFIDENT reads only. If the on-chain read is uncertain (RPC down,
 *     timeout, rate-limit) we DO NOT WRITE — a good cached balance is never
 *     overwritten with a wrong/zero value. (readOnChainUsdtBalance enforces this.)
 *   - The network read happens OUTSIDE the DB transaction, so we never hold a
 *     pooled connection / row lock open across a slow RPC call.
 *   - A per-account transaction advisory lock + `SELECT ... FOR UPDATE` re-read
 *     serialise concurrent syncs of the same account, so two refreshes can't
 *     interleave their writes (closes the "no per-wallet lock" race).
 *   - Writes only when the cached value actually differs (> dust threshold).
 *   - Never throws; always returns a structured result.
 *   - Skipped entirely in MOCK_MODE (no real chain to read).
 *
 * Scope of THIS file: it only DEFINES the capability. Nothing auto-runs it yet,
 * so adding this file changes no existing behaviour. Wiring it to fire after a
 * refund (Step 3) and letting the reconciler call it (behind BALANCE_RECON_WRITE)
 * are later, separately-gated steps.
 *
 * Finality note for the wiring step (NOT this file's concern): this function
 * writes whatever the chain currently says. The CALLER must only invoke it once
 * the relevant refund tx is confirmed on-chain — otherwise a pre-settlement read
 * would (correctly, but prematurely) copy a not-yet-credited balance.
 */

import { queryOne, transaction } from '@/lib/db';
import { logger } from '@/lib/logger';
import { MOCK_MODE } from 'settlement-core';
import { readOnChainUsdtBalance } from '@/lib/solana/readOnChainBalance';

export type AccountKind = 'merchant' | 'user';

export type BalanceSyncResult =
  | { ok: true; changed: boolean; previous: number; balance: number }
  | { ok: false; changed: false; reason: string; previous?: number };

/** Tiny threshold below which a balance difference is treated as noise (matches sync-balance route). */
const DUST = 0.000001;

function errMsg(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/**
 * Map a raw account-type string (e.g. ledger `account_type` = 'MERCHANT' | 'USER',
 * or 'merchant'/'user') to the table it lives in. Anything that isn't clearly a
 * merchant is treated as a user — mirrors the reconciler's existing logic.
 */
export function normalizeAccountKind(raw: string | null | undefined): AccountKind {
  return String(raw || '').toLowerCase().startsWith('merchant') ? 'merchant' : 'user';
}

/**
 * Refresh one account's cached DB balance from its on-chain USDT ATA.
 *
 * @param account.type  'merchant' | 'user' (or any ledger account_type string)
 * @param account.id    the merchants.id / users.id primary key
 * @returns a structured result; never throws.
 */
export async function syncBalanceFromChain(account: {
  type: AccountKind | string;
  id: string;
}): Promise<BalanceSyncResult> {
  // 1. MOCK_MODE has no real chain to read — there is nothing authoritative to copy.
  if (MOCK_MODE) {
    return { ok: false, changed: false, reason: 'mock_mode' };
  }

  const kind = normalizeAccountKind(account.type);
  // `table` is derived ONLY from the allowlist above (literal 'merchants'|'users'),
  // never from user input — safe to interpolate (pg can't parameterise identifiers).
  const table = kind === 'merchant' ? 'merchants' : 'users';
  const id = account.id;

  if (!id) {
    return { ok: false, changed: false, reason: 'missing_account_id' };
  }

  // 2. Read the current cached row (wallet + balance). Read-only.
  let row: { wallet_address: string | null; balance: string | number | null } | null;
  try {
    row = await queryOne<{ wallet_address: string | null; balance: string | number | null }>(
      `SELECT wallet_address, balance FROM ${table} WHERE id = $1`,
      [id],
    );
  } catch (err) {
    return { ok: false, changed: false, reason: `db_read_failed: ${errMsg(err)}` };
  }
  if (!row) {
    return { ok: false, changed: false, reason: 'account_not_found' };
  }
  if (!row.wallet_address) {
    // No wallet → nothing on-chain to reconcile against. Leave the cache untouched.
    return { ok: false, changed: false, reason: 'no_wallet_address', previous: Number(row.balance ?? 0) };
  }

  // 3. Read CONFIDENT on-chain truth — OUTSIDE any DB transaction (network call).
  const onChain = await readOnChainUsdtBalance(row.wallet_address);
  if (!onChain.confident) {
    // Transient/unknown read — never overwrite a good balance with bad data.
    return { ok: false, changed: false, reason: `unconfident_read: ${onChain.reason}`, previous: Number(row.balance ?? 0) };
  }
  const target = onChain.balance;

  // 4. Short transaction: per-account advisory lock + FOR UPDATE re-read + conditional write.
  //    The FOR UPDATE re-read means we compare against the freshest cached value,
  //    not the pre-RPC snapshot, so a concurrent writer can't cause a lost update.
  try {
    return await transaction<BalanceSyncResult>(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [table, id]);

      const cur = await client.query<{ balance: string | number | null }>(
        `SELECT balance FROM ${table} WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (cur.rowCount === 0) {
        return { ok: false, changed: false, reason: 'account_not_found' };
      }

      const previous = Number(cur.rows[0].balance ?? 0);
      if (Math.abs(previous - target) <= DUST) {
        // Already in sync — no write needed.
        return { ok: true, changed: false, previous, balance: previous };
      }

      await client.query(`UPDATE ${table} SET balance = $1 WHERE id = $2`, [target, id]);
      logger.info('[balanceSync] reconciled cache from chain', {
        table,
        id,
        previous,
        onChain: target,
        delta: target - previous,
      });
      return { ok: true, changed: true, previous, balance: target };
    });
  } catch (err) {
    return { ok: false, changed: false, reason: `db_write_failed: ${errMsg(err)}` };
  }
}
