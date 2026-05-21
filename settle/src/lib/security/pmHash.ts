/**
 * Salted hash of a payment method's canonical identity. Used purely
 * as a dedup signal in `payment_method_account_links` — never stored
 * alongside the raw PM details, never exposed to the client.
 *
 * The salt comes from PM_HASH_SALT (env). If unset we fall back to a
 * fixed dev salt; in production the env guard rejects boot unless it's
 * set, same as the other auth secrets.
 *
 * Canonicalisation rules per type:
 *   bank   → IBAN/account number, uppercased, no spaces
 *   upi/mobile → handle, lowercased, trimmed
 *   crypto → wallet address (case-sensitive — Solana base58 is)
 *   card   → last4 only (we never persist full PANs)
 *   cash   → no identity to dedup → skip
 */

import { createHash } from 'crypto';
import { query } from '@/lib/db';
import type { WaitlistActorType } from '@/lib/types/database';

const DEV_FALLBACK_SALT = 'blip-pm-hash-dev-salt-do-not-use-in-prod';
const SALT = process.env.PM_HASH_SALT || DEV_FALLBACK_SALT;

interface PaymentMethodLite {
  type: string;
  details?: string | null;
  // Some routes encode the identity as nested fields (account_number,
  // upi_id, etc). We don't try to be clever — callers pass us the
  // canonical identity string.
}

/** Compute a deterministic hash. Returns null if there's nothing to
 *  hash (cash-type PM, or empty details). */
export function hashPaymentMethodIdentity(pm: PaymentMethodLite): string | null {
  if (!pm.details) return null;
  const type = pm.type?.toLowerCase() ?? '';
  let canon = '';
  switch (type) {
    case 'bank':
      canon = pm.details.replace(/\s+/g, '').toUpperCase();
      break;
    case 'mobile':
    case 'upi':
      canon = pm.details.trim().toLowerCase();
      break;
    case 'crypto':
      canon = pm.details.trim(); // case-sensitive
      break;
    case 'card':
      // Last 4 only — the caller is responsible for stripping the rest.
      canon = pm.details.trim().slice(-4);
      break;
    case 'cash':
    default:
      return null;
  }
  if (!canon) return null;
  return createHash('sha256').update(SALT + ':' + type + ':' + canon).digest('hex');
}

/** Upsert a (pm_hash, actor) row. Idempotent — repeated saves of the
 *  same PM by the same actor just bump last_seen. */
export async function recordPmLink(args: {
  actorId: string;
  actorType: WaitlistActorType;
  pm: PaymentMethodLite;
}): Promise<void> {
  const h = hashPaymentMethodIdentity(args.pm);
  if (!h) return;
  try {
    await query(
      `INSERT INTO payment_method_account_links
         (pm_hash, actor_id, actor_type, first_seen, last_seen)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (pm_hash, actor_type, actor_id)
       DO UPDATE SET last_seen = NOW()`,
      [h, args.actorId, args.actorType],
    );
  } catch (err) {
    console.error('[pmHash] insert failed', err);
  }
}

/** How many distinct actors share this PM hash? Used by the dedup
 *  signal in fraud-flag aggregation. */
export async function countActorsForPmHash(pmHash: string): Promise<number> {
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT actor_id)::int AS cnt
       FROM payment_method_account_links
      WHERE pm_hash = $1`,
    [pmHash],
  );
  return row?.cnt ?? 0;
}
