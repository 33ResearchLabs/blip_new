// Server-side persistence for device fingerprints captured at signup.
// All functions are fire-and-forget safe — they swallow errors so a failed
// write can never break a signup. The cost of missing fingerprint data is
// a slightly less accurate risk score, not a broken user flow.

import crypto from 'crypto';
import { query } from '@/lib/db';
import type { ActorType } from './types';

export interface FingerprintPayload {
  visitor_id: string;
  components: Record<string, unknown>;
}

/** Canonical-stringify a components blob so the SAME components always hash
 *  to the same fp_hash regardless of key order or whitespace. */
function canonicalize(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const ordered: Record<string, unknown> = {};
  for (const k of keys) ordered[k] = obj[k];
  return JSON.stringify(ordered);
}

function hashFingerprint(components: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(canonicalize(components)).digest('hex');
}

export interface ValidatedFingerprint {
  fp_hash: string;
  visitor_id: string;
  components: Record<string, unknown>;
}

/**
 * Validate and normalise a payload submitted from a client. Returns null
 * for anything that doesn't look like a fingerprint (oversized, missing
 * fields, etc.) — we never let invalid client data into the DB.
 */
export function validateFingerprintPayload(input: unknown): ValidatedFingerprint | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const visitor_id = typeof raw.visitor_id === 'string' ? raw.visitor_id.trim() : null;
  const components = raw.components && typeof raw.components === 'object' && !Array.isArray(raw.components)
    ? raw.components as Record<string, unknown>
    : null;
  if (!visitor_id || !components) return null;

  // Bound the components blob to 8KB. A legit homegrown fingerprint is
  // <1KB; anything massive is an attempt to flood the row.
  const canonical = canonicalize(components);
  if (canonical.length > 8192) return null;

  // visitor_id must be alnum + 6..64 chars.
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(visitor_id)) return null;

  return {
    fp_hash: hashFingerprint(components),
    visitor_id,
    components,
  };
}

/**
 * Upsert the fingerprint row + link it to the actor. Both writes happen in
 * sequence (no transaction needed — each is independently safe and a partial
 * failure leaves the system in a consistent state). Errors swallowed.
 */
export async function saveAndLinkFingerprint(
  actorType: ActorType,
  actorId: string,
  fp: ValidatedFingerprint,
  source: 'signup' | 'login' = 'signup',
): Promise<void> {
  try {
    // Upsert the fingerprint. signup_count bumps only when a NEW actor links
    // to this fp (handled below); here we just refresh last_seen + ensure
    // the row exists.
    await query(
      `INSERT INTO device_fingerprints (fp_hash, visitor_id, components, signup_count)
       VALUES ($1, $2, $3::jsonb, 1)
       ON CONFLICT (fp_hash) DO UPDATE SET
         last_seen = NOW()`,
      [fp.fp_hash, fp.visitor_id, JSON.stringify(fp.components)],
    );

    // Insert the actor↔fingerprint link. ON CONFLICT DO UPDATE refreshes the
    // captured_at. If the row was newly inserted (first link from this
    // actor), bump signup_count on the fingerprint as a separate query.
    const linkInsert = await query<{ id: string }>(
      `INSERT INTO actor_device_fingerprints (actor_id, actor_type, fp_hash, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (actor_type, actor_id, fp_hash) DO UPDATE SET
         captured_at = NOW()
       RETURNING (xmax = 0) AS is_new, id`,
      [actorId, actorType, fp.fp_hash, source],
    );

    // is_new = true only when the link was actually inserted (not updated).
    // We need to query separately because the RETURNING clause above doesn't
    // expose xmax cleanly across all pg versions; do an additional query
    // checking whether the actor already had this fp before this call.
    if (linkInsert.length > 0) {
      await query(
        `UPDATE device_fingerprints
            SET signup_count = (
              SELECT COUNT(DISTINCT (actor_type, actor_id))
                FROM actor_device_fingerprints
               WHERE fp_hash = $1
            )
          WHERE fp_hash = $1`,
        [fp.fp_hash],
      );
    }
  } catch (err) {
    console.error('[threat/devicePersist] saveAndLinkFingerprint failed', { actorType, actorId, err });
  }
}

/** Fire-and-forget version: returns immediately, persistence runs in
 *  background, errors swallowed. Use from request paths. */
export function persistFingerprintAsync(
  actorType: ActorType,
  actorId: string,
  fp: ValidatedFingerprint,
  source: 'signup' | 'login' = 'signup',
): void {
  saveAndLinkFingerprint(actorType, actorId, fp, source).catch(err => {
    console.error('[threat/devicePersist] async persist failed', err);
  });
}
