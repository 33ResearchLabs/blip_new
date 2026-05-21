/**
 * Server-side capture of x-device-id + x-device-fingerprint headers
 * into the `device_accounts` table. Called from every successful auth
 * route (login, refresh, signup).
 *
 * Failure is non-fatal — we never block auth on a fingerprint write
 * failing. The table is for fraud signal, not access control.
 *
 * Scale-safe: a single UPSERT per auth event. The primary key is
 * (device_id, actor_type, actor_id) so re-logins from the same device
 * just touch `last_seen` without exploding row counts.
 */

import { query } from '@/lib/db';
import type { NextRequest } from 'next/server';
import type { WaitlistActorType } from '@/lib/types/database';

// The existing client lib at lib/device/fingerprint.ts already sets
// `x-device-id` (a SHA-256 of browser features) and `x-device-meta`
// (the JSON of the feature bag). We treat `x-device-id` as the
// primary key and store a short hash of `x-device-meta` as the
// secondary fingerprint signal — useful when the localStorage id
// gets wiped but the browser features stay stable.
const DEVICE_ID_HEADER = 'x-device-id';
const FINGERPRINT_HEADER = 'x-device-meta';

export async function captureDeviceForActor(args: {
  request: NextRequest;
  actorId: string;
  actorType: WaitlistActorType;
}): Promise<void> {
  const deviceId = args.request.headers.get(DEVICE_ID_HEADER);
  const fingerprint = args.request.headers.get(FINGERPRINT_HEADER);
  if (!deviceId) return; // Old clients without the lib — silent skip.

  try {
    await query(
      `INSERT INTO device_accounts
         (device_id, fingerprint_hash, actor_id, actor_type, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (device_id, actor_type, actor_id)
       DO UPDATE SET last_seen = NOW(),
                     fingerprint_hash = COALESCE(EXCLUDED.fingerprint_hash, device_accounts.fingerprint_hash)`,
      [deviceId, fingerprint, args.actorId, args.actorType],
    );
  } catch (err) {
    // Don't propagate — we never want a fraud-signal write to block auth.
    console.error('[deviceCapture] insert failed', err);
  }
}

/**
 * How many distinct accounts share this device? Used by the
 * `guardDeviceMultiAccount` security guard.
 */
export async function countAccountsForDevice(deviceId: string): Promise<number> {
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT actor_id)::int AS cnt FROM device_accounts WHERE device_id = $1`,
    [deviceId],
  );
  return row?.cnt ?? 0;
}

/**
 * Same lookup via fingerprint hash (catches localStorage-wiped re-signups).
 */
export async function countAccountsForFingerprint(fingerprint: string): Promise<number> {
  const { queryOne } = await import('@/lib/db');
  const row = await queryOne<{ cnt: number }>(
    `SELECT COUNT(DISTINCT actor_id)::int AS cnt FROM device_accounts WHERE fingerprint_hash = $1`,
    [fingerprint],
  );
  return row?.cnt ?? 0;
}
