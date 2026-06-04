/**
 * Web Push sender.
 *
 * sendPushTo(userId, payload) fans out a notification to every subscription
 * registered for an actor (user or merchant). Used by API routes and core-
 * api event handlers.
 *
 * The VAPID keypair is read lazily from env (NEXT_PUBLIC_VAPID_PUBLIC_KEY /
 * VAPID_PRIVATE_KEY / VAPID_SUBJECT) so a missing env doesn't crash module
 * import — pushes just no-op until configured.
 *
 * Subscriptions that return 404 or 410 are pruned from the table.
 */

import webpush from 'web-push';
import { query } from '@/lib/db';

let configured = false;
function configureVapid(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:dev@blip.money';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Click target. Defaults to '/' for user, '/market' for merchant. */
  url?: string;
  /** Optional tag — pushes with the same tag replace each other instead of
   *  stacking. Useful for "order accepted" type events that only need to
   *  show the latest state. */
  tag?: string;
  /** Optional badge / icon overrides. Defaults are set in the SW. */
  icon?: string;
}

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

export async function sendPushTo(
  actorType: 'user' | 'merchant',
  actorId: string,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid()) {
    return { sent: 0, pruned: 0 };
  }

  const subs = await query<SubRow>(
    `SELECT id, endpoint, p256dh, auth, failure_count
       FROM push_subscriptions
      WHERE actor_type = $1 AND actor_id = $2`,
    [actorType, actorId],
  );
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  const body = JSON.stringify(payload);
  let sent = 0;
  const toPrune: string[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          // Subscription gone — prune permanently.
          toPrune.push(s.id);
        }
      }
    }),
  );

  let pruned = 0;
  if (toPrune.length > 0) {
    const result = await query(
      `DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[]) RETURNING id`,
      [toPrune],
    );
    pruned = result.length;
  }

  return { sent, pruned };
}
