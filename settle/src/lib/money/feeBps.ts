/**
 * Source of truth for the current protocol fee in basis points.
 *
 * Reads `protocol_config.fee_bps` if present, else falls back to the
 * `PROTOCOL_FEE_BPS` env var, else 250 (2.50%) as the product default.
 * Result is cached for 60s — the UI hits this on every price-poll.
 */

import { query } from '@/lib/db';

let cache: { value: number; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export async function getCurrentFeeBps(): Promise<number> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.value;

  let fromDb: number | null = null;
  try {
    const rows = await query<{ fee_bps: number | string }>(
      `SELECT fee_bps FROM protocol_config ORDER BY id DESC LIMIT 1`,
    );
    const row = rows[0];
    if (row && row.fee_bps != null) {
      const n = Number(row.fee_bps);
      if (Number.isInteger(n) && n >= 0 && n <= 10_000) fromDb = n;
    }
  } catch {
    // Table may not exist in some envs — fall back to env/default silently.
  }

  const envRaw = process.env.PROTOCOL_FEE_BPS;
  const fromEnv = envRaw ? Number(envRaw) : NaN;
  const envValid = Number.isInteger(fromEnv) && fromEnv >= 0 && fromEnv <= 10_000;

  const value = fromDb ?? (envValid ? fromEnv : 250);

  cache = { value, expiresAt: now + TTL_MS };
  return value;
}

/** Test/dev helper — invalidate the cache so the next call re-reads. */
export function __resetFeeBpsCache() {
  cache = null;
}
